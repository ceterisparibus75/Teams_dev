jest.mock('@/lib/prisma', () => ({
  prisma: {
    cronRun: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/microsoft-graph', () => ({
  getMeetingsEndedInLastHours: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/inngest/client', () => ({
  inngest: { send: jest.fn() },
}))

import { jsonRequest } from '../helpers/http'

const ORIGINAL_SECRET = process.env.CRON_SECRET

describe('GET /api/cron/poll', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'cron-secret-for-tests'
  })
  afterAll(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET
  })
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('refuse 401 sans Authorization', async () => {
    const { GET } = await import('@/app/api/cron/poll/route')
    const req = jsonRequest('http://localhost/api/cron/poll')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('refuse 401 avec un secret incorrect', async () => {
    const { GET } = await import('@/app/api/cron/poll/route')
    const req = jsonRequest('http://localhost/api/cron/poll', {
      headers: { authorization: 'Bearer mauvais-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('refuse 401 quand seul le préfixe Bearer est fourni', async () => {
    const { GET } = await import('@/app/api/cron/poll/route')
    const req = jsonRequest('http://localhost/api/cron/poll', {
      headers: { authorization: 'Bearer ' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('accepte 200 et skip quand le cooldown est actif', async () => {
    const prismaMock = jest.requireMock('@/lib/prisma').prisma
    prismaMock.cronRun.findUnique.mockResolvedValue({
      job: 'poll',
      lastRunAt: new Date(),
      lastStatus: 'ok',
    })
    const { GET } = await import('@/app/api/cron/poll/route')
    const req = jsonRequest('http://localhost/api/cron/poll', {
      headers: { authorization: 'Bearer cron-secret-for-tests' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ skipped: true, reason: 'cooldown' })
    // Aucun event Inngest émis pendant le cooldown
    expect(jest.requireMock('@/inngest/client').inngest.send).not.toHaveBeenCalled()
  })
})
