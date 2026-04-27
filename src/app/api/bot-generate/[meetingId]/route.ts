import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { generateMinutesContent } from '@/lib/azure-openai'
import { getAttendanceWarning } from '@/lib/attendance-warning'
import { getAttendanceLookup } from '@/lib/microsoft-graph'
import { safeEqual } from '@/lib/secrets'
import { toPrismaJson } from '@/lib/minutes-persist'

const MAX_TRANSCRIPT_CHARS = 500_000
const BodySchema = z.object({
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS).nullable(),
})

// Rate limiting in-memory : un appel par meetingId toutes les 60 secondes
const rateLimitMap = new Map<string, number>()
const RATE_LIMIT_MS = 60_000   // 60 secondes entre deux appels pour le même meetingId
const CLEANUP_TTL_MS = 300_000 // entrées supprimées après 5 minutes d'inactivité

function checkRateLimit(meetingId: string): boolean {
  const now = Date.now()

  // Nettoyage des entrées expirées (> 5 min) pour éviter les fuites mémoire
  for (const [id, ts] of rateLimitMap.entries()) {
    if (now - ts > CLEANUP_TTL_MS) rateLimitMap.delete(id)
  }

  const lastCall = rateLimitMap.get(meetingId)
  if (lastCall !== undefined && now - lastCall < RATE_LIMIT_MS) {
    return false // trop tôt
  }

  rateLimitMap.set(meetingId, now)
  return true
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  // Authentification bot uniquement — pas de session utilisateur
  if (!safeEqual(req.headers.get('x-bot-secret'), process.env.BOT_SECRET)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { meetingId } = await params

  // Rate limiting : un appel par meetingId toutes les 60 secondes
  if (!checkRateLimit(meetingId)) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  const rawBody = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body invalide', code: 'invalid_body' }, { status: 400 })
  }
  const { transcript } = parsed.data

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const existingMinutes = await prisma.meetingMinutes.findUnique({ where: { meetingId } })
  const defaultTemplate = await prisma.template.findFirst({ where: { isDefault: true } })
  const attendanceLookup = await getAttendanceLookup(meeting.organizerId, meeting.joinUrl)
  const attendanceWarning = getAttendanceWarning(attendanceLookup)
  if (attendanceWarning) console.warn('[bot-generate] Attendance warning:', attendanceWarning)
  const content = await generateMinutesContent(
    meeting.subject,
    transcript,
    meeting.participants,
    { meetingDate: meeting.startDateTime ?? undefined, attendanceLookup }
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
      return NextResponse.json({ ok: true, updated: true, attendanceWarning })
    }
    return NextResponse.json({ ok: true, alreadyExists: true, attendanceWarning })
  }

  await prisma.meetingMinutes.create({
    data: {
      meetingId,
      authorId: meeting.organizerId,
      templateId: defaultTemplate?.id ?? null,
      content: toPrismaJson(content as object),
      status: 'DRAFT',
    },
  })

  console.log(`[bot-generate] Compte rendu créé pour "${meeting.subject}"`)
  return NextResponse.json({ ok: true, attendanceWarning })
}
