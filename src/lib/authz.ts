// Helpers d'autorisation par rôle, à appliquer sur les ressources partagées
// du workspace (Dossier, Prompt, Template). La lecture reste ouverte à tout
// utilisateur authentifié — l'app est un workspace partagé pour les membres
// de l'étude. Seules les opérations destructrices (PATCH/PUT/DELETE) doivent
// être restreintes :
//   - créateur de la ressource (createdById) OU
//   - rôle privilégié (ADMIN / ADMINISTRATEUR_JUDICIAIRE)
//
// Cette règle évite qu'un collaborateur supprime/modifie par erreur — ou
// malveillance — le dossier/prompt/template d'un collègue.

import type { UserRole } from '@prisma/client'

const PRIVILEGED_ROLES = ['ADMIN', 'ADMINISTRATEUR_JUDICIAIRE'] as const satisfies readonly UserRole[]

/** Vrai si le rôle a un droit d'administration sur les ressources partagées. */
export function isPrivileged(role: UserRole | null | undefined): boolean {
  return role != null && (PRIVILEGED_ROLES as readonly UserRole[]).includes(role)
}

interface Session {
  user?: { id?: string; role?: UserRole | null }
}

/**
 * Vrai si la session peut modifier/supprimer la ressource :
 *   - utilisateur connecté ET
 *   - (rôle privilégié OU créateur de la ressource)
 *
 * Si la ressource n'a pas de `createdById` (ex. Template), seuls les rôles
 * privilégiés sont autorisés.
 */
export function canManageResource(
  session: Session | null,
  resource: { createdById?: string | null } | null | undefined,
): boolean {
  const userId = session?.user?.id
  if (!userId) return false
  if (isPrivileged(session.user?.role)) return true
  if (resource?.createdById && resource.createdById === userId) return true
  return false
}
