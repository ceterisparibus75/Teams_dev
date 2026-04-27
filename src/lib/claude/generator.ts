// Orchestration de l'appel Claude (tool_use) avec retry, fallback Zod
// permissif et audit log. Le prompt système et l'outil sont dans prompts.ts,
// les conversions PvContent/MinutesContent dans converters.ts.

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { PvContentSchema, type PvContent } from '@/schemas/pv-content.schema'
import type { MeetingAttendanceLookup, MeetingAttendanceRecord, MinutesContent } from '@/types'
import { SYSTEM_PROMPT, GENERER_PV_TOOL, buildPrompt } from './prompts'
import { pvContentToMinutesContent, normalizeParticipantPresenceFromTranscript } from './converters'

const log = logger.child({ module: 'claude/generator' })

// ─── Client singleton ─────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return anthropicClient
}

// ─── Retry avec backoff exponentiel ──────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  delays = [2000, 5000],
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < delays.length && isRetryable(error)) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
        continue
      }
      throw error
    }
  }
  throw lastError
}

function isTransientApiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    msg.includes('overloaded') ||
    msg.includes('529') ||
    msg.includes('rate_limit') ||
    msg.includes('timeout') ||
    msg.includes('network')
  )
}

// ─── Génération principale ───────────────────────────────────────────────────

export type GenerationStyle = 'detailed'

export async function generateMinutesContent(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string; email?: string; company?: string | null }>,
  options?: {
    userId?: string
    minutesId?: string
    promptText?: string
    modelName?: string
    meetingDate?: Date
    attendanceRecords?: MeetingAttendanceRecord[]
    attendanceLookup?: MeetingAttendanceLookup
  },
): Promise<MinutesContent> {
  const client = getClient()
  const model = options?.modelName ?? 'claude-opus-4-7'
  const systemPrompt = options?.promptText ?? SYSTEM_PROMPT
  const attendanceRecords = options?.attendanceLookup?.records ?? options?.attendanceRecords ?? []
  const userMessage = buildPrompt(subject, transcription, participants, options?.meetingDate, attendanceRecords)
  const startMs = Date.now()

  let tokensInput = 0
  let tokensOutput = 0
  let status = 'success'
  let errorMessage: string | undefined

  log.info(
    { subject, transcriptionLength: (transcription ?? '').length, model },
    'Génération démarrée',
  )

  // stream().finalMessage() requis pour les appels potentiellement longs.
  // max_tokens=16000 : suffisant pour un PV très détaillé, évite stop_reason=max_tokens.
  const callClaude = () =>
    client.messages
      .stream({
        model,
        max_tokens: 16000,
        system: systemPrompt,
        tools: [GENERER_PV_TOOL],
        tool_choice: { type: 'tool', name: 'generer_pv' },
        messages: [{ role: 'user', content: userMessage }],
      })
      .finalMessage()

  // Diagnostic accumulé — inclus dans le message d'erreur final pour
  // diagnostic sans logs Vercel.
  let lastDiag = ''

  const extractToolInput = (response: Awaited<ReturnType<typeof callClaude>>, attempt: number) => {
    const blockTypes = response.content.map((b) => b.type).join(', ')
    log.info(
      { attempt, stop_reason: response.stop_reason, tokens_out: response.usage.output_tokens, blocs: blockTypes },
      'Tentative Claude',
    )

    const block = response.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | aucun bloc tool_use | blocs=[${blockTypes}] | tokens_out=${response.usage.output_tokens}`
      log.warn({ attempt }, lastDiag)
      return null
    }

    const input = block.input as Record<string, unknown>
    const keys = Object.keys(input)
    log.info({ attempt, keysCount: keys.length, keys }, 'Réponse Claude — clés')

    if (keys.length === 0) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | tool_use présent mais input={} (JSON tronqué ?) | tokens_out=${response.usage.output_tokens}`
      log.warn({ attempt }, lastDiag)
      return null
    }

    if (keys.length < 3) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | input partiel (${keys.length} clé(s): ${keys.join(',')}) | tokens_out=${response.usage.output_tokens}`
      log.warn({ attempt }, lastDiag)
    }

    // On accepte tout input non-vide (même partiel) — Zod valide ensuite
    return input
  }

  const callClaudeWithRetry = () => withRetry(callClaude, isTransientApiError)

  try {
    const MAX_TOOL_INPUT_ATTEMPTS = 3
    const TOOL_INPUT_DELAYS = [2000, 5000]

    let response = await callClaudeWithRetry()
    tokensInput = response.usage.input_tokens
    tokensOutput = response.usage.output_tokens

    let toolInput = extractToolInput(response, 1)

    for (let attempt = 2; !toolInput && attempt <= MAX_TOOL_INPUT_ATTEMPTS; attempt++) {
      const delay = TOOL_INPUT_DELAYS[attempt - 2]
      log.warn({ previousAttempt: attempt - 1, delayMs: delay }, 'Input vide, retry programmé')
      await new Promise((resolve) => setTimeout(resolve, delay))
      response = await callClaudeWithRetry()
      tokensInput += response.usage.input_tokens
      tokensOutput += response.usage.output_tokens
      toolInput = extractToolInput(response, attempt)
    }

    if (!toolInput) {
      throw new Error(
        `Claude a retourné une réponse vide après ${MAX_TOOL_INPUT_ATTEMPTS} tentatives. Diagnostic : ${lastDiag}`,
      )
    }

    // Si Claude a imbriqué le contenu sous une clé intermédiaire (ex: { "generer_pv": {...} }),
    // on détecte et déballe automatiquement.
    const topKeys = Object.keys(toolInput)
    if (topKeys.length === 1) {
      const nested = toolInput[topKeys[0]]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const nestedObj = nested as Record<string, unknown>
        if ('metadata' in nestedObj || 'resume' in nestedObj || 'sections' in nestedObj) {
          log.info({ wrapperKey: topKeys[0] }, 'Structure imbriquée détectée — déballage')
          toolInput = nestedObj
        }
      }
    }

    const topLevelKeys = Object.keys(toolInput).join(', ')
    log.debug({ topLevelKeys }, 'Clés top-level avant validation Zod')

    const validation = PvContentSchema.safeParse(toolInput)
    if (!validation.success) {
      log.warn({ topLevelKeys, zodErrors: validation.error.flatten() }, 'Zod validation partielle')
      const partial = toolInput as Partial<PvContent>
      if (partial.resume && partial.sections?.length) {
        const lenientInput = {
          metadata: partial.metadata ?? {
            date_reunion: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
            affaire: subject,
            type_procedure: 'Mandat ad hoc',
            signataire: '[Administrateur Judiciaire]',
          },
          modalites: partial.modalites ?? 'Réunion par visioconférence',
          participants: partial.participants ?? [],
          documents_amont: partial.documents_amont ?? [],
          resume: partial.resume,
          sections: partial.sections,
          points_desaccord: partial.points_desaccord ?? [],
          actions: partial.actions ?? [],
          points_vigilance: partial.points_vigilance ?? [],
          precisions_a_apporter: partial.precisions_a_apporter ?? [],
        }
        const lenientValidation = PvContentSchema.safeParse(lenientInput)
        if (lenientValidation.success) {
          return pvContentToMinutesContent(
            normalizeParticipantPresenceFromTranscript(lenientValidation.data, transcription, attendanceRecords),
          )
        }
        throw new Error(
          `Réponse Claude invalide (Zod) : ${lenientValidation.error.issues.map((i) => i.message).join(', ')} | clés reçues: ${topLevelKeys}`,
        )
      }
      throw new Error(
        `Réponse Claude incomplète. ` +
          `Clés reçues: [${topLevelKeys}]. ` +
          `Champs manquants: ${validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 5).join('; ')}`,
      )
    }

    return pvContentToMinutesContent(
      normalizeParticipantPresenceFromTranscript(validation.data, transcription, attendanceRecords),
    )
  } catch (error) {
    status = 'error'
    errorMessage = error instanceof Error ? error.message : String(error)
    log.error({ err: error }, 'Generation failed')
    throw error // On propage l'erreur — ne jamais écraser silencieusement un contenu existant
  } finally {
    if (options?.userId) {
      const transcriptHash = createHash('sha256').update(transcription ?? '').digest('hex')
      await prisma.generationAuditLog
        .create({
          data: {
            minutesId: options.minutesId ?? null,
            userId: options.userId,
            modele: model,
            tokensInput,
            tokensOutput,
            transcriptHash,
            durationMs: Date.now() - startMs,
            status,
            errorMessage: errorMessage ?? null,
          },
        })
        .catch((e) => log.error({ err: e, scope: 'AuditLog' }, 'Échec écriture audit log'))
    }
  }
}
