import { buildDocxFilename, buildActionRows } from '@/lib/docx-generator'

describe('buildDocxFilename', () => {
  it('génère un nom de fichier normalisé', () => {
    const name = buildDocxFilename('Réunion créanciers', new Date('2026-04-22T10:00:00'))
    expect(name).toMatch(/^PV_22042026_/)
    expect(name).toMatch(/\.docx$/)
  })
})

describe('buildActionRows', () => {
  it('convertit les actions en lignes de tableau', () => {
    const actions = [{ description: 'Envoyer bilan', responsable: 'Marie', echeance: '2026-05-01' }]
    const rows = buildActionRows(actions)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(3)
  })

  it('retourne un tableau vide si aucune action', () => {
    expect(buildActionRows([])).toEqual([])
  })
})
