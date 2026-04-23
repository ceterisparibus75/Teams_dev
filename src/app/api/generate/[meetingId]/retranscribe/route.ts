import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent, type GenerationStyle } from '@/lib/azure-openai'
import { getTranscriptionResult } from '@/lib/microsoft-graph'

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
  const body = await req.json().catch(() => ({}))
  const style: GenerationStyle = body.style === 'concise' ? 'concise' : 'detailed'

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

  const content = await generateMinutesContent(meeting.subject, transcriptResult.transcription, style)

  await prisma.meetingMinutes.update({
    where: { meetingId },
    data: { content: content as unknown as import('@prisma/client').Prisma.InputJsonValue },
  })

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: true },
  })

  return NextResponse.json({ ok: true, minutesId: existingMinutes.id })
}
