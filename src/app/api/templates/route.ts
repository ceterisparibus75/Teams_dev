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

  const { name, sections, footerHtml, isDefault } = await req.json()

  if (isDefault) {
    await prisma.template.updateMany({ data: { isDefault: false } })
  }

  const template = await prisma.template.create({
    data: { name, sections, footerHtml, isDefault: !!isDefault },
  })
  return NextResponse.json(template)
}
