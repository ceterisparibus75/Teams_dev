import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { generateMinutesContent } from '@/lib/claude-generator'
import { rateLimit } from '@/lib/rate-limit'

const BodySchema = z
  .object({
    sujet: z.string().trim().min(1).max(500),
    transcription: z.string().trim().min(1).max(500_000),
    promptText: z.string().trim().min(1).max(50_000).optional(),
    modeleClaude: z.string().regex(/^claude-[a-z0-9.-]+$/i).max(100).optional(),
    participants: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          email: z.string().trim().max(320).optional().nullable(),
          company: z.string().trim().max(200).optional().nullable(),
        }),
      )
      .max(200)
      .optional(),
    meetingDate: z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Date invalide')
      .optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // Cap : 5 tests par utilisateur / 5 min — chaque appel coûte un appel Claude.
  const rl = rateLimit({ name: 'prompts-test', key: session.user.id, limit: 5, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Trop de tests en peu de temps', retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const rawBody = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { sujet, transcription, promptText, modeleClaude, participants, meetingDate } = parsed.data

  const sanitizedParticipants = participants?.map((p) => ({
    name: p.name,
    email: p.email?.trim() || undefined,
    company: p.company?.trim() || undefined,
  }))

  const result = await generateMinutesContent(sujet, transcription, sanitizedParticipants, {
    userId: session.user.id,
    promptText,
    modelName: modeleClaude,
    meetingDate: meetingDate ? new Date(meetingDate) : undefined,
  })

  return NextResponse.json(result)
}
