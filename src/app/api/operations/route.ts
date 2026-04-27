import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type OperationState = 'ready' | 'processing' | 'failed' | 'blocked' | 'pending'
type TranscriptionState = 'found' | 'missing' | 'pending'
type GenerationState = 'not_started' | 'in_progress' | 'done' | 'failed' | 'draft_without_transcript'

function formatError(message: string | null | undefined): string | null {
  if (!message) return null
  return message.replace(/\s+/g, ' ').trim()
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [
        { organizerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    select: {
      id: true,
      subject: true,
      startDateTime: true,
      endDateTime: true,
      hasTranscription: true,
      processedAt: true,
      createdAt: true,
      platform: true,
      botStatus: true,
      botScheduledAt: true,
      participants: { select: { id: true } },
      minutes: {
        select: {
          id: true,
          status: true,
          isGenerating: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { startDateTime: 'desc' },
    take: 50,
  })

  const minutesIds = meetings
    .map((meeting) => meeting.minutes?.id)
    .filter((id): id is string => Boolean(id))

  const auditLogs = minutesIds.length > 0
    ? await prisma.generationAuditLog.findMany({
        where: { minutesId: { in: minutesIds } },
        select: {
          minutesId: true,
          status: true,
          errorMessage: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: minutesIds.length * 3,
      })
    : []

  const latestAuditByMinutes = new Map<string, (typeof auditLogs)[number]>()
  for (const log of auditLogs) {
    if (log.minutesId && !latestAuditByMinutes.has(log.minutesId)) {
      latestAuditByMinutes.set(log.minutesId, log)
    }
  }

  const now = Date.now()
  const rows = meetings.map((meeting) => {
    const minutes = meeting.minutes
    const latestAudit = minutes ? latestAuditByMinutes.get(minutes.id) : undefined
    const errorMessage = latestAudit?.status === 'error' ? formatError(latestAudit.errorMessage) : null
    const generationIsFresh = minutes?.isGenerating === true &&
      now - new Date(minutes.updatedAt).getTime() < 15 * 60 * 1000

    let transcriptionState: TranscriptionState = 'pending'
    if (meeting.hasTranscription) transcriptionState = 'found'
    else if (new Date(meeting.endDateTime).getTime() < now) transcriptionState = 'missing'

    let generationState: GenerationState = 'not_started'
    if (generationIsFresh) generationState = 'in_progress'
    else if (errorMessage) generationState = 'failed'
    else if (minutes && !meeting.hasTranscription) generationState = 'draft_without_transcript'
    else if (minutes) generationState = 'done'

    let state: OperationState = 'pending'
    if (generationState === 'done') state = 'ready'
    else if (generationState === 'in_progress') state = 'processing'
    else if (generationState === 'failed') state = 'failed'
    else if (transcriptionState === 'missing') state = 'blocked'

    const retryRemaining = generationState === 'failed' || generationState === 'draft_without_transcript'
      ? 1
      : 0

    const message = errorMessage
      ?? (transcriptionState === 'missing'
        ? 'Transcription Teams absente ou non encore récupérée.'
        : generationState === 'in_progress'
          ? 'Génération Claude en cours.'
          : generationState === 'not_started'
            ? 'Compte rendu non encore généré.'
            : 'Traitement terminé.')

    return {
      id: meeting.id,
      subject: meeting.subject,
      startDateTime: meeting.startDateTime,
      endDateTime: meeting.endDateTime,
      platform: meeting.platform,
      botStatus: meeting.botStatus,
      botScheduledAt: meeting.botScheduledAt,
      participantsCount: meeting.participants.length,
      processedAt: meeting.processedAt,
      minutesId: minutes?.id ?? null,
      minutesStatus: minutes?.status ?? null,
      updatedAt: minutes?.updatedAt ?? meeting.processedAt ?? meeting.createdAt,
      state,
      transcription: {
        state: transcriptionState,
        label: transcriptionState === 'found'
          ? 'Trouvée'
          : transcriptionState === 'missing'
            ? 'Absente'
            : 'En attente',
      },
      generation: {
        state: generationState,
        label: generationState === 'done'
          ? 'Terminée'
          : generationState === 'in_progress'
            ? 'En cours'
            : generationState === 'failed'
              ? 'Échouée'
              : generationState === 'draft_without_transcript'
                ? 'Brouillon sans transcription'
                : 'Non lancée',
      },
      retryRemaining,
      message,
    }
  })

  const summary = rows.reduce(
    (acc, row) => {
      acc.detected += 1
      if (row.transcription.state === 'found') acc.transcriptionFound += 1
      if (row.transcription.state === 'missing') acc.transcriptionMissing += 1
      if (row.generation.state === 'in_progress') acc.generationRunning += 1
      if (row.generation.state === 'failed') acc.generationFailed += 1
      if (row.state === 'ready') acc.ready += 1
      return acc
    },
    {
      detected: 0,
      transcriptionFound: 0,
      transcriptionMissing: 0,
      generationRunning: 0,
      generationFailed: 0,
      ready: 0,
    }
  )

  return NextResponse.json({ summary, rows })
}
