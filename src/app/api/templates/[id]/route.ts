import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TemplateUpsertSchema } from '@/schemas/template.schema'

// PATCH accepte un objet partiel : on rend tous les champs optionnels.
const PatchSchema = TemplateUpsertSchema.partial().strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }

  const template = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.template.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      })
    }
    return tx.template.update({ where: { id }, data: parsed.data })
  })
  return NextResponse.json(template)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
