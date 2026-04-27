jest.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn() },
}))

describe('GET /api/health', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renvoie 200 quand la BD répond', async () => {
    jest.requireMock('@/lib/prisma').prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.database).toBe('ok')
    expect(typeof body.latencyMs).toBe('number')
  })

  it('renvoie 503 quand la BD est down', async () => {
    jest.requireMock('@/lib/prisma').prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.database).toBe('down')
  })
})
