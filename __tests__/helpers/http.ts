// Helpers communs aux tests d'intégration des routes Next.js.

import { NextRequest } from 'next/server'

type JsonRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

export function jsonRequest(url: string, init: JsonRequestInit = {}) {
  const headers = new Headers(init.headers ?? {})
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const { headers: _ignored, ...rest } = init
  return new NextRequest(url, { ...rest, headers } as ConstructorParameters<typeof NextRequest>[1])
}

export function asyncParams<T>(value: T): Promise<T> {
  return Promise.resolve(value)
}
