import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const limitParam = searchParams.get('limit')
  const cursor = searchParams.get('cursor')

  // Mode rétrocompatible : aucun paramètre de pagination → tableau direct, limite 100
  const isPaginated = limitParam !== null || cursor !== null

  const limit = Math.min(parseInt(limitParam ?? '50', 10) || 50, 100)

  try {
    const where = {
      meeting: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    }

    const include = {
      meeting: { include: { participants: true } },
      template: { select: { name: true } },
      author: { select: { name: true } },
    }

    if (!isPaginated) {
      // Comportement original : retourne un tableau direct avec limite de sécurité à 100
      const minutes = await prisma.meetingMinutes.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return NextResponse.json(minutes)
    }

    // Mode paginé : cursor-based pagination
    const items = await prisma.meetingMinutes.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasNextPage = items.length > limit
    const minutes = hasNextPage ? items.slice(0, limit) : items
    const nextCursor = hasNextPage ? items[limit].id : null

    return NextResponse.json({ minutes, nextCursor })
  } catch (error) {
    logger.error({ err: error, scope: 'minutes/GET' }, 'GET failed')
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
