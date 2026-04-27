// Helpers HTTP bas-niveau pour Microsoft Graph + utilitaires d'erreur partagés.
// Ces fonctions sont appelées par les modules métier (auth, transcription,
// attendance, calendar) et n'ont elles-mêmes aucune dépendance applicative.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export function buildGraphErrorDetail(status: number, payloadText: string): string {
  try {
    const payload = JSON.parse(payloadText) as {
      error?: { code?: string; message?: string }
    }
    const code = payload.error?.code
    const message = payload.error?.message
    if (code || message) {
      return [status, code, message].filter(Boolean).join(' - ')
    }
  } catch {
    // Ignore JSON parsing issues and fall back to raw text.
  }
  return [status, payloadText.trim()].filter(Boolean).join(' - ')
}

export async function graphGetJson<T>(accessToken: string, path: string, query?: URLSearchParams): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const payloadText = await response.text()
  if (!response.ok) throw new Error(buildGraphErrorDetail(response.status, payloadText))
  return JSON.parse(payloadText) as T
}

export async function graphGetText(accessToken: string, path: string, query?: URLSearchParams): Promise<string> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/vtt, text/plain, application/octet-stream',
    },
  })
  const payloadText = await response.text()
  if (!response.ok) throw new Error(buildGraphErrorDetail(response.status, payloadText))
  return payloadText
}

export async function graphGetBuffer(accessToken: string, path: string, query?: URLSearchParams): Promise<Buffer> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/octet-stream' },
  })
  if (!response.ok) {
    const payloadText = await response.text()
    throw new Error(buildGraphErrorDetail(response.status, payloadText))
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function graphPostJson<T>(
  accessToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payloadText = await response.text()
  if (!response.ok) throw new Error(buildGraphErrorDetail(response.status, payloadText))
  return JSON.parse(payloadText) as T
}

// ─── Helpers d'erreur ─────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return undefined

  if ('message' in error && typeof error.message === 'string') return error.message

  if (
    'body' in error &&
    error.body &&
    typeof error.body === 'object' &&
    'error' in error.body &&
    error.body.error &&
    typeof error.body.error === 'object'
  ) {
    const graphError = error.body.error as { code?: unknown; message?: unknown }
    const code = typeof graphError.code === 'string' ? graphError.code : undefined
    const message = typeof graphError.message === 'string' ? graphError.message : undefined
    return [code, message].filter(Boolean).join(': ') || undefined
  }

  if ('code' in error && typeof error.code === 'string') return error.code

  try {
    return JSON.stringify(error)
  } catch {
    return undefined
  }
}

export function isReauthError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase() ?? ''
  return (
    message.includes('interaction_required') ||
    message.includes('consent_required') ||
    message.includes('invalid_grant') ||
    message.includes('aadsts65001') ||
    message.includes('aadsts65004') ||
    message.includes('aadsts700082')
  )
}

export function isPermissionError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase() ?? ''
  return (
    message.includes('forbidden') ||
    message.includes('no permissions in access token') ||
    message.includes('insufficient privileges') ||
    message.includes('access is denied') ||
    message.includes('authorization_requestdenied')
  )
}

export function isForbiddenDetail(detail: string | undefined): boolean {
  const lower = detail?.toLowerCase() ?? ''
  return lower.includes('403') || lower.includes('forbidden')
}

export function mergeDebug(detail: string | undefined, debug: string | undefined): string | undefined {
  return [detail, debug].filter(Boolean).join(' | ') || undefined
}
