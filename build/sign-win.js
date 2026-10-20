// Windows signing command for Tauri (bundle.windows.signCommand, set by the release workflow only):
// Certum "Code Signing in the Cloud" (SimplySign) through ssign (https://github.com/Le-Syl21/ssign),
// which talks to Certum's cloud API over HTTPS (no SimplySign Desktop, no virtual smart card).
// Usage: node build/sign-win.js <file>. Without CERTUM_EMAIL / CERTUM_OTP (local builds, pull requests)
// files are left unsigned on purpose.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('usage: node build/sign-win.js <file>')
  process.exit(2)
}
if (!process.env.CERTUM_OTP || !process.env.CERTUM_EMAIL) process.exit(0)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ssign signs in place with SHA-256, embeds the Certum chain and adds an RFC 3161 timestamp.
// It caches the cloud session for 20 minutes, so all files share one login.
// It replaces the file atomically, which Windows refuses while the freshly built file is still held
// open (Defender scan, the bundler): sign a private copy, then write it back, retrying while locked.
// The cloud and the timestamp server occasionally time out: retry those too.
const dir = mkdtempSync(join(tmpdir(), 'sign-'))
const copy = join(dir, basename(file))
try {
  copyFileSync(file, copy)
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(process.env.SSIGN_PATH || 'ssign', [copy], { stdio: 'inherit' })
      break
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`ssign failed (attempt ${attempt}), retrying in ${attempt * 10} s…`)
      await sleep(attempt * 10000)
    }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      copyFileSync(copy, file)
      break
    } catch (err) {
      if (attempt >= 10) throw err
      console.warn(`${file} is locked (${err.code}), retrying in 3 s…`)
      await sleep(3000)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
