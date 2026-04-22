import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  try {
    const minutes = await prisma.meetingMinutes.findMany({
      where: {
        meeting: {
          OR: [
            { organizerId: session.user.id },
            { collaborators: { some: { userId: session.user.id } } },
          ],
        },
      },
      include: {
        meeting: { include: { participants: true } },
        template: { select: { name: true } },
        author: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(minutes)
  } catch (error) {
    console.error('[minutes/GET]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
