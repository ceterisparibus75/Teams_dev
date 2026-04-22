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
    ? `Style : DÉVELOPPÉ — rédige un résumé complet et narratif (8 à 15 phrases) qui retrace chronologiquement les échanges, les positions de chaque partie, les points de discussion et les conclusions. Le lecteur doit comprendre ce qui s'est passé sans avoir assisté à la réunion.`
    : `Style : SYNTHÉTIQUE — rédige un résumé court et factuel (3 à 5 phrases) centré uniquement sur les points essentiels, les décisions et les conclusions. Pas de détail des échanges.`

  return `Tu es un assistant juridique professionnel pour un cabinet d'administrateurs judiciaires (SELAS BL & Associés).
Ta mission est de générer un compte rendu structuré de la réunion "${subject}".

${styleInstructions}

Règles absolues :
- Langue française uniquement
- Ton professionnel et factuel
- Ne jamais inventer d'informations absentes de la transcription
- Laisser les champs vides si l'information n'est pas disponible

${transcriptionBlock}

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, respectant exactement ce schéma :
{
  "summary": "Résumé de la réunion selon le style demandé",
  "actions": [
    { "description": "Action à réaliser", "responsable": "Prénom Nom", "echeance": "YYYY-MM-DD" }
  ],
  "notes": "Points complémentaires, observations, ou chaîne vide"
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
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return parseMinutesContent(raw)
  } catch (error) {
    console.error('[Claude] Generation failed:', error)
    return { ...DEFAULT_CONTENT }
  }
}
