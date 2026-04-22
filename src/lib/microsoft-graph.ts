import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma } from '@/lib/prisma'
import { MICROSOFT_GRAPH_SCOPES } from '@/lib/microsoft-scopes'
import type { GraphMeeting } from '@/types'

// ─── Token management ──────────────────────────────────────────────────────

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      microsoftAccessToken: true,
      microsoftRefreshToken: true,
      microsoftTokenExpiry: true,
    },
  })

  if (!user?.microsoftRefreshToken) return null

  if (user.microsoftAccessToken && user.microsoftTokenExpiry) {
    if (Date.now() < new Date(user.microsoftTokenExpiry).getTime() - 5 * 60 * 1000) {
      return user.microsoftAccessToken
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
    if (!result) return null

    await prisma.user.update({
      where: { id: userId },
      data: {
        microsoftAccessToken: result.accessToken,
        microsoftTokenExpiry: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
      },
    })
    return result.accessToken
  } catch (error) {
    console.error('[getValidAccessToken]', error)
    return null
  }
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
  if (!joinUrl) return null

  const token = await getValidAccessToken(userId)
  if (!token) return null

  try {
    const client = graphClient(token)
    const escapedJoinUrl = escapeODataString(joinUrl)

    // Resolve joinUrl → online meeting ID
    const lookup = await client
      .api('/me/onlineMeetings')
      .filter(`JoinWebUrl eq '${escapedJoinUrl}'`)
      .select('id')
      .get()
    const onlineMeetingId = lookup.value?.[0]?.id
    if (!onlineMeetingId) return null

    const transcripts = await client
      .api(`/me/onlineMeetings/${onlineMeetingId}/transcripts`)
      .get()

    if (!transcripts.value?.length) return null

    const latestTranscript = [...transcripts.value].sort(
      (a, b) =>
        new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime()
    )[0]
    const transcriptId = latestTranscript?.id
    if (!transcriptId) return null

    const content = await client
      .api(`/me/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content`)
      .responseType('text' as never)
      .get()

    if (typeof content !== 'string') return null

    // Parse VTT into readable text "[Speaker] text" lines
    const lines: string[] = []
    for (const block of content.split('\n\n')) {
      const match = block.match(/<v ([^>]+)>([\s\S]+)/)
      if (match) {
        const text = match[2].replace(/<[^>]+>/g, '').trim()
        if (text) lines.push(`[${match[1].trim()}] ${text}`)
      }
    }
    return lines.join('\n') || null
  } catch (error) {
    console.error('[getTranscription]', error)
    return null
  }
}
