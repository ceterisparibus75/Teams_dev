import { encryptToken, decryptToken } from '@/lib/crypto'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-jest'
})

describe('encryptToken / decryptToken', () => {
  it('roundtrip : décrypter après chiffrement retourne la valeur originale', () => {
    const original = 'mon-access-token-microsoft-12345'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  })

  it('migration transparente : une chaîne sans préfixe "enc:" est retournée telle quelle', () => {
    const ancienToken = 'ancien-token-en-clair-sans-prefixe'
    const result = decryptToken(ancienToken)
    expect(result).toBe(ancienToken)
  })

  it('le token chiffré est préfixé "enc:"', () => {
    const encrypted = encryptToken('quelque-chose')
    expect(encrypted.startsWith('enc:')).toBe(true)
  })

  it('IV aléatoire : deux chiffrements du même texte produisent des résultats différents', () => {
    const plaintext = 'même-texte-en-entrée'
    const enc1 = encryptToken(plaintext)
    const enc2 = encryptToken(plaintext)
    expect(enc1).not.toBe(enc2)
  })

  it('lève une erreur si le contenu chiffré est corrompu', () => {
    // On forge un token "enc:" avec des données base64 invalides / tronquées
    const corrompu = 'enc:' + Buffer.from('donnees-corrompues-courtes').toString('base64')
    expect(() => decryptToken(corrompu)).toThrow()
  })
})
