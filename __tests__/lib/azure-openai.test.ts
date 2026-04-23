import { buildPrompt, parseMinutesContent } from '@/lib/azure-openai'

describe('buildPrompt', () => {
  it('inclut le sujet de la réunion dans le prompt', () => {
    const prompt = buildPrompt('Réunion créanciers', 'Transcript content here')
    expect(prompt).toContain('Réunion créanciers')
    expect(prompt).toContain('Transcript content here')
  })

  it('fonctionne sans transcription', () => {
    const prompt = buildPrompt('Réunion équipe', null)
    expect(prompt).toContain('aucune transcription')
  })
})

describe('parseMinutesContent', () => {
  it('parse un JSON valide', () => {
    const raw = JSON.stringify({
      summary: 'Résumé test',
      actions: [{ description: 'Action 1', responsable: 'Marie', echeance: '2026-05-01' }],
      notes: '',
    })
    const result = parseMinutesContent(raw)
    expect(result.summary).toBe('Résumé test')
    expect(result.actions).toHaveLength(1)
  })

  it('retourne un contenu vide si JSON invalide', () => {
    const result = parseMinutesContent('pas du json')
    expect(result.summary).toBe('')
    expect(result.actions).toEqual([])
  })
})
