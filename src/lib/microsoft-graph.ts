import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma } from '@/lib/prisma'
import { MICROSOFT_GRAPH_SCOPES } from '@/lib/microsoft-scopes'
import { transcribeMedia } from '@/lib/openai-transcription'
import { encryptToken, decryptToken } from '@/lib/crypto'
import type { GraphMeeting, MeetingAttendanceLookup, MeetingAttendanceRecord } from '@/types'

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
        | 'policy_denied'
        | 'meeting_not_found'
        | 'transcript_not_found'
        | 'transcript_empty'
        | 'graph_error'
      detail?: string
    }

interface TranscriptionLookupOptions {
  subject?: string | null
}

interface DriveItemLike {
  id?: string
  name?: string
  size?: number
  webUrl?: string
  parentReference?: { driveId?: string; path?: string }
  file?: { mimeType?: string }
  remoteItem?: {
    id?: string
    name?: string
    size?: number
    webUrl?: string
    parentReference?: { driveId?: string; path?: string }
    file?: { mimeType?: string }
  }
}

// ─── App-only token (client credentials) ──────────────────────────────────

async function getAppOnlyToken(): Promise<string | null> {
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

async function fetchTranscriptWithAppToken(
  userOid: string,
  onlineMeetingId: string
): Promise<string | null> {
  const appToken = await getAppOnlyToken()
  if (!appToken) return null

  const basePath = `/users/${encodeURIComponent(userOid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`

  let transcripts: { value?: Array<{ id?: string; createdDateTime?: string }> }
  try {
    transcripts = await graphGetJson(appToken, `${basePath}/transcripts`)
  } catch {
    return null
  }

  if (!transcripts.value?.length) return null

  const latest = [...transcripts.value].sort(
    (a, b) =>
      new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime()
  )[0]
  if (!latest?.id) return null

  try {
    const content = await graphGetText(
      appToken,
      `${basePath}/transcripts/${encodeURIComponent(latest.id)}/content`,
      new URLSearchParams({ '$format': 'text/vtt' })
    )
    return parseTranscriptText(content)
  } catch {
    return null
  }
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

function tokenHasFileReadScope(accessToken: string): boolean {
  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return false

  const scopes = new Set((claims.scp ?? '').split(' ').filter(Boolean))
  const roles = new Set(claims.roles ?? [])

  return (
    scopes.has('Files.Read') ||
    scopes.has('Files.Read.All') ||
    roles.has('Files.Read.All')
  )
}

function tokenHasAttendanceArtifactScope(accessToken: string): boolean {
  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return false

  const scopes = new Set((claims.scp ?? '').split(' ').filter(Boolean))
  const roles = new Set(claims.roles ?? [])

  return (
    scopes.has('OnlineMeetingArtifact.Read.All') ||
    roles.has('OnlineMeetingArtifact.Read.All')
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

  const refreshToken = decryptToken(user.microsoftRefreshToken)

  if (user.microsoftAccessToken && user.microsoftTokenExpiry) {
    if (Date.now() < new Date(user.microsoftTokenExpiry).getTime() - 5 * 60 * 1000) {
      const accessToken = decryptToken(user.microsoftAccessToken)
      return {
        ok: true,
        accessToken,
        debug: buildTokenDebug(accessToken),
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

async function graphGetBuffer(accessToken: string, path: string, query?: URLSearchParams): Promise<Buffer> {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/octet-stream',
    },
  })

  if (!response.ok) {
    const payloadText = await response.text()
    throw new Error(buildGraphErrorDetail(response.status, payloadText))
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function graphPostJson<T>(
  accessToken: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`)

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
  if (!response.ok) {
    throw new Error(buildGraphErrorDetail(response.status, payloadText))
  }

  return JSON.parse(payloadText) as T
}

async function resolveOnlineMeetingId(
  accessToken: string,
  joinUrl: string,
  userOid?: string
): Promise<string | null> {
  const meetingLookup = new URLSearchParams({
    '$filter': `JoinWebUrl eq '${escapeODataString(joinUrl)}'`,
  })

  const lookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
    accessToken,
    '/me/onlineMeetings',
    meetingLookup
  )
  const delegatedMeetingId = lookup.value?.[0]?.id
  if (delegatedMeetingId) return delegatedMeetingId

  if (!userOid) return null

  const appToken = await getAppOnlyToken()
  if (!appToken) return null

  try {
    const appLookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
      appToken,
      `/users/${encodeURIComponent(userOid)}/onlineMeetings`,
      meetingLookup
    )
    return appLookup.value?.[0]?.id ?? null
  } catch {
    return null
  }
}

function simplifyQueryTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDriveReference(item: DriveItemLike): {
  driveId?: string
  itemId?: string
  name?: string
  size?: number
  mimeType?: string
  webUrl?: string
  path?: string
} {
  const remote = item.remoteItem

  return {
    driveId: remote?.parentReference?.driveId ?? item.parentReference?.driveId,
    itemId: remote?.id ?? item.id,
    name: remote?.name ?? item.name,
    size: remote?.size ?? item.size,
    mimeType: remote?.file?.mimeType ?? item.file?.mimeType,
    webUrl: remote?.webUrl ?? item.webUrl,
    path: remote?.parentReference?.path ?? item.parentReference?.path,
  }
}

function scoreTranscriptCandidate(item: DriveItemLike, subject: string): number {
  const ref = extractDriveReference(item)
  const name = (ref.name ?? '').toLowerCase()
  const path = (ref.path ?? '').toLowerCase()
  const simplifiedSubject = simplifyQueryTerm(subject).toLowerCase()

  let score = 0
  if (name.endsWith('.vtt')) score += 100
  if (name.endsWith('.docx')) score += 20
  if (path.includes('/recordings')) score += 30
  if (simplifiedSubject && name.includes(simplifiedSubject)) score += 40

  const subjectTokens = simplifiedSubject.split(' ').filter((token) => token.length >= 4)
  for (const token of subjectTokens) {
    if (name.includes(token)) score += 8
  }

  return score
}

function parseTranscriptText(content: string): string | null {
  const lines: string[] = []

  for (const block of content.split('\n\n')) {
    const jsonLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))

    if (jsonLines.length > 0) {
      for (const line of jsonLines) {
        try {
          const entry = JSON.parse(line) as { speakerName?: string; spokenText?: string }
          const speaker = entry.speakerName?.trim()
          const text = entry.spokenText?.trim()
          if (text) lines.push(speaker ? `[${speaker}] ${text}` : text)
        } catch {
          // Ignore malformed JSON lines and continue parsing.
        }
      }
      continue
    }

    const match = block.match(/<v ([^>]+)>([\s\S]+)/)
    if (match) {
      const text = match[2].replace(/<[^>]+>/g, '').trim()
      if (text) lines.push(`[${match[1].trim()}] ${text}`)
    }
  }

  return lines.join('\n') || null
}

async function searchDriveItems(
  accessToken: string,
  subject: string,
  fileTypes: string[]
): Promise<DriveItemLike[]> {
  const searchQueries = Array.from(
    new Set(
      [
        simplifyQueryTerm(subject),
        simplifyQueryTerm(subject)
          .split(' ')
          .filter((token) => token.length >= 4)
          .slice(0, 5)
          .join(' '),
      ].filter(Boolean)
    )
  )

  const items: DriveItemLike[] = []

  for (const queryText of searchQueries) {
    const results = await graphPostJson<{
      value?: Array<{
        hitsContainers?: Array<{
          hits?: Array<{
            resource?: DriveItemLike
          }>
        }>
      }>
    }>(accessToken, '/search/query', {
      requests: [
        {
          entityTypes: ['driveItem'],
          query: {
            queryString: `"${queryText}" AND (${fileTypes.map((type) => `filetype:${type}`).join(' OR ')})`,
          },
          from: 0,
          size: 25,
        },
      ],
    })

    const candidates = (results.value ?? [])
      .flatMap((container) => container.hitsContainers ?? [])
      .flatMap((container) => container.hits ?? [])
      .map((hit) => hit.resource)
      .filter((item): item is DriveItemLike => Boolean(item))
      .filter((item) => {
        const ref = extractDriveReference(item)
        const name = (ref.name ?? '').toLowerCase()
        return fileTypes.some((type) => name.endsWith(`.${type}`))
      })

    items.push(...candidates)
  }

  return items.sort((a, b) => scoreTranscriptCandidate(b, subject) - scoreTranscriptCandidate(a, subject))
}

async function searchTranscriptFile(
  accessToken: string,
  subject: string
): Promise<{ transcription: string; detail: string } | null> {
  const candidates = await searchDriveItems(accessToken, subject, ['vtt', 'docx'])

  for (const candidate of candidates) {
    const ref = extractDriveReference(candidate)
    if (!ref.driveId || !ref.itemId || !ref.name?.toLowerCase().endsWith('.vtt')) continue

    const content = await graphGetText(
      accessToken,
      `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}/content`
    )
    const parsed = parseTranscriptText(content)
    if (parsed) {
      return {
        transcription: parsed,
        detail: `Fallback fichier transcript: ${ref.name}${ref.webUrl ? ` (${ref.webUrl})` : ''}`,
      }
    }
  }

  return null
}

async function searchRecordingFile(
  accessToken: string,
  subject: string
): Promise<{ transcription: string; detail: string } | null> {
  const candidates = await searchDriveItems(accessToken, subject, ['mp4'])

  for (const candidate of candidates) {
    const ref = extractDriveReference(candidate)
    const name = ref.name ?? ''
    const size = ref.size ?? 0

    if (!ref.driveId || !ref.itemId || !name.toLowerCase().endsWith('.mp4')) continue
    if (size > 25 * 1024 * 1024) continue

    const buffer = await graphGetBuffer(
      accessToken,
      `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}/content`
    )

    const transcription = await transcribeMedia({
      buffer,
      filename: name,
      contentType: ref.mimeType ?? 'video/mp4',
    })

    if (transcription) {
      return {
        transcription,
        detail: `Fallback enregistrement: ${name}${ref.webUrl ? ` (${ref.webUrl})` : ''}`,
      }
    }
  }

  return null
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

interface AttendanceReportRecord {
  id?: string
  meetingStartDateTime?: string
  meetingEndDateTime?: string
}

interface AttendanceRecordResponse {
  emailAddress?: string
  totalAttendanceInSeconds?: number
  identity?: {
    displayName?: string
    user?: { displayName?: string }
    guest?: { displayName?: string }
  }
  attendanceIntervals?: Array<{ joinDateTime?: string; leaveDateTime?: string }>
}

function toAttendanceRecord(record: AttendanceRecordResponse): MeetingAttendanceRecord | null {
  const name =
    record.identity?.displayName ??
    record.identity?.user?.displayName ??
    record.identity?.guest?.displayName ??
    record.emailAddress ??
    ''

  if (!name.trim() && !record.emailAddress?.trim()) return null

  return {
    name: name.trim() || record.emailAddress!.trim(),
    email: record.emailAddress?.trim() || undefined,
    totalAttendanceInSeconds: record.totalAttendanceInSeconds,
    intervals: record.attendanceIntervals ?? [],
  }
}

export async function getAttendanceRecords(
  userId: string,
  joinUrl: string | null | undefined
): Promise<MeetingAttendanceRecord[]> {
  const lookup = await getAttendanceLookup(userId, joinUrl)
  return lookup.records
}

export async function getAttendanceLookup(
  userId: string,
  joinUrl: string | null | undefined
): Promise<MeetingAttendanceLookup> {
  if (!joinUrl) return { status: 'error', records: [], detail: 'Lien de réunion manquant.' }

  const tokenResult = await getAccessTokenResult(userId)
  if (!tokenResult.ok) {
    return {
      status: 'error',
      records: [],
      detail: tokenResult.detail ?? tokenResult.reason,
    }
  }
  if (!tokenHasAttendanceArtifactScope(tokenResult.accessToken)) {
    const detail = mergeDebug('Scope OnlineMeetingArtifact.Read.All absent du token utilisateur.', tokenResult.debug)
    console.warn('[getAttendanceRecords]', detail)
    return { status: 'missing_scope', records: [], detail }
  }

  try {
    const tokenClaims = decodeAccessTokenClaims(tokenResult.accessToken)
    const onlineMeetingId = await resolveOnlineMeetingId(
      tokenResult.accessToken,
      joinUrl,
      tokenClaims?.oid
    )
    if (!onlineMeetingId) {
      const detail = mergeDebug('onlineMeeting introuvable via joinUrl.', tokenResult.debug)
      console.warn('[getAttendanceRecords]', detail)
      return { status: 'meeting_not_found', records: [], detail }
    }

    const basePathCandidates = [
      `/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
      ...(tokenClaims?.oid
        ? [`/users/${encodeURIComponent(tokenClaims.oid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`]
        : []),
    ]

    const errors: string[] = []

    for (const basePath of basePathCandidates) {
      try {
        const reports = await graphGetJson<{ value?: AttendanceReportRecord[] }>(
          tokenResult.accessToken,
          `${basePath}/attendanceReports`
        )
        const latestReport = [...(reports.value ?? [])]
          .sort(
            (a, b) =>
              new Date(b.meetingEndDateTime ?? b.meetingStartDateTime ?? 0).getTime() -
              new Date(a.meetingEndDateTime ?? a.meetingStartDateTime ?? 0).getTime()
          )[0]

        if (!latestReport?.id) {
          errors.push(`${basePath}: aucun attendanceReport`)
          continue
        }

        const records = await graphGetJson<{ value?: AttendanceRecordResponse[] }>(
          tokenResult.accessToken,
          `${basePath}/attendanceReports/${encodeURIComponent(latestReport.id)}/attendanceRecords`
        )

        const attendanceRecords = (records.value ?? [])
          .map(toAttendanceRecord)
          .filter((record): record is MeetingAttendanceRecord => Boolean(record))

        if (attendanceRecords.length > 0) {
          return { status: 'found', records: attendanceRecords }
        }
        errors.push(`${basePath}: attendanceRecords vide`)
      } catch (error) {
        errors.push(`${basePath}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    console.warn(
      '[getAttendanceRecords] Aucun rapport de présence exploitable.',
      mergeDebug(errors.join(' || '), tokenResult.debug)
    )
    const detail = mergeDebug(errors.join(' || '), tokenResult.debug)
    const status = errors.every((entry) => entry.includes('aucun attendanceReport'))
      ? 'report_not_found'
      : errors.every((entry) => entry.includes('attendanceRecords vide'))
        ? 'records_empty'
        : 'error'
    return { status, records: [], detail }
  } catch (error) {
    const detail = getErrorMessage(error) ?? String(error)
    console.warn('[getAttendanceRecords] Rapport de présence indisponible:', detail)
    return { status: 'error', records: [], detail }
  }
}

// ─── Transcriptions ────────────────────────────────────────────────────────

export async function getTranscription(
  userId: string,
  joinUrl: string | null | undefined,
  options?: TranscriptionLookupOptions
): Promise<string | null> {
  const result = await getTranscriptionResult(userId, joinUrl, options)
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
  joinUrl: string | null | undefined,
  options?: TranscriptionLookupOptions
): Promise<TranscriptionResult> {
  if (!joinUrl) return { ok: false, reason: 'missing_join_url' }

  const tokenResult = await getAccessTokenResult(userId)
  if (!tokenResult.ok) {
    const failedTokenResult = tokenResult

    if (failedTokenResult.reason === 'missing_connection') {
      return { ok: false, reason: 'missing_connection' }
    }
    if (failedTokenResult.reason === 'reauth_required') {
      return { ok: false, reason: 'reauth_required', detail: failedTokenResult.detail }
    }
    return { ok: false, reason: 'graph_error', detail: failedTokenResult.detail }
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

  const canSearchFiles = tokenHasFileReadScope(tokenResult.accessToken)
  const tryFileFallback = async (detail: string | undefined): Promise<TranscriptionResult | null> => {
    const subject = options?.subject?.trim()
    if (!subject) return null
    if (!canSearchFiles) {
      return {
        ok: false,
        reason: 'permission_denied',
        detail: mergeDebug(
          `${detail ?? 'Acces transcript refuse.'} | Le token ne contient pas Files.Read ou Files.Read.All pour chercher le fichier de transcription OneDrive/SharePoint.`,
          tokenResult.debug
        ),
      }
    }

    try {
      const transcriptFile = await searchTranscriptFile(tokenResult.accessToken, subject)
      if (transcriptFile) {
        return {
          ok: true,
          transcription: transcriptFile.transcription,
        }
      }

      const recordingFile = await searchRecordingFile(tokenResult.accessToken, subject)
      if (recordingFile) {
        return {
          ok: true,
          transcription: recordingFile.transcription,
        }
      }

      return null
    } catch (error) {
      return {
        ok: false,
        reason: isPermissionError(error) ? 'permission_denied' : 'graph_error',
        detail: mergeDebug(
          `${detail ?? 'Acces transcript refuse.'} | Fallback fichier: ${getErrorMessage(error) ?? 'Erreur inconnue'}`,
          tokenResult.debug
        ),
      }
    }
  }

  try {
    const escapedJoinUrl = escapeODataString(joinUrl)
    const tokenClaims = decodeAccessTokenClaims(tokenResult.accessToken)
    const tokenOid = tokenClaims?.oid
    const meetingLookup = new URLSearchParams({
      '$filter': `JoinWebUrl eq '${escapedJoinUrl}'`,
    })

    // Resolve joinUrl → online meeting ID (delegated token first, app-only fallback)
    let lookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
      tokenResult.accessToken,
      '/me/onlineMeetings',
      meetingLookup
    )
    let onlineMeetingId = lookup.value?.[0]?.id

    // If not found via delegated token (user is not organizer), try with app-only token
    if (!onlineMeetingId && tokenOid) {
      const appToken = await getAppOnlyToken()
      if (appToken) {
        try {
          const appLookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
            appToken,
            `/users/${encodeURIComponent(tokenOid)}/onlineMeetings`,
            meetingLookup
          )
          onlineMeetingId = appLookup.value?.[0]?.id
          // If found with app token, fetch transcript directly
          if (onlineMeetingId) {
            const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
            if (appTranscript) return { ok: true, transcription: appTranscript }
            return { ok: false, reason: 'transcript_not_found' }
          }
        } catch {
          // ignore, fall through to meeting_not_found
        }
      }
    }

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
        if (tokenOid) {
          const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
          if (appTranscript) return { ok: true, transcription: appTranscript }
        }
        const fallbackResult = await tryFileFallback(detail)
        if (fallbackResult) return fallbackResult
        return { ok: false, reason: 'policy_denied', detail }
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
        if (tokenOid) {
          const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
          if (appTranscript) return { ok: true, transcription: appTranscript }
        }
        const fallbackResult = await tryFileFallback(detail)
        if (fallbackResult) return fallbackResult
        return { ok: false, reason: 'policy_denied', detail }
      }
      return { ok: false, reason: 'graph_error', detail }
    }

    if (typeof content !== 'string') {
      return { ok: false, reason: 'transcript_empty' }
    }

    // Parse VTT into readable text "[Speaker] text" lines
    const transcription = parseTranscriptText(content)
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
