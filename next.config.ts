import type { NextConfig } from 'next'

// Headers de sécurité globaux. Documentés sur https://owasp.org/www-project-secure-headers/
// CSP volontairement permissive sur 'unsafe-inline' style/script car Next.js
// injecte du JS et CSS inline. À durcir avec un nonce si besoin.
const securityHeaders = [
  // Empêche le framing externe (clickjacking)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Empêche le MIME-sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Limite le referer envoyé aux sites tiers
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Force HTTPS (1 an + sous-domaines + preload)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  // Désactive les API navigateur sensibles non utilisées
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  // CSP basique : self + Microsoft Graph (login + images de profil) + fonts Google
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.microsoft.com https://*.azurewebsites.net",
      "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://api.anthropic.com https://api.openai.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
