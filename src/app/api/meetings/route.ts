import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentMeetings, getTranscription } from '@/lib/microsoft-graph'
import { extractVttDurationMinutes } from '@/lib/utils'

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

    // Récupère tous les IDs existants en une seule requête
    const existingIds = new Set(
      (await prisma.meeting.findMany({
        where: { id: { in: graphMeetings.map((m) => m.id) } },
        select: { id: true },
      })).map((m) => m.id)
    )

    // Traitement des nouvelles réunions avec batch unique pour les membres du cabinet
    const newGraphMeetings = graphMeetings.filter((gm) => !existingIds.has(gm.id))

    if (newGraphMeetings.length > 0) {
      const allEmails = [...new Set(
        newGraphMeetings.flatMap((gm) => gm.attendees.map((a) => a.emailAddress.address.toLowerCase()))
      )]
      const firmMembers = allEmails.length > 0
        ? await prisma.user.findMany({ where: { email: { in: allEmails } }, select: { id: true, email: true } })
        : []
      const emailToUserId = new Map(firmMembers.map((m) => [m.email.toLowerCase(), m.id]))

      for (const gm of newGraphMeetings) {
        const subjectLower = gm.subject.toLowerCase()
        const matchedDossier = dossiers.find((d) => subjectLower.includes(d.denomination.toLowerCase()))

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

        const firmMemberIds = gm.attendees
          .map((a) => emailToUserId.get(a.emailAddress.address.toLowerCase()))
          .filter((id): id is string => id !== undefined)
        if (firmMemberIds.length > 0) {
          await prisma.meetingCollaborator.createMany({
            data: firmMemberIds.map((userId) => ({ meetingId: gm.id, userId })),
            skipDuplicates: true,
          })
        }
      }
    }

    // Réunions visibles par cet utilisateur (organisateur OU collaborateur)
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
        durationMinutes: true,
        joinUrl: true,
        platform: true,
        botStatus: true,
        botScheduledAt: true,
        participants: { select: { name: true, email: true } },
        minutes: { select: { id: true, status: true, isGenerating: true, updatedAt: true } },
      },
      orderBy: { startDateTime: 'desc' },
      take: 30,
    })

    // Vérification transcriptions + backfill durationMinutes — en arrière-plan (non bloquant)
    // Cible : réunions terminées sans transcription détectée, OU avec transcription mais sans durée stockée
    const now = new Date()
    const userId = session.user.id
    const toCheck = meetings
      .filter((m) => m.joinUrl && new Date(m.endDateTime) < now && (
        !m.hasTranscription || m.durationMinutes === null
      ))
      .slice(0, 3)

    if (toCheck.length > 0) {
      after(async () => {
        await Promise.all(
          toCheck.map(async (m) => {
            try {
              const transcription = await getTranscription(userId, m.joinUrl!, { subject: m.subject })
              if (transcription) {
                const durationMinutes = extractVttDurationMinutes(transcription)
                await prisma.meeting.update({
                  where: { id: m.id },
                  data: {
                    hasTranscription: true,
                    ...(durationMinutes !== null && { durationMinutes }),
                  },
                })
              }
            } catch {
              // Silencieux — pas de transcription ou erreur Graph
            }
          })
        )
      })
    }

    // Réponse immédiate — joinUrl et durationMinutes non nécessaires côté client dashboard
    return NextResponse.json(
      meetings.map(({ joinUrl: _joinUrl, durationMinutes: _dm, ...m }) => ({
        ...m,
        minutes: m.minutes ? {
          id: m.minutes.id,
          status: m.minutes.status,
          generating: m.minutes.isGenerating &&
            (Date.now() - new Date(m.minutes.updatedAt).getTime()) < 15 * 60 * 1000,
        } : null,
      }))
    )
  } catch (error) {
    console.error('[meetings/GET]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
