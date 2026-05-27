/**
 * Fusionne les réunions en double créées avant la déduplication.
 *
 * Historiquement, l'id de réunion = l'id d'événement Graph, PROPRE À CHAQUE
 * BOÎTE MAIL. Chaque membre interne synchronisant une réunion créait donc un
 * doublon. Ce script regroupe les réunions par clé stable (joinUrl + heure de
 * début) et fusionne chaque groupe sur une seule ligne canonique :
 *
 *   - canonique = la réunion au PV le plus avancé (SENT > VALIDATED > DRAFT),
 *     à défaut la plus ancienne (id stable) ;
 *   - les collaborateurs des doublons sont rattachés à la canonique ;
 *   - le PV d'un doublon est déplacé vers la canonique si elle n'en a pas,
 *     sinon supprimé (les logs d'édition/audit, sans FK, sont conservés) ;
 *   - dossierId / transcription / processedAt sont récupérés si manquants ;
 *   - les lignes doublons sont supprimées (participants + collaborateurs en
 *     cascade).
 *
 * SÉCURITÉ : dry-run par défaut. Ajouter --apply pour exécuter réellement.
 *
 * Usage :
 *   npm run db:merge-meetings              # simulation (n'écrit rien)
 *   npm run db:merge-meetings -- --apply   # exécution
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { computeDedupKey } from '../src/lib/meeting-sync'

const STATUS_RANK: Record<string, number> = { SENT: 3, VALIDATED: 2, DRAFT: 1 }

type MeetingRow = {
  id: string
  joinUrl: string | null
  startDateTime: Date
  createdAt: Date
  dossierId: string | null
  hasTranscription: boolean
  durationMinutes: number | null
  processedAt: Date | null
  minutes: { id: string; status: string; updatedAt: Date } | null
  collaborators: { userId: string }[]
}

/** Score d'avancement : plus c'est haut, plus la réunion mérite d'être canonique. */
function advancement(m: MeetingRow): [number, number, number] {
  const hasMinutes = m.minutes ? 1 : 0
  const statusRank = m.minutes ? (STATUS_RANK[m.minutes.status] ?? 0) : 0
  const minutesUpdated = m.minutes ? m.minutes.updatedAt.getTime() : 0
  return [hasMinutes, statusRank, minutesUpdated]
}

/** Trie pour placer la canonique en tête : avancement desc, puis createdAt asc. */
function pickCanonical(group: MeetingRow[]): MeetingRow {
  return [...group].sort((a, b) => {
    const [ha, sa, ua] = advancement(a)
    const [hb, sb, ub] = advancement(b)
    if (hb !== ha) return hb - ha
    if (sb !== sa) return sb - sa
    if (ub !== ua) return ub - ua
    return a.createdAt.getTime() - b.createdAt.getTime()
  })[0]
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`Fusion des réunions en double — mode: ${apply ? 'APPLY (écriture)' : 'DRY-RUN (simulation)'}`)

  const meetings: MeetingRow[] = await prisma.meeting.findMany({
    select: {
      id: true,
      joinUrl: true,
      startDateTime: true,
      createdAt: true,
      dossierId: true,
      hasTranscription: true,
      durationMinutes: true,
      processedAt: true,
      minutes: { select: { id: true, status: true, updatedAt: true } },
      collaborators: { select: { userId: true } },
    },
  })

  // Regroupement par clé stable (on ignore les réunions sans joinUrl : non dédupliquables)
  const groups = new Map<string, MeetingRow[]>()
  for (const m of meetings) {
    const key = computeDedupKey(m)
    if (!key) continue
    const arr = groups.get(key)
    if (arr) arr.push(m)
    else groups.set(key, [m])
  }

  const duplicateGroups = [...groups.entries()].filter(([, g]) => g.length > 1)
  console.log(`Réunions totales : ${meetings.length}`)
  console.log(`Groupes en double : ${duplicateGroups.length}`)

  let mergedMeetings = 0
  let movedMinutes = 0
  let deletedMinutes = 0
  let movedCollaborators = 0

  for (const [key, group] of duplicateGroups) {
    const canonical = pickCanonical(group)
    const dups = group.filter((m) => m.id !== canonical.id)
    let canonicalHasMinutes = canonical.minutes !== null

    console.log(
      `\nGroupe ${key.split('::')[1]} — ${group.length} réunions → canonique ${canonical.id}` +
        ` (PV: ${canonical.minutes ? canonical.minutes.status : 'aucun'})`,
    )

    for (const dup of dups) {
      const actions: string[] = []

      // PV du doublon
      let moveMinutesOf: string | null = null
      let deleteMinutes = false
      if (dup.minutes) {
        if (!canonicalHasMinutes) {
          moveMinutesOf = dup.id
          canonicalHasMinutes = true
          actions.push(`déplace PV ${dup.minutes.status}`)
        } else {
          deleteMinutes = true
          actions.push(`supprime PV ${dup.minutes.status} (doublon)`)
        }
      }

      // Collaborateurs à rattacher
      const collabUserIds = dup.collaborators.map((c) => c.userId)
      if (collabUserIds.length > 0) actions.push(`${collabUserIds.length} collaborateur(s)`)

      // Métadonnées à récupérer
      const metaPatch: Record<string, unknown> = {}
      if (!canonical.dossierId && dup.dossierId) metaPatch.dossierId = dup.dossierId
      if (!canonical.hasTranscription && dup.hasTranscription) metaPatch.hasTranscription = true
      if (canonical.durationMinutes == null && dup.durationMinutes != null)
        metaPatch.durationMinutes = dup.durationMinutes
      if (!canonical.processedAt && dup.processedAt) metaPatch.processedAt = dup.processedAt
      if (Object.keys(metaPatch).length > 0) actions.push(`métadonnées: ${Object.keys(metaPatch).join(', ')}`)

      console.log(`  - doublon ${dup.id} → ${actions.join(' ; ') || 'rien à reporter'} ; suppression`)

      if (apply) {
        await prisma.$transaction(async (tx) => {
          if (moveMinutesOf) {
            await tx.meetingMinutes.update({
              where: { meetingId: moveMinutesOf },
              data: { meetingId: canonical.id },
            })
          }
          if (deleteMinutes) {
            await tx.meetingMinutes.delete({ where: { meetingId: dup.id } })
          }
          if (collabUserIds.length > 0) {
            await tx.meetingCollaborator.createMany({
              data: collabUserIds.map((userId) => ({ meetingId: canonical.id, userId })),
              skipDuplicates: true,
            })
          }
          if (Object.keys(metaPatch).length > 0) {
            await tx.meeting.update({ where: { id: canonical.id }, data: metaPatch })
          }
          // Supprime le doublon (participants + collaborateurs en cascade)
          await tx.meeting.delete({ where: { id: dup.id } })
        })
      }

      if (moveMinutesOf) movedMinutes++
      if (deleteMinutes) deletedMinutes++
      movedCollaborators += collabUserIds.length
      mergedMeetings++
    }

    // Pose la clé stable sur la canonique
    if (apply) {
      await prisma.meeting.update({ where: { id: canonical.id }, data: { dedupKey: key } })
    }
  }

  console.log('\n=== Récapitulatif ===')
  console.log(`Doublons fusionnés : ${mergedMeetings}`)
  console.log(`PV déplacés vers la canonique : ${movedMinutes}`)
  console.log(`PV doublons supprimés : ${deletedMinutes}`)
  console.log(`Collaborateurs rattachés : ${movedCollaborators}`)
  if (!apply) {
    console.log('\n⚠ DRY-RUN : aucune modification écrite. Relancer avec --apply pour exécuter.')
  }
}

main()
  .catch((err) => {
    console.error('Fusion échouée :', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
