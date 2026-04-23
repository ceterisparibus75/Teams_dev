import { getMinutesQualityAlerts } from '@/lib/minutes-quality'
import type { MinutesContent } from '@/types'

function buildMinutesContent(overrides: Partial<MinutesContent> = {}): MinutesContent {
  return {
    summary: 'Résumé propre de la réunion.',
    notes: '',
    actions: [],
    sections: [
      { numero: 1, titre: 'Contexte', contenu: 'L’entreprise a présenté sa situation.' },
    ],
    ...overrides,
  }
}

describe('getMinutesQualityAlerts', () => {
  it('détecte le terme interdit "débiteur" dans les champs visibles', () => {
    const content = buildMinutesContent({
      summary: 'Le débiteur a indiqué que la trésorerie était tendue.',
    })

    const alerts = getMinutesQualityAlerts(content)

    expect(alerts).toHaveLength(1)
    expect(alerts[0].code).toBe('forbidden_term')
    expect(alerts[0].field).toBe('Résumé')
  })

  it('détecte prioritairement l’expression "conseil du débiteur" sans doublon sur le même extrait', () => {
    const content = buildMinutesContent({
      sections: [
        { numero: 1, titre: 'Participants', contenu: 'Le conseil du débiteur a confirmé l’envoi des pièces.' },
      ],
    })

    const alerts = getMinutesQualityAlerts(content)

    expect(alerts).toHaveLength(1)
    expect(alerts[0].code).toBe('forbidden_phrase')
    expect(alerts[0].message).toContain('conseil de l’entreprise')
  })

  it('remonte aussi les problèmes présents dans le PV structuré interne', () => {
    const content = buildMinutesContent({
      _pv: {
        metadata: {
          date_reunion: '23 avril 2026',
          affaire: 'SOCIETE TEST',
          type_procedure: 'Mandat ad hoc',
          objet: 'Réunion',
          ville_signature: 'PARIS',
          signataire: 'MAXIME LANGET',
        },
        modalites: 'Réunion par visioconférence',
        participants: [
          {
            civilite_nom: 'Maître X',
            societe_qualite: 'Cabinet Y — Conseil du débiteur',
            presence: 'Visioconférence',
            categorie: 'conseil_debiteur',
          },
        ],
        documents_amont: [],
        resume: 'Résumé propre.',
        sections: [{ titre: 'Contexte', contenu: 'Texte propre.' }],
        points_desaccord: [],
        actions: [],
        points_vigilance: [],
        precisions_a_apporter: [],
      },
    })

    const alerts = getMinutesQualityAlerts(content)

    expect(alerts).toHaveLength(1)
    expect(alerts[0].field).toContain('participant 1')
  })

  it('ignore les anciennes sections stockées dans _pv quand la version éditable est propre', () => {
    const content = buildMinutesContent({
      sections: [
        { numero: 1, titre: 'Contexte', contenu: 'L’entreprise a présenté sa situation.' },
      ],
      _pv: {
        metadata: {
          date_reunion: '23 avril 2026',
          affaire: 'SOCIETE TEST',
          type_procedure: 'Mandat ad hoc',
          objet: 'Réunion',
          ville_signature: 'PARIS',
          signataire: 'MAXIME LANGET',
        },
        modalites: 'Réunion par visioconférence',
        participants: [],
        documents_amont: [],
        resume: 'Le débiteur figurait dans une ancienne version interne.',
        sections: [{ titre: 'Contexte', contenu: 'Le débiteur figurait dans une ancienne version interne.' }],
        points_desaccord: [],
        actions: [],
        points_vigilance: [],
        precisions_a_apporter: [],
      },
    })

    expect(getMinutesQualityAlerts(content)).toHaveLength(0)
  })
})
