import { create } from 'zustand'
import type { Collection, Connection, Group, Location, Settings, TransferProgress, Vault } from '@shared/types'

export type View = 'connections' | 'settings'

export interface Tab {
  id: string
  title: string
  // Initial locations of the two panes
  left: Location
  right?: Location
}

export type Editing = { kind: 'connection'; item: Partial<Connection> } | { kind: 'group'; item: Partial<Group> } | null

interface State {
  vault: Vault | null
  view: View
  tabs: Tab[]
  activeTab: string | null // null = connections screen
  editing: Editing
  currentGroup: string | null
  transfers: Record<string, TransferProgress>
  toast: { message: string; error?: boolean } | null

  load(): Promise<void>
  upsert<T extends { id?: string; [k: string]: any }>(col: Collection, item: T): Promise<T & { id: string }>
  remove(col: Collection, id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  setView(v: View): void
  setEditing(e: Editing): void
  setCurrentGroup(id: string | null): void
  openBrowser(connectionId?: string, bucket?: string): void
  closeTab(id: string): void
  setActiveTab(id: string | null): void
  renameTab(id: string, title: string): void
  notify(message: string, error?: boolean): void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  vault: null,
  view: 'connections',
  tabs: [],
  activeTab: null,
  editing: null,
  currentGroup: null,
  transfers: {},
  toast: null,

  async load() {
    set({ vault: await window.api.vault.get() })
  },
  async upsert(col, item) {
    const saved = await window.api.vault.upsert(col, item)
    await get().load()
    return saved
  },
  async remove(col, id) {
    await window.api.vault.remove(col, id)
    await get().load()
  },
  async saveSettings(patch) {
    const settings = await window.api.vault.settings(patch)
    set((s) => ({ vault: s.vault && { ...s.vault, settings } }))
  },
  setView: (view) => set({ view, editing: null, activeTab: null }),
  setEditing: (editing) => set({ editing }),
  setCurrentGroup: (currentGroup) => set({ currentGroup }),
  openBrowser(connectionId, bucket) {
    const conn = get().vault?.connections.find((c) => c.id === connectionId)
    const b = bucket ?? conn?.defaultBucket ?? ''
    const tab: Tab = {
      id: crypto.randomUUID(),
      title: conn ? (b ? `${conn.label} · ${b}` : conn.label) : 'Browser',
      left: { kind: 'local', path: '' },
      right: conn ? { kind: 's3', connectionId: conn.id, bucket: b, prefix: '' } : undefined
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
  },
  closeTab(id) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTab = s.activeTab
      if (activeTab === id) activeTab = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
      return { tabs, activeTab }
    })
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  renameTab: (id, title) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
  notify(message, error) {
    clearTimeout(toastTimer)
    set({ toast: { message, error } })
    toastTimer = setTimeout(() => set({ toast: null }), 3500)
  }
}))

window.api.vault.onChanged(() => useStore.getState().load())
window.api.transfer.onProgress((t) => useStore.setState((s) => ({ transfers: { ...s.transfers, [t.transferId]: t } })))

export function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
