import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent, type GenerationStyle } from '@/lib/azure-openai'
import { getTranscription } from '@/lib/microsoft-graph'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { meetingId } = await params
  const body = await req.json().catch(() => ({}))
  const style: GenerationStyle = body.style === 'concise' ? 'concise' : 'detailed'

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

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  if (!existingMinutes)
    return NextResponse.json({ error: 'Aucun compte rendu à mettre à jour' }, { status: 400 })

  if (!meeting.joinUrl)
    return NextResponse.json({ error: 'Lien de réunion manquant en base' }, { status: 422 })

  const transcript = await getTranscription(session.user.id, meeting.joinUrl)

  if (!transcript) {
    return NextResponse.json(
      {
        error:
          'Transcription introuvable — vérifiez que la transcription Teams a bien été démarrée puis reconnectez votre compte Microsoft pour autoriser la lecture des transcriptions.',
      },
      { status: 422 }
    )
  }

  const content = await generateMinutesContent(meeting.subject, transcript, style)

  await prisma.meetingMinutes.update({
    where: { meetingId },
    data: { content: content as unknown as import('@prisma/client').Prisma.InputJsonValue },
  })

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { hasTranscription: true },
  })

  return NextResponse.json({ ok: true, minutesId: existingMinutes.id })
}
