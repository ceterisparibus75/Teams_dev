/**
 * Watcher — surveille le calendrier Teams et récupère les transcriptions via Graph API.
 *
 * Flux :
 *  1. syncCalendarMeetings : importe les réunions en ligne dans la DB toutes les 60 s
 *  2. processEndedMeetings : pour chaque réunion terminée (≥ 10 min après fin),
 *     récupère la transcription via Graph API et déclenche la génération du compte rendu
 *
 * Permissions Azure AD requises (Application) :
 *   OnlineMeetings.Read.All        — lire les réunions en ligne
 *   OnlineMeetingTranscript.Read.All — lire les transcriptions
 */

import { Client } from '@microsoft/microsoft-graph-client'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { prisma, triggerGeneration } from './index'

// IDs des réunions en cours de traitement (dédoublonnage intra-session)
const processingMeetings = new Set<string>()

// ─── Token applicatif (client credentials) ───────────────────────────────────

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
    console.error('[bot] Erreur token applicatif:', err)
    return null
  }
}

// ─── Token délégué (pour sync calendrier) ────────────────────────────────────

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
    // Format Teams VTT : <v Prénom Nom>Texte du bloc
    const match = block.match(/<v ([^>]+)>([\s\S]+)/)
    if (match) {
      const speaker = match[1].trim()
      const text = match[2].replace(/<[^>]+>/g, '').trim()
      if (text) lines.push(`[${speaker}] ${text}`)
    }
  }
  return lines.join('\n')
}

// ─── Récupération de la transcription via Graph API ───────────────────────────

async function fetchTranscript(
  organizerGuid: string,
  joinUrl: string
): Promise<string | null> {
  const token = await getAppToken()
  if (!token) {
    console.warn('[bot] Token applicatif indisponible — vérifiez les permissions Azure AD')
    return null
  }

  const client = Client.init({ authProvider: (done) => done(null, token) })

  try {
    // 1. Récupérer l'ID de la réunion en ligne à partir du lien de participation
    const escaped = joinUrl.replace(/'/g, "''")
    const meetingsResult = await client
      .api(`/users/${organizerGuid}/onlineMeetings`)
      .filter(`joinWebUrl eq '${escaped}'`)
      .get()

    const onlineMeetingId = meetingsResult.value?.[0]?.id as string | undefined
    if (!onlineMeetingId) {
      console.log('[bot] Réunion en ligne introuvable via Graph API')
      return null
    }

    // 2. Lister les transcriptions disponibles
    const transcriptsResult = await client
      .api(`/users/${organizerGuid}/onlineMeetings/${onlineMeetingId}/transcripts`)
      .get()

    if (!transcriptsResult.value?.length) {
      console.log('[bot] Aucune transcription disponible (activer la transcription dans Teams)')
      return null
    }

    // 3. Télécharger le contenu VTT de la transcription la plus récente
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

    console.log(`[bot] Transcription récupérée : ${parsed.split('\n').length} lignes`)
    return parsed
  } catch (err) {
    console.error('[bot] Erreur récupération transcription Graph:', err)
    return null
  }
}

// ─── Synchronisation du calendrier → DB ──────────────────────────────────────

interface CalendarEvent {
  id: string
  subject: string
  start: { dateTime: string }
  end: { dateTime: string }
  isOnlineMeeting: boolean
  onlineMeeting?: { joinUrl?: string }
}

function toUtc(dt: string): Date {
  return new Date(dt.endsWith('Z') ? dt : dt + 'Z')
}

async function syncCalendarMeetings(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { microsoftRefreshToken: { not: null } },
    select: { id: true },
  })

  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000) // 24 h en arrière
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  for (const user of users) {
    const token = await getUserToken(user.id)
    if (!token) continue

    try {
      const client = Client.init({ authProvider: (done) => done(null, token) })
      const result = await client
        .api('/me/calendarView')
        .query({ startDateTime: windowStart.toISOString(), endDateTime: windowEnd.toISOString() })
        .select('id,subject,start,end,isOnlineMeeting,onlineMeeting')
        .top(50)
        .get()

      for (const ev of (result.value ?? []) as CalendarEvent[]) {
        if (!ev.isOnlineMeeting || !ev.onlineMeeting?.joinUrl) continue

        await prisma.meeting.upsert({
          where: { id: ev.id },
          update: {},
          create: {
            id: ev.id,
            subject: ev.subject,
            startDateTime: toUtc(ev.start.dateTime),
            endDateTime: toUtc(ev.end.dateTime),
            organizerId: user.id,
            joinUrl: ev.onlineMeeting.joinUrl,
          },
        })
      }
    } catch (err) {
      console.error('[bot] Erreur sync calendrier:', err)
    }
  }
}

// ─── Traitement des réunions terminées ────────────────────────────────────────

async function processEndedMeetings(): Promise<void> {
  const now = new Date()
  // Attendre 10 minutes après la fin pour que la transcription soit disponible
  const cutoff = new Date(now.getTime() - 10 * 60 * 1000)

  const meetings = await prisma.meeting.findMany({
    where: {
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

    console.log(`[bot] Réunion terminée : "${meeting.subject}" — récupération transcription…`)

    const transcript =
      meeting.organizer.microsoftId && meeting.joinUrl
        ? await fetchTranscript(meeting.organizer.microsoftId, meeting.joinUrl)
        : null

    await triggerGeneration(meeting.id, transcript)
  }
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

export function startWatcher(): void {
  console.log('[bot] Watcher démarré — vérification toutes les 60 secondes')

  async function tick() {
    await syncCalendarMeetings()
    await processEndedMeetings()
  }

  tick()
  setInterval(tick, 60_000)
}
