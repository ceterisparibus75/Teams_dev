import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

/**
 * Bot service — surveille les réunions Teams et génère les comptes rendus.
 *
 * Transcription récupérée via Graph API après la fin de chaque réunion.
 * Permissions Azure AD requises (Application) :
 *   OnlineMeetings.Read.All
 *   OnlineMeetingTranscript.Read.All
 *
 * Lancer : npm run bot
 */

import express from 'express'
import type { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'
import { startWatcher } from './watcher'

const PORT = Number(process.env.BOT_PORT ?? 3001)
const log = logger.child({ service: 'bot' })

export const app = express()
app.use(express.json())

export const prisma = new PrismaClient()

// ─── Stats partagées ──────────────────────────────────────────────────────────

export const botStats = {
  startedAt: new Date().toISOString(),
  lastTickAt: null as string | null,
  tickCount: 0,
  errorCount: 0,
  meetingsGenerated: 0,
}

// ─── Génération du compte rendu ───────────────────────────────────────────────

export async function triggerGeneration(
  meetingDbId: string,
  transcript: string | null
): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.APP_URL}/api/bot-generate/${meetingDbId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': process.env.BOT_SECRET!,
      },
      body: JSON.stringify({ transcript }),
    })

    if (res.ok) {
      await prisma.meeting.update({
        where: { id: meetingDbId },
        data: { hasTranscription: !!transcript, processedAt: new Date() },
      })
      log.info({ meetingId: meetingDbId }, 'Compte rendu généré')
      botStats.meetingsGenerated++
      return true
    }

    log.error({ status: res.status, body: await res.text() }, 'Erreur génération')
    return false
  } catch (err) {
    log.error({ err, meetingId: meetingDbId }, 'triggerGeneration error')
    return false
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - new Date(botStats.startedAt).getTime()) / 1000)
  res.json({
    status: 'ok',
    uptime: uptimeSeconds,
    startedAt: botStats.startedAt,
    lastTickAt: botStats.lastTickAt,
    tickCount: botStats.tickCount,
    errorCount: botStats.errorCount,
    meetingsGenerated: botStats.meetingsGenerated,
  })
})

// ─── Gestionnaires d'erreurs non interceptées ────────────────────────────────

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaughtException')
  botStats.errorCount++
})

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'unhandledRejection')
  botStats.errorCount++
})

// ─── Heartbeat toutes les 5 minutes ─────────────────────────────────────────

setInterval(() => {
  const uptimeSeconds = Math.floor((Date.now() - new Date(botStats.startedAt).getTime()) / 1000)
  log.info({
    uptimeSeconds,
    tickCount: botStats.tickCount,
    errorCount: botStats.errorCount,
    meetingsGenerated: botStats.meetingsGenerated,
  }, 'heartbeat')
}, 5 * 60 * 1000)

// ─── Démarrage ────────────────────────────────────────────────────────────────

startWatcher()

app.listen(PORT, () => {
  log.info({ port: PORT, mode: 'graph-transcription' }, 'Service bot démarré')
})
