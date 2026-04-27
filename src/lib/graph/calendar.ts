// Calendrier Outlook : récupération des réunions en ligne pour un utilisateur.

import { logger } from '@/lib/logger'
import { getValidAccessToken, graphClient } from './auth'
import type { GraphMeeting } from '@/types'

const log = logger.child({ module: 'graph/calendar' })

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
// On ajoute 'Z' pour forcer l'interprétation UTC, conforme au champ timeZone:"UTC".
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
    log.error({ scope: 'getRecentMeetings', err: error }, 'failed to fetch meetings')
    return []
  }
}

export async function getMeetingsEndedInLastHours(
  userId: string,
  hours = 2,
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
    log.error({ scope: 'getMeetingsEndedInLastHours', err: error }, 'failed')
    return []
  }
}
