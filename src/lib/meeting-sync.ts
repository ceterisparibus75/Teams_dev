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
