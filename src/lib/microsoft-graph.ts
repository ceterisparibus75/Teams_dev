import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma } from '@/lib/prisma'
import { MICROSOFT_GRAPH_SCOPES } from '@/lib/microsoft-scopes'
import type { GraphMeeting } from '@/types'

type AccessTokenResult =
  | { ok: true; accessToken: string }
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

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return undefined
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
      return { ok: true, accessToken: user.microsoftAccessToken }
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
    return { ok: true, accessToken: result.accessToken }
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

  try {
    const client = graphClient(tokenResult.accessToken)
    const escapedJoinUrl = escapeODataString(joinUrl)

    // Resolve joinUrl → online meeting ID
    const lookup = await client
      .api('/me/onlineMeetings')
      .filter(`JoinWebUrl eq '${escapedJoinUrl}'`)
      .select('id')
      .get()
    const onlineMeetingId = lookup.value?.[0]?.id
    if (!onlineMeetingId) return { ok: false, reason: 'meeting_not_found' }

    const transcripts = await client
      .api(`/me/onlineMeetings/${onlineMeetingId}/transcripts`)
      .get()

    if (!transcripts.value?.length) return { ok: false, reason: 'transcript_not_found' }

    const latestTranscript = [...transcripts.value].sort(
      (a, b) =>
        new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime()
    )[0]
    const transcriptId = latestTranscript?.id
    if (!transcriptId) return { ok: false, reason: 'transcript_not_found' }

    const content = await client
      .api(`/me/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content`)
      .responseType('text' as never)
      .get()

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
      return { ok: false, reason: 'permission_denied', detail: getErrorMessage(error) }
    }

    if (isReauthError(error)) {
      return { ok: false, reason: 'reauth_required', detail: getErrorMessage(error) }
    }

    return { ok: false, reason: 'graph_error', detail: getErrorMessage(error) }
  }
}
