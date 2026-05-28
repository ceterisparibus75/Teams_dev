import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { generatePvJob } from '@/inngest/functions/generate-pv'
import { purgeEditLogsJob } from '@/inngest/functions/purge-edit-logs'

// IMPORTANT : Inngest exécute chaque `step.run` au sein d'une invocation de
// cette fonction. Le step `claude-generate` (Opus, PV complet) dure ~100-150s.
// Sans maxDuration explicite, Vercel coupe l'invocation au défaut (~10-15s) :
// le step est tué en plein milieu, AUCUN état final n'est écrit (ni erreur, ni
// audit log) et le PV reste bloqué en `isGenerating: true`. On monte au max du
// plan Pro (300s) pour laisser la génération aboutir.
export const maxDuration = 300

// Endpoint exposé à Inngest. En dev local, lancer `npx inngest-cli dev`
// puis ouvrir http://localhost:8288 pour le dashboard.
//
// En prod, on ÉPINGLE serveHost à l'alias public stable via INNGEST_SERVE_HOST
// (ex. https://teams-dev-tau.vercel.app). Sans ce pin, l'auto-détection peut
// enregistrer une URL de déploiement protégée par Vercel Authentication →
// Inngest reçoit 401 → fonctions jamais invoquées (cause de l'incident silencieux
// du 27/04 au 27/05). Le pin survit à chaque re-sync.
const serveHost = process.env.INNGEST_SERVE_HOST
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generatePvJob, purgeEditLogsJob],
  ...(serveHost ? { serveHost } : {}),
})
