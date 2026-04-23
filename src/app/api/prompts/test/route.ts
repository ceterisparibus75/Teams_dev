import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateMinutesContent } from '@/lib/azure-openai'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { sujet, transcription, promptText, modeleClaude } = await req.json() as {
    sujet: string
    transcription: string
    promptText?: string
    modeleClaude?: string
  }

  if (!sujet?.trim() || !transcription?.trim()) {
    return NextResponse.json({ error: 'Sujet et transcription requis' }, { status: 400 })
  }

  const result = await generateMinutesContent(sujet, transcription, undefined, {
    userId: session.user.id,
    promptText,
    modelName: modeleClaude,
  })

  return NextResponse.json(result)
}
