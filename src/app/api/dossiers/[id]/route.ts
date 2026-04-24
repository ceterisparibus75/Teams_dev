import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTranscription } from '@/lib/microsoft-graph'
import { extractVttDurationMinutes } from '@/lib/utils'
import type { TypeProcedure, StatutDossier } from '@prisma/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const dossier = await prisma.dossier.findUnique({
    where: { id },
    include: {
      _count: { select: { meetings: true } },
      meetings: {
        orderBy: { startDateTime: 'desc' },
        select: {
          id: true,
          subject: true,
          startDateTime: true,
          endDateTime: true,
          durationMinutes: true,
          hasTranscription: true,
          joinUrl: true,
          minutes: { select: { id: true, status: true, content: true } },
        },
      },
    },
  })

  if (!dossier) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Backfill durationMinutes en arrière-plan pour les réunions avec transcription mais sans durée
  const userId = session.user.id
  const now = new Date()
  const toBackfill = dossier.meetings.filter((m) =>
    m.hasTranscription && m.durationMinutes === null && m.joinUrl && new Date(m.endDateTime) < now
  )
  if (toBackfill.length > 0) {
    after(async () => {
      await Promise.all(toBackfill.map(async (m) => {
        try {
          const transcription = await getTranscription(userId, m.joinUrl!, { subject: m.subject })
          const durationMinutes = transcription ? extractVttDurationMinutes(transcription) : null
          if (durationMinutes !== null) {
            await prisma.meeting.update({ where: { id: m.id }, data: { durationMinutes } })
          }
        } catch { /* silencieux */ }
      }))
    })
  }

  const meetings = dossier.meetings.map(({ joinUrl: _, ...m }) => {
    const content = m.minutes?.content as Record<string, unknown> | null
    const summary = typeof content?.summary === 'string' && content.summary.trim()
      ? content.summary.trim().slice(0, 250)
      : null
    return {
      ...m,
      minutes: m.minutes ? { id: m.minutes.id, status: m.minutes.status, summary } : null,
    }
  })

  return NextResponse.json({ ...dossier, meetings })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    reference?: string
    denomination?: string
    typeProcedure?: TypeProcedure
    statut?: StatutDossier
  }

  const existing = await prisma.dossier.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  if (body.reference && body.reference.trim() !== existing.reference) {
    const conflict = await prisma.dossier.findUnique({ where: { reference: body.reference.trim() } })
    if (conflict) return NextResponse.json({ error: 'Cette référence existe déjà' }, { status: 409 })
  }

  const updated = await prisma.dossier.update({
    where: { id },
    data: {
      ...(body.reference    && { reference: body.reference.trim() }),
      ...(body.denomination && { denomination: body.denomination.trim() }),
      ...(body.typeProcedure && { typeProcedure: body.typeProcedure }),
      ...(body.statut        && { statut: body.statut }),
    },
  })

  return NextResponse.json(updated)
}
