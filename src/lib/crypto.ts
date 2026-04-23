import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET manquant — impossible de chiffrer les tokens')
  return createHash('sha256').update(secret).digest()
}

// Tokens chiffrés en AES-256-GCM, préfixés "enc:" pour distinguer
// les anciens tokens en clair (migration transparente).

export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'enc:' + Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptToken(value: string): string {
  if (!value.startsWith('enc:')) return value
  const buf = Buffer.from(value.slice(4), 'base64')
  const iv = buf.subarray(0, 16)
  const tag = buf.subarray(16, 32)
  const encrypted = buf.subarray(32)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}
