const mockAcquireTokenByClientCredential = jest.fn()

jest.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
    acquireTokenByClientCredential: mockAcquireTokenByClientCredential,
    acquireTokenByRefreshToken: jest.fn(),
  })),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { getTranscriptionResult } from '@/lib/microsoft-graph'

function createJwt(claims: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`
}

describe('getTranscriptionResult', () => {
  const fetchMock = jest.fn()
  const prismaUserFindUnique = prisma.user.findUnique as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock as typeof fetch
    prismaUserFindUnique.mockResolvedValue({
      microsoftAccessToken: createJwt({
        oid: 'user-oid-123',
        scp: 'User.Read Calendars.Read Files.Read.All OnlineMeetings.Read',
        preferred_username: 'user@example.com',
      }),
      microsoftRefreshToken: 'refresh-token',
      microsoftTokenExpiry: new Date('2099-01-01T00:00:00.000Z'),
    })
    mockAcquireTokenByClientCredential.mockResolvedValue({ accessToken: 'app-only-token' })
  })

  it('utilise le fallback app-only quand le token délégué n’a pas le scope transcript', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ id: 'meeting-123' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ value: [{ id: 'transcript-1', createdDateTime: '2026-04-27T09:15:00Z' }] }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Maxime Langet>Bonjour à tous',
          { status: 200 }
        )
      )

    const result = await getTranscriptionResult('user-1', 'https://teams.example/join', {
      subject: 'FINANCIERE IMAC - MAH - réunion banques',
    })

    expect(result).toEqual({
      ok: true,
      transcription: '[Maxime Langet] Bonjour à tous',
    })
    expect(mockAcquireTokenByClientCredential).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
