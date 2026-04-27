import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAttendanceLookup } from '@/lib/microsoft-graph'
import { createSkeletonContent } from '@/lib/claude-generator'
import { getAttendanceWarning } from '@/lib/attendance-warning'
import { toPrismaJson } from '@/lib/minutes-persist'
import { rateLimit } from '@/lib/rate-limit'
import { inngest } from '@/inngest/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params
  const userId = session.user.id

  // Cap : 10 générations par utilisateur / 5 min — protège contre le spam
  // (le job réel est ensuite cappé par la concurrency Inngest).
  const rl = rateLimit({ name: 'generate-pv', key: userId, limit: 10, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Trop de générations en peu de temps', retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      OR: [
        { organizerId: userId },
        { collaborators: { some: { userId } } },
      ],
    },
    include: { participants: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })

  // Squelette immédiat — la génération réelle tourne via Inngest (retry, observabilité,
  // pas de timeout lambda).
  const skeleton = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
  const skeletonWithFlag = toPrismaJson({
    ...(skeleton as object),
    _generating: true,
    _generatingStartedAt: new Date().toISOString(),
  })

  const savedMinutes = existingMinutes
    ? await prisma.meetingMinutes.update({
        where: { meetingId },
        data: { content: skeletonWithFlag, isGenerating: true },
      })
    : await prisma.meetingMinutes.create({
        data: {
          meetingId,
          authorId: userId,
          templateId: defaultTemplate?.id ?? null,
          content: skeletonWithFlag,
          isGenerating: true,
          status: 'DRAFT',
        },
      })

  // Attendance lookup en synchrone : c'est rapide (1 appel Graph) et ça permet
  // d'avertir tout de suite l'utilisateur si le scope manque.
  const attendanceLookup = await getAttendanceLookup(userId, meeting.joinUrl)
  const attendanceWarning = getAttendanceWarning(attendanceLookup)

  await inngest.send({
    name: 'pv/generate.requested',
    data: { meetingId, userId, source: 'manual' },
  })

  return NextResponse.json({
    ...savedMinutes,
    content: skeletonWithFlag,
    generating: true,
    attendanceWarning,
  })
}
