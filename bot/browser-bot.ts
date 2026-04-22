/**
 * browser-bot.ts — Bot navigateur Playwright
 *
 * Rejoint une réunion (Teams externe, Zoom, Google Meet) en tant que participant,
 * enregistre l'audio via ffmpeg, puis déclenche la transcription et la génération
 * du compte rendu à la fin de la réunion.
 *
 * Prérequis sur le serveur :
 *   - Playwright + Chromium  (npx playwright install chromium)
 *   - Xvfb                   (apt-get install xvfb)
 *   - PulseAudio             (apt-get install pulseaudio)
 *   - ffmpeg                 (apt-get install ffmpeg)
 *
 * Variables d'environnement :
 *   BOT_DISPLAY   (optionnel) — numéro d'écran Xvfb, ex. ":99" (défaut :99)
 *   BOT_AUDIO_DIR (optionnel) — dossier pour les fichiers audio temporaires
 */

import { chromium, type Browser, type Page } from 'playwright'
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { MeetingPlatform } from '@prisma/client'
import { prisma, triggerGeneration } from './index'
import { transcribeAudio } from './transcriber'

export interface MeetingTarget {
  id: string
  subject: string
  platform: MeetingPlatform
  url: string
  endDateTime: Date
}

const BOT_NAME = 'Assistant BL&Associés'
const AUDIO_DIR = process.env.BOT_AUDIO_DIR ?? '/tmp/bot-audio'
const DISPLAY = process.env.BOT_DISPLAY ?? ':99'

// Extra time to record after scheduled end (in case the meeting runs over)
const POST_END_BUFFER_MS = 10 * 60 * 1000

// ─── Audio recording via ffmpeg ───────────────────────────────────────────────

function startAudioRecording(outputPath: string): ChildProcess {
  // Records from PulseAudio default sink monitor (captures what the browser plays)
  const proc = spawn('ffmpeg', [
    '-f', 'pulse',
    '-i', 'default',
    '-ar', '16000',   // 16 kHz — optimal for Whisper
    '-ac', '1',       // mono
    '-y',             // overwrite if exists
    outputPath,
  ], {
    env: { ...process.env, DISPLAY, PULSE_SERVER: 'unix:/tmp/pulse/native' },
    // stdin must be 'pipe' so we can send 'q' for graceful shutdown
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stderr?.on('data', () => {}) // suppress ffmpeg verbose output
  proc.on('error', (err) => console.error('[bot-audio] ffmpeg error:', err))
  return proc
}

function stopRecording(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) { resolve(); return }
    proc.once('exit', () => resolve())
    // 'q' + Enter = ffmpeg graceful stop (stdin is 'pipe' so this works)
    proc.stdin?.write('q\n')
    proc.stdin?.end()
    setTimeout(() => { proc.kill('SIGKILL'); resolve() }, 5000)
  })
}

// ─── Platform-specific join logic ─────────────────────────────────────────────

async function joinTeamsExternal(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // Teams web — "Join on the web instead" link
  const joinOnWeb = page.locator('text=Join on the web instead, a[data-tid="joinOnWeb"]').first()
  if (await joinOnWeb.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await joinOnWeb.click()
  }

  // Enter name field (guest join)
  const nameInput = page.locator('input[placeholder*="name"], input[data-tid="prejoin-display-name-input"]').first()
  if (await nameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await nameInput.fill(BOT_NAME)
  }

  // Disable mic + camera before joining
  for (const selector of [
    '[data-tid="toggle-mute"]',
    'button[aria-label*="Microphone"]',
    'button[aria-label*="Micro"]',
  ]) {
    const btn = page.locator(selector).first()
    if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const pressed = await btn.getAttribute('aria-pressed').catch(() => null)
      if (pressed !== 'true') await btn.click().catch(() => {})
      break
    }
  }

  // Click "Join now"
  const joinBtn = page.locator(
    'button[data-tid="prejoin-join-button"], button:has-text("Join now"), button:has-text("Rejoindre")'
  ).first()
  await joinBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await joinBtn.click()

  // Wait for meeting UI to load (roster panel or video grid)
  await page.waitForSelector(
    '[data-tid="roster-panel"], [data-tid="calling-roster-section"], .ts-calling-screen',
    { timeout: 60_000 }
  ).catch(() => console.warn('[bot] Teams: meeting UI not detected within 60s'))
}

async function joinZoom(page: Page, url: string): Promise<void> {
  // Zoom web client — build the join URL in browser mode
  const webUrl = url
    .replace('zoom.us/j/', 'zoom.us/wc/join/')
    .replace(/\?.*$/, '') + '?prefer=1&un=' + encodeURIComponent(btoa(BOT_NAME))

  await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // Name field
  const nameInput = page.locator('input#inputname, input[placeholder*="Your Name"], input[placeholder*="Votre nom"]').first()
  if (await nameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await nameInput.fill(BOT_NAME)
  }

  // Join button
  const joinBtn = page.locator('button.preview-join-button, button:has-text("Join"), button:has-text("Rejoindre")').first()
  if (await joinBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await joinBtn.click()
  }

  // Wait for meeting room
  await page.waitForSelector('.meeting-app, .meeting-client, #wc-container-right', {
    timeout: 60_000,
  }).catch(() => console.warn('[bot] Zoom: meeting UI not detected within 60s'))
}

async function joinGoogleMeet(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // Enter name if prompted (guest join)
  const nameInput = page.locator('input[placeholder*="Your name"], input[aria-label*="Your name"]').first()
  if (await nameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await nameInput.fill(BOT_NAME)
  }

  // Click "Ask to join" or "Join now"
  const joinBtn = page.locator(
    'button:has-text("Ask to join"), button:has-text("Join now"), button:has-text("Demander à participer"), button:has-text("Rejoindre")'
  ).first()
  if (await joinBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await joinBtn.click()
  }

  // Wait for call UI
  await page.waitForSelector('[data-call-ended], [data-meeting-title], .crqnQb', {
    timeout: 60_000,
  }).catch(() => console.warn('[bot] Google Meet: meeting UI not detected within 60s'))
}

// ─── Meeting end detection ────────────────────────────────────────────────────

async function waitForMeetingEnd(page: Page, endDateTime: Date): Promise<void> {
  const deadline = new Date(endDateTime.getTime() + POST_END_BUFFER_MS)

  return new Promise((resolve) => {
    // Resolve when scheduled deadline is reached
    const timer = setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now()))

    // Also resolve early if meeting UI shows "call ended" overlay
    const checkInterval = setInterval(async () => {
      try {
        const ended = await page.evaluate(() => {
          const text = document.body?.innerText ?? ''
          return (
            text.includes('call ended') ||
            text.includes('réunion terminée') ||
            text.includes('left the meeting') ||
            text.includes('meeting has ended') ||
            text.includes('La réunion est terminée') ||
            document.querySelector('[data-tid="call-ended"]') !== null
          )
        })
        if (ended) {
          clearTimeout(timer)
          clearInterval(checkInterval)
          resolve()
        }
      } catch {
        // page may be closed
        clearTimeout(timer)
        clearInterval(checkInterval)
        resolve()
      }
    }, 30_000)
  })
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function joinMeeting(meeting: MeetingTarget): Promise<void> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const audioFile = path.join(AUDIO_DIR, `${meeting.id}.wav`)

  let browser: Browser | null = null
  let recorder: ChildProcess | null = null

  // Outer finally ensures audio file is always cleaned up regardless of where failure occurs
  try {
    try {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'JOINING' },
      })

      browser = await chromium.launch({
        headless: false,  // must be false — Xvfb provides the virtual display
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
        args: [
          `--display=${DISPLAY}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--autoplay-policy=no-user-gesture-required',
          '--use-fake-ui-for-media-stream',  // auto-accept mic/camera prompts
        ],
      })

      const context = await browser.newContext({
        permissions: ['microphone', 'camera'],
        extraHTTPHeaders: {},
      })

      const page = await context.newPage()

      // Start audio recording immediately — capture everything played through PulseAudio
      recorder = startAudioRecording(audioFile)

      // Join based on platform
      switch (meeting.platform) {
        case 'TEAMS_EXTERNAL':
          await joinTeamsExternal(page, meeting.url)
          break
        case 'ZOOM':
          await joinZoom(page, meeting.url)
          break
        case 'GOOGLE_MEET':
          await joinGoogleMeet(page, meeting.url)
          break
        default:
          await page.goto(meeting.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      }

      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'IN_MEETING' },
      })

      console.log(`[bot] "${meeting.subject}" — bot en réunion, enregistrement en cours`)

      await waitForMeetingEnd(page, meeting.endDateTime)

      console.log(`[bot] "${meeting.subject}" — réunion terminée, arrêt de l'enregistrement`)
    } catch (err) {
      console.error(`[bot] Erreur pendant la réunion "${meeting.subject}":`, err)
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'FAILED' },
      }).catch(() => {})
      return
    } finally {
      if (recorder) await stopRecording(recorder)
      if (browser) await browser.close().catch(() => {})
    }

    // Transcription + generation
    try {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'PROCESSING' },
      })

      const transcript = await transcribeAudio(audioFile)
      console.log(`[bot] "${meeting.subject}" — transcription : ${transcript ? transcript.split(' ').length + ' mots' : 'échec'}`)

      await triggerGeneration(meeting.id, transcript)

      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'DONE' },
      })
    } catch (err) {
      console.error(`[bot] Erreur transcription/génération pour "${meeting.subject}":`, err)
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { botStatus: 'FAILED' },
      }).catch(() => {})
    }
  } finally {
    // Always clean up audio file regardless of where the failure occurred
    fs.unlink(audioFile, () => {})
  }
}
