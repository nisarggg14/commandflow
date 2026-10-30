'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type MfaStatus = { mfaEnabled: boolean; enrollmentPending: boolean }

async function readJson(response: Response) {
  return response.json().catch(() => ({}))
}

export default function SecuritySettingsPage() {
  const router = useRouter()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [showManualKey, setShowManualKey] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [disableWithRecovery, setDisableWithRecovery] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshStatus = async () => {
    const response = await fetch('/api/auth/mfa/status', { credentials: 'include' })
    const data = await readJson(response)
    if (response.status === 401) {
      router.push('/login')
      return
    }
    if (!response.ok || data.success !== true) {
      throw new Error(data.message || 'Unable to load MFA status.')
    }
    setStatus({
      mfaEnabled: data.mfaEnabled === true,
      enrollmentPending: data.enrollmentPending === true,
    })
  }

  useEffect(() => {
    void refreshStatus().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to load MFA status.')
    })
  }, [])

  const beginEnrollment = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    setRecoveryCodes([])
    try {
      const response = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await readJson(response)
      if (!response.ok || data.success !== true) throw new Error(data.message || 'Unable to start MFA enrollment.')
      setQrCodeDataUrl(data.setup.qrCodeDataUrl)
      setManualKey('')
      setShowManualKey(false)
      setStatus({ mfaEnabled: false, enrollmentPending: true })
      setNotice('Scan this QR code with your authenticator app. Enrollment expires in 10 minutes.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start MFA enrollment.')
    } finally {
      setBusy(false)
    }
  }

  const revealManualKey = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/mfa/setup-key', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await readJson(response)
      if (!response.ok || data.success !== true) throw new Error(data.message || 'Manual setup key unavailable.')
      setManualKey(data.manualSetupKey)
      setShowManualKey(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Manual setup key unavailable.')
    } finally {
      setBusy(false)
    }
  }

  const confirmEnrollment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/auth/mfa/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: verificationCode }),
      })
      const data = await readJson(response)
      if (!response.ok || data.success !== true) throw new Error(data.message || 'MFA verification failed.')
      setStatus({ mfaEnabled: true, enrollmentPending: false })
      setQrCodeDataUrl('')
      setManualKey('')
      setShowManualKey(false)
      setVerificationCode('')
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [])
      setNotice('MFA is enabled. Save these recovery codes now; they will not be shown again.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MFA verification failed.')
    } finally {
      setBusy(false)
    }
  }

  const disableMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          password,
          ...(disableWithRecovery ? { recoveryCode } : { code: verificationCode }),
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.success !== true) throw new Error(data.message || 'Unable to disable MFA.')
      router.push('/login')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to disable MFA.')
    } finally {
      setBusy(false)
    }
  }

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'))
    setNotice('Recovery codes copied. Store them in a secure location.')
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <button type="button" className="mb-4 text-sm text-accent" onClick={() => router.push('/')}>← Command center</button>
          <p className="cf-kicker">Account security</p>
          <h1 className="mt-2 text-2xl font-semibold">Multi-factor authentication</h1>
          <p className="mt-2 text-sm text-muted-foreground">Use a TOTP-compatible authenticator app for an additional sign-in check.</p>
        </header>

        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-border bg-card p-3 text-sm">{notice}</p>}

        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-medium">Authenticator app</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Status: {status === null ? 'Loading…' : status.mfaEnabled ? 'Enabled' : status.enrollmentPending ? 'Enrollment pending' : 'Not enabled'}
              </p>
            </div>
            {!status?.mfaEnabled && (
              <button type="button" onClick={beginEnrollment} disabled={busy} className="cf-button cf-button-primary">
                {status?.enrollmentPending ? 'Create a new setup code' : 'Set up MFA'}
              </button>
            )}
          </div>

          {qrCodeDataUrl && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm">Scan this QR code with Google Authenticator, Microsoft Authenticator, or another compatible app.</p>
              <img src={qrCodeDataUrl} alt="TOTP enrollment QR code" className="h-52 w-52 rounded-lg bg-white p-2" />
              <div className="space-y-2">
                {!showManualKey ? (
                  <button type="button" onClick={revealManualKey} disabled={busy} className="text-sm text-accent underline">
                    Can’t scan? Reveal manual setup key
                  </button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                    <p className="text-sm font-medium">Keep this key private. Anyone with it can generate your MFA codes.</p>
                    <code className="block break-all select-all text-sm">{manualKey}</code>
                  </div>
                )}
              </div>
              <form onSubmit={confirmEnrollment} className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="enrollment-code">Authenticator verification code</label>
                <input
                  id="enrollment-code"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  required
                  className="cf-input flex-1"
                />
                <button type="submit" disabled={busy || verificationCode.length !== 6} className="cf-button cf-button-primary">
                  Confirm and enable
                </button>
              </form>
            </div>
          )}

          {recoveryCodes.length > 0 && (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="font-medium">Recovery codes</h3>
              <p className="text-sm text-muted-foreground">Each code can be used once. Save them now; CommandFlow stores only their hashes and cannot show them again.</p>
              <pre className="grid grid-cols-2 gap-2 overflow-x-auto rounded-lg bg-background p-3 text-sm">{recoveryCodes.join('\n')}</pre>
              <button type="button" onClick={() => void copyRecoveryCodes()} className="cf-button">Copy recovery codes</button>
            </div>
          )}
        </section>

        {status?.mfaEnabled && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="font-medium">Disable MFA</h2>
            <p className="text-sm text-muted-foreground">Confirm your password and a fresh authenticator code or unused recovery code. Disabling MFA signs out all sessions.</p>
            <form onSubmit={disableMfa} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Password</span>
                <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="cf-input w-full" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={disableWithRecovery} onChange={(event) => setDisableWithRecovery(event.target.checked)} />
                Use a recovery code
              </label>
              <label className="block space-y-1 text-sm">
                <span>{disableWithRecovery ? 'Recovery code' : 'Fresh authenticator code'}</span>
                <input
                  type="text"
                  required
                  autoComplete={disableWithRecovery ? 'off' : 'one-time-code'}
                  inputMode={disableWithRecovery ? 'text' : 'numeric'}
                  value={disableWithRecovery ? recoveryCode : verificationCode}
                  onChange={(event) => disableWithRecovery ? setRecoveryCode(event.target.value) : setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="cf-input w-full"
                />
              </label>
              <button type="submit" disabled={busy} className="cf-button border border-destructive/50 text-destructive">
                Disable MFA and sign out
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  )
}
