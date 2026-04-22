'use client'

import { signIn } from 'next-auth/react'

export function SignInButton() {
  return (
    <button
      onClick={() => signIn('azure-ad', { callbackUrl: '/dashboard' })}
      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
    >
      Se connecter avec Microsoft 365
    </button>
  )
}
