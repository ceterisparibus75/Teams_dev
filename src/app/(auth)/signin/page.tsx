import { SignInButton } from './SignInButton'

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthCallback: 'La configuration Microsoft 365 est incomplète ou invalide sur cet environnement.',
  default: 'La connexion a échoué. Vérifiez la configuration de l’authentification puis réessayez.',
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error } = await searchParams
  const oauthConfigured = Boolean(
    process.env.AZURE_AD_CLIENT_ID &&
      process.env.AZURE_AD_CLIENT_SECRET &&
      process.env.AZURE_AD_TENANT_ID &&
      process.env.NEXTAUTH_SECRET
  )
  const errorMessage = error
    ? OAUTH_ERROR_MESSAGES[error] ?? OAUTH_ERROR_MESSAGES.default
    : null

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl border border-gray-200 p-10 w-full max-w-sm text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comptes rendus</h1>
          <p className="text-sm text-gray-500 mt-1">BL & Associés</p>
        </div>
        {errorMessage ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {errorMessage}
          </p>
        ) : null}
        {oauthConfigured ? (
          <SignInButton />
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            La connexion Microsoft 365 n&apos;est pas configurée pour cet environnement Vercel.
          </div>
        )}
      </div>
    </div>
  )
}
