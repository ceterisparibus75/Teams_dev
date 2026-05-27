// Déduplication des réunions entre boîtes mail.
//
// Microsoft Graph renvoie un `id` d'événement PROPRE À CHAQUE BOÎTE MAIL :
// quand plusieurs membres de l'étude synchronisent la même réunion Teams,
// chacun obtient un id différent → autant de lignes Meeting que de participants
// internes. On déduplique sur une clé stable entre boîtes mail : le `joinUrl`
// (identique pour tous les participants d'une même réunion) combiné à l'heure
// de début (pour distinguer les occurrences d'une série récurrente, qui
// partagent le même joinUrl).

import { prisma } from '@/lib/prisma'
import { grantFirmMemberAccess } from '@/lib/meeting-access'
import { logger } from '@/lib/logger'
import type { GraphMeeting } from '@/types'

const log = logger.child({ module: 'meeting-sync' })

/**
 * Clé de déduplication stable entre boîtes mail : `joinUrl::heureDébutISO`.
 * Retourne null si la réunion n'a pas de joinUrl (réunions non-Teams créées par
 * le bot, p.ex.) — ces réunions ne sont pas dédupliquées (id déjà unique).
 */
export function computeDedupKey(
  meeting: { joinUrl?: string | null; startDateTime: string | Date },
): string | null {
  const joinUrl = meeting.joinUrl?.trim()
  if (!joinUrl) return null
  const startIso = new Date(meeting.startDateTime).toISOString()
  return `${joinUrl}::${startIso}`
}

/**
 * Résout la réunion canonique (dédupliquée) pour un évènement Graph, ou la crée.
 *
 * - Si une réunion avec la même clé stable existe déjà (créée par un autre
 *   membre), on NE crée PAS de doublon : on rattache simplement l'utilisateur
 *   courant comme collaborateur et on (re)donne l'accès aux membres de l'étude.
 * - Sinon on crée la réunion avec l'id Graph de l'utilisateur courant comme PK.
 *
 * Retourne l'id canonique de la réunion et si elle vient d'être créée.
 */
export async function resolveOrCreateMeeting(
  gm: GraphMeeting,
  syncingUserId: string,
  opts: { dossierId?: string | null } = {},
): Promise<{ meetingId: string; created: boolean }> {
  const dedupKey = computeDedupKey(gm)

  // 1. Réunion déjà connue ? D'abord par clé stable (autre boîte mail), sinon
  //    par id Graph (même boîte mail, re-sync).
  const existing =
    (dedupKey
      ? await prisma.meeting.findFirst({ where: { dedupKey }, select: { id: true, organizerId: true } })
      : null) ??
    (await prisma.meeting.findUnique({ where: { id: gm.id }, select: { id: true, organizerId: true } }))

  if (existing) {
    // Rattache l'utilisateur courant (la réunion est dans son calendrier → légitime)
    if (existing.organizerId !== syncingUserId) {
      await prisma.meetingCollaborator.createMany({
        data: [{ meetingId: existing.id, userId: syncingUserId }],
        skipDuplicates: true,
      })
    }
    // Donne accès aux membres de l'étude présents dans la liste d'invités
    await grantFirmMemberAccess(existing.id, gm.attendees.map((a) => a.emailAddress.address))
    // Backfill de la clé stable sur les anciennes lignes
    if (dedupKey) {
      await prisma.meeting
        .updateMany({ where: { id: existing.id, dedupKey: null }, data: { dedupKey } })
        .catch((err) => log.warn({ err, scope: 'dedupKey-backfill' }, 'backfill failed'))
    }
    return { meetingId: existing.id, created: false }
  }

  // 2. Création. L'id Graph (propre à cette boîte mail) sert de PK ; la clé
  //    stable assure la déduplication pour les prochains syncs des autres membres.
  try {
    await prisma.meeting.create({
      data: {
        id: gm.id,
        dedupKey,
        subject: gm.subject,
        startDateTime: new Date(gm.startDateTime),
        endDateTime: new Date(gm.endDateTime),
        organizerId: syncingUserId,
        joinUrl: gm.joinUrl ?? null,
        dossierId: opts.dossierId ?? null,
        participants: {
          create: gm.attendees.map((a) => ({
            name: a.emailAddress.name,
            email: a.emailAddress.address,
          })),
        },
      },
    })
  } catch (err) {
    // Course (deux syncs simultanés du même nouvel évènement) : on re-résout.
    log.warn({ err, scope: 'create', meetingId: gm.id }, 'create failed, re-resolving')
    const fallback = dedupKey
      ? await prisma.meeting.findFirst({ where: { dedupKey }, select: { id: true } })
      : await prisma.meeting.findUnique({ where: { id: gm.id }, select: { id: true } })
    if (fallback) {
      await grantFirmMemberAccess(fallback.id, gm.attendees.map((a) => a.emailAddress.address))
      return { meetingId: fallback.id, created: false }
    }
    throw err
  }

  await grantFirmMemberAccess(gm.id, gm.attendees.map((a) => a.emailAddress.address))
  return { meetingId: gm.id, created: true }
}

/**
 * Synchronise en LOT les réunions Graph d'un utilisateur (chemin dashboard).
 *
 * Conçu pour tourner en arrière-plan (`after()`) sans marteler la base : le cas
 * courant (toutes les réunions déjà connues, l'utilisateur a déjà accès) ne
 * coûte qu'UNE requête de lecture, là où une boucle `resolveOrCreateMeeting`
 * faisait 3-5 requêtes par réunion.
 *
 * - rattache l'utilisateur (collaborateur) aux réunions canoniques où il a accès
 *   via son calendrier mais n'était pas encore listé ;
 * - backfill paresseux de `dedupKey` sur les anciennes lignes (anti-doublon
 *   pour les réunions sans doublon, non couvertes par le merge initial) ;
 * - crée les réunions réellement nouvelles (rare) via resolveOrCreateMeeting.
 */
export async function syncUserMeetings(
  graphMeetings: GraphMeeting[],
  userId: string,
  dossiers: Array<{ id: string; denomination: string }>,
): Promise<void> {
  if (graphMeetings.length === 0) return

  const ids = graphMeetings.map((g) => g.id)
  const keys = graphMeetings
    .map((g) => computeDedupKey(g))
    .filter((k): k is string => k !== null)

  // UNE seule lecture pour tout le lot (par id Graph OU clé stable)
  const existing = await prisma.meeting.findMany({
    where: { OR: [{ id: { in: ids } }, ...(keys.length ? [{ dedupKey: { in: keys } }] : [])] },
    select: {
      id: true,
      dedupKey: true,
      organizerId: true,
      joinUrl: true,
      startDateTime: true,
      collaborators: { where: { userId }, select: { userId: true } },
    },
  })

  const byKey = new Map(existing.filter((e) => e.dedupKey).map((e) => [e.dedupKey as string, e]))
  const byId = new Map(existing.map((e) => [e.id, e]))

  const collaboratorAdds: Array<{ meetingId: string; userId: string }> = []
  const dedupBackfill: Array<{ id: string; dedupKey: string }> = []
  const toCreate: GraphMeeting[] = []

  for (const gm of graphMeetings) {
    const key = computeDedupKey(gm)
    const ex = (key ? byKey.get(key) : undefined) ?? byId.get(gm.id)
    if (!ex) {
      toCreate.push(gm)
      continue
    }
    if (ex.organizerId !== userId && ex.collaborators.length === 0) {
      collaboratorAdds.push({ meetingId: ex.id, userId })
    }
    if (!ex.dedupKey) {
      const k = computeDedupKey(ex)
      if (k) dedupBackfill.push({ id: ex.id, dedupKey: k })
    }
  }

  if (collaboratorAdds.length > 0) {
    await prisma.meetingCollaborator.createMany({ data: collaboratorAdds, skipDuplicates: true })
  }
  for (const { id, dedupKey } of dedupBackfill) {
    await prisma.meeting.update({ where: { id }, data: { dedupKey } }).catch(() => {})
  }
  for (const gm of toCreate) {
    const subjectLower = gm.subject.toLowerCase()
    const matchedDossier = dossiers.find((d) => subjectLower.includes(d.denomination.toLowerCase()))
    await resolveOrCreateMeeting(gm, userId, { dossierId: matchedDossier?.id ?? null }).catch(() => {})
  }
}
