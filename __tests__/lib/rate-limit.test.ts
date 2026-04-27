import { rateLimit } from '@/lib/rate-limit'

describe('rateLimit', () => {
  it('autorise jusqu\'à la limite, puis refuse', () => {
    for (let i = 0; i < 3; i++) {
      const r = rateLimit({ name: 'test-burst', key: 'k1', limit: 3, windowMs: 60_000 })
      expect(r.ok).toBe(true)
    }
    const denied = rateLimit({ name: 'test-burst', key: 'k1', limit: 3, windowMs: 60_000 })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.retryAfterSec).toBeGreaterThan(0)
      expect(denied.retryAfterSec).toBeLessThanOrEqual(60)
    }
  })

  it('isole les clés différentes', () => {
    rateLimit({ name: 'test-keys', key: 'a', limit: 1, windowMs: 60_000 })
    rateLimit({ name: 'test-keys', key: 'a', limit: 1, windowMs: 60_000 }) // dénié
    const otherKey = rateLimit({ name: 'test-keys', key: 'b', limit: 1, windowMs: 60_000 })
    expect(otherKey.ok).toBe(true)
  })

  it('isole les buckets différents (name)', () => {
    rateLimit({ name: 'bucket-a', key: 'shared', limit: 1, windowMs: 60_000 })
    const otherBucket = rateLimit({ name: 'bucket-b', key: 'shared', limit: 1, windowMs: 60_000 })
    expect(otherBucket.ok).toBe(true)
  })

  it('reset après expiration de la fenêtre', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const r1 = rateLimit({ name: 'test-reset', key: 'u1', limit: 1, windowMs: 1000 })
    expect(r1.ok).toBe(true)

    const r2 = rateLimit({ name: 'test-reset', key: 'u1', limit: 1, windowMs: 1000 })
    expect(r2.ok).toBe(false)

    // Avance le temps au-delà de la fenêtre
    jest.advanceTimersByTime(1500)

    const r3 = rateLimit({ name: 'test-reset', key: 'u1', limit: 1, windowMs: 1000 })
    expect(r3.ok).toBe(true)

    jest.useRealTimers()
  })
})
