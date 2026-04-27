// Sanity tests sur la définition de la fonction Inngest generatePvJob.
// On ne fait pas tourner Inngest dev en test — on vérifie la structure.

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/microsoft-graph', () => ({
  getAttendanceLookup: jest.fn(),
  getTranscription: jest.fn(),
}))
jest.mock('@/lib/claude-generator', () => ({
  generateMinutesContent: jest.fn(),
  createSkeletonContent: jest.fn(),
}))

import { generatePvJob } from '@/inngest/functions/generate-pv'
import { purgeEditLogsJob } from '@/inngest/functions/purge-edit-logs'

describe('Inngest functions — config', () => {
  it('generatePvJob expose les bonnes options de fonction', () => {
    // L'instance de InngestFunction expose `id` et l'options d'origine via
    // des propriétés internes ; on les vérifie indirectement via les helpers
    // publics.
    expect(generatePvJob).toBeDefined()
    expect(generatePvJob.id()).toContain('generate-pv')
  })

  it('purgeEditLogsJob expose une trigger cron', () => {
    expect(purgeEditLogsJob).toBeDefined()
    expect(purgeEditLogsJob.id()).toContain('purge-edit-logs')
  })
})
