import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { TypeProcedure } from '@prisma/client'

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

  const { reference, denomination, typeProcedure } = await req.json() as {
    reference: string
    denomination: string
    typeProcedure: TypeProcedure
  }

  if (!reference?.trim() || !denomination?.trim() || !typeProcedure) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  const existing = await prisma.dossier.findUnique({ where: { reference: reference.trim() } })
  if (existing) {
    return NextResponse.json({ error: 'Cette référence existe déjà' }, { status: 409 })
  }

  const dossier = await prisma.dossier.create({
    data: {
      reference: reference.trim(),
      denomination: denomination.trim(),
      typeProcedure,
      createdById: session.user.id,
    },
  })

  // Auto-associe les réunions existantes dont le sujet contient la dénomination
  const denominationLower = denomination.trim().toLowerCase()
  const matchingMeetings = await prisma.meeting.findMany({
    where: { dossierId: null },
    select: { id: true, subject: true },
  })
  const toLink = matchingMeetings.filter((m) =>
    m.subject.toLowerCase().includes(denominationLower)
  )
  if (toLink.length > 0) {
    await prisma.meeting.updateMany({
      where: { id: { in: toLink.map((m) => m.id) } },
      data: { dossierId: dossier.id },
    })
  }

  return NextResponse.json({ ...dossier, linkedMeetings: toLink.length }, { status: 201 })
}
