import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentMeetings } from '@/lib/microsoft-graph'
import { refreshMeetingsTranscriptionMetadata } from '@/lib/meeting-transcription-sync'
import { syncUserMeetings } from '@/lib/meeting-sync'
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
    const userId = session.user.id

    // CHEMIN RAPIDE : on renvoie la liste depuis la BD en UNE requête. Tout le
    // sync coûteux (appel Graph + déduplication + rafraîchissement des
    // transcriptions) est déporté en arrière-plan via after() pour ne PAS
    // bloquer le chargement de la page. Les éventuelles nouvelles réunions
    // apparaissent au rafraîchissement suivant.
    const meetings = await prisma.meeting.findMany({
      where: {
        OR: [
          { organizerId: userId },
          { collaborators: { some: { userId } } },
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

    after(async () => {
      try {
        const graphMeetings = await getRecentMeetings(userId)

        // Dossiers actifs pour l'auto-association (dégradé si indisponible)
        let dossiers: Array<{ id: string; denomination: string }> = []
        try {
          dossiers = await prisma.dossier.findMany({
            where: { statut: { not: 'ARCHIVE' } },
            select: { id: true, denomination: true },
          })
        } catch {
          // table dossier indisponible — on continue sans auto-association
        }

        // Sync dédupliqué en lot (1 lecture dans le cas courant)
        await syncUserMeetings(graphMeetings, userId, dossiers)

        // Rattrapage des métadonnées de transcription pour les réunions terminées
        const now = new Date()
        const toCheck = await prisma.meeting.findMany({
          where: {
            joinUrl: { not: null },
            endDateTime: { lt: now },
            AND: [
              { OR: [{ organizerId: userId }, { collaborators: { some: { userId } } }] },
              { OR: [{ hasTranscription: false }, { durationMinutes: null }] },
            ],
          },
          select: { id: true, subject: true, joinUrl: true, hasTranscription: true, durationMinutes: true },
          orderBy: { endDateTime: 'desc' },
          take: 200,
        })
        if (toCheck.length > 0) {
          await refreshMeetingsTranscriptionMetadata(userId, toCheck, { concurrency: 5 })
        }
      } catch (err) {
        logger.warn({ err, scope: 'meetings/background-sync' }, 'background sync failed')
      }
    })

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
