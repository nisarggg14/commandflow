# CommandFlow MFA configuration and operation

CommandFlow uses TOTP authenticator apps and stores active/pending TOTP secrets
encrypted with AES-256-GCM. The encryption key is supplied by the server
environment as `MFA_ENCRYPTION_KEY`; it must contain at least 32 characters.
Use a randomly generated value with at least 32 bytes of entropy, keep it in
the deployment secret manager, and never commit it or include it in logs.

For a fresh development or deployment secret, generate one locally with:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set that output as `MFA_ENCRYPTION_KEY` in the server environment. Do not rotate
the key while encrypted MFA secrets exist unless the stored secrets are first
re-encrypted with a controlled migration. Existing legacy encrypted values
remain readable by the decryption helper; new secrets use AES-GCM.

After adding the database migration, run:

```sh
npx prisma migrate deploy
npx prisma generate
```

To enroll, sign in and open **Manage → Security settings**. Scan the QR code
with an authenticator app and enter its current six-digit code. Enrollment is
not active until the server accepts that code. The manual setup key is available
only during authenticated pending enrollment. Recovery codes are displayed once
after enrollment; save them in a secure location. Each recovery code can be
used once.

For MFA-enabled accounts, password sign-in returns a short-lived MFA challenge,
not an authenticated session. Complete the challenge with a TOTP or recovery
code to receive the normal session cookie. Disabling MFA requires the account
password and a fresh TOTP or unused recovery code and revokes the account's
existing sessions.
