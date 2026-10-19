import { app, BrowserWindow, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Collection, Settings, Vault } from '@shared/types'

// Fields that hold secrets, per collection. They are encrypted at rest.
const SECRET_FIELDS: Partial<Record<Collection, string[]>> = {
  connections: ['secretAccessKey']
}

const ENC_PREFIX = 'enc:v1:'

function encrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function emptyVault(): Vault {
  return { version: 1, groups: [], connections: [], bookmarks: [], settings: { ...DEFAULT_SETTINGS } }
}

function mapSecrets(vault: Vault, fn: (v: string) => string): Vault {
  const out: Vault = { ...vault }
  for (const [col, fields] of Object.entries(SECRET_FIELDS) as [Collection, string[]][]) {
    ;(out as any)[col] = (vault[col] as any[]).map((item) => {
      const copy = { ...item }
      for (const f of fields) if (copy[f]) copy[f] = fn(copy[f])
      return copy
    })
  }
  return out
}

type Listener = (id?: string) => void

class Store {
  private vault: Vault = emptyVault()
  private file = ''
  // Notified when a connection changes so cached S3 clients get rebuilt
  private listeners: Listener[] = []

  onConnectionChange(fn: Listener) {
    this.listeners.push(fn)
  }

  load(): void {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'vault.json')
    if (!existsSync(this.file)) {
      this.save()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      const base = emptyVault()
      this.vault = mapSecrets({ ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } }, decrypt)
    } catch {
      // Keep the unreadable file around rather than silently overwriting it
      renameSync(this.file, this.file + '.corrupt-' + Date.now())
      this.vault = emptyVault()
      this.save()
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(mapSecrets(this.vault, encrypt), null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  get(): Vault {
    return this.vault
  }

  upsert<T extends { id?: string; [k: string]: any }>(col: Collection, item: T): T & { id: string } {
    const list = this.vault[col] as any[]
    const id = item.id || randomUUID()
    const idx = list.findIndex((x) => x.id === id)
    const next = { createdAt: Date.now(), ...item, id }
    if (idx >= 0) list[idx] = { ...list[idx], ...next }
    else list.push(next)
    this.save()
    if (col === 'connections') this.listeners.forEach((fn) => fn(id))
    return next
  }

  remove(col: Collection, id: string): void {
    const removed = (this.vault[col] as any[]).find((x) => x.id === id)
    ;(this.vault as any)[col] = (this.vault[col] as any[]).filter((x) => x.id !== id)
    if (col === 'groups') {
      // Orphaned connections and subgroups move up to the deleted group's parent
      const parent = removed?.parentId ?? null
      for (const c of this.vault.connections) if (c.groupId === id) c.groupId = parent
      for (const g of this.vault.groups) if (g.parentId === id) g.parentId = parent
    }
    if (col === 'connections') {
      this.vault.bookmarks = this.vault.bookmarks.filter((b) => b.connectionId !== id)
      this.listeners.forEach((fn) => fn(id))
    }
    this.save()
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.vault.settings = { ...this.vault.settings, ...patch }
    this.save()
    return this.vault.settings
  }

  touch(id: string): void {
    const c = this.vault.connections.find((x) => x.id === id)
    if (c) {
      c.lastUsedAt = Date.now()
      this.save()
    }
  }
}

export const store = new Store()

export function notifyVaultChanged() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('vault:changed')
}
