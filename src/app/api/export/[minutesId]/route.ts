import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDocx, buildDocxFilename } from '@/lib/docx-generator'
import type { MinutesContent, TemplateSection } from '@/types'

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary',   label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'decisions', label: 'Décisions',             type: 'list',  aiGenerated: true  },
  { id: 'actions',   label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',     label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ minutesId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { minutesId } = await params
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

  const sections: TemplateSection[] = minutes.template
    ? (minutes.template.sections as TemplateSection[])
    : DEFAULT_SECTIONS

  const docxBuffer = await generateDocx({
    subject: minutes.meeting.subject,
    date: minutes.meeting.startDateTime,
    participants: minutes.meeting.participants,
    content: minutes.content as MinutesContent,
    sections,
    footerHtml: minutes.template?.footerHtml,
  })

  const filename = buildDocxFilename(minutes.meeting.subject, minutes.meeting.startDateTime)

  return new NextResponse(docxBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
