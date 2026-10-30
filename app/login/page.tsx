'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaChallengeToken, setMfaChallengeToken] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok || data.success === false) {
        setError(data.message || 'Invalid credentials. Please try again.')
        setIsLoading(false)
        return
      }

      if (data.mfaRequired === true && typeof data.challengeToken === 'string') {
        setMfaChallengeToken(data.challengeToken)
        setIsLoading(false)
        return
      }

      router.push('/')
    } catch {
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/mfa/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: mfaChallengeToken,
          ...(useRecoveryCode ? { recoveryCode: mfaCode } : { code: mfaCode }),
        }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false || data.mfaRequired) {
        setError(data.message || 'MFA verification failed.')
        setIsLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('MFA verification is temporarily unavailable. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-accent">
            <span className="text-xl font-bold text-accent-foreground">⚡</span>
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">CommandFlow</h1>
          <p className="text-muted-foreground text-sm">Enterprise AI Operating System</p>
        </div>

        {mfaChallengeToken ? (
          <form onSubmit={handleMfaSubmit} className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Enter the current code from your authenticator app to finish signing in.
            </p>
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="mfa-code" className="block text-sm font-medium text-foreground">
                {useRecoveryCode ? 'Recovery code' : '6-digit authenticator code'}
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                maxLength={useRecoveryCode ? 32 : 6}
                required
                disabled={isLoading}
                className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground"
              />
            </div>
            <button type="button" className="text-sm text-accent" onClick={() => { setUseRecoveryCode(!useRecoveryCode); setMfaCode(''); setError('') }}>
              {useRecoveryCode ? 'Use an authenticator code' : 'Use a recovery code'}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-lg bg-accent text-accent-foreground font-semibold disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Verify and sign in'}
            </button>
            <button type="button" className="w-full py-2 text-sm text-muted-foreground" onClick={() => { setMfaChallengeToken(''); setMfaCode(''); setError('') }}>
              Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <a href="#" className="text-xs text-accent hover:text-accent/80 transition-colors">
                Forgot password?
              </a>
            </div>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-lg bg-accent text-accent-foreground font-semibold hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          New to CommandFlow?{' '}
          <a href="/register" className="font-medium text-accent hover:text-accent/80">
            Create an account
          </a>
        </p>
      </div>
    </div>
  )
}
