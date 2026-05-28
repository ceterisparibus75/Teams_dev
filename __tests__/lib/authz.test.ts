import { canManageResource, isPrivileged } from '@/lib/authz'

describe('isPrivileged', () => {
  it('vrai pour ADMIN et ADMINISTRATEUR_JUDICIAIRE', () => {
    expect(isPrivileged('ADMIN')).toBe(true)
    expect(isPrivileged('ADMINISTRATEUR_JUDICIAIRE')).toBe(true)
  })
  it('faux pour COLLABORATEUR et undefined', () => {
    expect(isPrivileged('COLLABORATEUR')).toBe(false)
    expect(isPrivileged(undefined)).toBe(false)
    expect(isPrivileged(null)).toBe(false)
  })
})

describe('canManageResource', () => {
  const userSession = (id: string, role: 'COLLABORATEUR' | 'ADMIN' | 'ADMINISTRATEUR_JUDICIAIRE' = 'COLLABORATEUR') => ({
    user: { id, role: role as any },
  })

  it('refuse si non connecté', () => {
    expect(canManageResource(null, { createdById: 'u1' })).toBe(false)
    expect(canManageResource({ user: {} }, { createdById: 'u1' })).toBe(false)
  })

  it('autorise le créateur (COLLABORATEUR sur sa propre ressource)', () => {
    expect(canManageResource(userSession('u1'), { createdById: 'u1' })).toBe(true)
  })

  it('refuse un autre COLLABORATEUR', () => {
    expect(canManageResource(userSession('u2'), { createdById: 'u1' })).toBe(false)
  })

  it('autorise un ADMIN sur la ressource d\'un autre', () => {
    expect(canManageResource(userSession('admin', 'ADMIN'), { createdById: 'u1' })).toBe(true)
  })

  it('autorise un ADMINISTRATEUR_JUDICIAIRE', () => {
    expect(canManageResource(userSession('aj', 'ADMINISTRATEUR_JUDICIAIRE'), { createdById: 'u1' })).toBe(true)
  })

  it('ressource sans createdById : seuls les rôles privilégiés passent', () => {
    expect(canManageResource(userSession('u1'), null)).toBe(false)
    expect(canManageResource(userSession('admin', 'ADMIN'), null)).toBe(true)
  })
})
