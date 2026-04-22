import OpenAI from 'openai'
import type { MinutesContent } from '@/types'

const DEFAULT_CONTENT: MinutesContent = {
  summary: '',
  decisions: [],
  actions: [],
  notes: '',
}

export function buildPrompt(subject: string, transcription: string | null): string {
  const transcriptionBlock = transcription
    ? `Transcription de la réunion :\n\n${transcription}`
    : `Note : aucune transcription disponible pour cette réunion. Remplis uniquement les champs déductibles du sujet.`

  return `Tu es un assistant juridique professionnel pour un cabinet d'administrateurs judiciaires (SELAS BL & Associés).
Ta mission est de générer un compte rendu structuré de la réunion "${subject}".

Règles absolues :
- Langue française uniquement
- Ton professionnel et factuel
- Ne jamais inventer d'informations absentes de la transcription
- Laisser les champs vides si l'information n'est pas disponible

${transcriptionBlock}

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, respectant exactement ce schéma :
{
  "summary": "Résumé en 3 à 5 phrases",
  "decisions": ["Décision 1", "Décision 2"],
  "actions": [
    { "description": "Description", "responsable": "Prénom Nom", "echeance": "YYYY-MM-DD" }
  ],
  "notes": "Points complémentaires ou chaîne vide"
}`
}

export function parseMinutesContent(raw: string): MinutesContent {
  try {
    const parsed = JSON.parse(raw)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  } catch {
    return { ...DEFAULT_CONTENT }
  }
}

let openaiClient: OpenAI | null = null

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
      defaultQuery: { 'api-version': '2024-02-01' },
      defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY! },
    })
  }
  return openaiClient
}

export async function generateMinutesContent(
  subject: string,
  transcription: string | null
): Promise<MinutesContent> {
  const client = getClient()
  const prompt = buildPrompt(subject, transcription)

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT!,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    })
    const raw = response.choices[0]?.message?.content ?? ''
    return parseMinutesContent(raw)
  } catch (error) {
    console.error('[Azure OpenAI] Generation failed:', error)
    return { ...DEFAULT_CONTENT }
  }
}
