import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const minutes = await prisma.meetingMinutes.findFirst({
    where: {
      id,
      meeting: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    },
    include: {
      meeting: { include: { participants: true } },
      template: true,
      author: { select: { name: true } },
    },
  })

  if (!minutes) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const raw = minutes.content as Record<string, unknown>
  const generating = raw?._generating === true
  const startedAt = raw?._generatingStartedAt as string | undefined
  const timedOut = generating && startedAt &&
    (Date.now() - new Date(startedAt).getTime()) > 8 * 60 * 1000
  const actualGenerating = generating && !timedOut

  if (timedOut) {
    const errorMsg = 'La génération a pris trop de temps. Cliquez sur "Régénérer le procès-verbal" pour réessayer.'
    await prisma.meetingMinutes.update({
      where: { id },
      data: {
        isGenerating: false,
        content: { ...raw, _generating: false, _generationError: errorMsg } as import('@prisma/client').Prisma.InputJsonValue,
      },
    })
  }

  const generationError = timedOut
    ? 'La génération a pris trop de temps. Cliquez sur "Régénérer le procès-verbal" pour réessayer.'
    : (typeof raw?._generationError === 'string' ? raw._generationError : null)
  return NextResponse.json({ ...minutes, generating: actualGenerating, generationError })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await params
  const { content, status } = await req.json()

  try {
    const accessibleMinutes = await prisma.meetingMinutes.findFirst({
      where: {
        id,
        meeting: {
          OR: [
            { organizerId: session.user.id },
            { collaborators: { some: { userId: session.user.id } } },
          ],
        },
      },
      select: { id: true, content: true, status: true },
    })

    if (!accessibleMinutes) {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    }

    // Audit log : snapshot du contenu avant chaque modification
    await prisma.minutesEditLog.create({
      data: {
        minutesId: accessibleMinutes.id,
        userId: session.user.id,
        action: content !== undefined ? 'content_edit' : 'status_change',
        previousStatus: accessibleMinutes.status,
        contentSnapshot: accessibleMinutes.content as import('@prisma/client').Prisma.InputJsonValue,
      },
    })

    const updated = await prisma.meetingMinutes.update({
      where: { id: accessibleMinutes.id },
      data: {
        ...(content !== undefined && { content }),
        ...(status !== undefined && { status }),
        ...(status === 'VALIDATED' && {
          validatedById: session.user.id,
          validatedAt: new Date(),
        }),
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[minutes/PATCH]', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
