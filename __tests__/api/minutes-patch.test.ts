jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    meetingMinutes: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    minutesEditLog: { create: jest.fn() },
  },
}))
jest.mock('@/lib/minutes-quality', () => ({
  getMinutesQualityAlerts: () => [],
}))

import { jsonRequest, asyncParams } from '../helpers/http'
import { getServerSession } from 'next-auth'

const sessionMock = getServerSession as jest.Mock

describe('PATCH /api/minutes/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuse 401 sans session', async () => {
    sessionMock.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'VALIDATED' }),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(401)
  })

  it('refuse 400 si body vide (ni content ni status)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 si status hors enum', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PIRATE' }),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 si content est un tableau (pas un objet)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ content: ['a', 'b'] }),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(400)
  })

  it('refuse 400 sur clé inattendue (mode strict)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'VALIDATED', authorId: 'forged' }),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(400)
  })

  it('renvoie 404 si le PV n\'est pas accessible à l\'utilisateur', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    jest.requireMock('@/lib/prisma').prisma.meetingMinutes.findFirst.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/minutes/[id]/route')
    const req = jsonRequest('http://localhost/api/minutes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'VALIDATED' }),
    })
    const res = await PATCH(req, { params: asyncParams({ id: 'abc' }) })
    expect(res.status).toBe(404)
  })
})
