import { buildDocxFilename, buildActionRows } from '@/lib/docx-generator'

describe('buildDocxFilename', () => {
  it('format : NOM DU DOSSIER (majuscule)_Réunion du_date', () => {
    const name = buildDocxFilename('Groupe Bheekaree', new Date('2026-04-22T10:00:00'))
    expect(name).toBe('GROUPE BHEEKAREE_Réunion du_22 avril 2026.docx')
  })

  it('met le nom du dossier en majuscule et retire les caractères interdits', () => {
    const name = buildDocxFilename('Société X / Y', new Date('2026-05-26T10:00:00'))
    expect(name).toBe('SOCIÉTÉ X Y_Réunion du_26 mai 2026.docx')
  })

  it('repli sur "DOSSIER" si le nom est vide', () => {
    const name = buildDocxFilename('', new Date('2026-05-26T10:00:00'))
    expect(name).toBe('DOSSIER_Réunion du_26 mai 2026.docx')
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
