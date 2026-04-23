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
  const minutes = await prisma.meetingMinutes.findFirst({
    where: {
      id,
      meeting: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    },
    include: {
      meeting: { include: { participants: true } },
      template: true,
      author: { select: { name: true } },
    },
  })

  if (!minutes) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const generating = (minutes.content as Record<string, unknown>)?._generating === true
  return NextResponse.json({ ...minutes, generating })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const { content, status } = await req.json()

  try {
    const updated = await prisma.meetingMinutes.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(status !== undefined && { status }),
        ...(status === 'VALIDATED' && {
          validatedById: session.user.id,
          validatedAt: new Date(),
        }),
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[minutes/PATCH]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
