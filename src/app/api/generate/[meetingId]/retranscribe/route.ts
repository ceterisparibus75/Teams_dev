import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createSkeletonContent } from '@/lib/claude-generator'
import { getAttendanceWarning } from '@/lib/attendance-warning'
import { getAttendanceLookup, getTranscriptionResult } from '@/lib/microsoft-graph'
import { toPrismaJson } from '@/lib/minutes-persist'
import { rateLimit } from '@/lib/rate-limit'
import { inngest } from '@/inngest/client'

// Plan Pro Vercel : 300s max, défaut 10s. La récupération de transcription
// Graph (transcript_id puis content VTT) peut prendre ~10-20s. La génération
// Claude est ensuite déléguée à Inngest, donc 60s suffisent largement.
export const maxDuration = 60

// Seuls les modèles Anthropic sont acceptés ; empêche la substitution vers un
// autre fournisseur via un body arbitraire.
const BodySchema = z.object({
  promptText: z.string().trim().min(1).max(50_000).optional(),
  modelName: z.string().regex(/^claude-[a-z0-9.-]+$/i).max(100).optional(),
}).strict()

function withDetail(message: string, detail?: string) {
  return detail ? `${message} Détail Graph: ${detail}` : message
}

function buildTranscriptionError(result: Exclude<Awaited<ReturnType<typeof getTranscriptionResult>>, { ok: true }>) {
  switch (result.reason) {
    case 'missing_connection':
      return {
        status: 401,
        error: withDetail(
          'Compte Microsoft non connecté. Déconnectez-vous puis reconnectez-vous avec Microsoft 365 avant de relancer la retranscription.',
          result.detail
        ),
      }
    case 'reauth_required':
      return {
        status: 401,
        error: withDetail(
          'Autorisation Microsoft expirée ou incomplète. Déconnectez-vous puis reconnectez-vous pour autoriser la lecture des transcriptions Teams.',
          result.detail
        ),
      }
    case 'permission_denied':
      return {
        status: 403,
        error: withDetail(
          "La permission OnlineMeetingTranscript.Read.All est absente de votre session. Deconnectez-vous puis reconnectez-vous pour que la nouvelle permission soit prise en compte.",
          result.detail
        ),
      }
    case 'policy_denied':
      return {
        status: 403,
        error: withDetail(
          "Microsoft Graph refuse l'acces aux transcriptions malgre la permission presente. Verifiez le consentement administrateur dans Azure AD (Applications d'entreprise > votre app > Autorisations > Accorder le consentement) et que la transcription est activee dans Teams Admin Center.",
          result.detail
        ),
      }
    case 'meeting_not_found':
      return {
        status: 422,
        error:
          'Réunion introuvable dans Microsoft Graph via son lien Teams. Ouvrez la réunion depuis le calendrier synchronisé puis réessayez.',
      }
    case 'transcript_not_found':
      return {
        status: 422,
        error:
          'Aucune transcription disponible pour cette réunion. Vérifiez que la transcription Teams a bien été démarrée et attendez quelques minutes après la fin de la réunion.',
      }
    case 'transcript_empty':
      return {
        status: 422,
        error:
          "La transcription Teams a été trouvée mais son contenu est vide pour l'instant. Réessayez dans quelques minutes.",
      }
    case 'missing_join_url':
      return {
        status: 422,
        error: 'Lien de réunion manquant en base.',
      }
    case 'graph_error':
    default:
      return {
        status: 502,
        error: withDetail(
          'Erreur Microsoft Graph lors de la récupération de la transcription. Vérifiez la connexion Microsoft puis réessayez.',
          result.detail
        ),
      }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params

  // Cap : 5 retranscriptions par utilisateur / 5 min — chaque appel relance
  // Claude en synchrone, donc plus coûteux que /api/generate qui passe par Inngest.
  const rl = rateLimit({ name: 'retranscribe-pv', key: session.user.id, limit: 5, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Trop de retranscriptions en peu de temps', retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const rawBody = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const customPromptText = parsed.data.promptText
  const customModelName = parsed.data.modelName

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      OR: [
        { organizerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    include: { participants: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  if (!existingMinutes)
    return NextResponse.json({ error: 'Aucun compte rendu à mettre à jour' }, { status: 400 })

  if (!meeting.joinUrl)
    return NextResponse.json({ error: 'Lien de réunion manquant en base' }, { status: 422 })

  const transcriptResult = await getTranscriptionResult(session.user.id, meeting.joinUrl, {
    subject: meeting.subject,
  })

  if (!transcriptResult.ok) {
    const response = buildTranscriptionError(transcriptResult)
    return NextResponse.json(
      {
        error: response.error,
        code: transcriptResult.reason,
        detail: transcriptResult.detail ?? null,
      },
      { status: response.status }
    )
  }

  // Transcription confirmée ok : mettre à jour le flag AVANT la génération
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: true },
  })

  // Attendance lookup en sync : 1 appel Graph rapide, permet d'avertir tout
  // de suite l'utilisateur si le scope manque.
  const attendanceLookup = await getAttendanceLookup(session.user.id, meeting.joinUrl)
  const attendanceWarning = getAttendanceWarning(attendanceLookup)

  // Marque le PV comme "en cours de régénération" : le squelette + flag
  // _generating sont visibles immédiatement côté UI.
  const skeleton = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
  await prisma.meetingMinutes.update({
    where: { meetingId },
    data: {
      isGenerating: true,
      content: toPrismaJson({
        ...(skeleton as object),
        _generating: true,
        _generatingStartedAt: new Date().toISOString(),
      }),
    },
  })

  // Envoi à Inngest : retry/backoff/observabilité gérés par la queue.
  // On passe la transcription déjà fetchée pour que le job ne refasse pas
  // l'appel Graph.
  await inngest.send({
    name: 'pv/generate.requested',
    data: {
      meetingId,
      userId: session.user.id,
      source: 'retranscribe',
      transcript: transcriptResult.transcription,
      promptText: customPromptText,
      modelName: customModelName,
    },
  })

  return NextResponse.json(
    { ok: true, minutesId: existingMinutes.id, generating: true, attendanceWarning },
    { status: 202 },
  )
}
