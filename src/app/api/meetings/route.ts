import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentMeetings } from '@/lib/microsoft-graph'

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

    // Charge tous les dossiers actifs pour l'auto-association
    const dossiers = await prisma.dossier.findMany({
      where: { statut: { not: 'ARCHIVE' } },
      select: { id: true, denomination: true },
    })

    for (const gm of graphMeetings) {
      const existing = await prisma.meeting.findUnique({ where: { id: gm.id } })
      if (!existing) {
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

        // Link firm members who attended
        const attendeeEmails = gm.attendees.map((a) => a.emailAddress.address.toLowerCase())
        const firmMembers = await prisma.user.findMany({
          where: { email: { in: attendeeEmails } },
          select: { id: true },
        })
        for (const member of firmMembers) {
          await prisma.meetingCollaborator.upsert({
            where: { meetingId_userId: { meetingId: gm.id, userId: member.id } },
            update: {},
            create: { meetingId: gm.id, userId: member.id },
          })
        }
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
        platform: true,
        botStatus: true,
        botScheduledAt: true,
        participants: { select: { name: true, email: true } },
        minutes: { select: { id: true, status: true } },
      },
      orderBy: { startDateTime: 'desc' },
      take: 30,
    })

    return NextResponse.json(meetings)
  } catch (error) {
    console.error('[meetings/GET]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
