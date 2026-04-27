jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    meeting: { findFirst: jest.fn(), update: jest.fn() },
    meetingMinutes: { findUnique: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/microsoft-graph', () => ({
  getAttendanceLookup: jest.fn().mockResolvedValue({ status: 'found', records: [] }),
  getTranscriptionResult: jest.fn(),
}))
jest.mock('@/inngest/client', () => ({
  inngest: { send: jest.fn().mockResolvedValue({}) },
}))

import { jsonRequest, asyncParams } from '../helpers/http'
import { getServerSession } from 'next-auth'

const sessionMock = getServerSession as jest.Mock

describe('POST /api/generate/[meetingId]/retranscribe', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuse 401 sans session', async () => {
    sessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/generate/[meetingId]/retranscribe/route')
    const req = jsonRequest('http://localhost/api/generate/m1/retranscribe', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(401)
  })

  it('refuse 400 si modelName non-claude', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u-modelname' } })
    const { POST } = await import('@/app/api/generate/[meetingId]/retranscribe/route')
    const req = jsonRequest('http://localhost/api/generate/m1/retranscribe', {
      method: 'POST',
      body: JSON.stringify({ modelName: 'gpt-4-turbo' }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 sur clé inattendue (mode strict)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u-strict' } })
    const { POST } = await import('@/app/api/generate/[meetingId]/retranscribe/route')
    const req = jsonRequest('http://localhost/api/generate/m1/retranscribe', {
      method: 'POST',
      body: JSON.stringify({ modelName: 'claude-opus-4-7', injection: 'oops' }),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si la réunion est inaccessible', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u-404' } })
    jest.requireMock('@/lib/prisma').prisma.meeting.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/generate/[meetingId]/retranscribe/route')
    const req = jsonRequest('http://localhost/api/generate/m1/retranscribe', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: asyncParams({ meetingId: 'm1' }) })
    expect(res.status).toBe(404)
  })
})
