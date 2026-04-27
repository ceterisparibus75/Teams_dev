import {
  buildPrompt,
  parseMinutesContent,
  createSkeletonContent,
  pvContentToMinutesContent,
  normalizeParticipantPresenceFromTranscript,
} from '@/lib/claude-generator'
import type { PvContent } from '@/schemas/pv-content.schema'

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

  it('distingue la liste Teams des intervenants détectés dans la transcription', () => {
    const prompt = buildPrompt(
      'Réunion créanciers',
      '[Maxime Langet] Bonjour à tous.\n[Charles Prieur] Merci.',
      [
        { name: 'Maxime Langet', email: 'maxime.langet@bl-aj.fr' },
        { name: 'Jean Absent', email: 'jean@example.com' },
      ]
    )

    expect(prompt).toContain("liste Teams d'invitation")
    expect(prompt).toContain('Intervenants détectés')
    expect(prompt).toContain('- Maxime Langet')
    expect(prompt).toContain('- Charles Prieur')
  })

  it('inclut le rapport de présence Teams quand il est fourni', () => {
    const prompt = buildPrompt(
      'Réunion créanciers',
      '[Maxime Langet] Bonjour à tous.',
      [{ name: 'Maxime Langet', email: 'maxime.langet@bl-aj.fr' }],
      new Date('2026-04-23T10:00:00Z'),
      [
        {
          name: 'Jean Présent',
          email: 'jean@example.com',
          totalAttendanceInSeconds: 600,
          intervals: [
            { joinDateTime: '2026-04-23T10:00:00Z', leaveDateTime: '2026-04-23T10:10:00Z' },
          ],
        },
      ]
    )

    expect(prompt).toContain('Rapport de présence Teams')
    expect(prompt).toContain('Jean Présent <jean@example.com>')
    expect(prompt).toContain('10 min')
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

// ─── buildPrompt — truncation 40k+10k+10k ────────────────────────────────────

describe('buildPrompt — truncation', () => {
  const MAX_HEAD = 40_000
  const MAX_MIDDLE = 10_000
  const MAX_TAIL = 10_000
  const THRESHOLD = MAX_HEAD + MAX_MIDDLE + MAX_TAIL // 60 000

  it('transcription < 60 001 chars : retournée intacte dans le prompt', () => {
    const transcript = 'A'.repeat(THRESHOLD) // exactement 60 000 — pas tronquée
    const prompt = buildPrompt('Sujet', transcript)
    expect(prompt).toContain(transcript)
    expect(prompt).not.toContain('caractères omis')
  })

  it('transcription = 80 000 chars : contient deux marqueurs "[… X caractères omis …]"', () => {
    const transcript = 'B'.repeat(80_000)
    const prompt = buildPrompt('Sujet', transcript)
    const matches = prompt.match(/\[… .+ caractères omis …\]/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2)
  })

  it('transcription = 80 000 chars : les 40 000 premiers chars sont présents', () => {
    // On distingue début / milieu / fin avec des caractères différents
    const head = 'H'.repeat(MAX_HEAD)
    const rest = 'R'.repeat(80_000 - MAX_HEAD)
    const transcript = head + rest
    const prompt = buildPrompt('Sujet', transcript)
    // Le prompt doit contenir un bloc de H consécutifs de taille MAX_HEAD
    expect(prompt).toContain(head)
  })

  it('transcription = 80 000 chars : les 10 000 derniers chars sont présents', () => {
    const init = 'I'.repeat(80_000 - MAX_TAIL)
    const tail = 'T'.repeat(MAX_TAIL)
    const transcript = init + tail
    const prompt = buildPrompt('Sujet', transcript)
    expect(prompt).toContain(tail)
  })

  it('transcription = 80 000 chars : un extrait du milieu est présent', () => {
    // Milieu centré autour du caractère (80000 - 10000) / 2 = 35000
    const transcript = 'X'.repeat(80_000)
    const middleStart = Math.floor((80_000 - MAX_MIDDLE) / 2)
    const middle = transcript.slice(middleStart, middleStart + MAX_MIDDLE)
    const prompt = buildPrompt('Sujet', transcript)
    expect(prompt).toContain(middle)
  })
})

// ─── createSkeletonContent ────────────────────────────────────────────────────

describe('createSkeletonContent', () => {
  it('retourne un MinutesContent avec summary non vide', () => {
    const result = createSkeletonContent('Mon Affaire')
    expect(result.summary).toBeTruthy()
    expect(typeof result.summary).toBe('string')
  })

  it('le champ summary contient "aucune transcription"', () => {
    const result = createSkeletonContent('Mon Affaire')
    expect(result.summary.toLowerCase()).toContain('aucune transcription')
  })

  it('si participants fournis, ils apparaissent dans _pv.participants', () => {
    const participants = [{ name: 'Alice Dupont' }, { name: 'Bob Martin' }]
    const result = createSkeletonContent('Mon Affaire', participants)
    expect(result._pv).toBeDefined()
    const pv = result._pv as PvContent
    const names = pv.participants.map((p) => p.civilite_nom)
    expect(names).toContain('Alice Dupont')
    expect(names).toContain('Bob Martin')
  })
})

// ─── pvContentToMinutesContent ────────────────────────────────────────────────

/** Construit un PvContent minimal valide (tous les champs requis par Zod) */
function buildPvContent(overrides: Partial<PvContent> = {}): PvContent {
  return {
    metadata: {
      date_reunion: '22 avril 2026',
      affaire: 'SOCIÉTÉ TEST',
      type_procedure: 'Mandat ad hoc',
      objet: 'Réunion de suivi',
      ville_signature: 'PARIS',
      signataire: 'Maître Dupont',
    },
    modalites: 'Réunion par visioconférence',
    participants: [],
    documents_amont: [],
    resume: 'Résumé de la réunion de test.',
    sections: [
      { titre: 'Section 1', contenu: 'Contenu de la section 1.' },
      { titre: 'Section 2', contenu: 'Contenu de la section 2.' },
    ],
    points_desaccord: [],
    actions: [],
    points_vigilance: [],
    precisions_a_apporter: [],
    ...overrides,
  }
}

describe('pvContentToMinutesContent', () => {
  it('convertit pv.resume → summary', () => {
    const pv = buildPvContent({ resume: 'Mon résumé complet.' })
    const result = pvContentToMinutesContent(pv)
    expect(result.summary).toBe('Mon résumé complet.')
  })

  it('convertit pv.sections → tableau sections avec numéros 1, 2, 3...', () => {
    const pv = buildPvContent({
      sections: [
        { titre: 'Intro', contenu: 'Contexte.' },
        { titre: 'Finances', contenu: 'Chiffres.' },
        { titre: 'Actions', contenu: 'Prochaines étapes.' },
      ],
    })
    const result = pvContentToMinutesContent(pv)
    expect(result.sections).toHaveLength(3)
    expect(result.sections![0].numero).toBe(1)
    expect(result.sections![1].numero).toBe(2)
    expect(result.sections![2].numero).toBe(3)
  })

  it('convertit pv.actions → tableau actions avec description, responsable, echeance', () => {
    const pv = buildPvContent({
      actions: [
        { libelle: 'Préparer le business plan', responsable: 'Alice (Cabinet GT)', echeance: '30 avril 2026' },
        { libelle: 'Envoyer les documents', responsable: 'Bob (Société)', echeance: 'Non précisée' },
      ],
    })
    const result = pvContentToMinutesContent(pv)
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0].description).toBe('Préparer le business plan')
    expect(result.actions[0].responsable).toBe('Alice (Cabinet GT)')
    expect(result.actions[0].echeance).toBe('30 avril 2026')
    expect(result.actions[1].description).toBe('Envoyer les documents')
  })

  it('prochaine_reunion fournie → chaîne formatée', () => {
    const pv = buildPvContent({
      prochaine_reunion: { date: '15 mai 2026', heure: '14h00', fuseau: 'heure Paris' },
    })
    const result = pvContentToMinutesContent(pv)
    expect(result.prochaine_reunion).toBe('15 mai 2026 à 14h00 (heure Paris)')
  })

  it('prochaine_reunion absente → undefined', () => {
    const pv = buildPvContent({ prochaine_reunion: undefined })
    const result = pvContentToMinutesContent(pv)
    expect(result.prochaine_reunion).toBeUndefined()
  })

  it('precisions_a_apporter → notes avec chaque item préfixé "→ "', () => {
    const pv = buildPvContent({
      precisions_a_apporter: [
        'Vérifier le montant de la dette',
        'Confirmer la date du tribunal',
      ],
    })
    const result = pvContentToMinutesContent(pv)
    expect(result.notes).toContain('→ Vérifier le montant de la dette')
    expect(result.notes).toContain('→ Confirmer la date du tribunal')
  })
})

describe('normalizeParticipantPresenceFromTranscript', () => {
  it('ne marque pas absent un invité silencieux sans mention explicite d’absence', () => {
    const pv = buildPvContent({
      participants: [
        {
          civilite_nom: 'Maxime Langet',
          societe_qualite: 'SELAS BL & Associés — Conciliateur',
          email: 'maxime.langet@bl-aj.fr',
          presence: 'Visioconférence',
          categorie: 'conciliateur',
        },
        {
          civilite_nom: 'Jean Absent',
          societe_qualite: 'Banque Test',
          email: 'jean@example.com',
          presence: 'Visioconférence',
          categorie: 'partenaire_bancaire',
        },
      ],
    })

    const normalized = normalizeParticipantPresenceFromTranscript(
      pv,
      '[Maxime Langet] Bonjour à tous.\n[Charles Prieur] Merci.'
    )

    expect(normalized.participants[0].presence).toBe('Visioconférence')
    expect(normalized.participants[1].presence).toBe('Visioconférence')
  })

  it('marque absent un invité explicitement signalé comme absent', () => {
    const pv = buildPvContent({
      participants: [
        {
          civilite_nom: 'Jean Absent',
          societe_qualite: 'Banque Test',
          email: 'jean@example.com',
          presence: 'Visioconférence',
          categorie: 'partenaire_bancaire',
        },
      ],
    })

    const normalized = normalizeParticipantPresenceFromTranscript(
      pv,
      '[Maxime Langet] Jean Absent est excusé et ne participera pas à la réunion.'
    )

    expect(normalized.participants[0].presence).toBe('Absent')
  })

  it('ne modifie pas les présences si aucun intervenant structuré n’est détecté', () => {
    const pv = buildPvContent({
      participants: [
        {
          civilite_nom: 'Jean Dupont',
          societe_qualite: 'Entreprise',
          presence: 'Visioconférence',
          categorie: 'debiteur',
        },
      ],
    })

    const normalized = normalizeParticipantPresenceFromTranscript(pv, 'Bonjour sans speaker structuré.')

    expect(normalized.participants[0].presence).toBe('Visioconférence')
  })

  it('utilise le rapport de présence Teams pour distinguer présents et absents silencieux', () => {
    const pv = buildPvContent({
      participants: [
        {
          civilite_nom: 'Jean Présent',
          societe_qualite: 'Banque Test',
          email: 'jean.present@example.com',
          presence: 'Visioconférence',
          categorie: 'partenaire_bancaire',
        },
        {
          civilite_nom: 'Marie Invitée',
          societe_qualite: 'Banque Test',
          email: 'marie.invitee@example.com',
          presence: 'Visioconférence',
          categorie: 'partenaire_bancaire',
        },
      ],
    })

    const normalized = normalizeParticipantPresenceFromTranscript(
      pv,
      '[Maxime Langet] Bonjour à tous.',
      [
        {
          name: 'Jean Présent',
          email: 'jean.present@example.com',
          totalAttendanceInSeconds: 900,
          intervals: [{ joinDateTime: '2026-04-23T10:00:00Z', leaveDateTime: '2026-04-23T10:15:00Z' }],
        },
      ]
    )

    expect(normalized.participants[0].presence).toBe('Visioconférence')
    expect(normalized.participants[1].presence).toBe('Absent')
  })
})
