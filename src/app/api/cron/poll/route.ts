import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMeetingsEndedInLastHours, getTranscription } from '@/lib/microsoft-graph'
import { generateMinutesContent } from '@/lib/azure-openai'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const usersWithToken = await prisma.user.findMany({
    where: { microsoftRefreshToken: { not: null } },
    select: { id: true, email: true },
  })

  let processed = 0

  for (const user of usersWithToken) {
    const meetings = await getMeetingsEndedInLastHours(user.id, 2)

    for (const gm of meetings) {
      const existing = await prisma.meeting.findUnique({
        where: { id: gm.id },
        select: { processedAt: true },
      })
      if (existing?.processedAt) continue

      await prisma.meeting.upsert({
        where: { id: gm.id },
        update: {},
        create: {
          id: gm.id,
          subject: gm.subject,
          startDateTime: new Date(gm.startDateTime),
          endDateTime: new Date(gm.endDateTime),
          organizerId: user.id,
          participants: {
            create: gm.attendees.map((a) => ({
              name: a.emailAddress.name,
              email: a.emailAddress.address,
            })),
          },
        },
      })

      // Link firm members
      const attendeeEmails = gm.attendees.map((a) => a.emailAddress.address.toLowerCase())
      const firmMembers = await prisma.user.findMany({
        where: { email: { in: attendeeEmails } },
        select: { id: true },
      })
      for (const member of firmMembers) {
        await prisma.meetingCollaborator.upsert({
          where: { meetingId_userId: { meetingId: gm.id, userId: member.id } },
          update: {},
          create: { meetingId: gm.id, userId: member.id },
        })
      }

      const existingMinutes = await prisma.meetingMinutes.findUnique({
        where: { meetingId: gm.id },
      })
      if (existingMinutes) {
        await prisma.meeting.update({
          where: { id: gm.id },
          data: { processedAt: new Date() },
        })
        continue
      }

      const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })

      // Transcription in memory only — never persisted (RGPD)
      const transcription = await getTranscription(user.id, gm.id)
      const content = await generateMinutesContent(gm.subject, transcription)

      await prisma.meetingMinutes.create({
        data: {
          meetingId: gm.id,
          authorId: user.id,
          templateId: defaultTemplate?.id ?? null,
          content,
          status: 'DRAFT',
        },
      })

      await prisma.meeting.update({
        where: { id: gm.id },
        data: { hasTranscription: !!transcription, processedAt: new Date() },
      })

      processed++
    }
  }

  return NextResponse.json({ processed, users: usersWithToken.length })
}
