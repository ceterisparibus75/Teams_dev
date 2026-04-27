import { timingSafeEqual } from 'crypto'

// Comparaison en temps constant : protège contre les timing attacks
// lors de la vérification d'un secret (bot, cron, webhook).
export function safeEqual(input: string | null | undefined, expected: string | undefined): boolean {
  if (!input || !expected) return false
  const a = Buffer.from(input)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function safeBearerEqual(authHeader: string | null, expected: string | undefined): boolean {
  if (!authHeader || !expected) return false
  const prefix = 'Bearer '
  if (!authHeader.startsWith(prefix)) return false
  return safeEqual(authHeader.slice(prefix.length), expected)
}
