jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    meetingMinutes: { findFirst: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/docx-generator', () => ({
  generateDocx: jest.fn().mockResolvedValue(Buffer.from('docx')),
  buildDocxFilename: () => 'pv.docx',
}))
jest.mock('@/lib/email-sender', () => ({
  sendMinutesEmail: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/minutes-quality', () => ({
  getMinutesQualityAlerts: () => [],
}))

import { jsonRequest, asyncParams } from '../helpers/http'
import { getServerSession } from 'next-auth'

const sessionMock = getServerSession as jest.Mock

describe('POST /api/send/[minutesId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuse 401 sans session', async () => {
    sessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/send/[minutesId]/route')
    const req = jsonRequest('http://localhost/api/send/m1', {
      method: 'POST',
      body: JSON.stringify({ recipients: [{ name: 'X', email: 'x@y.fr' }] }),
    })
    const res = await POST(req, { params: asyncParams({ minutesId: 'm1' }) })
    expect(res.status).toBe(401)
  })

  it('refuse 400 sans recipients', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { POST } = await import('@/app/api/send/[minutesId]/route')
    const req = jsonRequest('http://localhost/api/send/m1', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: asyncParams({ minutesId: 'm1' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 si email invalide', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { POST } = await import('@/app/api/send/[minutesId]/route')
    const req = jsonRequest('http://localhost/api/send/m1', {
      method: 'POST',
      body: JSON.stringify({ recipients: [{ name: 'X', email: 'pas-un-email' }] }),
    })
    const res = await POST(req, { params: asyncParams({ minutesId: 'm1' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 si recipients dépasse 100', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { POST } = await import('@/app/api/send/[minutesId]/route')
    const recipients = Array.from({ length: 101 }, (_, i) => ({ name: `n${i}`, email: `a${i}@b.fr` }))
    const req = jsonRequest('http://localhost/api/send/m1', {
      method: 'POST',
      body: JSON.stringify({ recipients }),
    })
    const res = await POST(req, { params: asyncParams({ minutesId: 'm1' }) })
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si le PV n\'est pas accessible', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    jest.requireMock('@/lib/prisma').prisma.meetingMinutes.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/send/[minutesId]/route')
    const req = jsonRequest('http://localhost/api/send/m1', {
      method: 'POST',
      body: JSON.stringify({ recipients: [{ name: 'X', email: 'x@y.fr' }] }),
    })
    const res = await POST(req, { params: asyncParams({ minutesId: 'm1' }) })
    expect(res.status).toBe(404)
  })
})
