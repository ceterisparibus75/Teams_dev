/**
 * Backfill des accès réunion pour les membres de l'étude (@bl-aj.fr).
 *
 * Applique rétroactivement la règle « tous les membres de l'étude connectés à
 * la réunion ont accès » aux réunions/PV déjà existants :
 *
 *   1. Présence réelle Teams (si le rapport est encore disponible) — best-effort
 *      via le token délégué de l'organisateur.
 *   2. Invités stockés (MeetingParticipant) — toujours appliqué, fiable.
 *
 * Idempotent : peut être relancé sans créer de doublon (skipDuplicates).
 *
 * Usage :
 *   npm run db:backfill-access                 # présence (best-effort) + invités
 *   npm run db:backfill-access -- --skip-attendance   # invités uniquement (rapide)
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { grantFirmMemberAccess } from '../src/lib/meeting-access'
import { getAttendanceLookup } from '../src/lib/microsoft-graph'

const BATCH_SIZE = 100

async function main() {
  const skipAttendance = process.argv.includes('--skip-attendance')

  console.log(
    `Backfill des accès réunion — source présence: ${skipAttendance ? 'NON (invités uniquement)' : 'oui (best-effort)'}`,
  )

  let cursor: string | undefined
  let processed = 0
  let totalAdded = 0
  let attendanceUsed = 0
  let attendanceFailed = 0

  for (;;) {
    const meetings = await prisma.meeting.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        subject: true,
        joinUrl: true,
        organizerId: true,
        participants: { select: { email: true } },
      },
    })
    if (meetings.length === 0) break

    for (const meeting of meetings) {
      processed++
      const emails: Array<string | null | undefined> = meeting.participants.map((p) => p.email)

      // 1. Présence réelle (best-effort) — n'échoue jamais le backfill
      if (!skipAttendance && meeting.joinUrl) {
        try {
          const lookup = await getAttendanceLookup(meeting.organizerId, meeting.joinUrl)
          if (lookup.status === 'found' && lookup.records.length > 0) {
            emails.push(...lookup.records.map((r) => r.email))
            attendanceUsed++
          }
        } catch (err) {
          attendanceFailed++
          console.warn(`  ⚠ présence indisponible pour ${meeting.id}: ${(err as Error).message}`)
        }
      }

      // 2. Octroi (invités + présence), filtré @bl-aj.fr, idempotent
      const added = await grantFirmMemberAccess(meeting.id, emails)
      totalAdded += added
      if (added > 0) {
        console.log(`  + ${added} accès ajouté(s) — ${meeting.subject} (${meeting.id})`)
      }
    }

    cursor = meetings[meetings.length - 1].id
    if (meetings.length < BATCH_SIZE) break
  }

  console.log('\n=== Backfill terminé ===')
  console.log(`Réunions parcourues : ${processed}`)
  console.log(`Accès collaborateurs ajoutés : ${totalAdded}`)
  if (!skipAttendance) {
    console.log(`Rapports de présence exploités : ${attendanceUsed}`)
    console.log(`Présence indisponible (ignorée) : ${attendanceFailed}`)
  }
}

main()
  .catch((err) => {
    console.error('Backfill échoué :', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
