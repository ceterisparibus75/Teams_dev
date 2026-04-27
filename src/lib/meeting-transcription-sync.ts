import { prisma } from '@/lib/prisma'
import { getTranscription } from '@/lib/microsoft-graph'
import { extractVttDurationMinutes } from '@/lib/utils'

export interface MeetingTranscriptionSyncTarget {
  id: string
  subject: string
  joinUrl: string | null
  hasTranscription: boolean
  durationMinutes: number | null
}

interface SyncOptions {
  concurrency?: number
}

async function syncSingleMeeting(
  userId: string,
  meeting: MeetingTranscriptionSyncTarget
): Promise<void> {
  if (!meeting.joinUrl) return

  try {
    const transcription = await getTranscription(userId, meeting.joinUrl, { subject: meeting.subject })
    if (!transcription) return

    const durationMinutes = extractVttDurationMinutes(transcription)
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        hasTranscription: true,
        ...(durationMinutes !== null && meeting.durationMinutes !== durationMinutes
          ? { durationMinutes }
          : {}),
      },
    })
  } catch {
    // Silencieux : on ne bloque jamais le flux appelant pour un échec Graph.
  }
}

export async function refreshMeetingsTranscriptionMetadata(
  userId: string,
  meetings: MeetingTranscriptionSyncTarget[],
  options: SyncOptions = {}
): Promise<void> {
  const concurrency = Math.max(1, options.concurrency ?? 5)
  const queue = meetings.filter(
    (meeting) => meeting.joinUrl && (!meeting.hasTranscription || meeting.durationMinutes === null)
  )

  if (queue.length === 0) return

  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (index < queue.length) {
      const current = queue[index]
      index += 1
      if (current) {
        await syncSingleMeeting(userId, current)
      }
    }
  })

  await Promise.all(workers)
}
