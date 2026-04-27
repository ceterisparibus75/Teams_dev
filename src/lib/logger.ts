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

// Si SENTRY_DSN est défini, on inscrit l'envoi automatique des erreurs.
// Le hook est volontairement minimaliste (pas d'instrumentation tracing) :
// il intercepte les niveaux >= error et les envoie à Sentry via fetch.
// C'est suffisant pour avoir des alertes prod sans dépendre de @sentry/node.
type SentryEvent = { level: string; message: string; extra: Record<string, unknown>; timestamp: string }
async function sendToSentry(event: SentryEvent): Promise<void> {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    // DSN format: https://<key>@oXXXXXX.ingest.sentry.io/<project>
    const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/)
    if (!match) return
    const [, key, host, projectId] = match
    await fetch(`https://${host}/api/${projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${key},sentry_client=teams-minutes/1.0`,
      },
      body: JSON.stringify({
        level: event.level,
        message: event.message,
        extra: event.extra,
        timestamp: event.timestamp,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
        release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
      }),
    })
  } catch {
    // On n'échoue jamais à cause de Sentry — c'est de l'observabilité best-effort.
  }
}

// JSON par défaut — Vercel et Datadog parsent ces lignes nativement.
// Pour du pretty-print en local : `npm run dev | npx pino-pretty`.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: { service: 'teams-minutes' },
  hooks: {
    logMethod(args, method, level) {
      // Forward errors to Sentry en production (ou si SENTRY_DSN défini en local).
      if (level >= 50 /* error */ && process.env.SENTRY_DSN) {
        const obj = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {}
        const msg = typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : 'error'
        // Fire-and-forget : ne bloque jamais le log local.
        void sendToSentry({
          level: level >= 60 ? 'fatal' : 'error',
          message: msg,
          extra: obj,
          timestamp: new Date().toISOString(),
        })
      }
      return method.apply(this, args)
    },
  },
})

// Helper pour logger une erreur avec son contexte sans exposer la stack au client.
export function logError(scope: string, error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error({ scope, ...context, err: { name: err.name, message: err.message, stack: err.stack } }, scope)
}

// Logger enfant lié à une requête : injecte automatiquement le requestId
// dans toutes les lignes pour que Datadog / Vercel puissent corréler.
// Usage : `const log = requestLogger(req); log.info(...)`
import type { NextRequest } from 'next/server'
export function requestLogger(req: NextRequest | Request) {
  const requestId = req.headers.get('x-request-id') ?? undefined
  return logger.child({ requestId })
}
