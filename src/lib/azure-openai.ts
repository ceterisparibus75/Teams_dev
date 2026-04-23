import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { PvContentSchema, type PvContent } from '@/schemas/pv-content.schema'
import type { MinutesContent, PVSection } from '@/types'

// ─── Constantes prompt ────────────────────────────────────────────────────────

const DOMAINE_EXPERTISE = `Tu es un assistant rédactionnel expert au service du cabinet SELAS BL & Associés, administrateurs judiciaires et mandataires ad hoc.

Tu maîtrises parfaitement :

PROCÉDURES AMIABLES — mandat ad hoc (art. L611-3 C.com.), conciliation (art. L611-4 à L611-15 C.com.), négociation avec créanciers bancaires et institutionnels, protocole de conciliation, homologation ou constatation par le président du tribunal, confidentialité, standstill, moratoires, abandons de créances, gels d'exigibilité.

PROCÉDURES COLLECTIVES — sauvegarde, sauvegarde accélérée, redressement judiciaire (art. L631-1 et s.), clôture par extinction du passif (art. L631-16), période d'observation, plan de continuation.

FINANCE D'ENTREPRISE EN DIFFICULTÉ — trésorerie disponible et prévisionnelle, BFR, EBE, EBITDA, dette financière nette, covenants bancaires, Dailly, affacturage, refinancement, augmentation de capital, cession d'actifs, business plan, free cash-flow.

MANAGEMENT — continuité d'exploitation, carnet de commandes, plan de retournement, communication aux parties prenantes.`

const MODELE_PV = `MODÈLE DE RÉFÉRENCE — Style exact à respecter :

"1- Propos introductifs

Le Mandataire ad hoc a rappelé le cadre de cette réunion, intervenant :
- A la suite de la procédure de conciliation qui a pris fin le 20 avril 2025 ;
- Dans le cadre de la procédure de mandat ad hoc ouverte le 25 avril 2025.

Il a été rappelé que, malgré les nombreuses réunions tenues avec les partenaires bancaires et la construction d'une solution de traitement des dettes bancaires dans le cadre de la précédente procédure de conciliation, l'une des trois banques (CE-N) a finalement refusé la proposition formulée."

"2- Présentation des travaux financiers

Grant Thornton a précisé avoir repris une méthodologie identique aux travaux précédents. Sur l'exercice 2025, les performances dépassent nettement les prévisions initiales. Les volumes atteignent 227,8 milliers de tonnes, contre 223 initialement anticipés.

L'EBITDA atteint environ 2,6 millions d'euros en 2025. Il progresserait ensuite à 3,2 millions en 2026 puis à 3,6 millions en 2027.

La trajectoire de trésorerie constitue un autre point fort :
- A fin 2023 : 1,7 M€ ;
- A fin 2024 : 6,2 M€ ;
- A fin 2025 : 14,6 M€."`

const SYSTEM_PROMPT = `${DOMAINE_EXPERTISE}

${MODELE_PV}

# MISSION

À partir de la transcription fournie, tu produis un procès-verbal complet en appelant l'outil "generer_pv" avec un objet JSON conforme à son schéma.

# PRINCIPES CARDINAUX

1. SYNTHÈSE THÉMATIQUE — Regroupe les échanges par sujet, même s'ils ont été dispersés dans la discussion.
2. DENSITÉ, pas verbosité — Écarte salutations, digressions, redites.
3. REFORMULATION, jamais citation directe — Pas de guillemets pour reproduire des paroles.
4. SOBRIÉTÉ — Pas d'emoji, pas d'astérisques, pas de gras dans le contenu des sections.
5. PRÉCISION FACTUELLE — Aucun chiffre, date, nom ou engagement inventé. Reproduis exactement les montants (17,2 M€), pourcentages (37,1 %), dates (30 avril 2026).
6. ATTRIBUTION SYSTÉMATIQUE — Chaque information doit être attribuée : "L'Administrateur Judiciaire a confirmé...", "Monsieur X a indiqué...", "La société a précisé...", "Il a été rappelé que..."
7. LISTES TIRETÉES — Chaque item se termine par " ;" sauf le dernier par ".".
8. LONGUEUR — Substantielle. Une heure de réunion produit 3 à 5 pages. Ne résume pas : retranscris la substance.

# RÈGLES PAR CHAMP

sections : 4 à 8 sections thématiques. Aucun gras, italique, astérisque, sous-numérotation alphabétique. Paragraphes séparés par \\n\\n, listes par \\n- .
participants : tableau exhaustif avec catégorie (debiteur, conseil_debiteur, partenaire_bancaire, conseil_partenaire, auditeur_expert, mandataire_ad_hoc, conciliateur, administrateur_judiciaire, mandataire_judiciaire, actionnaire, repreneur, autre). Inclure TOUS les participants listés dans l'invitation, qu'ils soient présents ou absents.
Présence — règles strictes :
- 'Visioconférence' : participant actif en visio (a pris la parole ou sa présence est confirmée en visio)
- 'Présentiel' : participant actif en salle
- 'Téléphonique' : participant actif par téléphone
- 'Absent' : invité à la réunion mais absent ou excusé (n'a pas participé aux échanges)
Un participant présent mais qui ne prend pas la parole conserve son mode de présence (Visioconférence/Présentiel/Téléphonique) — seule l'absence totale justifie la valeur 'Absent'.
⚠ RÈGLE ABSOLUE : Les membres de BL & Associés ne peuvent JAMAIS être catégorisés 'conseil_debiteur' ou 'conseil_partenaire'. BL & Associés est le cabinet mandataire — selon la procédure :
- Mandat ad hoc → catégorie 'mandataire_ad_hoc'
- Conciliation → catégorie 'conciliateur'
- Redressement judiciaire ou Sauvegarde → catégorie 'administrateur_judiciaire'
actions : verbe à l'infinitif + objet précis, responsable avec entité entre parenthèses, échéance en français complet.
prochaine_reunion : ne renseigne que si explicitement mentionnée.
points_vigilance et precisions_a_apporter : réservés aux éléments ambigus ou sensibles.`

// ─── Outil Claude ─────────────────────────────────────────────────────────────

const GENERER_PV_TOOL: Anthropic.Tool = {
  name: 'generer_pv',
  description: 'Génère le procès-verbal structuré de la réunion',
  input_schema: {
    type: 'object' as const,
    properties: {
      metadata: {
        type: 'object',
        properties: {
          date_reunion: { type: 'string', description: 'Date en français complet, ex. "22 avril 2026"' },
          affaire: { type: 'string', description: 'Dénomination du dossier en majuscules' },
          type_procedure: {
            type: 'string',
            enum: ['Mandat ad hoc', 'Conciliation', 'Redressement judiciaire', 'Sauvegarde'],
          },
          objet: { type: 'string', description: 'Objet court de la réunion' },
          ville_signature: { type: 'string', default: 'PARIS' },
          signataire: { type: 'string', description: 'Nom de l\'administrateur judiciaire' },
        },
        required: ['date_reunion', 'affaire', 'type_procedure', 'signataire'],
      },
      modalites: { type: 'string', description: 'Ex. "Réunion par visioconférence"' },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            civilite_nom: { type: 'string' },
            societe_qualite: { type: 'string' },
            email: { type: 'string' },
            presence: { type: 'string', enum: ['Visioconférence', 'Présentiel', 'Téléphonique', 'Absent'] },
            categorie: {
              type: 'string',
              enum: [
                'debiteur', 'conseil_debiteur', 'partenaire_bancaire', 'conseil_partenaire',
                'auditeur_expert', 'mandataire_ad_hoc', 'conciliateur', 'administrateur_judiciaire',
                'mandataire_judiciaire', 'actionnaire', 'repreneur', 'autre',
              ],
            },
          },
          required: ['civilite_nom', 'societe_qualite', 'presence', 'categorie'],
        },
      },
      documents_amont: {
        type: 'array',
        items: { type: 'string' },
        description: 'Documents communiqués avant la réunion',
      },
      resume: { type: 'string', description: '5 à 8 phrases couvrant les enjeux et conclusions' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            contenu: { type: 'string', description: 'Paragraphes séparés par \\n\\n, listes par \\n-' },
          },
          required: ['titre', 'contenu'],
        },
      },
      points_desaccord: {
        type: 'array',
        items: { type: 'string' },
        description: 'Points de désaccord ou en suspens',
      },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            libelle: { type: 'string', description: 'Verbe à l\'infinitif + objet précis' },
            responsable: { type: 'string' },
            echeance: { type: 'string', description: 'Date en français ou "Non précisée"' },
          },
          required: ['libelle', 'responsable', 'echeance'],
        },
      },
      prochaine_reunion: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          heure: { type: 'string' },
          fuseau: { type: 'string', default: 'heure Paris' },
        },
        required: ['date', 'heure'],
      },
      points_vigilance: {
        type: 'array',
        items: { type: 'string' },
        description: 'Éléments sensibles à valider avant diffusion',
      },
      precisions_a_apporter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Éléments ambigus nécessitant clarification',
      },
    },
    required: ['metadata', 'modalites', 'participants', 'resume', 'sections'],
  },
}

// ─── Client singleton ─────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return anthropicClient
}

// ─── Mapping PvContent → MinutesContent (compatibilité UI existante) ──────────

export function pvContentToMinutesContent(pv: PvContent): MinutesContent {
  const sections: PVSection[] = pv.sections.map((s, i) => ({
    numero: i + 1,
    titre: s.titre,
    contenu: s.contenu,
  }))

  const actions = pv.actions.map((a) => ({
    description: a.libelle,
    responsable: a.responsable,
    echeance: a.echeance,
  }))

  const prochaine_reunion = pv.prochaine_reunion
    ? `${pv.prochaine_reunion.date} à ${pv.prochaine_reunion.heure} (${pv.prochaine_reunion.fuseau ?? 'heure Paris'})`
    : undefined

  const notes = [
    ...pv.points_vigilance.map((p) => `⚠ ${p}`),
    ...pv.precisions_a_apporter.map((p) => `→ ${p}`),
  ].join('\n') || ''

  return {
    summary: pv.resume,
    sections,
    actions,
    notes,
    prochaine_reunion,
    _pv: pv,
  }
}

// ─── Squelette PV sans transcription ─────────────────────────────────────────

export function createSkeletonContent(
  subject: string,
  participants?: Array<{ name: string }>,
  date?: Date
): MinutesContent {
  const dateStr = (date ?? new Date()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const pv: PvContent = {
    metadata: {
      date_reunion: dateStr,
      affaire: subject,
      type_procedure: 'Mandat ad hoc',
      objet: 'Réunion',
      ville_signature: 'PARIS',
      signataire: '[Administrateur Judiciaire]',
    },
    modalites: 'Réunion par visioconférence',
    participants: (participants ?? []).map((p) => ({
      civilite_nom: p.name,
      societe_qualite: '[À compléter]',
      presence: 'Visioconférence' as const,
      categorie: 'autre' as const,
    })),
    documents_amont: [],
    resume: '[À compléter — aucune transcription Teams disponible pour cette réunion]',
    sections: [
      { titre: 'Points abordés', contenu: '[À compléter]' },
    ],
    points_desaccord: [],
    actions: [],
    points_vigilance: ['Compte rendu généré sans transcription Teams — contenu à remplir manuellement'],
    precisions_a_apporter: [],
  }
  return pvContentToMinutesContent(pv)
}

// ─── Prompt builder (conservé pour les tests unitaires) ───────────────────────

// Transcription tronquée pour rester dans un budget de tokens raisonnable.
// Stratégie début+fin : on conserve l'ouverture (contexte, participants, enjeux)
// et la clôture (décisions, actions, prochaine réunion).
const MAX_HEAD_CHARS = 50_000
const MAX_TAIL_CHARS = 10_000

export function buildPrompt(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string }>
): string {
  const participantsBlock = participants?.length
    ? `\nParticipants identifiés : ${participants.map((p) => p.name).join(', ')}`
    : ''

  let safeTranscription = transcription
  if (safeTranscription && safeTranscription.length > MAX_HEAD_CHARS + MAX_TAIL_CHARS) {
    const head = safeTranscription.slice(0, MAX_HEAD_CHARS)
    const tail = safeTranscription.slice(-MAX_TAIL_CHARS)
    safeTranscription = `${head}\n\n[… ${(safeTranscription.length - MAX_HEAD_CHARS - MAX_TAIL_CHARS).toLocaleString('fr')} caractères omis …]\n\n${tail}`
  }

  const transcriptionBlock = safeTranscription
    ? `TRANSCRIPTION DE LA RÉUNION :\n\n${safeTranscription}`
    : `Note : aucune transcription disponible. Remplis uniquement ce qui est déductible du sujet et des participants.`
  return `Affaire : "${subject}"${participantsBlock}\n\n${transcriptionBlock}`
}

// ─── Parser texte (conservé pour les tests + fallback) ───────────────────────

const DEFAULT_CONTENT: MinutesContent = { summary: '', actions: [], notes: '' }

export function parseMinutesContent(raw: string): MinutesContent {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)

    const sections: PVSection[] | undefined = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s: unknown): s is PVSection =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as PVSection).numero === 'number' &&
            typeof (s as PVSection).titre === 'string' &&
            typeof (s as PVSection).contenu === 'string'
        )
      : undefined

    const summary =
      typeof parsed.resume === 'string' && parsed.resume.trim()
        ? parsed.resume.trim()
        : typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : sections
            ? sections.map((s) => `${s.numero}- ${s.titre}\n\n${s.contenu}`).join('\n\n')
            : ''

    return {
      summary,
      sections: sections?.length ? sections : undefined,
      prochaine_reunion:
        typeof parsed.prochaine_reunion === 'string' && parsed.prochaine_reunion.trim()
          ? parsed.prochaine_reunion.trim()
          : undefined,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  } catch {
    return { ...DEFAULT_CONTENT }
  }
}

// ─── Génération principale via tool_use ───────────────────────────────────────

export type GenerationStyle = 'detailed'

export async function generateMinutesContent(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string }>,
  options?: { userId?: string; minutesId?: string; promptText?: string; modelName?: string }
): Promise<MinutesContent> {
  const client = getClient()
  const model = options?.modelName ?? 'claude-opus-4-7'
  const systemPrompt = options?.promptText ?? SYSTEM_PROMPT
  const userMessage = buildPrompt(subject, transcription, participants)
  const startMs = Date.now()

  let tokensInput = 0
  let tokensOutput = 0
  let status = 'success'
  let errorMessage: string | undefined

  console.log(
    '[Claude] Génération pour "%s" — transcription: %d chars, modèle: %s',
    subject,
    (transcription ?? '').length,
    model
  )

  // stream().finalMessage() requis pour les appels potentiellement longs.
  // max_tokens=16000 : suffisant pour un PV très détaillé, évite stop_reason=max_tokens.
  const callClaude = () =>
    client.messages.stream({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      tools: [GENERER_PV_TOOL],
      tool_choice: { type: 'tool', name: 'generer_pv' },
      messages: [{ role: 'user', content: userMessage }],
    }).finalMessage()

  // Diagnostic accumulé — inclus dans le message d'erreur final pour diagnostic sans logs Vercel
  let lastDiag = ''

  const extractToolInput = (response: Awaited<ReturnType<typeof callClaude>>, attempt: number) => {
    const blockTypes = response.content.map((b) => b.type).join(', ')
    console.log(
      '[Claude] tentative=%d stop_reason=%s tokens_out=%d blocs=[%s]',
      attempt, response.stop_reason, response.usage.output_tokens, blockTypes
    )

    const block = response.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | aucun bloc tool_use | blocs=[${blockTypes}] | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
      return null
    }

    const input = block.input as Record<string, unknown>
    const keys = Object.keys(input)
    console.log('[Claude] tentative=%d — %d clé(s): %s', attempt, keys.length, keys.join(', '))

    if (keys.length === 0) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | tool_use présent mais input={} (JSON tronqué ?) | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
      return null
    }

    if (keys.length < 3) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | input partiel (${keys.length} clé(s): ${keys.join(',')}) | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
    }

    // On accepte tout input non-vide (même partiel) — Zod valide ensuite
    return input
  }

  try {
    let response = await callClaude()
    tokensInput = response.usage.input_tokens
    tokensOutput = response.usage.output_tokens

    let toolInput = extractToolInput(response, 1)

    if (!toolInput) {
      console.warn('[Claude] Input vide (tentative 1), nouvelle tentative...')
      response = await callClaude()
      tokensInput += response.usage.input_tokens
      tokensOutput += response.usage.output_tokens
      toolInput = extractToolInput(response, 2)
    }

    if (!toolInput) {
      throw new Error(
        `Claude a retourné une réponse vide après 2 tentatives. Diagnostic : ${lastDiag}`
      )
    }

    const validation = PvContentSchema.safeParse(toolInput)
    if (!validation.success) {
      console.warn('[Claude] Zod validation partielle:', validation.error.flatten())
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
          return pvContentToMinutesContent(lenientValidation.data)
        }
        console.error('[Claude] Lenient parse also failed:', lenientValidation.error.flatten())
        throw new Error(`Réponse Claude invalide : ${lenientValidation.error.issues.map(i => i.message).join(', ')}`)
      }
      throw new Error(
        `Réponse Claude incomplète — résumé ou sections manquants. ` +
        `Détails : ${validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; ')}`
      )
    }

    return pvContentToMinutesContent(validation.data)
  } catch (error) {
    status = 'error'
    errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Claude] Generation failed:', error)
    throw error  // On propage l'erreur — ne jamais écraser silencieusement un contenu existant
  } finally {
    if (options?.userId) {
      const transcriptHash = createHash('sha256')
        .update(transcription ?? '')
        .digest('hex')
      await prisma.generationAuditLog.create({
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
      }).catch((e) => console.error('[AuditLog] Échec écriture:', e))
    }
  }
}
