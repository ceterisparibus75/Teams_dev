import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentMeetings, getTranscription } from '@/lib/microsoft-graph'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // Mode spécial : réunions sans dossier (pour l'association manuelle)
  if (req.nextUrl.searchParams.get('unlinked') === '1') {
    const meetings = await prisma.meeting.findMany({
      where: {
        dossierId: null,
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
      select: { id: true, subject: true, startDateTime: true },
      orderBy: { startDateTime: 'desc' },
      take: 50,
    })
    return NextResponse.json(meetings)
  }

  try {
    const graphMeetings = await getRecentMeetings(session.user.id)

    // Charge tous les dossiers actifs pour l'auto-association (dégradé si indisponible)
    let dossiers: Array<{ id: string; denomination: string }> = []
    try {
      dossiers = await prisma.dossier.findMany({
        where: { statut: { not: 'ARCHIVE' } },
        select: { id: true, denomination: true },
      })
    } catch {
      // La table dossier n'est pas encore disponible — on continue sans auto-association
    }

    // Récupère tous les IDs existants en une seule requête (évite N+1)
    const existingIds = new Set(
      (await prisma.meeting.findMany({
        where: { id: { in: graphMeetings.map((m) => m.id) } },
        select: { id: true },
      })).map((m) => m.id)
    )

    for (const gm of graphMeetings) {
      if (existingIds.has(gm.id)) continue

      // Cherche un dossier dont la dénomination apparaît dans le sujet de la réunion
      const subjectLower = gm.subject.toLowerCase()
      const matchedDossier = dossiers.find((d) =>
        subjectLower.includes(d.denomination.toLowerCase())
      )

      await prisma.meeting.create({
        data: {
          id: gm.id,
          subject: gm.subject,
          startDateTime: new Date(gm.startDateTime),
          endDateTime: new Date(gm.endDateTime),
          organizerId: session.user.id,
          joinUrl: gm.joinUrl ?? null,
          dossierId: matchedDossier?.id ?? null,
          participants: {
            create: gm.attendees.map((a) => ({
              name: a.emailAddress.name,
              email: a.emailAddress.address,
            })),
          },
        },
      })

      // Link firm members who attended (batch au lieu de N upserts séquentiels)
      const attendeeEmails = gm.attendees.map((a) => a.emailAddress.address.toLowerCase())
      const firmMembers = await prisma.user.findMany({
        where: { email: { in: attendeeEmails } },
        select: { id: true },
      })
      if (firmMembers.length > 0) {
        await prisma.meetingCollaborator.createMany({
          data: firmMembers.map((m) => ({ meetingId: gm.id, userId: m.id })),
          skipDuplicates: true,
        })
      }
    }

    // Return meetings visible to this user (organizer OR collaborator)
    const meetings = await prisma.meeting.findMany({
      where: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
      select: {
        id: true,
        subject: true,
        startDateTime: true,
        endDateTime: true,
        hasTranscription: true,
        joinUrl: true,
        platform: true,
        botStatus: true,
        botScheduledAt: true,
        participants: { select: { name: true, email: true } },
        minutes: { select: { id: true, status: true, isGenerating: true } },
      },
      orderBy: { startDateTime: 'desc' },
      take: 30,
    })

    // Vérifier les transcriptions disponibles pour les réunions terminées sans flag
    const now = new Date()
    const toCheck = meetings
      .filter((m) => !m.hasTranscription && m.joinUrl && new Date(m.endDateTime) < now)
      .slice(0, 5)

    const updatedIds = new Set<string>()
    if (toCheck.length > 0) {
      await Promise.all(
        toCheck.map(async (m) => {
          try {
            const transcription = await getTranscription(session.user.id, m.joinUrl!, {
              subject: m.subject,
            })
            if (transcription) {
              await prisma.meeting.update({
                where: { id: m.id },
                data: { hasTranscription: true },
              })
              updatedIds.add(m.id)
            }
          } catch {
            // Silencieux — pas de transcription disponible ou erreur Graph
          }
        })
      )
    }

    // Retourner sans joinUrl (non nécessaire côté client) + flags mis à jour
    return NextResponse.json(
      meetings.map(({ joinUrl: _joinUrl, ...m }) => ({
        ...m,
        hasTranscription: updatedIds.has(m.id) ? true : m.hasTranscription,
        minutes: m.minutes ? {
          id: m.minutes.id,
          status: m.minutes.status,
          generating: m.minutes.isGenerating,
        } : null,
      }))
    )
  } catch (error) {
    console.error('[meetings/GET]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
