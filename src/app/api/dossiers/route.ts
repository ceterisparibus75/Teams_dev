import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const BodySchema = z.object({
  reference: z.string().trim().min(1).max(100),
  denomination: z.string().trim().min(1).max(255),
  typeProcedure: z.enum(['MANDAT_AD_HOC', 'CONCILIATION', 'REDRESSEMENT_JUDICIAIRE', 'SAUVEGARDE']),
}).strict()

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const dossiers = await prisma.dossier.findMany({
    orderBy: [{ statut: 'asc' }, { createdAt: 'desc' }],
    include: {
      _count: {
        select: {
          meetings: true,
        },
      },
      meetings: {
        select: { minutes: { select: { id: true, status: true } } },
      },
    },
  })

  return NextResponse.json(dossiers)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const rawBody = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { reference, denomination, typeProcedure } = parsed.data

  const existing = await prisma.dossier.findUnique({ where: { reference } })
  if (existing) {
    return NextResponse.json({ error: 'Cette référence existe déjà' }, { status: 409 })
  }

  // Transaction : la création du dossier et l'auto-link sont atomiques.
  // Sinon, en cas d'échec de updateMany, on garde un dossier sans réunion liée.
  const denominationLower = denomination.toLowerCase()
  const { dossier, linkedMeetings } = await prisma.$transaction(async (tx) => {
    const dossier = await tx.dossier.create({
      data: { reference, denomination, typeProcedure, createdById: session.user.id },
    })

    const matchingMeetings = await tx.meeting.findMany({
      where: { dossierId: null },
      select: { id: true, subject: true },
    })
    const toLink = matchingMeetings.filter((m) => m.subject.toLowerCase().includes(denominationLower))
    if (toLink.length > 0) {
      await tx.meeting.updateMany({
        where: { id: { in: toLink.map((m) => m.id) } },
        data: { dossierId: dossier.id },
      })
    }
    return { dossier, linkedMeetings: toLink.length }
  })

  return NextResponse.json({ ...dossier, linkedMeetings }, { status: 201 })
}
