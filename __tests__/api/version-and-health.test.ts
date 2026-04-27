describe('GET /api/version', () => {
  it('renvoie une structure stable même sans variables Vercel', async () => {
    const { GET } = await import('@/app/api/version/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('sha')
    expect(body).toHaveProperty('shortSha')
    expect(body).toHaveProperty('branch')
    expect(body).toHaveProperty('region')
    expect(body).toHaveProperty('nodeVersion')
    expect(typeof body.nodeVersion).toBe('string')
  })

  it('expose le SHA quand VERCEL_GIT_COMMIT_SHA est défini', async () => {
    const ORIG = process.env.VERCEL_GIT_COMMIT_SHA
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
    try {
      const { GET } = await import('@/app/api/version/route')
      const res = await GET()
      const body = await res.json()
      expect(body.sha).toBe('abcdef1234567890abcdef1234567890abcdef12')
      expect(body.shortSha).toBe('abcdef1')
    } finally {
      process.env.VERCEL_GIT_COMMIT_SHA = ORIG
    }
  })
})
