import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TemplateUpsertSchema } from '@/schemas/template.schema'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const templates = await prisma.template.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const parsed = TemplateUpsertSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const data = parsed.data

  // Si on crée un template par défaut, on retire le flag des autres dans la même transaction.
  const template = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.template.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }
    return tx.template.create({ data })
  })

  return NextResponse.json(template, { status: 201 })
}
