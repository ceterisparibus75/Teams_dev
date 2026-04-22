import Anthropic from '@anthropic-ai/sdk'
import type { MinutesContent } from '@/types'

const DEFAULT_CONTENT: MinutesContent = {
  summary: '',
  actions: [],
  notes: '',
}

export type GenerationStyle = 'detailed' | 'concise'

export function buildPrompt(subject: string, transcription: string | null, style: GenerationStyle = 'detailed'): string {
  const transcriptionBlock = transcription
    ? `Transcription de la réunion :\n\n${transcription}`
    : `Note : aucune transcription disponible pour cette réunion. Remplis uniquement les champs déductibles du sujet.`

  const styleInstructions = style === 'detailed'
    ? `Style : COMPTE RENDU DÉVELOPPÉ

Tu dois produire un compte rendu exhaustif, comme le ferait un juriste présent à la réunion.
Structure obligatoire du champ "summary" :

1. **Participants et contexte** — liste les personnes présentes et leur qualité (créancier, conseil, administrateur, etc.), rappelle l'objet de la réunion.

2. **Déroulé par thème** — identifie les grands sujets abordés et consacre un paragraphe développé à chacun :
   - Pour chaque thème : expose la situation initiale, détaille les échanges et positions de chaque partie (en attribuant les propos : "M. X a indiqué que…", "La société a contesté…"), mentionne les chiffres, dates, montants, délais évoqués.
   - Ne résume pas : retranscris fidèlement la substance des échanges.

3. **Points de désaccord ou points en suspens** — identifie ce qui n'est pas résolu.

4. **Conclusions et suite** — ce qui a été acté à l'issue de la réunion.

Le champ "summary" doit être long (plusieurs paragraphes, potentiellement 500 à 1500 mots selon la durée de la réunion). Utilise \\n\\n pour séparer les paragraphes.`
    : `Style : COMPTE RENDU SYNTHÉTIQUE

Rédige un résumé court et factuel (5 à 8 phrases maximum) centré uniquement sur : l'objet de la réunion, les points essentiels discutés, et les conclusions/décisions. Pas de détail des échanges.`

  return `Tu es un assistant juridique expert au service du cabinet SELAS BL & Associés, administrateurs judiciaires.
Tu maîtrises parfaitement les trois domaines suivants, qui sont les sujets habituels de ces réunions :

DOMAINE JURIDIQUE — procédures collectives (sauvegarde, redressement judiciaire, liquidation judiciaire, mandat ad hoc, conciliation), droits des créanciers, plan de continuation, plan de cession, revendications, déclarations de créances, jugements, ordonnances, audiences, délais légaux, mandataire judiciaire, administrateur judiciaire, juge-commissaire, tribunal de commerce.

DOMAINE FINANCIER — bilan, compte de résultat, trésorerie, flux de trésorerie, BFR, EBE, EBITDA, dette financière, passif exigible, créanciers privilégiés et chirographaires, échéancier de remboursement, covenant bancaire, financement court terme / long terme, refinancement, prévisionnel, plan de financement, valorisation d'actifs, cession d'actifs.

DOMAINE MANAGEMENT & OPÉRATIONNEL — organisation de l'entreprise, restructuration, plan social, effectifs, carnet de commandes, activité commerciale, situation des fournisseurs, clients stratégiques, contrats en cours, continuité d'exploitation.

Ta mission est de générer un compte rendu de la réunion "${subject}".

${styleInstructions}

Règles absolues :
- Langue française uniquement, ton professionnel et factuel
- Utilise le vocabulaire technique exact du domaine concerné (juridique, financier, managérial)
- Ne jamais inventer d'informations absentes de la transcription
- Retranscrire fidèlement les montants, dates, délais, références légales et noms de personnes tels qu'ils apparaissent dans la transcription
- Laisser les champs vides si l'information n'est pas disponible

${transcriptionBlock}

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni balises de code, respectant exactement ce schéma :
{
  "summary": "Compte rendu complet selon le style demandé",
  "actions": [
    { "description": "Action à réaliser", "responsable": "Prénom Nom", "echeance": "YYYY-MM-DD" }
  ],
  "notes": "Points complémentaires, observations importantes, ou chaîne vide"
}`
}

export function parseMinutesContent(raw: string): MinutesContent {
  try {
    // Extract JSON even if Claude wraps it in markdown
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
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
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })
  }
  return anthropicClient
}

export async function generateMinutesContent(
  subject: string,
  transcription: string | null,
  style: GenerationStyle = 'detailed'
): Promise<MinutesContent> {
  const client = getClient()
  const prompt = buildPrompt(subject, transcription, style)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
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
