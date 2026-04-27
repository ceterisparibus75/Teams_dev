// Smoke tests : toutes les routes protégées doivent retourner 401 sans session.
// Couvre les routes qui n'ont pas leur propre test dédié.

jest.mock('next-auth', () => ({ getServerSession: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    dossier: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    meeting: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    meetingMinutes: { findFirst: jest.fn(), findMany: jest.fn() },
    template: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    prompt: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    generationAuditLog: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/microsoft-graph', () => ({
  getRecentMeetings: jest.fn(),
}))
jest.mock('@/lib/meeting-transcription-sync', () => ({
  refreshMeetingsTranscriptionMetadata: jest.fn().mockResolvedValue(undefined),
}))

import { jsonRequest, asyncParams } from '../helpers/http'

describe('Auth gates — 401 sans session', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('GET /api/dossiers', async () => {
    const { GET } = await import('@/app/api/dossiers/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('POST /api/dossiers', async () => {
    const { POST } = await import('@/app/api/dossiers/route')
    const res = await POST(
      jsonRequest('http://localhost/api/dossiers', { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/dossiers/[id]', async () => {
    const { GET } = await import('@/app/api/dossiers/[id]/route')
    const res = await GET(
      jsonRequest('http://localhost/api/dossiers/d1'),
      { params: asyncParams({ id: 'd1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('POST /api/dossiers/[id]/meetings', async () => {
    const { POST } = await import('@/app/api/dossiers/[id]/meetings/route')
    const res = await POST(
      jsonRequest('http://localhost/api/dossiers/d1/meetings', {
        method: 'POST',
        body: JSON.stringify({ meetingId: 'm1' }),
      }),
      { params: asyncParams({ id: 'd1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/templates', async () => {
    const { GET } = await import('@/app/api/templates/route')
    const res = await GET(jsonRequest('http://localhost/api/templates'))
    expect(res.status).toBe(401)
  })

  it('POST /api/templates', async () => {
    const { POST } = await import('@/app/api/templates/route')
    const res = await POST(
      jsonRequest('http://localhost/api/templates', { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/prompts', async () => {
    const { GET } = await import('@/app/api/prompts/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('POST /api/prompts', async () => {
    const { POST } = await import('@/app/api/prompts/route')
    const res = await POST(
      jsonRequest('http://localhost/api/prompts', { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(401)
  })

  it('POST /api/prompts/test', async () => {
    const { POST } = await import('@/app/api/prompts/test/route')
    const res = await POST(
      jsonRequest('http://localhost/api/prompts/test', { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/operations', async () => {
    const { GET } = await import('@/app/api/operations/route')
    const res = await GET(jsonRequest('http://localhost/api/operations'))
    expect(res.status).toBe(401)
  })

  it('GET /api/export/[minutesId]', async () => {
    const { GET } = await import('@/app/api/export/[minutesId]/route')
    const res = await GET(
      jsonRequest('http://localhost/api/export/m1'),
      { params: asyncParams({ minutesId: 'm1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/meetings', async () => {
    const { GET } = await import('@/app/api/meetings/route')
    const res = await GET(jsonRequest('http://localhost/api/meetings'))
    expect(res.status).toBe(401)
  })

  it('GET /api/minutes', async () => {
    const { GET } = await import('@/app/api/minutes/route')
    const res = await GET(jsonRequest('http://localhost/api/minutes'))
    expect(res.status).toBe(401)
  })

  it('GET /api/minutes/[id]', async () => {
    const { GET } = await import('@/app/api/minutes/[id]/route')
    const res = await GET(
      jsonRequest('http://localhost/api/minutes/abc'),
      { params: asyncParams({ id: 'abc' }) },
    )
    expect(res.status).toBe(401)
  })

  it('POST /api/meetings/[id]/trigger-bot', async () => {
    const { POST } = await import('@/app/api/meetings/[id]/trigger-bot/route')
    const res = await POST(
      jsonRequest('http://localhost/api/meetings/m1/trigger-bot', { method: 'POST' }),
      { params: asyncParams({ id: 'm1' }) },
    )
    expect(res.status).toBe(401)
  })
})
