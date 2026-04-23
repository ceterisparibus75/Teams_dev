import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const templates = await prisma.template.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { name, isDefault, isActive, ...rest } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Nom requis' }, { status: 400 })

  if (isDefault) {
    await prisma.template.updateMany({ data: { isDefault: false } })
  }

  const template = await prisma.template.create({
    data: { name: name.trim(), isDefault: !!isDefault, isActive: isActive !== false, ...rest },
  })
  return NextResponse.json(template, { status: 201 })
}
