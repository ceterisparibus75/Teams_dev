import { computeDedupKey } from '@/lib/meeting-sync'

describe('computeDedupKey', () => {
  it('combine joinUrl et heure de début (clé stable entre boîtes mail)', () => {
    const key = computeDedupKey({
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/ABC',
      startDateTime: '2026-05-27T13:30:00Z',
    })
    expect(key).toBe('https://teams.microsoft.com/l/meetup-join/ABC::2026-05-27T13:30:00.000Z')
  })

  it('produit la même clé pour deux boîtes mail (même joinUrl + même début)', () => {
    const userA = computeDedupKey({ joinUrl: 'https://join/X', startDateTime: '2026-05-27T13:30:00Z' })
    const userB = computeDedupKey({ joinUrl: 'https://join/X', startDateTime: new Date('2026-05-27T13:30:00Z') })
    expect(userA).toBe(userB)
  })

  it('distingue deux occurrences d’une série récurrente (même joinUrl, débuts différents)', () => {
    const occ1 = computeDedupKey({ joinUrl: 'https://join/X', startDateTime: '2026-05-20T13:30:00Z' })
    const occ2 = computeDedupKey({ joinUrl: 'https://join/X', startDateTime: '2026-05-27T13:30:00Z' })
    expect(occ1).not.toBe(occ2)
  })

  it('retourne null sans joinUrl (réunion non dédupliquable)', () => {
    expect(computeDedupKey({ joinUrl: null, startDateTime: '2026-05-27T13:30:00Z' })).toBeNull()
    expect(computeDedupKey({ joinUrl: '   ', startDateTime: '2026-05-27T13:30:00Z' })).toBeNull()
  })
})
