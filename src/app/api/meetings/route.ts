import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentMeetings } from '@/lib/microsoft-graph'
import { refreshMeetingsTranscriptionMetadata } from '@/lib/meeting-transcription-sync'
import { resolveOrCreateMeeting } from '@/lib/meeting-sync'
import { logger } from '@/lib/logger'

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

    // Résolution / création dédupliquée : la même réunion synchronisée par
    // plusieurs membres de l'étude pointe vers UNE seule ligne canonique (clé
    // stable joinUrl+début). resolveOrCreateMeeting rattache l'utilisateur
    // courant et donne l'accès aux membres @bl-aj.fr invités.
    for (const gm of graphMeetings) {
      const subjectLower = gm.subject.toLowerCase()
      const matchedDossier = dossiers.find((d) => subjectLower.includes(d.denomination.toLowerCase()))
      await resolveOrCreateMeeting(gm, session.user.id, { dossierId: matchedDossier?.id ?? null })
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

    // Vérification globale des transcriptions en arrière-plan.
    // On ne se limite plus aux 3 premières réunions affichées : on rattrape
    // tout l'historique visible de l'utilisateur pour auto-corriger les faux
    // "Sans transcription" laissés par d'anciens échecs Graph.
    const now = new Date()
    const userId = session.user.id
    const toCheck = await prisma.meeting.findMany({
      where: {
        joinUrl: { not: null },
        endDateTime: { lt: now },
        AND: [
          {
            OR: [
              { organizerId: userId },
              { collaborators: { some: { userId } } },
            ],
          },
          {
            OR: [
              { hasTranscription: false },
              { durationMinutes: null },
            ],
          },
        ],
      },
      select: {
        id: true,
        subject: true,
        joinUrl: true,
        hasTranscription: true,
        durationMinutes: true,
      },
      orderBy: { endDateTime: 'desc' },
      take: 200,
    })

    if (toCheck.length > 0) {
      after(async () => {
        await refreshMeetingsTranscriptionMetadata(userId, toCheck, { concurrency: 5 })
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
    logger.error({ err: error, scope: 'meetings/GET' }, 'GET failed')
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
