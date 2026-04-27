import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateMinutesContent } from '@/lib/claude-generator'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { sujet, transcription, promptText, modeleClaude, participants, meetingDate } = await req.json() as {
    sujet: string
    transcription: string
    promptText?: string
    modeleClaude?: string
    participants?: Array<{ name: string; email?: string; company?: string | null }>
    meetingDate?: string
  }

  if (!sujet?.trim() || !transcription?.trim()) {
    return NextResponse.json({ error: 'Sujet et transcription requis' }, { status: 400 })
  }

  const sanitizedParticipants = Array.isArray(participants)
    ? participants.reduce<Array<{ name: string; email?: string; company?: string }>>((acc, participant) => {
        const name = participant.name?.trim()
        if (!name) return acc

        acc.push({
          name,
          email: participant.email?.trim() || undefined,
          company: participant.company?.trim() || undefined,
        })
        return acc
      }, [])
    : undefined

  const parsedMeetingDate = meetingDate ? new Date(meetingDate) : undefined
  if (meetingDate && Number.isNaN(parsedMeetingDate?.getTime())) {
    return NextResponse.json({ error: 'Date de réunion invalide' }, { status: 400 })
  }

  const result = await generateMinutesContent(sujet, transcription, sanitizedParticipants, {
    userId: session.user.id,
    promptText,
    modelName: modeleClaude,
    meetingDate: parsedMeetingDate,
  })

  return NextResponse.json(result)
}
