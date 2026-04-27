import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { refreshMeetingsTranscriptionMetadata } from '@/lib/meeting-transcription-sync'

const PatchSchema = z
  .object({
    reference: z.string().trim().min(1).max(100).optional(),
    denomination: z.string().trim().min(1).max(255).optional(),
    typeProcedure: z.enum(['MANDAT_AD_HOC', 'CONCILIATION', 'REDRESSEMENT_JUDICIAIRE', 'SAUVEGARDE']).optional(),
    statut: z.enum(['EN_COURS', 'CLOS', 'ARCHIVE']).optional(),
  })
  .strict()
  .refine(
    (b) => b.reference !== undefined || b.denomination !== undefined || b.typeProcedure !== undefined || b.statut !== undefined,
    { message: 'au moins un champ requis' },
  )

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

  // Backfill global de transcription/durée pour tout le dossier.
  const userId = session.user.id
  const now = new Date()
  const toBackfill = dossier.meetings.filter((m) =>
    m.joinUrl && new Date(m.endDateTime) < now && (!m.hasTranscription || m.durationMinutes === null)
  )
  if (toBackfill.length > 0) {
    after(async () => {
      await refreshMeetingsTranscriptionMetadata(userId, toBackfill, { concurrency: 5 })
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
  const rawBody = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const body = parsed.data

  const existing = await prisma.dossier.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  if (body.reference && body.reference !== existing.reference) {
    const conflict = await prisma.dossier.findUnique({ where: { reference: body.reference } })
    if (conflict) return NextResponse.json({ error: 'Cette référence existe déjà' }, { status: 409 })
  }

  const updated = await prisma.dossier.update({
    where: { id },
    data: {
      ...(body.reference !== undefined && { reference: body.reference }),
      ...(body.denomination !== undefined && { denomination: body.denomination }),
      ...(body.typeProcedure !== undefined && { typeProcedure: body.typeProcedure }),
      ...(body.statut !== undefined && { statut: body.statut }),
    },
  })

  return NextResponse.json(updated)
}
