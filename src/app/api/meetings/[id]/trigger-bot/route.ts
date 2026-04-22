import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/meetings/[id]/trigger-bot
// Déclenche immédiatement le bot pour une réunion externe.
// Le watcher le prendra en charge au prochain tick (≤ 60 s).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params

  const meeting = await prisma.meeting.findFirst({
    where: {
      id,
      OR: [
        { organizerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
      platform: { not: 'TEAMS_INTERNAL' },
    },
    select: { id: true, botStatus: true },
  })

  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  // Allow re-triggering only if not currently running
  if (meeting.botStatus === 'JOINING' || meeting.botStatus === 'IN_MEETING' || meeting.botStatus === 'PROCESSING') {
    return NextResponse.json({ error: 'Le bot est déjà en cours' }, { status: 409 })
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      botStatus: 'SCHEDULED',
      botScheduledAt: new Date(), // join now
    },
  })

  return NextResponse.json({ ok: true })
}
