import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent } from '@/lib/azure-openai'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'

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
  } catch {
    return null
  }
}

async function fetchTranscriptForMeeting(
  organizerGuid: string,
  joinUrl: string
): Promise<{ transcript: string | null; error?: string }> {
  const token = await getAppToken()
  if (!token) return { transcript: null, error: 'Token applicatif introuvable — vérifiez AZURE_AD_CLIENT_ID/SECRET' }

  const client = Client.init({ authProvider: (done) => done(null, token) })

  try {
    // Étape 1 : retrouver l'ID de la réunion en ligne depuis le lien
    const escaped = joinUrl.replace(/'/g, "''")
    let meetingsResult: { value?: Array<{ id: string }> }
    try {
      meetingsResult = await client
        .api(`/users/${organizerGuid}/onlineMeetings`)
        .filter(`joinWebUrl eq '${escaped}'`)
        .get()
    } catch (e) {
      const err = e as Record<string, unknown>
      const msg = (err?.message as string) || (err?.body as string) || JSON.stringify(e)
      console.error('[retranscribe] erreur recherche réunion:', e)
      return { transcript: null, error: `Erreur recherche réunion : ${msg}` }
    }

    const onlineMeeting = meetingsResult.value?.[0] as { id: string; organizer?: { upn?: string; identity?: { user?: { displayName?: string } } } } | undefined
    const onlineMeetingId = onlineMeeting?.id
    if (!onlineMeetingId) {
      return { transcript: null, error: `Réunion introuvable pour ce lien (joinWebUrl filter). joinUrl = ${joinUrl.substring(0, 80)}…` }
    }

    // Log organizer to detect cross-tenant meetings
    const meetingOrganizerUpn = onlineMeeting?.organizer?.upn ?? 'inconnu'
    console.log(`[retranscribe] online meeting organizer UPN: ${meetingOrganizerUpn}, our guid: ${organizerGuid}`)

    // Étape 2 : lister les transcriptions
    let transcriptsResult: { value?: Array<{ id: string }> }
    try {
      transcriptsResult = await client
        .api(`/users/${organizerGuid}/onlineMeetings/${onlineMeetingId}/transcripts`)
        .get()
    } catch (e) {
      // Extract detailed Graph error info
      const graphErr = e as Record<string, unknown>
      const body = graphErr?.body ? JSON.parse(graphErr.body as string) : null
      const code = body?.error?.code ?? graphErr?.code ?? 'unknown'
      const detail = body?.error?.message ?? (e as Error).message ?? String(e)
      console.error('[retranscribe] transcripts error:', JSON.stringify({ code, detail, organizerGuid, onlineMeetingId, meetingOrganizerUpn }))
      return { transcript: null, error: `Erreur récupération transcriptions : ${code} — ${detail} (organisateur réunion: ${meetingOrganizerUpn})` }
    }

    if (!transcriptsResult.value?.length) {
      return { transcript: null, error: 'Aucune transcription trouvée — la transcription était-elle démarrée dans Teams ?' }
    }

    // Étape 3 : télécharger le contenu VTT
    const transcriptId = transcriptsResult.value[0].id
    const vttResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${organizerGuid}/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'text/vtt' } }
    )
    if (!vttResponse.ok) {
      return { transcript: null, error: `Erreur téléchargement VTT : HTTP ${vttResponse.status}` }
    }
    const vttContent = await vttResponse.text()

    const lines: string[] = []
    for (const block of vttContent.split('\n\n')) {
      const match = block.match(/<v ([^>]+)>([\s\S]+)/)
      if (match) {
        const text = match[2].replace(/<[^>]+>/g, '').trim()
        if (text) lines.push(`[${match[1].trim()}] ${text}`)
      }
    }
    const transcript = lines.join('\n') || null
    if (!transcript) return { transcript: null, error: 'Transcription vide après parsing VTT' }
    return { transcript }
  } catch (err) {
    console.error('[retranscribe]', err)
    return { transcript: null, error: (err as Error).message ?? String(err) }
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      OR: [
        { organizerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    include: {
      participants: true,
      organizer: { select: { microsoftId: true } },
    },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  if (!existingMinutes)
    return NextResponse.json({ error: 'Aucun compte rendu à mettre à jour' }, { status: 400 })

  if (!meeting.organizer.microsoftId) {
    return NextResponse.json({ error: 'GUID Azure AD de l\'organisateur manquant — reconnectez-vous pour le mettre à jour' }, { status: 422 })
  }
  if (!meeting.joinUrl) {
    return NextResponse.json({ error: 'Lien de réunion manquant en base' }, { status: 422 })
  }

  const { transcript, error: transcriptError } = await fetchTranscriptForMeeting(
    meeting.organizer.microsoftId,
    meeting.joinUrl
  )

  if (!transcript) {
    console.error('[retranscribe] échec:', transcriptError)
    return NextResponse.json({ error: transcriptError ?? 'Transcription indisponible' }, { status: 422 })
  }

  const content = await generateMinutesContent(meeting.subject, transcript)

  await prisma.meetingMinutes.update({
    where: { meetingId },
    data: { content: content as unknown as import('@prisma/client').Prisma.InputJsonValue },
  })

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: true },
  })

  return NextResponse.json({ ok: true, minutesId: existingMinutes.id })
}
