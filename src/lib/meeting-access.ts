// Octroi d'accès aux réunions pour les membres de l'étude.
//
// Règle métier (cf. CLAUDE.md « Catégorisation BL&Associés ») : seuls les
// comptes dont l'email se termine par @bl-aj.fr sont considérés comme membres
// du cabinet et reçoivent un accès automatique aux PV. L'accès est matérialisé
// par une ligne MeetingCollaborator (clé composite meetingId+userId).

import { prisma } from '@/lib/prisma'

export const FIRM_EMAIL_DOMAIN = 'bl-aj.fr'

/** Vrai si l'email appartient à l'étude (insensible à la casse / aux espaces). */
export function isFirmEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${FIRM_EMAIL_DOMAIN}`)
}

/**
 * Donne accès à une réunion (MeetingCollaborator) à tous les membres de l'étude
 * dont l'email figure dans `emails` ET qui possèdent un compte.
 *
 * - Filtre sur le domaine @bl-aj.fr
 * - Matching insensible à la casse (les emails Azure AD ne sont pas normalisés)
 * - Idempotent (skipDuplicates) : peut être rejoué sans créer de doublon
 *
 * Retourne le nombre de collaborateurs réellement ajoutés.
 */
export async function grantFirmMemberAccess(
  meetingId: string,
  emails: Array<string | null | undefined>,
): Promise<number> {
  const targetEmails = new Set(
    emails.filter(isFirmEmail).map((e) => e!.trim().toLowerCase()),
  )
  if (targetEmails.size === 0) return 0

  // L'étude a un effectif limité : on charge tous les comptes du cabinet et on
  // intersecte côté JS pour un match insensible à la casse fiable.
  const firmUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${FIRM_EMAIL_DOMAIN}`, mode: 'insensitive' } },
    select: { id: true, email: true },
  })

  const userIds = firmUsers
    .filter((u) => targetEmails.has(u.email.trim().toLowerCase()))
    .map((u) => u.id)
  if (userIds.length === 0) return 0

  const { count } = await prisma.meetingCollaborator.createMany({
    data: userIds.map((userId) => ({ meetingId, userId })),
    skipDuplicates: true,
  })
  return count
}

/**
 * Rattrape l'accès d'un membre de l'étude à toutes les réunions passées où il
 * figure comme participant mais n'a pas encore de ligne MeetingCollaborator.
 *
 * Appelé à la connexion (callback NextAuth) pour couvrir le cas d'un membre
 * inscrit APRÈS la génération du PV : la réconciliation par présence côté
 * Inngest n'avait pas pu le rattacher faute de compte à ce moment-là.
 *
 * DB-only, idempotent. Retourne le nombre d'accès ajoutés.
 */
export async function reconcileUserMeetingAccess(
  userId: string,
  email: string | null | undefined,
): Promise<number> {
  if (!isFirmEmail(email)) return 0
  const normalized = email!.trim().toLowerCase()

  const meetings = await prisma.meeting.findMany({
    where: {
      participants: { some: { email: { equals: normalized, mode: 'insensitive' } } },
      collaborators: { none: { userId } },
    },
    select: { id: true },
  })
  if (meetings.length === 0) return 0

  const { count } = await prisma.meetingCollaborator.createMany({
    data: meetings.map((m) => ({ meetingId: m.id, userId })),
    skipDuplicates: true,
  })
  return count
}
