/**
 * Watcher — surveille le calendrier Outlook et orchestre la génération de comptes rendus.
 *
 * Flux pour réunions Teams internes :
 *  1. syncCalendarMeetings : importe les réunions en ligne dans la DB toutes les 60 s
 *  2. processEndedMeetings : 10 min après la fin, récupère la transcription Graph API → génère
 *
 * Flux pour réunions externes (Teams externe, Zoom, Google Meet) :
 *  1. syncCalendarMeetings : détecte la plateforme + extrait le lien depuis le corps de l'événement
 *  2. scheduleAndRunBots   : 3 min avant le début, lance le bot navigateur Playwright
 *  3. Le bot capture l'audio → transcrit via Whisper → génère le compte rendu
 */

import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import type { MeetingPlatform } from '@prisma/client'
import { logger } from '@/lib/logger'
import { prisma, triggerGeneration, botStats } from './index'
import { joinMeeting } from './browser-bot'

const log = logger.child({ service: 'bot', component: 'watcher' })
const processingMeetings = new Set<string>()

// ─── Token applicatif (client credentials) ────────────────────────────────────

async function getAppToken(): Promise<string | null> {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
    },
  })
  try {
    const result = await cca.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
    return result?.accessToken ?? null
  } catch (err) {
    log.error({ err }, 'Erreur token applicatif')
    return null
  }
}

// ─── Token délégué ────────────────────────────────────────────────────────────

async function getUserToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      microsoftAccessToken: true,
      microsoftRefreshToken: true,
      microsoftTokenExpiry: true,
    },
  })

  if (!user?.microsoftRefreshToken) return null

  if (
    user.microsoftAccessToken &&
    user.microsoftTokenExpiry &&
    Date.now() < new Date(user.microsoftTokenExpiry).getTime() - 5 * 60 * 1000
  ) {
    return user.microsoftAccessToken
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
      scopes: ['User.Read', 'Calendars.Read'],
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

// ─── Parsing VTT → texte ──────────────────────────────────────────────────────

function parseVttTranscript(vtt: string): string {
  const lines: string[] = []
  for (const block of vtt.split('\n\n')) {
    const match = block.match(/<v ([^>]+)>([\s\S]+)/)
    if (match) {
      const speaker = match[1].trim()
      const text = match[2].replace(/<[^>]+>/g, '').trim()
      if (text) lines.push(`[${speaker}] ${text}`)
    }
  }
  return lines.join('\n')
}

// ─── Transcription via Graph API (réunions Teams internes) ───────────────────

async function fetchTranscript(
  organizerGuid: string,
  joinUrl: string
): Promise<string | null> {
  const token = await getAppToken()
  if (!token) {
    log.warn('Token applicatif indisponible')
    return null
  }

  const client = Client.init({ authProvider: (done) => done(null, token) })

  try {
    const escaped = joinUrl.replace(/'/g, "''")
    const meetingsResult = await client
      .api(`/users/${organizerGuid}/onlineMeetings`)
      .filter(`joinWebUrl eq '${escaped}'`)
      .get()

    const onlineMeetingId = meetingsResult.value?.[0]?.id as string | undefined
    if (!onlineMeetingId) return null

    const transcriptsResult = await client
      .api(`/users/${organizerGuid}/onlineMeetings/${onlineMeetingId}/transcripts`)
      .get()

    if (!transcriptsResult.value?.length) return null

    const transcriptId = transcriptsResult.value[0].id as string
    const vttContent = await fetch(
      `https://graph.microsoft.com/v1.0/users/${organizerGuid}/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/vtt',
        },
      }
    ).then((r) => r.text())

    const parsed = parseVttTranscript(vttContent)
    if (!parsed) return null

    log.info({ lines: parsed.split('\n').length }, 'Transcription Graph récupérée')
    return parsed
  } catch (err) {
    log.error({ err }, 'Erreur récupération transcription Graph')
    return null
  }
}

// ─── Détection de la plateforme ───────────────────────────────────────────────

function detectPlatform(joinUrl: string | undefined, bodyHtml: string): {
  platform: MeetingPlatform
  externalUrl: string | undefined
} {
  // Teams interne (même tenant)
  if (joinUrl?.includes('teams.microsoft.com') || joinUrl?.includes('teams.live.com')) {
    const tenantId = process.env.AZURE_AD_TENANT_ID ?? ''
    const isInternal = tenantId && joinUrl.includes(tenantId)
    return {
      platform: isInternal ? 'TEAMS_INTERNAL' : 'TEAMS_EXTERNAL',
      externalUrl: isInternal ? undefined : joinUrl,
    }
  }

  // Zoom — le lien est dans le corps de l'invitation
  const zoomMatch = bodyHtml.match(/https?:\/\/[\w.-]*zoom\.us\/j\/[\w?=&%-]+/)
  if (zoomMatch) {
    return { platform: 'ZOOM', externalUrl: zoomMatch[0] }
  }

  // Google Meet
  const meetMatch = bodyHtml.match(/https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)
  if (meetMatch) {
    return { platform: 'GOOGLE_MEET', externalUrl: meetMatch[0] }
  }

  // Autres liens de visio dans le corps
  const genericMatch = bodyHtml.match(/https?:\/\/[\w.-]+\/(j\/|join\/|meeting\/)[^\s"<]+/)
  if (genericMatch) {
    return { platform: 'OTHER', externalUrl: genericMatch[0] }
  }

  return { platform: 'TEAMS_INTERNAL', externalUrl: undefined }
}

// ─── Synchronisation du calendrier → DB ──────────────────────────────────────

interface CalendarEvent {
  id: string
  subject: string
  start: { dateTime: string }
  end: { dateTime: string }
  isOnlineMeeting: boolean
  onlineMeeting?: { joinUrl?: string }
  body?: { content: string; contentType: string }
}

function toUtc(dt: string): Date {
  return new Date(dt.endsWith('Z') ? dt : dt + 'Z')
}

// 3 minutes d'avance pour que le bot soit prêt avant le début
const BOT_LEAD_TIME_MS = 3 * 60 * 1000
const TRANSCRIPT_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000

async function syncCalendarMeetings(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { microsoftRefreshToken: { not: null } },
    select: { id: true },
  })

  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  for (const user of users) {
    const token = await getUserToken(user.id)
    if (!token) continue

    try {
      const client = Client.init({ authProvider: (done) => done(null, token) })
      const result = await client
        .api('/me/calendarView')
        .query({ startDateTime: windowStart.toISOString(), endDateTime: windowEnd.toISOString() })
        // Fetch body to detect Zoom/Meet links
        .select('id,subject,start,end,isOnlineMeeting,onlineMeeting,body')
        .top(50)
        .get()

      for (const ev of (result.value ?? []) as CalendarEvent[]) {
        const bodyHtml = ev.body?.content ?? ''
        const joinUrl = ev.onlineMeeting?.joinUrl

        // Skip events with no meeting link at all
        if (!joinUrl && !bodyHtml.includes('zoom.us') && !bodyHtml.includes('meet.google.com')) {
          continue
        }

        const { platform, externalUrl } = detectPlatform(joinUrl, bodyHtml)
        const startTime = toUtc(ev.start.dateTime)
        const botScheduledAt = new Date(startTime.getTime() - BOT_LEAD_TIME_MS)

        await prisma.meeting.upsert({
          where: { id: ev.id },
          // On future updates, preserve botStatus already set (avoid resetting an in-progress bot)
          update: {
            subject: ev.subject,
            startDateTime: startTime,
            endDateTime: toUtc(ev.end.dateTime),
            platform,
            externalUrl: externalUrl ?? null,
          },
          create: {
            id: ev.id,
            subject: ev.subject,
            startDateTime: startTime,
            endDateTime: toUtc(ev.end.dateTime),
            organizerId: user.id,
            joinUrl: joinUrl ?? null,
            platform,
            externalUrl: externalUrl ?? null,
            // Only schedule bot for external meetings
            botStatus: platform === 'TEAMS_INTERNAL' ? null : 'SCHEDULED',
            botScheduledAt: platform === 'TEAMS_INTERNAL' ? null : botScheduledAt,
          },
        })
      }
    } catch (err) {
      log.error({ err, userId: user.id }, 'Erreur sync calendrier')
    }
  }
}

// ─── Lancement des bots planifiés ────────────────────────────────────────────

async function scheduleAndRunBots(): Promise<void> {
  const now = new Date()

  const pendingMeetings = await prisma.meeting.findMany({
    where: {
      botStatus: 'SCHEDULED',
      botScheduledAt: { lte: now },
      // Don't retry meetings that already ended more than 30 min ago
      endDateTime: { gte: new Date(now.getTime() - 30 * 60 * 1000) },
      platform: { not: 'TEAMS_INTERNAL' },
    },
    include: { organizer: { select: { id: true } } },
  })

  for (const meeting of pendingMeetings) {
    if (processingMeetings.has(meeting.id)) continue
    processingMeetings.add(meeting.id)

    const meetingUrl = meeting.externalUrl ?? meeting.joinUrl
    if (!meetingUrl) {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'FAILED' },
      })
      processingMeetings.delete(meeting.id)
      continue
    }

    log.info({ meetingId: meeting.id, subject: meeting.subject, platform: meeting.platform }, 'Lancement bot navigateur')

    // Run in background — joinMeeting handles its own status updates and generation trigger
    joinMeeting({
      id: meeting.id,
      subject: meeting.subject,
      platform: meeting.platform,
      url: meetingUrl,
      endDateTime: meeting.endDateTime,
    }).catch((err) => {
      log.error({ err, meetingId: meeting.id }, 'Erreur joinMeeting')
      prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'FAILED' },
      }).catch(() => {})
    }).finally(() => {
      processingMeetings.delete(meeting.id)
    })
  }
}

// ─── Traitement des réunions Teams internes terminées ────────────────────────

async function processEndedMeetings(): Promise<void> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 10 * 60 * 1000)

  const meetings = await prisma.meeting.findMany({
    where: {
      platform: 'TEAMS_INTERNAL',
      endDateTime: { lte: cutoff },
      processedAt: null,
      joinUrl: { not: null },
    },
    include: {
      organizer: { select: { id: true, microsoftId: true } },
    },
  })

  for (const meeting of meetings) {
    if (processingMeetings.has(meeting.id)) continue
    processingMeetings.add(meeting.id)

    try {
      log.info({ meetingId: meeting.id, subject: meeting.subject }, 'Réunion Teams terminée — récupération transcription')

      const transcript =
        meeting.organizer.microsoftId && meeting.joinUrl
          ? await fetchTranscript(meeting.organizer.microsoftId, meeting.joinUrl)
          : null

      if (transcript) {
        await triggerGeneration(meeting.id, transcript)
        continue
      }

      const retryDeadline = new Date(meeting.endDateTime.getTime() + TRANSCRIPT_RETRY_WINDOW_MS)
      if (retryDeadline > now) {
        log.info(
          { meetingId: meeting.id, subject: meeting.subject, retryDeadline: retryDeadline.toISOString() },
          'Transcription indisponible — nouvelle tentative programmée',
        )
        continue
      }

      log.warn(
        { meetingId: meeting.id, subject: meeting.subject },
        'Transcription introuvable après attente — génération sans transcription',
      )
      await triggerGeneration(meeting.id, null)
    } finally {
      processingMeetings.delete(meeting.id)
    }
  }
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

export function startWatcher(): void {
  log.info('Watcher démarré — vérification toutes les 60 secondes')

  async function tick() {
    await syncCalendarMeetings()
    await scheduleAndRunBots()
    await processEndedMeetings()
  }

  // Recursive setTimeout instead of setInterval to avoid concurrent ticks
  // if a tick takes longer than 60 seconds (slow Graph API, many users, etc.)
  async function scheduleTick() {
    try {
      await tick()
      botStats.lastTickAt = new Date().toISOString()
      botStats.tickCount++
    } catch (err) {
      log.error({ err }, 'Erreur tick watcher')
      botStats.errorCount++
    }
    setTimeout(scheduleTick, 60_000)
  }

  scheduleTick()
}
