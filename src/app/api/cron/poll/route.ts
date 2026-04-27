import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAttendanceWarning } from '@/lib/attendance-warning'
import { getAttendanceLookup, getMeetingsEndedInLastHours, getTranscription } from '@/lib/microsoft-graph'
import { generateMinutesContent } from '@/lib/azure-openai'
import { extractVttDurationMinutes } from '@/lib/utils'
import { safeBearerEqual } from '@/lib/secrets'
import { toPrismaJson } from '@/lib/minutes-persist'

// Cooldown persisté en BD — survit aux cold starts lambda et aux redémarrages.
// Vercel Cron tourne toutes les 2h — cooldown 90 min laisse une marge confortable.
const COOLDOWN_MS = 90 * 60_000 // 90 minutes
const CRON_JOB_NAME = 'poll'

export async function GET(req: NextRequest) {
  if (!safeBearerEqual(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  // Vérification du cooldown (persistant en BD)
  const lastRun = await prisma.cronRun.findUnique({ where: { job: CRON_JOB_NAME } })
  if (lastRun) {
    const elapsed = Date.now() - lastRun.lastRunAt.getTime()
    if (elapsed < COOLDOWN_MS) {
      const nextAllowedAt = new Date(lastRun.lastRunAt.getTime() + COOLDOWN_MS).toISOString()
      return NextResponse.json({ skipped: true, reason: 'cooldown', nextAllowedAt }, { status: 200 })
    }
  }

  const usersWithToken = await prisma.user.findMany({
    where: { microsoftRefreshToken: { not: null } },
    select: { id: true, email: true },
  })

  let processed = 0

  for (const user of usersWithToken) {
    const meetings = await getMeetingsEndedInLastHours(user.id, 2)

    for (const gm of meetings) {
      const existing = await prisma.meeting.findUnique({
        where: { id: gm.id },
        select: { processedAt: true },
      })
      if (existing?.processedAt) continue

      await prisma.meeting.upsert({
        where: { id: gm.id },
        update: {},
        create: {
          id: gm.id,
          subject: gm.subject,
          startDateTime: new Date(gm.startDateTime),
          endDateTime: new Date(gm.endDateTime),
          organizerId: user.id,
          joinUrl: gm.joinUrl ?? null,
          participants: {
            create: gm.attendees.map((a) => ({
              name: a.emailAddress.name,
              email: a.emailAddress.address,
            })),
          },
        },
      })

      // Link firm members (batch)
      const attendeeEmails = gm.attendees.map((a) => a.emailAddress.address.toLowerCase())
      const firmMembers = await prisma.user.findMany({
        where: { email: { in: attendeeEmails } },
        select: { id: true },
      })
      if (firmMembers.length > 0) {
        await prisma.meetingCollaborator.createMany({
          data: firmMembers.map((m) => ({ meetingId: gm.id, userId: m.id })),
          skipDuplicates: true,
        })
      }

      const existingMinutes = await prisma.meetingMinutes.findUnique({
        where: { meetingId: gm.id },
      })
      if (existingMinutes) {
        await prisma.meeting.update({
          where: { id: gm.id },
          data: { processedAt: new Date() },
        })
        continue
      }

      const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })

      // Transcription in memory only — never persisted (RGPD)
      const transcription = await getTranscription(user.id, gm.joinUrl, {
        subject: gm.subject,
      })
      const attendanceLookup = await getAttendanceLookup(user.id, gm.joinUrl)
      const attendanceWarning = getAttendanceWarning(attendanceLookup)
      if (attendanceWarning) console.warn('[cron/poll] Attendance warning:', attendanceWarning)
      const content = await generateMinutesContent(
        gm.subject,
        transcription,
        gm.attendees.map((a) => ({
          name: a.emailAddress.name,
          email: a.emailAddress.address,
        })),
        { userId: user.id, meetingDate: new Date(gm.startDateTime), attendanceLookup }
      )

      await prisma.meetingMinutes.create({
        data: {
          meetingId: gm.id,
          authorId: user.id,
          templateId: defaultTemplate?.id ?? null,
          content: toPrismaJson(content as object),
          status: 'DRAFT',
        },
      })

      const durationMinutes = transcription ? extractVttDurationMinutes(transcription) : null
      await prisma.meeting.update({
        where: { id: gm.id },
        data: {
          hasTranscription: !!transcription,
          processedAt: new Date(),
          ...(durationMinutes !== null && { durationMinutes }),
        },
      })

      processed++
    }
  }

  // Marquer la fin d'une exécution réussie (démarre le cooldown)
  await prisma.cronRun.upsert({
    where: { job: CRON_JOB_NAME },
    create: { job: CRON_JOB_NAME, lastRunAt: new Date(), lastStatus: 'ok' },
    update: { lastRunAt: new Date(), lastStatus: 'ok' },
  })
  return NextResponse.json({ processed, users: usersWithToken.length })
}
