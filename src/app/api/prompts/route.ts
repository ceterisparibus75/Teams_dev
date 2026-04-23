import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const prompts = await prisma.prompt.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    include: { _count: { select: { minutes: true } } },
  })
  return NextResponse.json(prompts)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { nom, typeDocument, contenu, modeleClaude, isActive } = await req.json() as {
    nom: string
    typeDocument?: string
    contenu: string
    modeleClaude?: string
    isActive?: boolean
  }

  if (!nom?.trim() || !contenu?.trim()) {
    return NextResponse.json({ error: 'Nom et contenu obligatoires' }, { status: 400 })
  }

  const prompt = await prisma.prompt.create({
    data: {
      nom: nom.trim(),
      typeDocument: typeDocument ?? 'pv_reunion',
      contenu: contenu.trim(),
      modeleClaude: modeleClaude ?? 'claude-opus-4-7',
      isActive: isActive !== false,
      createdById: session.user.id,
    },
  })
  return NextResponse.json(prompt, { status: 201 })
}
