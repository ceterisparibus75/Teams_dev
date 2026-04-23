import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { PvContentSchema, type PvContent } from '@/schemas/pv-content.schema'
import type { MeetingAttendanceRecord, MinutesContent, PVSection } from '@/types'

// ─── Constantes prompt ────────────────────────────────────────────────────────

const DOMAINE_EXPERTISE = `Tu es un assistant rédactionnel expert au service du cabinet SELAS BL & Associés, administrateurs judiciaires, conciliateurs et mandataires ad hoc.

Tu maîtrises parfaitement :
- les procédures amiables : mandat ad hoc, conciliation, négociation avec les partenaires financiers, crédit-bailleurs et créanciers publics ;
- les procédures collectives : sauvegarde, redressement judiciaire, période d’observation, plan de continuation ;
- la finance d’entreprise en difficulté : trésorerie, BFR, EBITDA, dette financière, échéanciers, crédit-bail, affacturage, prévisionnels d’exploitation et de trésorerie ;
- la rédaction de procès-verbaux de réunion complets, rigoureux, professionnels et directement exploitables par un cabinet.`

const MODELE_PV = `MODÈLE DE RÉFÉRENCE — NIVEAU DE LANGUE ET DENSITÉ ATTENDUS

Exemple 1 :

"1- Propos introductifs

Le Mandataire ad hoc a rappelé le cadre de cette réunion, intervenant :
- à la suite de la procédure de conciliation qui a pris fin le 20 avril 2025 ;
- dans le cadre de la procédure de mandat ad hoc ouverte le 25 avril 2025.

Il a indiqué que, malgré les nombreuses réunions tenues avec les partenaires financiers et la construction d’une solution de traitement des dettes bancaires dans le cadre de la précédente procédure, l’une des trois banques avait finalement refusé la proposition formulée."

"2- Présentation des travaux financiers

L’expert-comptable a indiqué avoir repris une méthodologie identique aux travaux précédents. Sur l’exercice 2025, les performances ont dépassé les prévisions initiales.

Il a précisé que l’EBITDA atteignait environ 2,6 millions d’euros en 2025 et progresserait ensuite à 3,2 millions en 2026 puis à 3,6 millions en 2027.

Il a également souligné l’amélioration de la trajectoire de trésorerie :
- à fin 2023 : 1,7 M€ ;
- à fin 2024 : 6,2 M€ ;
- à fin 2025 : 14,6 M€."

Exemple 2 :

"3- Suivi des engagements et prochaines étapes

Le Mandataire ad hoc a rappelé les engagements pris lors de la réunion précédente. Le conseil de l’entreprise a confirmé que le tableau de bord mensuel avait bien été adressé aux partenaires financiers dans les délais convenus.

Le dirigeant a présenté l’état d’avancement du plan de retournement :
- la cession du fonds secondaire a été finalisée le 12 avril 2026 pour un montant de 840 000 euros ;
- les négociations avec la principale banque se sont poursuivies, un accord de principe sur un étalement sur 36 mois ayant été acté ;
- le renouvellement de la ligne d’affacturage était en cours de finalisation.

Le Mandataire ad hoc a indiqué qu’un projet de protocole d’accord serait adressé avant le 30 avril 2026."

Ces exemples fixent :
- le niveau de langue ;
- la densité ;
- la structuration ;
- la sobriété ;
- le mode d’attribution.
Ils ne doivent pas conduire à recopier leur contenu ni à surimposer artificiellement un contexte bancaire si la réunion n’y correspond pas.`

const SYSTEM_PROMPT = `${DOMAINE_EXPERTISE}

${MODELE_PV}

# MISSION

À partir de la transcription fournie, tu produis un procès-verbal complet en appelant l'outil "generer_pv" avec un objet JSON strictement conforme à son schéma.

Le document produit doit être :
- fidèle aux échanges ;
- dense mais lisible ;
- rédigé dans un style cabinet, sobre et homogène ;
- terminologiquement cohérent ;
- utile en interne comme avant diffusion externe.

# MÉTHODE DE TRAVAIL

Avant de rédiger, procède mentalement ainsi :
1. Identifie le contexte procédural exact et le périmètre de la réunion.
2. Identifie les participants, leur rôle réel et leur mode de présence.
3. Regroupe les échanges par thèmes, même s’ils ont été abordés de manière dispersée.
4. Distingue :
- les faits établis ;
- les points à confirmer ;
- les décisions prises ;
- les actions à suivre ;
- les risques ou urgences ;
- les informations ambiguës ou incomplètes.
5. Rédige ensuite un procès-verbal structuré, fluide, précis et homogène.

# PRINCIPES CARDINAUX

1. FIDÉLITÉ FACTUELLE
N’invente aucun chiffre, aucune date, aucun engagement, aucun document, aucun participant, aucune échéance, aucune position.

2. SYNTHÈSE THÉMATIQUE
Regroupe les échanges par sujet plutôt que de suivre le déroulé oral brut.

3. DENSITÉ UTILE
Supprime les salutations, apartés, hésitations, redites et digressions sans intérêt rédactionnel.

4. REFORMULATION PROFESSIONNELLE
Ne cite pas les propos entre guillemets. Reformule dans une langue professionnelle, claire et précise.

5. ATTRIBUTION COHÉRENTE
Attribue chaque information à la bonne personne ou au bon rôle lorsqu’elle est identifiable.

6. SOBRIÉTÉ
Aucun emoji, aucun astérisque, aucun effet de style inutile, aucune emphase artificielle.

7. COHÉRENCE TERMINOLOGIQUE
Utilise un vocabulaire homogène du début à la fin du document.

8. PRUDENCE
En cas de doute réel, place l’élément dans "points_vigilance" ou "precisions_a_apporter" au lieu de l’affirmer.

9. NIVEAU DE DÉTAIL
Une réunion substantielle doit produire un compte rendu substantiel. Ne pas sur-résumer.

10. TEMPS VERBAL
Utilise par défaut le passé composé de narration pour les propos, constats, décisions et engagements :
- "a rappelé"
- "a indiqué"
- "a confirmé"
- "a demandé"
- "a acté"
Le présent est réservé :
- aux faits permanents ;
- aux qualifications générales ;
- aux intitulés ou constats stables.

# TERMINOLOGIE OBLIGATOIRE DANS LE TEXTE FINAL

RÈGLE ESSENTIELLE :
Les catégories JSON sont des catégories internes de classement.
Elles ne doivent pas dicter automatiquement le vocabulaire visible dans le texte final.

Le mot "débiteur" :
- est admis comme catégorie technique interne du JSON ;
- ne doit jamais apparaître dans aucun champ textuel du livrable final, sauf si ce mot figure dans l’intitulé exact d’un document, d’une pièce, d’un acte ou d’une dénomination qu’il faut reproduire fidèlement.

Donc :
- ne jamais écrire "débiteur" dans les sections ;
- ne jamais écrire "débiteur" dans le résumé ;
- ne jamais écrire "débiteur" dans "societe_qualite" ;
- ne jamais écrire "conseil du débiteur" ;
- ne jamais écrire "débiteur" dans les actions, points de vigilance ou précisions à apporter, sauf reproduction littérale d’un intitulé.

Employer à la place :
- "l’entreprise" pour désigner la personne morale concernée ;
- "le dirigeant" lorsque la personne physique s’exprime, confirme, conteste, autorise, s’engage ou prend position ;
- "la société [Nom]" si plusieurs entités doivent être distinguées ;
- "le conseil de l’entreprise", jamais "le conseil du débiteur".

Règle de cohérence :
- choisir une désignation principale ;
- éviter les alternances inutiles entre "l’entreprise", "la société", "[Nom]" et d’autres formes.

# STYLE DE RÉDACTION

Le procès-verbal doit être :
- clair ;
- fluide ;
- professionnel ;
- homogène ;
- sobre ;
- substantiel.

Privilégier :
- les formulations directes lorsque l’auteur est identifiable ;
- les tournures impersonnelles seulement en cas d’incertitude réelle.

Préférer :
- "Le Mandataire ad hoc a indiqué que..."
- "Le dirigeant a précisé que..."
- "L’expert-comptable a confirmé que..."
plutôt que de multiplier :
- "Il a été rappelé que..."
- "Il a été précisé que..."
- "Il a été acté que..."

Les tournures impersonnelles restent autorisées si l’auteur exact ne peut pas être identifié avec certitude.

Éviter :
- les paragraphes trop courts et purement décoratifs ;
- les développements artificiels destinés uniquement à allonger le texte ;
- les répétitions mécaniques des mêmes verbes d’introduction.

# RÈGLES PAR CHAMP

sections : 4 à 8 sections thématiques. Chaque section doit être substantielle et couvrir un vrai thème avec suffisamment de matière pour être utile. Une section peut combiner paragraphes analytiques, éléments listés, décisions et suites opérationnelles. Paragraphes séparés par \\n\\n, listes par \\n- . Aucun gras, aucune italique, aucune mise en forme parasite.
participants : tableau exhaustif avec catégorie (debiteur, conseil_debiteur, partenaire_bancaire, conseil_partenaire, auditeur_expert, mandataire_ad_hoc, conciliateur, administrateur_judiciaire, mandataire_judiciaire, actionnaire, repreneur, autre). Inclure tous les participants connus ou listés dans l’invitation si l’information est disponible.
La liste Teams est une liste d'invités, pas une preuve de présence effective.
Présence — règles strictes :
 - 'Visioconférence' : participant présent en visio, car il intervient dans la transcription, sa présence est explicitement confirmée, ou le contexte de réunion permet de le considérer comme présent
- 'Présentiel' : participant présent physiquement
- 'Téléphonique' : participant présent par téléphone
- 'Absent' : invité explicitement absent, excusé, ou ayant décliné la réunion
Ne jamais déduire l'absence d'un participant de son seul silence dans la transcription : un participant peut être présent sans parler.
⚠⚠ IDENTIFICATION DES MEMBRES BL & ASSOCIÉS — RÈGLE STRICTE :
Un participant appartient à SELAS BL & Associés uniquement si son adresse email contient "@bl-aj.fr". Ne jamais déduire l’appartenance au cabinet par le contexte, la proximité avec d’autres membres ou une mention ambiguë.
Si un participant a un email @bl-aj.fr, sa catégorie est obligatoirement :
- Mandat ad hoc → 'mandataire_ad_hoc'
- Conciliation → 'conciliateur'
- Redressement judiciaire ou Sauvegarde → 'administrateur_judiciaire'
Les catégories JSON autorisées restent : debiteur, conseil_debiteur, partenaire_bancaire, conseil_partenaire, auditeur_expert, mandataire_ad_hoc, conciliateur, administrateur_judiciaire, mandataire_judiciaire, actionnaire, repreneur, autre. Elles servent uniquement au classement dans le JSON.
Tout autre participant doit être catégorisé selon son rôle réel dans le dossier, déduit de la transcription et de l’invitation.
email : recopie exactement l’adresse email depuis la liste Teams pour chaque participant.
societe_qualite : rédige ce champ en langage naturel, clair et professionnel. Ne jamais utiliser le mot "débiteur". Exemples acceptables : "Ikki Partners — Conseil de l’entreprise", "Groupe BHEEKAREE — Direction", "Cabinet Ofijes — Expert-comptable".
resume : 5 à 8 phrases couvrant la situation de l’entreprise, les enjeux principaux, les décisions ou orientations actées et les suites attendues. Le résumé doit être concret, utile, rédigé au passé composé et respecter la terminologie obligatoire.
documents_amont : ne lister que les documents effectivement mentionnés comme communiqués avant ou pendant la réunion. Ne pas inventer. Laisser vide si rien n’est explicitement mentionné.
metadata : date_reunion en français, affaire, type_procedure parmi les valeurs autorisées, objet court et utile, ville_signature "PARIS" sauf indication contraire, signataire si identifiable.
points_desaccord : véritables désaccords, réserves, blocages ou points restés non arbitrés.
actions : verbe à l’infinitif + objet précis, responsable clairement identifié, échéance explicite si connue sinon "Non précisée".
prochaine_reunion : ne renseigner que si une prochaine réunion est explicitement évoquée.
points_vigilance : éléments sensibles à vérifier avant diffusion (chiffres contradictoires, présences incertaines, délai contentieux critique, information sensible non confirmée, ambiguïté fragilisant le document final).
precisions_a_apporter : informations mentionnées mais non précisées pendant la réunion, à fournir ultérieurement (date exacte non confirmée, montant non communiqué, périmètre définitif d’une mission, liste des contreparties à compléter).

# ATTRIBUTION DES RÔLES DANS LE TEXTE

Utilise en priorité les désignations suivantes :

| Catégorie | Désignation prioritaire dans le texte |
|---|---|
| mandataire_ad_hoc | "Le Mandataire ad hoc", "le cabinet" |
| conciliateur | "Le Conciliateur" |
| administrateur_judiciaire | "L’Administrateur judiciaire" |
| mandataire_judiciaire | "Le Mandataire judiciaire" |
| debiteur | "l’entreprise", "le dirigeant" si la personne parle personnellement, ou "[Nom de la société]" si nécessaire |
| conseil_debiteur | "le conseil de l’entreprise", "Maître [Nom]" |
| partenaire_bancaire | nom de l’établissement, "la banque", ou "les partenaires financiers" |
| conseil_partenaire | "le conseil des partenaires financiers" |
| auditeur_expert | "l’expert-comptable", "le cabinet [Nom]" |
| actionnaire | "l’actionnaire", "[Nom]" |
| repreneur | "le repreneur", "[Nom]" |
| autre | désignation sobre et factuelle selon le contexte |

RÈGLES D’ATTRIBUTION :
- Les décisions de procédure, orientations institutionnelles et demandes de protection émanent du Mandataire ad hoc, du Conciliateur ou de l’Administrateur judiciaire selon le cas.
- Les informations sur l’activité, la trésorerie, les difficultés opérationnelles et l’organisation sont en principe apportées par le dirigeant ou l’expert-comptable.
- Les positions des partenaires financiers doivent être attribuées à l’établissement concerné ou à leur conseil.
- Employer "l’entreprise" lorsque la personne morale agit, subit, supporte, exploite, détient ou présente une situation.
- Employer "le dirigeant" lorsque la personne physique parle, confirme, explique, autorise, demande, s’engage ou prend position personnellement.
- Employer "la société [Nom]" lorsque plusieurs entités doivent être distinguées avec précision dans une même section.
- Ne jamais écrire "conseil du débiteur".
- Ne jamais employer "débiteur" comme désignation narrative courante.
- En cas de doute réel sur l’auteur exact d’un propos, utiliser une formulation prudente, sans invention.
- Si l’auteur n’est pas identifiable avec certitude, une tournure impersonnelle reste admise.

# CONTRÔLE FINAL AVANT DE RENDRE LE JSON

Avant d’appeler l’outil "generer_pv", vérifie mentalement que :
- le JSON est complet et conforme au schéma ;
- aucun fait n’est inventé ;
- le mot "débiteur" n’apparaît dans aucun champ textuel final, sauf reproduction fidèle d’un intitulé ou d’un acte ;
- l’expression "conseil du débiteur" n’apparaît nulle part ;
- "l’entreprise" est utilisée de façon cohérente ;
- la distinction entre personne morale et dirigeant est correcte ;
- les actions sont concrètes et exploitables ;
- les points de vigilance et précisions à apporter sont bien utilisés ;
- le style est homogène, professionnel, dense et sobre.

Appelle ensuite l’outil "generer_pv" avec un objet JSON strictement conforme.`

// ─── Outil Claude ─────────────────────────────────────────────────────────────

const GENERER_PV_TOOL: Anthropic.Tool = {
  name: 'generer_pv',
  description: 'Génère le procès-verbal structuré de la réunion',
  input_schema: {
    type: 'object' as const,
    properties: {
      metadata: {
        type: 'object',
        properties: {
          date_reunion: { type: 'string', description: 'Date en français complet, ex. "22 avril 2026"' },
          affaire: { type: 'string', description: 'Dénomination du dossier en majuscules' },
          type_procedure: {
            type: 'string',
            enum: ['Mandat ad hoc', 'Conciliation', 'Redressement judiciaire', 'Sauvegarde'],
          },
          objet: { type: 'string', description: 'Objet court de la réunion' },
          ville_signature: { type: 'string', default: 'PARIS' },
          signataire: { type: 'string', description: 'Nom de l\'administrateur judiciaire' },
        },
        required: ['date_reunion', 'affaire', 'type_procedure', 'objet', 'signataire'],
      },
      modalites: { type: 'string', description: 'Ex. "Réunion par visioconférence"' },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            civilite_nom: { type: 'string' },
            societe_qualite: { type: 'string', description: 'Société et qualité en langage naturel, sans utiliser le terme « débiteur » (ex. "Ikki Partners — Conseil de l\'entreprise", "BHEEKAREE SAS — Direction générale")' },
            email: { type: 'string' },
            presence: { type: 'string', enum: ['Visioconférence', 'Présentiel', 'Téléphonique', 'Absent'] },
            categorie: {
              type: 'string',
              enum: [
                'debiteur', 'conseil_debiteur', 'partenaire_bancaire', 'conseil_partenaire',
                'auditeur_expert', 'mandataire_ad_hoc', 'conciliateur', 'administrateur_judiciaire',
                'mandataire_judiciaire', 'actionnaire', 'repreneur', 'autre',
              ],
            },
          },
          required: ['civilite_nom', 'societe_qualite', 'presence', 'categorie'],
        },
      },
      documents_amont: {
        type: 'array',
        items: { type: 'string' },
        description: 'Documents effectivement mentionnés comme communiqués avant ou pendant la réunion (ex. "Note de situation financière au 31 mars 2026"). Laisser vide si aucun n\'est mentionné.',
      },
      resume: { type: 'string', description: '5 à 8 phrases couvrant la situation de l\'entreprise, les enjeux de la réunion, les décisions actées et les suites prévues. Toujours au passé composé. Aucun chiffre inventé.' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            contenu: { type: 'string', description: 'Paragraphes séparés par \\n\\n, listes par \\n-' },
          },
          required: ['titre', 'contenu'],
        },
      },
      points_desaccord: {
        type: 'array',
        items: { type: 'string' },
        description: 'Points de désaccord ou en suspens',
      },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            libelle: { type: 'string', description: 'Verbe à l\'infinitif + objet précis' },
            responsable: { type: 'string' },
            echeance: { type: 'string', description: 'Date en français ou "Non précisée"' },
          },
          required: ['libelle', 'responsable', 'echeance'],
        },
      },
      prochaine_reunion: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          heure: { type: 'string' },
          fuseau: { type: 'string', default: 'heure Paris' },
        },
        required: ['date', 'heure'],
      },
      points_vigilance: {
        type: 'array',
        items: { type: 'string' },
        description: 'Éléments à vérifier avant diffusion : chiffres contradictoires, présences incertaines, informations ambiguës dans la transcription.',
      },
      precisions_a_apporter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Informations mentionnées mais non précisées lors de la réunion, à fournir lors du suivi.',
      },
    },
    required: ['metadata', 'modalites', 'participants', 'resume', 'sections'],
  },
}

// ─── Client singleton ─────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return anthropicClient
}

// ─── Mapping PvContent → MinutesContent (compatibilité UI existante) ──────────

export function pvContentToMinutesContent(pv: PvContent): MinutesContent {
  const sections: PVSection[] = pv.sections.map((s, i) => ({
    numero: i + 1,
    titre: s.titre,
    contenu: s.contenu,
  }))

  const actions = pv.actions.map((a) => ({
    description: a.libelle,
    responsable: a.responsable,
    echeance: a.echeance,
  }))

  const prochaine_reunion = pv.prochaine_reunion
    ? `${pv.prochaine_reunion.date} à ${pv.prochaine_reunion.heure} (${pv.prochaine_reunion.fuseau ?? 'heure Paris'})`
    : undefined

  const notes = pv.precisions_a_apporter.map((p) => `→ ${p}`).join('\n') || ''

  return {
    summary: pv.resume,
    sections,
    actions,
    notes,
    prochaine_reunion,
    _pv: pv,
  }
}

// ─── Squelette PV sans transcription ─────────────────────────────────────────

export function createSkeletonContent(
  subject: string,
  participants?: Array<{ name: string }>,
  date?: Date
): MinutesContent {
  const dateStr = (date ?? new Date()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const pv: PvContent = {
    metadata: {
      date_reunion: dateStr,
      affaire: subject,
      type_procedure: 'Mandat ad hoc',
      objet: 'Réunion',
      ville_signature: 'PARIS',
      signataire: '[Administrateur Judiciaire]',
    },
    modalites: 'Réunion par visioconférence',
    participants: (participants ?? []).map((p) => ({
      civilite_nom: p.name,
      societe_qualite: '[À compléter]',
      presence: 'Visioconférence' as const,
      categorie: 'autre' as const,
    })),
    documents_amont: [],
    resume: '[À compléter — aucune transcription Teams disponible pour cette réunion]',
    sections: [
      { titre: 'Points abordés', contenu: '[À compléter]' },
    ],
    points_desaccord: [],
    actions: [],
    points_vigilance: ['Compte rendu généré sans transcription Teams — contenu à remplir manuellement'],
    precisions_a_apporter: [],
  }
  return pvContentToMinutesContent(pv)
}

// ─── Prompt builder (conservé pour les tests unitaires) ───────────────────────

// Transcription tronquée pour rester dans un budget de tokens raisonnable.
// Stratégie début+milieu+fin : ouverture (contexte, enjeux) + sample du milieu (discussions)
// + clôture (décisions, actions, prochaine réunion).
const MAX_HEAD_CHARS = 40_000
const MAX_MIDDLE_CHARS = 10_000
const MAX_TAIL_CHARS = 10_000

function normalizeNameForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTokens(value: string): string[] {
  return normalizeNameForMatching(value)
    .split(' ')
    .filter((token) => token.length >= 3)
}

function namesLikelyMatch(a: string, b: string): boolean {
  const normalizedA = normalizeNameForMatching(a)
  const normalizedB = normalizeNameForMatching(b)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true

  const tokensA = new Set(nameTokens(a))
  const tokensB = nameTokens(b)
  if (tokensA.size === 0 || tokensB.length === 0) return false

  const overlap = tokensB.filter((token) => tokensA.has(token)).length
  return overlap >= Math.min(2, tokensB.length)
}

function extractTranscriptSpeakers(transcription: string | null): string[] {
  if (!transcription) return []

  const speakers = new Set<string>()
  const regex = /^\s*\[([^\]]+)]/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(transcription)) !== null) {
    const speaker = match[1]?.trim()
    if (speaker) speakers.add(speaker)
  }
  return [...speakers]
}

function participantAppearsInTranscript(participantName: string, transcription: string | null, speakers: string[]): boolean {
  if (!transcription) return false
  if (speakers.some((speaker) => namesLikelyMatch(speaker, participantName))) return true

  const normalizedTranscript = normalizeNameForMatching(transcription)
  const normalizedParticipant = normalizeNameForMatching(participantName)
  return normalizedParticipant.length > 0 && normalizedTranscript.includes(normalizedParticipant)
}

function attendanceLikelyMatchesParticipant(
  attendance: MeetingAttendanceRecord,
  participant: PvContent['participants'][number]
): boolean {
  const attendanceEmail = attendance.email?.toLowerCase()
  const participantEmail = participant.email?.toLowerCase()
  if (attendanceEmail && participantEmail && attendanceEmail === participantEmail) return true
  return namesLikelyMatch(attendance.name, participant.civilite_nom)
}

function attendanceShowsPresence(attendance: MeetingAttendanceRecord): boolean {
  return (attendance.totalAttendanceInSeconds ?? 0) > 0 || attendance.intervals.length > 0
}

function transcriptExplicitlyMarksAbsent(participantName: string, transcription: string | null): boolean {
  if (!transcription) return false

  const participantTokens = nameTokens(participantName)
  if (participantTokens.length === 0) return false

  const absenceMarkers = [
    'absent',
    'absente',
    'absents',
    'absentes',
    'excuse',
    'excusee',
    'excuses',
    'excusees',
    'decline',
    'declinee',
    'declines',
    'declinees',
    'ne participe pas',
    'ne participera pas',
    'n est pas present',
    'n est pas presente',
    'ne sera pas present',
    'ne sera pas presente',
  ]

  return transcription
    .split(/\r?\n|[.!?;]/)
    .map(normalizeNameForMatching)
    .some((line) => {
      if (!line || !absenceMarkers.some((marker) => line.includes(marker))) return false
      return participantTokens.every((token) => line.includes(token))
    })
}

export function normalizeParticipantPresenceFromTranscript(
  pv: PvContent,
  transcription: string | null,
  attendanceRecords: MeetingAttendanceRecord[] = []
): PvContent {
  const speakers = extractTranscriptSpeakers(transcription)
  if (speakers.length === 0 && !transcription) return pv

  return {
    ...pv,
    participants: pv.participants.map((participant) => {
      const attendance = attendanceRecords.find((record) => attendanceLikelyMatchesParticipant(record, participant))
      if (attendance) {
        return {
          ...participant,
          presence: attendanceShowsPresence(attendance) ? 'Visioconférence' as const : participant.presence,
        }
      }

      if (attendanceRecords.length > 0 && participant.presence !== 'Absent') {
        return { ...participant, presence: 'Absent' as const }
      }

      if (participant.presence === 'Absent') return participant
      if (transcriptExplicitlyMarksAbsent(participant.civilite_nom, transcription)) {
        return { ...participant, presence: 'Absent' as const }
      }
      if (participantAppearsInTranscript(participant.civilite_nom, transcription, speakers)) return participant
      return participant
    }),
  }
}

export function buildPrompt(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string; email?: string; company?: string | null }>,
  date?: Date,
  attendanceRecords: MeetingAttendanceRecord[] = []
): string {
  const dateStr = date
    ? date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const dateBlock = dateStr ? `\nDate de la réunion : ${dateStr}` : ''
  const detectedSpeakers = extractTranscriptSpeakers(transcription)
  const speakersBlock = detectedSpeakers.length
    ? `\nIntervenants détectés dans la transcription (à considérer comme présents ; l'absence des autres invités ne doit pas être déduite de leur silence) :\n${detectedSpeakers.map((speaker) => `- ${speaker}`).join('\n')}`
    : ''
  const attendanceBlock = attendanceRecords.length
    ? `\nRapport de présence Teams (source prioritaire pour le champ presence) :\n${attendanceRecords.map((record) => {
        const duration = record.totalAttendanceInSeconds
          ? ` — ${Math.round(record.totalAttendanceInSeconds / 60)} min`
          : ''
        const intervals = record.intervals
          .map((interval) => [interval.joinDateTime, interval.leaveDateTime].filter(Boolean).join(' → '))
          .filter(Boolean)
          .join(' ; ')
        return `- ${record.name}${record.email ? ` <${record.email}>` : ''}${duration}${intervals ? ` (${intervals})` : ''}`
      }).join('\n')}`
    : ''
  const participantsBlock = participants?.length
    ? `\nParticipants (liste Teams d'invitation — ne pas assimiler automatiquement à la liste des présents) :\n${participants.map((p) => {
        const isCabinet = p.email?.toLowerCase().includes('@bl-aj.fr')
        const parts = [p.name]
        if (p.email) parts.push(`<${p.email}>`)
        if (p.company) parts.push(`— ${p.company}`)
        if (isCabinet) parts.push('[CABINET BL & ASSOCIÉS — mandataire]')
        return `- ${parts.join(' ')}`
      }).join('\n')}`
    : ''

  let safeTranscription = transcription
  if (safeTranscription && safeTranscription.length > MAX_HEAD_CHARS + MAX_MIDDLE_CHARS + MAX_TAIL_CHARS) {
    const head = safeTranscription.slice(0, MAX_HEAD_CHARS)
    const middleStart = Math.floor((safeTranscription.length - MAX_MIDDLE_CHARS) / 2)
    const middle = safeTranscription.slice(middleStart, middleStart + MAX_MIDDLE_CHARS)
    const tail = safeTranscription.slice(-MAX_TAIL_CHARS)
    const omitted1 = middleStart - MAX_HEAD_CHARS
    const omitted2 = safeTranscription.length - MAX_TAIL_CHARS - (middleStart + MAX_MIDDLE_CHARS)
    safeTranscription =
      `${head}\n\n[… ${omitted1.toLocaleString('fr')} caractères omis …]\n\n` +
      `${middle}\n\n[… ${omitted2.toLocaleString('fr')} caractères omis …]\n\n${tail}`
  }

  const transcriptionBlock = safeTranscription
    ? `TRANSCRIPTION DE LA RÉUNION :\n\n${safeTranscription}`
    : `Note : aucune transcription disponible. Remplis uniquement ce qui est déductible du sujet et des participants.`
  return `Affaire : "${subject}"${dateBlock}${participantsBlock}${attendanceBlock}${speakersBlock}\n\n${transcriptionBlock}`
}

// ─── Parser texte (conservé pour les tests + fallback) ───────────────────────

const DEFAULT_CONTENT: MinutesContent = { summary: '', actions: [], notes: '' }

export function parseMinutesContent(raw: string): MinutesContent {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)

    const sections: PVSection[] | undefined = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s: unknown): s is PVSection =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as PVSection).numero === 'number' &&
            typeof (s as PVSection).titre === 'string' &&
            typeof (s as PVSection).contenu === 'string'
        )
      : undefined

    const summary =
      typeof parsed.resume === 'string' && parsed.resume.trim()
        ? parsed.resume.trim()
        : typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : sections
            ? sections.map((s) => `${s.numero}- ${s.titre}\n\n${s.contenu}`).join('\n\n')
            : ''

    return {
      summary,
      sections: sections?.length ? sections : undefined,
      prochaine_reunion:
        typeof parsed.prochaine_reunion === 'string' && parsed.prochaine_reunion.trim()
          ? parsed.prochaine_reunion.trim()
          : undefined,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  } catch {
    return { ...DEFAULT_CONTENT }
  }
}

// ─── Retry avec backoff exponentiel ──────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  delays = [2000, 5000]
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < delays.length && isRetryable(error)) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]))
        continue
      }
      throw error
    }
  }
  throw lastError
}

function isTransientApiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return msg.includes('overloaded') || msg.includes('529') || msg.includes('rate_limit') || msg.includes('timeout') || msg.includes('network')
}

// ─── Génération principale via tool_use ───────────────────────────────────────

export type GenerationStyle = 'detailed'

export async function generateMinutesContent(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string; email?: string; company?: string | null }>,
  options?: {
    userId?: string
    minutesId?: string
    promptText?: string
    modelName?: string
    meetingDate?: Date
    attendanceRecords?: MeetingAttendanceRecord[]
  }
): Promise<MinutesContent> {
  const client = getClient()
  const model = options?.modelName ?? 'claude-opus-4-7'
  const systemPrompt = options?.promptText ?? SYSTEM_PROMPT
  const attendanceRecords = options?.attendanceRecords ?? []
  const userMessage = buildPrompt(subject, transcription, participants, options?.meetingDate, attendanceRecords)
  const startMs = Date.now()

  let tokensInput = 0
  let tokensOutput = 0
  let status = 'success'
  let errorMessage: string | undefined

  console.log(
    '[Claude] Génération pour "%s" — transcription: %d chars, modèle: %s',
    subject,
    (transcription ?? '').length,
    model
  )

  // stream().finalMessage() requis pour les appels potentiellement longs.
  // max_tokens=16000 : suffisant pour un PV très détaillé, évite stop_reason=max_tokens.
  const callClaude = () =>
    client.messages.stream({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      tools: [GENERER_PV_TOOL],
      tool_choice: { type: 'tool', name: 'generer_pv' },
      messages: [{ role: 'user', content: userMessage }],
    }).finalMessage()

  // Diagnostic accumulé — inclus dans le message d'erreur final pour diagnostic sans logs Vercel
  let lastDiag = ''

  const extractToolInput = (response: Awaited<ReturnType<typeof callClaude>>, attempt: number) => {
    const blockTypes = response.content.map((b) => b.type).join(', ')
    console.log(
      '[Claude] tentative=%d stop_reason=%s tokens_out=%d blocs=[%s]',
      attempt, response.stop_reason, response.usage.output_tokens, blockTypes
    )

    const block = response.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | aucun bloc tool_use | blocs=[${blockTypes}] | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
      return null
    }

    const input = block.input as Record<string, unknown>
    const keys = Object.keys(input)
    console.log('[Claude] tentative=%d — %d clé(s): %s', attempt, keys.length, keys.join(', '))

    if (keys.length === 0) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | tool_use présent mais input={} (JSON tronqué ?) | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
      return null
    }

    if (keys.length < 3) {
      lastDiag = `tentative ${attempt} — stop_reason=${response.stop_reason} | input partiel (${keys.length} clé(s): ${keys.join(',')}) | tokens_out=${response.usage.output_tokens}`
      console.warn('[Claude]', lastDiag)
    }

    // On accepte tout input non-vide (même partiel) — Zod valide ensuite
    return input
  }

  const callClaudeWithRetry = () => withRetry(callClaude, isTransientApiError)

  try {
    const MAX_TOOL_INPUT_ATTEMPTS = 3
    const TOOL_INPUT_DELAYS = [2000, 5000]

    let response = await callClaudeWithRetry()
    tokensInput = response.usage.input_tokens
    tokensOutput = response.usage.output_tokens

    let toolInput = extractToolInput(response, 1)

    for (let attempt = 2; !toolInput && attempt <= MAX_TOOL_INPUT_ATTEMPTS; attempt++) {
      const delay = TOOL_INPUT_DELAYS[attempt - 2]
      console.warn(`[Claude] Input vide (tentative ${attempt - 1}), attente ${delay} ms avant retry...`)
      await new Promise(resolve => setTimeout(resolve, delay))
      response = await callClaudeWithRetry()
      tokensInput += response.usage.input_tokens
      tokensOutput += response.usage.output_tokens
      toolInput = extractToolInput(response, attempt)
    }

    if (!toolInput) {
      throw new Error(
        `Claude a retourné une réponse vide après ${MAX_TOOL_INPUT_ATTEMPTS} tentatives. Diagnostic : ${lastDiag}`
      )
    }

    // Si Claude a imbriqué le contenu sous une clé intermédiaire (ex: { "generer_pv": {...} }),
    // on détecte et déballe automatiquement.
    const topKeys = Object.keys(toolInput)
    if (topKeys.length === 1) {
      const nested = toolInput[topKeys[0]]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const nestedObj = nested as Record<string, unknown>
        if ('metadata' in nestedObj || 'resume' in nestedObj || 'sections' in nestedObj) {
          console.log('[Claude] Structure imbriquée détectée sous "%s" — déballage', topKeys[0])
          toolInput = nestedObj
        }
      }
    }

    const topLevelKeys = Object.keys(toolInput).join(', ')
    console.log('[Claude] Clés top-level avant validation Zod : %s', topLevelKeys)

    const validation = PvContentSchema.safeParse(toolInput)
    if (!validation.success) {
      console.warn('[Claude] Zod validation partielle — clés présentes: %s', topLevelKeys)
      console.warn('[Claude] Erreurs Zod:', validation.error.flatten())
      const partial = toolInput as Partial<PvContent>
      if (partial.resume && partial.sections?.length) {
        const lenientInput = {
          metadata: partial.metadata ?? {
            date_reunion: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
            affaire: subject,
            type_procedure: 'Mandat ad hoc',
            signataire: '[Administrateur Judiciaire]',
          },
          modalites: partial.modalites ?? 'Réunion par visioconférence',
          participants: partial.participants ?? [],
          documents_amont: partial.documents_amont ?? [],
          resume: partial.resume,
          sections: partial.sections,
          points_desaccord: partial.points_desaccord ?? [],
          actions: partial.actions ?? [],
          points_vigilance: partial.points_vigilance ?? [],
          precisions_a_apporter: partial.precisions_a_apporter ?? [],
        }
        const lenientValidation = PvContentSchema.safeParse(lenientInput)
        if (lenientValidation.success) {
          return pvContentToMinutesContent(
            normalizeParticipantPresenceFromTranscript(lenientValidation.data, transcription, attendanceRecords)
          )
        }
        throw new Error(
          `Réponse Claude invalide (Zod) : ${lenientValidation.error.issues.map(i => i.message).join(', ')} | clés reçues: ${topLevelKeys}`
        )
      }
      throw new Error(
        `Réponse Claude incomplète. ` +
        `Clés reçues: [${topLevelKeys}]. ` +
        `Champs manquants: ${validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 5).join('; ')}`
      )
    }

    return pvContentToMinutesContent(
      normalizeParticipantPresenceFromTranscript(validation.data, transcription, attendanceRecords)
    )
  } catch (error) {
    status = 'error'
    errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Claude] Generation failed:', error)
    throw error  // On propage l'erreur — ne jamais écraser silencieusement un contenu existant
  } finally {
    if (options?.userId) {
      const transcriptHash = createHash('sha256')
        .update(transcription ?? '')
        .digest('hex')
      await prisma.generationAuditLog.create({
        data: {
          minutesId: options.minutesId ?? null,
          userId: options.userId,
          modele: model,
          tokensInput,
          tokensOutput,
          transcriptHash,
          durationMs: Date.now() - startMs,
          status,
          errorMessage: errorMessage ?? null,
        },
      }).catch((e) => console.error('[AuditLog] Échec écriture:', e))
    }
  }
}
