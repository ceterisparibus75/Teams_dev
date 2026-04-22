import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma } from '@/lib/prisma'
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
      scopes: ['User.Read', 'OnlineMeetings.Read', 'Calendars.Read', 'Mail.Send'],
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
  } catch {
    return null
  }
}

function graphClient(accessToken: string): Client {
  return Client.init({ authProvider: (done) => done(null, accessToken) })
}

// ─── Meetings ──────────────────────────────────────────────────────────────

export async function getRecentMeetings(userId: string): Promise<GraphMeeting[]> {
  const token = await getValidAccessToken(userId)
  if (!token) return []

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  try {
    const client = graphClient(token)
    const result = await client
      .api('/me/onlineMeetings')
      .filter(`startDateTime ge ${sevenDaysAgo.toISOString()} and endDateTime le ${now.toISOString()}`)
      .select('id,subject,startDateTime,endDateTime,organizer,attendees')
      .get()
    return result.value ?? []
  } catch {
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
      .api('/me/onlineMeetings')
      .filter(`endDateTime ge ${since.toISOString()} and endDateTime le ${now.toISOString()}`)
      .select('id,subject,startDateTime,endDateTime,organizer,attendees')
      .get()
    return result.value ?? []
  } catch {
    return []
  }
}

// ─── Transcriptions ────────────────────────────────────────────────────────

export async function getTranscription(
  userId: string,
  meetingId: string
): Promise<string | null> {
  const token = await getValidAccessToken(userId)
  if (!token) return null

  try {
    const client = graphClient(token)
    const transcripts = await client
      .api(`/me/onlineMeetings/${meetingId}/transcripts`)
      .get()

    if (!transcripts.value?.length) return null

    const transcriptId = transcripts.value[0].id
    const content = await client
      .api(`/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`)
      .responseType('text' as never)
      .get()

    return typeof content === 'string' ? content : null
  } catch {
    return null
  }
}
