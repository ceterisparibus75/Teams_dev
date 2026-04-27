import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Génère un identifiant de corrélation par requête, exposé en header pour
// le rapprochement entre logs (Vercel/Datadog) et tickets utilisateur.
// Si l'appelant fournit déjà un x-request-id (par ex. Vercel edge), on le
// conserve.

function newRequestId(): string {
  // crypto.randomUUID est dispo en runtime Node ET Edge.
  return crypto.randomUUID()
}

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? newRequestId()

  // Propage l'id en header request entrant (consultable côté route)
  // ET en réponse pour le client / proxies.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  // S'applique à toutes les routes API mais pas aux assets statiques.
  matcher: ['/api/:path*'],
}
