import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const PatchSchema = z
  .object({
    nom: z.string().trim().min(1).max(200).optional(),
    contenu: z.string().trim().min(1).max(50_000).optional(),
    modeleClaude: z.string().regex(/^claude-[a-z0-9.-]+$/i).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'au moins un champ requis' })

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
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const body = parsed.data

  const existing = await prisma.prompt.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const updated = await prisma.prompt.update({
    where: { id },
    data: {
      ...(body.nom !== undefined && { nom: body.nom }),
      ...(body.contenu !== undefined && { contenu: body.contenu }),
      ...(body.modeleClaude !== undefined && { modeleClaude: body.modeleClaude }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
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
