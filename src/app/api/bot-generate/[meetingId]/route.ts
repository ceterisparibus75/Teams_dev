import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent } from '@/lib/azure-openai'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  // Authentification bot uniquement — pas de session utilisateur
  const botSecret = req.headers.get('x-bot-secret')
  if (!botSecret || botSecret !== process.env.BOT_SECRET) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { meetingId } = await params
  const { transcript } = (await req.json()) as { transcript: string | null }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })
  const content = await generateMinutesContent(
    meeting.subject,
    transcript,
    meeting.participants,
    { meetingDate: meeting.startDateTime ?? undefined }
  )

  if (existingMinutes) {
    // Mettre à jour uniquement si on a maintenant une transcription
    if (transcript) {
      await prisma.meetingMinutes.update({
        where: { meetingId },
        data: { content: content as unknown as import('@prisma/client').Prisma.InputJsonValue },
      })
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { hasTranscription: true },
      })
      console.log(`[bot-generate] Compte rendu mis à jour avec transcription pour "${meeting.subject}"`)
      return NextResponse.json({ ok: true, updated: true })
    }
    return NextResponse.json({ ok: true, alreadyExists: true })
  }

  await prisma.meetingMinutes.create({
    data: {
      meetingId,
      authorId: meeting.organizerId,
      templateId: defaultTemplate?.id ?? null,
      content: content as unknown as import('@prisma/client').Prisma.InputJsonValue,
      status: 'DRAFT',
    },
  })

  console.log(`[bot-generate] Compte rendu créé pour "${meeting.subject}"`)
  return NextResponse.json({ ok: true })
}
