import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTranscription } from '@/lib/microsoft-graph'
import { generateMinutesContent } from '@/lib/azure-openai'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      OR: [
        { organizerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    include: { participants: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({
    where: { meetingId },
  })
  if (existingMinutes) return NextResponse.json(existingMinutes)

  const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })

  // Transcription fetched in memory only — never persisted
  const transcription = await getTranscription(session.user.id, meeting.joinUrl)

  const content = await generateMinutesContent(meeting.subject, transcription)

  const minutes = await prisma.meetingMinutes.create({
    data: {
      meetingId,
      authorId: session.user.id,
      templateId: defaultTemplate?.id ?? null,
      content: content as unknown as import('@prisma/client').Prisma.InputJsonValue,
      status: 'DRAFT',
    },
  })

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: !!transcription, processedAt: new Date() },
  })

  return NextResponse.json(minutes)
}
