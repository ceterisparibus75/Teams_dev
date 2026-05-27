import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMeetingsEndedInLastHours } from '@/lib/microsoft-graph'
import { resolveOrCreateMeeting } from '@/lib/meeting-sync'
import { safeBearerEqual } from '@/lib/secrets'
import { inngest } from '@/inngest/client'

// Itération sur N utilisateurs × Graph API pour chacun. Avec 10 utilisateurs
// la durée typique est ~10-20s ; on monte à 60s pour absorber un Graph lent.
export const maxDuration = 60

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

  // Une même réunion apparaît dans le calendrier de CHAQUE membre interne. Après
  // résolution dédupliquée, plusieurs (user, gm) pointent vers la même ligne
  // canonique : on ne traite chaque réunion qu'une fois pour ne pas générer N PV.
  const seenMeetingIds = new Set<string>()

  for (const user of usersWithToken) {
    const meetings = await getMeetingsEndedInLastHours(user.id, 2)

    for (const gm of meetings) {
      // Résout (ou crée) la réunion canonique + rattache l'utilisateur + accès firm
      const { meetingId } = await resolveOrCreateMeeting(gm, user.id)
      if (seenMeetingIds.has(meetingId)) continue
      seenMeetingIds.add(meetingId)

      const canonical = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { processedAt: true },
      })
      if (canonical?.processedAt) continue

      const existingMinutes = await prisma.meetingMinutes.findUnique({
        where: { meetingId },
        select: { id: true },
      })
      if (existingMinutes) {
        // Déjà un PV : on marque la réunion traitée et on n'enfile pas de job.
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { processedAt: new Date() },
        })
        continue
      }

      events.push({
        name: 'pv/generate.requested',
        data: { meetingId, userId: user.id, source: 'cron' },
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
