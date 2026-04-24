import { NextRequest, NextResponse, after } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTranscription } from '@/lib/microsoft-graph'
import { generateMinutesContent, createSkeletonContent } from '@/lib/azure-openai'
import type { Prisma } from '@prisma/client'

// Plan Pro : 300 s max. Le handler répond en < 1 s (squelette),
// le reste du budget est utilisé par after() pour la transcription + Claude.
export const maxDuration = 300

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

  // Squelette immédiat — transcription et Claude se font entièrement en arrière-plan
  const skeleton = createSkeletonContent(meeting.subject, meeting.participants, meeting.startDateTime)
  const skeletonWithFlag = {
    ...(skeleton as object),
    _generating: true,
    _generatingStartedAt: new Date().toISOString(),
  } as Prisma.InputJsonValue

  let savedMinutes
  if (existingMinutes) {
    savedMinutes = await prisma.meetingMinutes.update({
      where: { meetingId },
      data: { content: skeletonWithFlag, isGenerating: true },
    })
  } else {
    savedMinutes = await prisma.meetingMinutes.create({
      data: {
        meetingId,
        authorId: userId,
        templateId: defaultTemplate?.id ?? null,
        content: skeletonWithFlag,
        isGenerating: true,
        status: 'DRAFT',
      },
    })
  }

  const minutesId = savedMinutes.id
  const meetingSubject = meeting.subject
  const participants = meeting.participants
  const startDateTime = meeting.startDateTime
  const joinUrl = meeting.joinUrl

  // Tout en arrière-plan : récupération transcription + génération Claude
  after(async () => {
    try {
      console.log(`[generate/after] Démarrage — meetingId=${meetingId}`)

      const transcription = await getTranscription(userId, joinUrl, { subject: meetingSubject })

      await prisma.meeting.update({
        where: { id: meetingId },
        data: { hasTranscription: !!transcription, processedAt: new Date() },
      })

      if (!transcription) {
        console.log(`[generate/after] Pas de transcription — squelette sauvegardé`)
        const fallback = createSkeletonContent(meetingSubject, participants, startDateTime)
        await prisma.meetingMinutes.update({
          where: { id: minutesId },
          data: {
            isGenerating: false,
            content: { ...(fallback as object), _generating: false } as Prisma.InputJsonValue,
          },
        })
        return
      }

      console.log(`[generate/after] Transcription trouvée (${transcription.length} chars) — appel Claude`)
      const content = await generateMinutesContent(
        meetingSubject,
        transcription,
        participants,
        { userId, minutesId, meetingDate: startDateTime ?? undefined }
      )
      await prisma.meetingMinutes.update({
        where: { id: minutesId },
        data: {
          isGenerating: false,
          content: { ...(content as object), _generating: false } as Prisma.InputJsonValue,
        },
      })
      console.log(`[generate/after] ✓ CR généré — minutesId=${minutesId}`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erreur inconnue'
      console.error('[generate/after] Échec:', error)
      const fallback = createSkeletonContent(meetingSubject, participants, startDateTime)
      await prisma.meetingMinutes.update({
        where: { id: minutesId },
        data: {
          isGenerating: false,
          content: {
            ...(fallback as object),
            _generating: false,
            _generationError: errMsg,
          } as Prisma.InputJsonValue,
        },
      })
    }
  })

  return NextResponse.json({ ...savedMinutes, content: skeletonWithFlag, generating: true })
}
