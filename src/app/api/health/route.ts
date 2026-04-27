import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Endpoint léger pour le monitoring (Vercel uptime, Datadog synthétique, etc.).
// Vérifie que l'app répond ET que la BD est accessible. Pas d'auth — réponse
// volontairement minimale pour ne rien exposer en cas de scan.

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const startedAt = Date.now()
  let dbOk = false
  try {
    // Requête triviale : vérifie la connexion BD sans charger de données métier.
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    dbOk = false
  }

  const status = dbOk ? 'ok' : 'degraded'
  const httpStatus = dbOk ? 200 : 503
  return NextResponse.json(
    {
      status,
      checks: { database: dbOk ? 'ok' : 'down' },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: httpStatus },
  )
}
