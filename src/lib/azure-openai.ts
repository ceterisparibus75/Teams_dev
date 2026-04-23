import Anthropic from '@anthropic-ai/sdk'
import type { MinutesContent, PVSection } from '@/types'

const DEFAULT_CONTENT: MinutesContent = {
  summary: '',
  actions: [],
  notes: '',
}

export type GenerationStyle = 'detailed'

const DOMAINE_EXPERTISE = `Tu es un assistant juridique expert au service du cabinet SELAS BL & Associés, administrateurs judiciaires et mandataires ad hoc.
Tu maîtrises parfaitement :

PROCÉDURES AMIABLES — mandat ad hoc (art. L611-3 C.com.), conciliation (art. L611-4 à L611-15 C.com.), négociation avec créanciers bancaires et institutionnels, protocole de conciliation, homologation ou constatation par le président du tribunal, confidentialité, standstill, moratoires, abandons de créances, gels d'exigibilité.

PROCÉDURES COLLECTIVES — sauvegarde, sauvegarde accélérée, redressement judiciaire (art. L631-1 et s.), clôture par extinction du passif (art. L631-16), période d'observation, plan de continuation.

FINANCE D'ENTREPRISE EN DIFFICULTÉ — trésorerie disponible et prévisionnelle, BFR, EBE, EBITDA, dette financière nette, covenants bancaires, Dailly, affacturage, refinancement, augmentation de capital, cession d'actifs, business plan, free cash-flow.

MANAGEMENT — continuité d'exploitation, carnet de commandes, plan de retournement, communication aux parties prenantes.`

const MODELE_PV = `MODÈLE DE RÉFÉRENCE — Style exact à respecter :

Exemple de section bien rédigée (extrait d'un PV réel du cabinet) :

"1- Propos introductifs

Le Mandataire ad hoc a rappelé le cadre de cette réunion, intervenant :
- A la suite de la procédure de conciliation qui a pris fin le 20 avril 2025 ;
- Dans le cadre de la procédure de mandat ad hoc ouverte le 25 avril 2025.

Il a été rappelé que, malgré les nombreuses réunions tenues avec les partenaires bancaires et la construction d'une solution de traitement des dettes bancaires dans le cadre de la précédente procédure de conciliation, l'une des trois banques (CE-N) a finalement refusé la proposition formulée.

La CE-N a indiqué que ce refus était motivé par :
- L'ouverture d'une procédure de conciliation quatre mois après l'octroi d'un financement ;
- L'exploitation de l'activité de la société en dehors du ressort de compétence territoriale ;
- L'absence de rentabilité de la société depuis sa création."

Exemple de section financière bien rédigée :

"2- Présentation des travaux de Grant Thornton

Grant Thornton a précisé avoir repris une méthodologie identique aux travaux précédents, basée sur l'analyse des résultats réalisés en 2025, une actualisation du business plan 2026-2027, et une projection long terme jusqu'en 2033.

Sur l'exercice 2025, les performances dépassent nettement les prévisions initiales. Les volumes atteignent 227,8 milliers de tonnes, contre 223 initialement anticipés. Le taux de valeur ajoutée s'établit à 37,1 %, alors que les premières hypothèses étaient proches de 30 %.

L'EBITDA atteint environ 2,6 millions d'euros en 2025. Il progresserait ensuite à 3,2 millions en 2026 puis à 3,6 millions en 2027.

La trajectoire de trésorerie constitue un autre point fort :
- A fin 2023 : 1,7 M€
- A fin 2024 : 6,2 M€
- A fin 2025 : 14,6 M€"

Exemple de dernière section :

"N- Calendrier et prochaines étapes

Les prochaines étapes sont les suivantes :
- Confirmation du montant des dettes échues dues aux partenaires bancaires ;
- Communication par les conseils de la note juridique sur la gouvernance ;
- Retour du comité des partenaires bancaires avant le 30 avril 2026 sur les demandes listées.

La prochaine réunion est fixée le 05 mai 2026 à 14h00 (heure Paris)."`

export function buildPrompt(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string }>
): string {
  const participantsBlock = participants?.length
    ? `\nParticipants identifiés : ${participants.map((p) => p.name).join(', ')}`
    : ''

  const transcriptionBlock = transcription
    ? `TRANSCRIPTION DE LA RÉUNION :\n\n${transcription}`
    : `Note : aucune transcription disponible. Remplis uniquement ce qui est déductible du sujet et des participants.`

  return `${DOMAINE_EXPERTISE}

${MODELE_PV}

Ta mission est de rédiger le PROCÈS VERBAL DE RÉUNION complet pour l'affaire "${subject}".${participantsBlock}

RÈGLES ABSOLUES DE RÉDACTION :

1. STRUCTURE : Identifie les grands thèmes abordés dans la transcription. Crée une section numérotée par thème. La DERNIÈRE section est toujours "Calendrier et prochaines étapes".

2. ATTRIBUTION SYSTÉMATIQUE : Chaque prise de position, chaque information présentée, chaque demande formulée doit être attribuée à son auteur. Exemples de formulations :
   - "L'Administrateur Judiciaire a confirmé que..."
   - "Le Mandataire ad hoc a rappelé que..."
   - "Monsieur X a indiqué que..."
   - "La société a précisé que..."
   - "La banque Y a indiqué qu'elle ne souhaitait pas..."
   - "Il a été rappelé que..." (pour les faits établis)
   - "Il a été indiqué que..." (pour les informations communiquées)

3. CHIFFRES ET DATES : Cite EXACTEMENT les montants (17,2 M€ — jamais "environ 17 millions"), pourcentages (37,1 % — jamais "environ 37 %"), dates (30 avril 2026 — jamais "fin avril") et délais tels qu'ils apparaissent dans la transcription.

4. LISTES TIRETÉES : Utilise des listes avec "-" pour les énumérations de points, d'arguments, d'actions demandées. Chaque item se termine par " ;" sauf le dernier qui se termine par ".".

5. STYLE JURIDIQUE : Français formel, constructions passives ("il a été décidé que...", "il convient de..."), verbes comme "rappeler", "indiquer", "confirmer", "préciser", "solliciter", "préconiser", "envisager".

6. LONGUEUR : Chaque section doit être substantielle. Le contenu de chaque section doit refléter fidèlement la durée et la densité des échanges. Ne résume pas : retranscris la substance.

7. NE JAMAIS INVENTER : Si une information n'est pas dans la transcription, ne l'invente pas. Ne laisse pas de champs vides inutilement — exploite tout ce qui est dans la transcription.

${transcriptionBlock}

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni balises de code, respectant EXACTEMENT ce schéma :
{
  "resume": "Résumé factuel en 5 à 8 phrases couvrant l'objet de la réunion, les points essentiels et les conclusions.",
  "sections": [
    {
      "numero": 1,
      "titre": "Titre exact de la section",
      "contenu": "Paragraphes du corps de la section, séparés par \\n\\n. Utilise \\n- pour les listes tiretées."
    }
  ],
  "prochaine_reunion": "Date et heure de la prochaine réunion si mentionnée, sinon chaîne vide",
  "actions": [
    { "description": "Action à réaliser", "responsable": "Prénom Nom ou entité", "echeance": "YYYY-MM-DD ou texte" }
  ],
  "notes": ""
}`
}

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

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return anthropicClient
}

export async function generateMinutesContent(
  subject: string,
  transcription: string | null,
  participants?: Array<{ name: string }>
): Promise<MinutesContent> {
  const client = getClient()
  const prompt = buildPrompt(subject, transcription, participants)

  const model = 'claude-opus-4-7'

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return parseMinutesContent(raw)
  } catch (error) {
    console.error('[Claude] Generation failed:', error)
    return { ...DEFAULT_CONTENT }
  }
}
