import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const prompt = await prisma.prompt.findUnique({ where: { id } })
  if (!prompt) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(prompt)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    nom?: string
    contenu?: string
    modeleClaude?: string
    isActive?: boolean
  }

  const existing = await prisma.prompt.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const updated = await prisma.prompt.update({
    where: { id },
    data: {
      ...(body.nom        !== undefined && { nom: body.nom.trim() }),
      ...(body.contenu    !== undefined && { contenu: body.contenu.trim() }),
      ...(body.modeleClaude !== undefined && { modeleClaude: body.modeleClaude }),
      ...(body.isActive   !== undefined && { isActive: body.isActive }),
      version: { increment: 1 },
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  await prisma.prompt.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
