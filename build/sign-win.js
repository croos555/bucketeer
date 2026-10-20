// Windows signing command for Tauri (bundle.windows.signCommand, set by the release workflow only):
// Certum "Code Signing in the Cloud" (SimplySign) through ssign (https://github.com/Le-Syl21/ssign),
// which talks to Certum's cloud API over HTTPS (no SimplySign Desktop, no virtual smart card).
// Usage: node build/sign-win.js <file>. Without CERTUM_EMAIL / CERTUM_OTP (local builds, pull requests)
// files are left unsigned on purpose.
import { execFileSync } from 'node:child_process'

const file = process.argv[2]
if (!file) {
  console.error('usage: node build/sign-win.js <file>')
  process.exit(2)
}
if (!process.env.CERTUM_OTP || !process.env.CERTUM_EMAIL) process.exit(0)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ssign signs in place with SHA-256, embeds the Certum chain and adds an RFC 3161 timestamp.
// It caches the cloud session for 20 minutes, so all files share one login.
// The cloud and the timestamp server occasionally time out: retry a few times.
for (let attempt = 1; ; attempt++) {
  try {
    execFileSync(process.env.SSIGN_PATH || 'ssign', [file], { stdio: 'inherit' })
    break
  } catch (err) {
    if (attempt >= 3) throw err
    console.warn(`ssign failed (attempt ${attempt}), retrying in ${attempt * 10} s…`)
    await sleep(attempt * 10000)
  }
}
