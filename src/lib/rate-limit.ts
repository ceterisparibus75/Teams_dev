// Rate limit fenêtre fixe en mémoire — chaque instance lambda a son propre
// store. Sur Vercel multi-instance, un attaquant déterminé peut donc faire
// N × limit requêtes (N = lambdas chauds). C'est un compromis assumé :
//   - Inngest cappe la concurrence Claude réelle à 5 (src/inngest/functions)
//   - Le but ici est de stopper le spam évident côté coût Anthropic
// Si on a besoin d'un rate limit strict cross-instance : passer par
// Upstash Redis (`@upstash/ratelimit`).

type Bucket = { count: number; resetAt: number }

const stores = new Map<string, Map<string, Bucket>>()

function getStore(name: string): Map<string, Bucket> {
  let s = stores.get(name)
  if (!s) {
    s = new Map()
    stores.set(name, s)
  }
  return s
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number }

export function rateLimit(options: {
  /** Identifiant logique (ex: 'generate-pv', 'send-email'). */
  name: string
  /** Clé d'isolation (souvent userId, ou meetingId). */
  key: string
  /** Nombre max de hits sur la fenêtre. */
  limit: number
  /** Durée de la fenêtre en ms. */
  windowMs: number
}): RateLimitResult {
  const { name, key, limit, windowMs } = options
  const store = getStore(name)
  const now = Date.now()

  // Nettoyage opportuniste : 1 entrée expirée à chaque hit, suffisant pour
  // éviter une fuite mémoire significative sur des clés qui tournent.
  for (const [k, b] of store) {
    if (b.resetAt <= now) {
      store.delete(k)
      break
    }
  }

  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }

  existing.count += 1
  return { ok: true }
}
