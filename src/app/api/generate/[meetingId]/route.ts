import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTranscription } from '@/lib/microsoft-graph'
import { generateMinutesContent, createSkeletonContent } from '@/lib/azure-openai'
import type { Prisma } from '@prisma/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params
  const userId = session.user.id

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
  const transcription = await getTranscription(userId, meeting.joinUrl, { subject: meeting.subject })

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: !!transcription, processedAt: new Date() },
  })

  if (!transcription) {
    // Pas de transcription — squelette immédiat, pas de tâche en arrière-plan
    const content = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
    if (existingMinutes) {
      await prisma.meetingMinutes.update({
        where: { meetingId },
        data: { content: content as unknown as Prisma.InputJsonValue },
      })
      return NextResponse.json({ ...existingMinutes, content })
    }
    const minutes = await prisma.meetingMinutes.create({
      data: {
        meetingId,
        authorId: userId,
        templateId: defaultTemplate?.id ?? null,
        content: content as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
      },
    })
    return NextResponse.json(minutes)
  }

  // Transcription disponible — sauvegarde du squelette avec flag _generating, Claude tourne en fond
  const skeleton = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
  const skeletonWithFlag = { ...(skeleton as object), _generating: true } as Prisma.InputJsonValue

  let savedMinutes
  if (existingMinutes) {
    savedMinutes = await prisma.meetingMinutes.update({
      where: { meetingId },
      data: { content: skeletonWithFlag },
    })
  } else {
    savedMinutes = await prisma.meetingMinutes.create({
      data: {
        meetingId,
        authorId: userId,
        templateId: defaultTemplate?.id ?? null,
        content: skeletonWithFlag,
        status: 'DRAFT',
      },
    })
  }

  const minutesId = savedMinutes.id
  const meetingSubject = meeting.subject
  const participants = meeting.participants
  const startDateTime = meeting.startDateTime

  after(async () => {
    try {
      const content = await generateMinutesContent(
        meetingSubject,
        transcription,
        participants,
        { userId, minutesId }
      )
      await prisma.meetingMinutes.update({
        where: { id: minutesId },
        data: { content: { ...(content as object), _generating: false } as Prisma.InputJsonValue },
      })
      console.log(`[generate/after] ✓ CR généré — meetingId=${meetingId} minutesId=${minutesId}`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erreur inconnue'
      console.error('[generate/after] Échec génération Claude:', error)
      const fallback = createSkeletonContent(meetingSubject, participants, startDateTime)
      const fallbackWithError = {
        ...(fallback as object),
        _generating: false,
        _generationError: errMsg,
      } as Prisma.InputJsonValue
      await prisma.meetingMinutes.update({
        where: { id: minutesId },
        data: { content: fallbackWithError },
      })
    }
  })

  return NextResponse.json({ ...savedMinutes, content: skeletonWithFlag, generating: true })
}
