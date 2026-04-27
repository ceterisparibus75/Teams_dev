import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const BodySchema = z.object({ meetingId: z.string().min(1).max(255) }).strict()

async function findAccessibleMeeting(meetingId: string, userId: string) {
  return prisma.meeting.findFirst({
    where: {
      id: meetingId,
      OR: [
        { organizerId: userId },
        { collaborators: { some: { userId } } },
      ],
    },
    select: { id: true, dossierId: true },
  })
}

// Lie manuellement une réunion à un dossier
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { meetingId } = parsed.data

  const dossier = await prisma.dossier.findUnique({ where: { id } })
  if (!dossier) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })

  const meeting = await findAccessibleMeeting(meetingId, session.user.id)
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  await prisma.meeting.update({ where: { id: meetingId }, data: { dossierId: id } })
  return NextResponse.json({ success: true })
}

// Délie une réunion de ce dossier
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { meetingId } = parsed.data

  const meeting = await findAccessibleMeeting(meetingId, session.user.id)
  if (!meeting || meeting.dossierId !== id) {
    return NextResponse.json({ error: 'Réunion non associée à ce dossier' }, { status: 404 })
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { dossierId: null } })
  return NextResponse.json({ success: true })
}
