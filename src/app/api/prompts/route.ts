import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const BodySchema = z
  .object({
    nom: z.string().trim().min(1).max(200),
    contenu: z.string().trim().min(1).max(50_000),
    typeDocument: z.string().trim().min(1).max(50).optional(),
    // Verrouille sur les modèles Anthropic uniquement.
    modeleClaude: z.string().regex(/^claude-[a-z0-9.-]+$/i).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

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

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { nom, contenu, typeDocument, modeleClaude, isActive } = parsed.data

  const prompt = await prisma.prompt.create({
    data: {
      nom,
      typeDocument: typeDocument ?? 'pv_reunion',
      contenu,
      modeleClaude: modeleClaude ?? 'claude-opus-4-7',
      isActive: isActive !== false,
      createdById: session.user.id,
    },
  })
  return NextResponse.json(prompt, { status: 201 })
}
