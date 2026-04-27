import { NextResponse } from 'next/server'

// Endpoint de débuggage : permet de vérifier quelle version (commit) tourne
// effectivement en prod. Utile pour diagnostiquer les bugs liés à un déploiement
// récent. Vercel injecte automatiquement VERCEL_GIT_COMMIT_SHA.

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    shortSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ? null : new Date().toISOString(),
    region: process.env.VERCEL_REGION ?? null,
    nodeVersion: process.version,
  })
}
