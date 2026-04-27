import { NonRetriableError } from 'inngest'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent, createSkeletonContent } from '@/lib/claude-generator'
import { getAttendanceLookup, getTranscription } from '@/lib/microsoft-graph'
import { extractVttDurationMinutes } from '@/lib/utils'
import { toPrismaJson } from '@/lib/minutes-persist'
import { logger } from '@/lib/logger'
import { inngest, generatePvRequested } from '@/inngest/client'
import type { MeetingAttendanceLookup } from '@/types'

const log = logger.child({ module: 'inngest:generate-pv' })

// Pipeline de génération PV : transcription → Claude → persist.
// Inngest gère retry exponentiel automatique (3 tentatives par défaut)
// et observabilité via le dashboard. Throw une NonRetriableError pour
// court-circuiter (réunion introuvable, plus de transcription possible…).
//
// NB : `step.run()` sérialise les valeurs retournées en JSON — Date, undefined
// et autres ne survivent pas. On hydrate manuellement aux frontières.
export const generatePvJob = inngest.createFunction(
  {
    id: 'generate-pv',
    name: 'Génération PV (transcription + Claude + persist)',
    triggers: [generatePvRequested],
    retries: 3,
    concurrency: { limit: 5 },
    // Déduplique sur (meetingId, source) sur 5 minutes : si l'utilisateur
    // double-clique "Régénérer" ou si le cron émet le même event 2 fois,
    // un seul run Claude sera exécuté.
    idempotency: 'event.data.meetingId + "-" + event.data.source',
  },
  async ({ event, step }) => {
    const { meetingId, userId, source, transcript: providedTranscript, promptText, modelName } =
      event.data

    const loaded = await step.run('load-meeting', async () => {
      const m = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: { participants: true, minutes: { select: { id: true } } },
      })
      if (!m) throw new NonRetriableError(`Meeting ${meetingId} introuvable`)
      return m
    })

    // Re-hydrate les Date après sérialisation JSON par Inngest
    const meeting = {
      subject: loaded.subject,
      participants: loaded.participants,
      joinUrl: loaded.joinUrl,
      startDateTime: new Date(loaded.startDateTime),
      existingMinutesId: loaded.minutes?.id ?? null,
    }

    const minutesId = await step.run('ensure-minutes-row', async () => {
      if (meeting.existingMinutesId) return meeting.existingMinutesId

      const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })
      const skeleton = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
      const created = await prisma.meetingMinutes.create({
        data: {
          meetingId,
          authorId: userId,
          templateId: defaultTemplate?.id ?? null,
          content: toPrismaJson({
            ...(skeleton as object),
            _generating: true,
            _generatingStartedAt: new Date().toISOString(),
          }),
          isGenerating: true,
          status: 'DRAFT',
        },
      })
      return created.id
    })

    let transcription: string | null = null
    if (providedTranscript !== undefined) {
      transcription = providedTranscript
    } else if (meeting.joinUrl) {
      transcription = await step.run('fetch-transcription', async () => {
        try {
          return await getTranscription(userId, meeting.joinUrl, { subject: meeting.subject })
        } catch (err) {
          log.warn({ err, scope: 'fetch-transcription' }, 'getTranscription failed')
          return null
        }
      })
    }

    await step.run('update-meeting-flags', async () => {
      const durationMinutes = transcription ? extractVttDurationMinutes(transcription) : null
      await prisma.meeting.update({
        where: { id: meetingId },
        data: {
          hasTranscription: !!transcription,
          processedAt: new Date(),
          ...(durationMinutes !== null && { durationMinutes }),
        },
      })
    })

    if (!transcription) {
      await step.run('persist-skeleton-fallback', async () => {
        const fallback = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
        await prisma.meetingMinutes.update({
          where: { id: minutesId },
          data: {
            isGenerating: false,
            content: toPrismaJson({ ...(fallback as object), _generating: false }),
          },
        })
      })
      return { meetingId, minutesId, status: 'no_transcription', source }
    }

    const attendanceLookupRaw = await step.run('fetch-attendance', async () => {
      try {
        return (await getAttendanceLookup(userId, meeting.joinUrl)) ?? null
      } catch (err) {
        log.warn({ err, scope: 'fetch-attendance' }, 'getAttendanceLookup failed')
        return null
      }
    })
    const attendanceLookup = (attendanceLookupRaw ?? undefined) as MeetingAttendanceLookup | undefined

    try {
      const content = await step.run('claude-generate', () =>
        generateMinutesContent(meeting.subject, transcription, meeting.participants, {
          userId,
          minutesId,
          meetingDate: meeting.startDateTime,
          attendanceLookup,
          promptText,
          modelName,
        }),
      )

      await step.run('persist-success', async () => {
        await prisma.meetingMinutes.update({
          where: { id: minutesId },
          data: {
            isGenerating: false,
            content: toPrismaJson({ ...(content as object), _generating: false }),
          },
        })
      })

      return { meetingId, minutesId, status: 'ok', source }
    } catch (genError) {
      const errMsg = genError instanceof Error ? genError.message : 'Erreur inconnue'
      await step.run('persist-failure', async () => {
        const fallback = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
        await prisma.meetingMinutes.update({
          where: { id: minutesId },
          data: {
            isGenerating: false,
            content: toPrismaJson({
              ...(fallback as object),
              _generating: false,
              _generationError: errMsg,
            }),
          },
        })
      })
      // Re-throw pour que Inngest log l'échec final dans le dashboard
      throw genError
    }
  },
)
