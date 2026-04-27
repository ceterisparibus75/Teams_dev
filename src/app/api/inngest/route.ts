import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { generatePvJob } from '@/inngest/functions/generate-pv'

// Endpoint exposé à Inngest. En dev local, lancer `npx inngest-cli dev`
// puis ouvrir http://localhost:8288 pour le dashboard.
// En prod : Inngest découvre cette URL via la signing key + intégration Vercel.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generatePvJob],
})
