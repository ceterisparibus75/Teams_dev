import { Inngest, eventType, staticSchema } from 'inngest'

// Évènement typé : déclaration unique partagée par `inngest.send()` et le handler.
export type GeneratePvData = {
  meetingId: string
  userId: string
  // Source : trace pour debugging / audit dans le dashboard Inngest.
  source: 'manual' | 'cron' | 'bot' | 'retranscribe'
  // Si fourni (cas bot), on saute la récupération Graph et on l'utilise tel quel.
  transcript?: string | null
  // Pour /retranscribe : permet de surcharger le prompt et/ou le modèle.
  promptText?: string
  modelName?: string
}

export const generatePvRequested = eventType('pv/generate.requested', {
  schema: staticSchema<GeneratePvData>(),
})

export const inngest = new Inngest({ id: 'teams-minutes' })
