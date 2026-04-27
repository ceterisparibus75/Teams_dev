import pino from 'pino'

// Logger structuré commun à toutes les routes / services.
// Redaction : on masque les claims Azure (oid, tid), les tokens et les emails.
// Ces valeurs apparaissent dans les logs de microsoft-graph.ts et auth.ts ;
// les laisser fuiter en prod dans Vercel/Datadog est un risque RGPD.

const REDACT_PATHS = [
  // Claims OAuth / JWT
  '*.oid',
  '*.tid',
  '*.preferred_username',
  '*.upn',
  '*.email',
  '*.userPrincipalName',
  // Tokens
  '*.accessToken',
  '*.refreshToken',
  '*.microsoftAccessToken',
  '*.microsoftRefreshToken',
  // Headers
  '*.authorization',
  '*.cookie',
  // Génériques
  'err.config.headers.authorization',
]

const isProd = process.env.NODE_ENV === 'production'

// JSON par défaut — Vercel et Datadog parsent ces lignes nativement.
// Pour du pretty-print en local : `npm run dev | npx pino-pretty`.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: { service: 'teams-minutes' },
})

// Helper pour logger une erreur avec son contexte sans exposer la stack au client.
export function logError(scope: string, error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error({ scope, ...context, err: { name: err.name, message: err.message, stack: err.stack } }, scope)
}
