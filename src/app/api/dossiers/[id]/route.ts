import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
          hasTranscription: true,
          minutes: { select: { id: true, status: true } },
        },
      },
    },
  })

  if (!dossier) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(dossier)
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
