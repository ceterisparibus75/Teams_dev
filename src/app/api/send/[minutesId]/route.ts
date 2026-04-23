import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDocx, buildDocxFilename } from '@/lib/docx-generator'
import { sendMinutesEmail } from '@/lib/email-sender'
import { getMinutesQualityAlerts } from '@/lib/minutes-quality'
import type { MinutesContent, TemplateSection } from '@/types'

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary',   label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'decisions', label: 'Décisions',             type: 'list',  aiGenerated: true  },
  { id: 'actions',   label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',     label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ minutesId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { minutesId } = await params
  const { recipients } = await req.json() as {
    recipients: Array<{ name: string; email: string }>
  }

  const minutes = await prisma.meetingMinutes.findFirst({
    where: {
      id: minutesId,
      meeting: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    },
    include: { meeting: { include: { participants: true } }, template: true },
  })
  if (!minutes) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const content = minutes.content as MinutesContent
  const qualityAlerts = getMinutesQualityAlerts(content)
  if (qualityAlerts.length > 0) {
    return NextResponse.json(
      {
        error: "Le compte rendu contient des termes à corriger avant envoi.",
        code: 'quality_guard_failed',
        qualityAlerts,
      },
      { status: 422 }
    )
  }

  const docxBuffer = await generateDocx({
    subject: minutes.meeting.subject,
    date: minutes.meeting.startDateTime,
    participants: minutes.meeting.participants,
    content,
    sections: DEFAULT_SECTIONS,
    template: minutes.template,
  })

  const filename = buildDocxFilename(minutes.meeting.subject, minutes.meeting.startDateTime)

  const sent = await sendMinutesEmail({
    userId: session.user.id,
    subject: minutes.meeting.subject,
    recipients,
    content,
    docxBuffer,
    docxFilename: filename,
  })

  if (!sent) return NextResponse.json({ error: "Échec de l'envoi" }, { status: 500 })

  await prisma.meetingMinutes.update({
    where: { id: minutesId },
    data: { status: 'SENT', sentAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
