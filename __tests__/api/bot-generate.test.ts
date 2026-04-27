jest.mock('@/lib/prisma', () => ({
  prisma: {
    meeting: { findUnique: jest.fn(), update: jest.fn() },
    meetingMinutes: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    template: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/claude-generator', () => ({
  generateMinutesContent: jest.fn().mockResolvedValue({ summary: 'ok' }),
}))
jest.mock('@/lib/microsoft-graph', () => ({
  getAttendanceLookup: jest.fn().mockResolvedValue({ status: 'found', records: [] }),
}))

import { jsonRequest, asyncParams } from '../helpers/http'

const ORIGINAL_SECRET = process.env.BOT_SECRET

describe('POST /api/bot-generate/[meetingId]', () => {
  beforeAll(() => {
    process.env.BOT_SECRET = 'bot-secret-for-tests'
  })
  afterAll(() => {
    process.env.BOT_SECRET = ORIGINAL_SECRET
  })
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('refuse 401 sans header x-bot-secret', async () => {
    const { POST } = await import('@/app/api/bot-generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/bot-generate/abc', {
      method: 'POST',
      body: JSON.stringify({ transcript: 'hello' }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'abc' }) })
    expect(res.status).toBe(401)
  })

  it('refuse 401 avec un mauvais x-bot-secret', async () => {
    const { POST } = await import('@/app/api/bot-generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/bot-generate/abc', {
      method: 'POST',
      headers: { 'x-bot-secret': 'mauvais' },
      body: JSON.stringify({ transcript: 'hello' }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'abc' }) })
    expect(res.status).toBe(401)
  })

  it('refuse 400 avec body invalide (transcript number)', async () => {
    const { POST } = await import('@/app/api/bot-generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/bot-generate/abc', {
      method: 'POST',
      headers: { 'x-bot-secret': 'bot-secret-for-tests' },
      body: JSON.stringify({ transcript: 42 }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'meeting-z' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('invalid_body')
  })

  it('refuse 400 quand le body n\'est pas un JSON parsable', async () => {
    const { POST } = await import('@/app/api/bot-generate/[meetingId]/route')
    const req = new Request('http://localhost/api/bot-generate/abc', {
      method: 'POST',
      headers: { 'x-bot-secret': 'bot-secret-for-tests', 'content-type': 'application/json' },
      body: 'pas du JSON',
    }) as unknown as Parameters<typeof POST>[0]
    const res = await POST(req, { params: asyncParams({ meetingId: 'meeting-y' }) })
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si la réunion est introuvable', async () => {
    jest.requireMock('@/lib/prisma').prisma.meeting.findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/bot-generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/bot-generate/abc', {
      method: 'POST',
      headers: { 'x-bot-secret': 'bot-secret-for-tests' },
      body: JSON.stringify({ transcript: null }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'unknown-meeting' }) })
    expect(res.status).toBe(404)
  })
})
