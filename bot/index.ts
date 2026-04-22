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
import { startWatcher } from './watcher'

const PORT = Number(process.env.BOT_PORT ?? 3001)

export const app = express()
app.use(express.json())

export const prisma = new PrismaClient()

// ─── Génération du compte rendu ───────────────────────────────────────────────

export async function triggerGeneration(
  meetingDbId: string,
  transcript: string | null
): Promise<void> {
  try {
    await prisma.meeting.update({
      where: { id: meetingDbId },
      data: { hasTranscription: !!transcript, processedAt: new Date() },
    })

    const res = await fetch(`${process.env.APP_URL}/api/bot-generate/${meetingDbId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': process.env.BOT_SECRET!,
      },
      body: JSON.stringify({ transcript }),
    })

    if (res.ok) {
      console.log(`[bot] Compte rendu généré pour ${meetingDbId}`)
    } else {
      console.error('[bot] Erreur génération:', await res.text())
    }
  } catch (err) {
    console.error('[bot] triggerGeneration error:', err)
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Démarrage ────────────────────────────────────────────────────────────────

startWatcher()

app.listen(PORT, () => {
  console.log(`\n[bot] ✓ Service démarré sur le port ${PORT}`)
  console.log(`[bot] ✓ Mode transcription Graph API (ngrok non requis)`)
  console.log(`[bot] ✓ Surveillance des réunions active (vérification toutes les 60s)\n`)
})
