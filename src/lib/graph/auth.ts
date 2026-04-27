import { ConfidentialClientApplication } from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { encryptToken, decryptToken } from '@/lib/crypto'
import { MICROSOFT_GRAPH_SCOPES } from '@/lib/microsoft-scopes'
import { getErrorMessage, isReauthError } from './http'

const log = logger.child({ module: 'graph/auth' })

export type AccessTokenResult =
  | { ok: true; accessToken: string; debug?: string }
  | {
      ok: false
      reason: 'missing_connection' | 'reauth_required' | 'graph_error'
      detail?: string
    }

// ─── App-only token (client credentials) ──────────────────────────────────

export async function getAppOnlyToken(): Promise<string | null> {
  try {
    const cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_AD_CLIENT_ID!,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
      },
    })
    const result = await cca.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
    return result?.accessToken ?? null
  } catch {
    return null
  }
}

// ─── JWT claims + scopes ──────────────────────────────────────────────────

export interface AccessTokenClaims {
  scp?: string
  roles?: string[]
  oid?: string
  tid?: string
  upn?: string
  preferred_username?: string
  unique_name?: string
  name?: string
}

export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const payload = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(payload) as AccessTokenClaims
  } catch {
    return null
  }
}

export function buildTokenDebug(accessToken: string): string | undefined {
  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return undefined
  const user =
    claims.preferred_username ?? claims.upn ?? claims.unique_name ?? claims.name ?? 'inconnu'
  const scopes = claims.scp ?? (claims.roles?.join(' ') || 'aucun')
  return `user=${user}; oid=${claims.oid ?? 'n/a'}; tid=${claims.tid ?? 'n/a'}; scopes=${scopes}`
}

function hasScopeOrRole(token: string, scope: string): boolean {
  const claims = decodeAccessTokenClaims(token)
  if (!claims) return false
  const scopes = new Set((claims.scp ?? '').split(' ').filter(Boolean))
  const roles = new Set(claims.roles ?? [])
  return scopes.has(scope) || roles.has(scope)
}

export function tokenHasTranscriptScope(t: string): boolean {
  return hasScopeOrRole(t, 'OnlineMeetingTranscript.Read.All')
}

export function tokenHasFileReadScope(t: string): boolean {
  return hasScopeOrRole(t, 'Files.Read') || hasScopeOrRole(t, 'Files.Read.All')
}

export function tokenHasAttendanceArtifactScope(t: string): boolean {
  return hasScopeOrRole(t, 'OnlineMeetingArtifact.Read.All')
}

// ─── Récupération token délégué (refresh transparent) ─────────────────────

export async function getAccessTokenResult(userId: string): Promise<AccessTokenResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      microsoftAccessToken: true,
      microsoftRefreshToken: true,
      microsoftTokenExpiry: true,
    },
  })

  if (!user?.microsoftRefreshToken) return { ok: false, reason: 'missing_connection' }

  const refreshToken = decryptToken(user.microsoftRefreshToken)

  if (user.microsoftAccessToken && user.microsoftTokenExpiry) {
    if (Date.now() < new Date(user.microsoftTokenExpiry).getTime() - 5 * 60 * 1000) {
      const accessToken = decryptToken(user.microsoftAccessToken)
      return { ok: true, accessToken, debug: buildTokenDebug(accessToken) }
    }
  }

  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
    },
  })

  try {
    const result = await cca.acquireTokenByRefreshToken({
      refreshToken,
      scopes: [...MICROSOFT_GRAPH_SCOPES],
    })
    if (!result?.accessToken) {
      return { ok: false, reason: 'graph_error', detail: 'Token Microsoft introuvable après refresh.' }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        microsoftAccessToken: encryptToken(result.accessToken),
        microsoftTokenExpiry: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
      },
    })
    return { ok: true, accessToken: result.accessToken, debug: buildTokenDebug(result.accessToken) }
  } catch (error) {
    log.error({ scope: 'getValidAccessToken', err: error }, 'access token error')
    if (isReauthError(error)) {
      return { ok: false, reason: 'reauth_required', detail: getErrorMessage(error) }
    }
    return { ok: false, reason: 'graph_error', detail: getErrorMessage(error) }
  }
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const result = await getAccessTokenResult(userId)
  return result.ok ? result.accessToken : null
}

export function graphClient(accessToken: string): Client {
  return Client.init({ authProvider: (done) => done(null, accessToken) })
}
