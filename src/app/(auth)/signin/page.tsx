'use client'
import { signIn } from 'next-auth/react'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl border border-gray-200 p-10 w-full max-w-sm text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comptes rendus</h1>
          <p className="text-sm text-gray-500 mt-1">BL & Associés</p>
        </div>
        <button
          onClick={() => signIn('azure-ad', { callbackUrl: '/dashboard' })}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Se connecter avec Microsoft 365
        </button>
      </div>
    </div>
  )
}
