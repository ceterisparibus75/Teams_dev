// Fetcher SWR partagé : JSON + propagation des erreurs HTTP avec le payload.
// Permet aux pages d'afficher le message d'erreur renvoyé par l'API.

export class FetchError extends Error {
  status: number
  payload: unknown
  constructor(status: number, payload: unknown, message: string) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

export async function jsonFetcher<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      // pas de body JSON
    }
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : null) ?? `HTTP ${res.status}`
    throw new FetchError(res.status, payload, message)
  }
  return res.json() as Promise<T>
}
