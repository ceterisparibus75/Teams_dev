jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    meeting: { findFirst: jest.fn() },
    meetingMinutes: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    template: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/microsoft-graph', () => ({
  getAttendanceLookup: jest.fn().mockResolvedValue({ status: 'found', records: [] }),
}))
jest.mock('@/inngest/client', () => ({
  inngest: { send: jest.fn().mockResolvedValue({}) },
}))

import { jsonRequest, asyncParams } from '../helpers/http'
import { getServerSession } from 'next-auth'

const sessionMock = getServerSession as jest.Mock

describe('POST /api/generate/[meetingId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuse 401 sans session', async () => {
    sessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/generate/m1', { method: 'POST' })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(401)
  })

  it('renvoie 404 si la réunion n\'est pas accessible', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    jest.requireMock('@/lib/prisma').prisma.meeting.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/generate/[meetingId]/route')
    const req = jsonRequest('http://localhost/api/generate/m1', { method: 'POST' })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(404)
  })

  it('rate-limit après 10 tentatives par utilisateur', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u-rl' } })
    jest.requireMock('@/lib/prisma').prisma.meeting.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/generate/[meetingId]/route')
    // 10 appels valides (404 mais consomment le bucket), 11e en 429
    for (let i = 0; i < 10; i++) {
      await POST(jsonRequest('http://localhost/api/generate/m1', { method: 'POST' }), {
        params: asyncParams({ meetingId: 'm1' }),
      })
    }
    const res = await POST(jsonRequest('http://localhost/api/generate/m1', { method: 'POST' }), {
      params: asyncParams({ meetingId: 'm1' }),
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
  })
})
