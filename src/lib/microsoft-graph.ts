import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma } from '@/lib/prisma'
import { MICROSOFT_GRAPH_SCOPES } from '@/lib/microsoft-scopes'
import type { GraphMeeting } from '@/types'

type AccessTokenResult =
  | { ok: true; accessToken: string; debug?: string }
  | {
      ok: false
      reason: 'missing_connection' | 'reauth_required' | 'graph_error'
      detail?: string
    }

export type TranscriptionResult =
  | { ok: true; transcription: string }
  | {
      ok: false
      reason:
        | 'missing_join_url'
        | 'missing_connection'
        | 'reauth_required'
        | 'permission_denied'
        | 'meeting_not_found'
        | 'transcript_not_found'
        | 'transcript_empty'
        | 'graph_error'
      detail?: string
    }

// ─── Token management ──────────────────────────────────────────────────────

interface AccessTokenClaims {
  scp?: string
  roles?: string[]
  oid?: string
  tid?: string
  upn?: string
  preferred_username?: string
  unique_name?: string
  name?: string
}

function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
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

function buildTokenDebug(accessToken: string): string | undefined {
  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return undefined

  const user =
    claims.preferred_username ??
    claims.upn ??
    claims.unique_name ??
    claims.name ??
    'inconnu'
  const scopes = claims.scp ?? (claims.roles?.join(' ') || 'aucun')

  return `user=${user}; oid=${claims.oid ?? 'n/a'}; tid=${claims.tid ?? 'n/a'}; scopes=${scopes}`
}

function tokenHasTranscriptScope(accessToken: string): boolean {
  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return false

  const scopes = new Set((claims.scp ?? '').split(' ').filter(Boolean))
  const roles = new Set(claims.roles ?? [])

  return (
    scopes.has('OnlineMeetingTranscript.Read.All') ||
    roles.has('OnlineMeetingTranscript.Read.All')
  )
}

function mergeDebug(detail: string | undefined, debug: string | undefined): string | undefined {
  return [detail, debug].filter(Boolean).join(' | ') || undefined
}

function isForbiddenDetail(detail: string | undefined): boolean {
  const lower = detail?.toLowerCase() ?? ''
  return lower.includes('403') || lower.includes('forbidden')
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return undefined

  if ('message' in error && typeof error.message === 'string') {
    return error.message
  }

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

  if ('code' in error && typeof error.code === 'string') {
    return error.code
  }

  try {
    return JSON.stringify(error)
  } catch {
    return undefined
  }
}

function isReauthError(error: unknown): boolean {
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

async function getAccessTokenResult(userId: string): Promise<AccessTokenResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      microsoftAccessToken: true,
      microsoftRefreshToken: true,
      microsoftTokenExpiry: true,
    },
  })

  if (!user?.microsoftRefreshToken) {
    return { ok: false, reason: 'missing_connection' }
  }

  if (user.microsoftAccessToken && user.microsoftTokenExpiry) {
    if (Date.now() < new Date(user.microsoftTokenExpiry).getTime() - 5 * 60 * 1000) {
      return {
        ok: true,
        accessToken: user.microsoftAccessToken,
        debug: buildTokenDebug(user.microsoftAccessToken),
      }
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
      refreshToken: user.microsoftRefreshToken,
      scopes: [...MICROSOFT_GRAPH_SCOPES],
    })
    if (!result?.accessToken) {
      return { ok: false, reason: 'graph_error', detail: 'Token Microsoft introuvable après refresh.' }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        microsoftAccessToken: result.accessToken,
        microsoftTokenExpiry: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
      },
    })
    return {
      ok: true,
      accessToken: result.accessToken,
      debug: buildTokenDebug(result.accessToken),
    }
  } catch (error) {
    console.error('[getValidAccessToken]', error)
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

function graphClient(accessToken: string): Client {
  return Client.init({ authProvider: (done) => done(null, accessToken) })
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

function buildGraphErrorDetail(status: number, payloadText: string): string {
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

async function graphGetJson<T>(accessToken: string, path: string, query?: URLSearchParams): Promise<T> {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const payloadText = await response.text()
  if (!response.ok) {
    throw new Error(buildGraphErrorDetail(response.status, payloadText))
  }

  return JSON.parse(payloadText) as T
}

async function graphGetText(accessToken: string, path: string, query?: URLSearchParams): Promise<string> {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/vtt, text/plain, application/octet-stream',
    },
  })

  const payloadText = await response.text()
  if (!response.ok) {
    throw new Error(buildGraphErrorDetail(response.status, payloadText))
  }

  return payloadText
}

// ─── Meetings ──────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string
  subject: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  organizer: { emailAddress: { name: string; address: string } }
  attendees: Array<{ emailAddress: { name: string; address: string } }>
  isOnlineMeeting?: boolean
  onlineMeeting?: { joinUrl?: string }
}

// Graph retourne des datetimes sans suffixe timezone (ex: "2026-04-27T07:00:00.0000000").
// On ajoute 'Z' pour forcer l'interprétation UTC, conforme au champ timeZone:"UTC" renvoyé par l'API.
function toUtcIso(dt: string): string {
  return dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z'
}

function toGraphMeeting(ev: CalendarEvent): GraphMeeting {
  return {
    id: ev.id,
    subject: ev.subject,
    startDateTime: toUtcIso(ev.start.dateTime),
    endDateTime: toUtcIso(ev.end.dateTime),
    organizer: ev.organizer,
    attendees: ev.attendees ?? [],
    joinUrl: ev.onlineMeeting?.joinUrl ?? null,
  }
}

export async function getRecentMeetings(userId: string): Promise<GraphMeeting[]> {
  const token = await getValidAccessToken(userId)
  if (!token) return []

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  try {
    const client = graphClient(token)
    const result = await client
      .api('/me/calendarView')
      .query({ startDateTime: sevenDaysAgo.toISOString(), endDateTime: sevenDaysAhead.toISOString() })
      .select('id,subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeeting')
      .top(50)
      .get()
    const events: CalendarEvent[] = result.value ?? []
    return events.filter((ev) => ev.isOnlineMeeting || ev.onlineMeeting?.joinUrl).map(toGraphMeeting)
  } catch (error) {
    console.error('[getRecentMeetings]', error)
    return []
  }
}

export async function getMeetingsEndedInLastHours(
  userId: string,
  hours = 2
): Promise<GraphMeeting[]> {
  const token = await getValidAccessToken(userId)
  if (!token) return []

  const now = new Date()
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000)

  try {
    const client = graphClient(token)
    const result = await client
      .api('/me/calendarView')
      .query({ startDateTime: since.toISOString(), endDateTime: now.toISOString() })
      .select('id,subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeeting')
      .get()
    const events: CalendarEvent[] = result.value ?? []
    return events.filter((ev) => ev.isOnlineMeeting).map(toGraphMeeting)
  } catch (error) {
    console.error('[getMeetingsEndedInLastHours]', error)
    return []
  }
}

// ─── Transcriptions ────────────────────────────────────────────────────────

export async function getTranscription(
  userId: string,
  joinUrl: string | null | undefined
): Promise<string | null> {
  const result = await getTranscriptionResult(userId, joinUrl)
  return result.ok ? result.transcription : null
}

function isPermissionError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase() ?? ''

  return (
    message.includes('forbidden') ||
    message.includes('no permissions in access token') ||
    message.includes('insufficient privileges') ||
    message.includes('access is denied') ||
    message.includes('authorization_requestdenied')
  )
}

export async function getTranscriptionResult(
  userId: string,
  joinUrl: string | null | undefined
): Promise<TranscriptionResult> {
  if (!joinUrl) return { ok: false, reason: 'missing_join_url' }

  const tokenResult = await getAccessTokenResult(userId)
  if (!tokenResult.ok) {
    if (tokenResult.reason === 'missing_connection') {
      return { ok: false, reason: 'missing_connection' }
    }
    if (tokenResult.reason === 'reauth_required') {
      return { ok: false, reason: 'reauth_required', detail: tokenResult.detail }
    }
    return { ok: false, reason: 'graph_error', detail: tokenResult.detail }
  }

  if (!tokenHasTranscriptScope(tokenResult.accessToken)) {
    return {
      ok: false,
      reason: 'permission_denied',
      detail: mergeDebug(
        'Le token delegue ne contient pas OnlineMeetingTranscript.Read.All.',
        tokenResult.debug
      ),
    }
  }

  try {
    const escapedJoinUrl = escapeODataString(joinUrl)
    const tokenClaims = decodeAccessTokenClaims(tokenResult.accessToken)
    const tokenOid = tokenClaims?.oid
    const meetingLookup = new URLSearchParams({
      '$filter': `JoinWebUrl eq '${escapedJoinUrl}'`,
    })

    // Resolve joinUrl → online meeting ID
    const lookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
      tokenResult.accessToken,
      '/me/onlineMeetings',
      meetingLookup
    )
    const onlineMeetingId = lookup.value?.[0]?.id
    if (!onlineMeetingId) return { ok: false, reason: 'meeting_not_found' }

    const transcriptCandidates = [
      {
        label: 'me',
        basePath: `/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
      },
      ...(tokenOid
        ? [
            {
              label: `users/${tokenOid}`,
              basePath: `/users/${encodeURIComponent(tokenOid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
            },
          ]
        : []),
    ]

    let transcripts:
      | {
          value?: Array<{ id?: string; createdDateTime?: string }>
        }
      | null = null
    let transcriptBasePath: string | null = null
    const transcriptErrors: string[] = []

    for (const candidate of transcriptCandidates) {
      try {
        transcripts = await graphGetJson<{
          value?: Array<{ id?: string; createdDateTime?: string }>
        }>(tokenResult.accessToken, `${candidate.basePath}/transcripts`)
        transcriptBasePath = candidate.basePath
        break
      } catch (error) {
        transcriptErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    if (!transcripts) {
      const detail = mergeDebug(transcriptErrors.join(' || '), tokenResult.debug)
      if (transcriptErrors.some((entry) => isForbiddenDetail(entry))) {
        return { ok: false, reason: 'permission_denied', detail }
      }
      return { ok: false, reason: 'graph_error', detail }
    }

    if (!transcripts.value?.length) return { ok: false, reason: 'transcript_not_found' }

    const latestTranscript = [...transcripts.value].sort(
      (a, b) =>
        new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime()
    )[0]
    const transcriptId = latestTranscript?.id
    if (!transcriptId) return { ok: false, reason: 'transcript_not_found' }

    let content: string | null = null
    const contentErrors: string[] = []

    for (const candidate of transcriptCandidates) {
      if (transcriptBasePath && candidate.basePath !== transcriptBasePath && candidate.label !== 'me') {
        // Prefer the path that successfully listed transcripts before trying alternates.
        continue
      }

      try {
        content = await graphGetText(
          tokenResult.accessToken,
          `${candidate.basePath}/transcripts/${encodeURIComponent(transcriptId)}/content`,
          new URLSearchParams({ '$format': 'text/vtt' })
        )
        break
      } catch (error) {
        contentErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    if (!content && transcriptBasePath) {
      for (const candidate of transcriptCandidates) {
        if (`${candidate.basePath}` === transcriptBasePath) continue

        try {
          content = await graphGetText(
            tokenResult.accessToken,
            `${candidate.basePath}/transcripts/${encodeURIComponent(transcriptId)}/content`,
            new URLSearchParams({ '$format': 'text/vtt' })
          )
          break
        } catch (error) {
          contentErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
        }
      }
    }

    if (!content) {
      const detail = mergeDebug(contentErrors.join(' || '), tokenResult.debug)
      if (contentErrors.some((entry) => isForbiddenDetail(entry))) {
        return { ok: false, reason: 'permission_denied', detail }
      }
      return { ok: false, reason: 'graph_error', detail }
    }

    if (typeof content !== 'string') {
      return { ok: false, reason: 'transcript_empty' }
    }

    // Parse VTT into readable text "[Speaker] text" lines
    const lines: string[] = []
    for (const block of content.split('\n\n')) {
      const match = block.match(/<v ([^>]+)>([\s\S]+)/)
      if (match) {
        const text = match[2].replace(/<[^>]+>/g, '').trim()
        if (text) lines.push(`[${match[1].trim()}] ${text}`)
      }
    }
    const transcription = lines.join('\n')
    if (!transcription) {
      return { ok: false, reason: 'transcript_empty' }
    }

    return { ok: true, transcription }
  } catch (error) {
    console.error('[getTranscription]', error)
    if (isPermissionError(error)) {
      return {
        ok: false,
        reason: 'permission_denied',
        detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
      }
    }

    if (isReauthError(error)) {
      return {
        ok: false,
        reason: 'reauth_required',
        detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
      }
    }

    return {
      ok: false,
      reason: 'graph_error',
      detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
    }
  }
}
