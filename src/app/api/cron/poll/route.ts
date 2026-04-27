import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMeetingsEndedInLastHours } from '@/lib/microsoft-graph'
import { safeBearerEqual } from '@/lib/secrets'
import { inngest } from '@/inngest/client'

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

  // Évènements à dispatcher en batch — un par réunion à générer.
  const events: { name: 'pv/generate.requested'; data: { meetingId: string; userId: string; source: 'cron' } }[] = []
  let dispatched = 0

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
        select: { id: true },
      })
      if (existingMinutes) {
        // Déjà un PV : on marque la réunion traitée et on n'enfile pas de job.
        await prisma.meeting.update({
          where: { id: gm.id },
          data: { processedAt: new Date() },
        })
        continue
      }

      events.push({
        name: 'pv/generate.requested',
        data: { meetingId: gm.id, userId: user.id, source: 'cron' },
      })
      dispatched++
    }
  }

  if (events.length > 0) {
    await inngest.send(events)
  }

  // Marquer la fin d'une exécution réussie (démarre le cooldown)
  await prisma.cronRun.upsert({
    where: { job: CRON_JOB_NAME },
    create: { job: CRON_JOB_NAME, lastRunAt: new Date(), lastStatus: 'ok' },
    update: { lastRunAt: new Date(), lastStatus: 'ok' },
  })
  return NextResponse.json({ dispatched, users: usersWithToken.length })
}
