import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateDocx, buildDocxFilename } from '@/lib/docx-generator'
import { sendMinutesEmail } from '@/lib/email-sender'
import { getMinutesQualityAlerts } from '@/lib/minutes-quality'
import { rateLimit } from '@/lib/rate-limit'
import type { MinutesContent, TemplateSection } from '@/types'

const BodySchema = z.object({
  recipients: z.array(
    z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().max(320),
    })
  ).min(1).max(100),
}).strict()

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

  // Cap : 20 envois par utilisateur / 5 min — protège contre les loops
  // côté UI et cap le coût Graph API. La taille de pièce jointe DOCX
  // peut atteindre plusieurs Mo, donc l'envoi est non-trivial.
  const rl = rateLimit({ name: 'send-minutes', key: session.user.id, limit: 20, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Trop d\'envois en peu de temps', retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const { minutesId } = await params
  const rawBody = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { recipients } = parsed.data

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
