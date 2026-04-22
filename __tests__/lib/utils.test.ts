import { formatDate, formatDateTime, cn, slugify } from '@/lib/utils'

describe('formatDate', () => {
  it('formate une date en JJ/MM/AAAA', () => {
    expect(formatDate(new Date('2026-04-22T10:00:00Z'))).toMatch(/22\/04\/2026/)
  })
})

describe('formatDateTime', () => {
  it('formate date et heure', () => {
    const result = formatDateTime(new Date('2026-04-22T14:30:00'))
    expect(result).toMatch(/22\/04\/2026/)
  })
})

describe('cn', () => {
  it('fusionne des classes Tailwind', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2')
  })
})

describe('slugify', () => {
  it('convertit les caractères accentués', () => {
    expect(slugify('Réunion créanciers')).toBe('reunion-creanciers')
  })
})
