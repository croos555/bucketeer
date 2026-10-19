import { useEffect } from 'react'
import { Box, Database, FolderOpen, Plus, Settings as SettingsIcon, X } from 'lucide-react'
import { useStore, View } from './store'
import ConnectionsView from './views/ConnectionsView'
import SettingsView from './views/SettingsView'
import { ConnectionEditor, GroupEditor } from './components/ConnectionEditor'
import BrowserTab from './components/BrowserTab'
import { ConfirmHost, PromptHost } from './components/ui'

const NAV: { id: View; label: string; icon: typeof Database }[] = [{ id: 'connections', label: 'Connections', icon: Database }]

function useAppearance(appearance: 'system' | 'light' | 'dark' | undefined) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance !== 'light' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [appearance])
}

export default function App() {
  const { vault, load, view, setView, tabs, activeTab, setActiveTab, closeTab, editing, toast, openBrowser } = useStore()

  useEffect(() => {
    load()
  }, [load])
  useAppearance(vault?.settings.appearance)

  // Tab shortcuts: Cmd/Ctrl+W closes, Cmd/Ctrl+1..9 switches (1 = connections)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod) return
      const { tabs, activeTab } = useStore.getState()
      if (e.key === 'w' && activeTab) {
        e.preventDefault()
        closeTab(activeTab)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const n = Number(e.key)
        if (n === 1) setActiveTab(null)
        else if (tabs[n - 2]) setActiveTab(tabs[n - 2].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeTab, setActiveTab])

  if (!vault) return <div className="app" />

  return (
    <div className="app">
      <div className={`titlebar ${window.api.platform === 'darwin' ? 'mac' : ''}`}>
        <button className={`tab ${activeTab === null ? 'active' : ''}`} onClick={() => setActiveTab(null)}>
          <Database size={14} />
          <span className="title">Connections</span>
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            title={t.title}
          >
            {t.right?.kind === 's3' ? <Box size={14} /> : <FolderOpen size={14} />}
            <span className="title">{t.title}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              <X size={12} />
            </span>
          </button>
        ))}
        <button className="tab-add" title="New browser tab" onClick={() => openBrowser()}>
          <Plus size={16} />
        </button>
        <div className="spacer" />
      </div>

      <div className="body">
        {activeTab === null && (
          <>
            <nav className="sidebar">
              {NAV.map((n) => (
                <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
                  <n.icon size={16} />
                  {n.label}
                </button>
              ))}
              <div className="grow" />
              <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
                <SettingsIcon size={16} />
                Settings
              </button>
            </nav>
            {view === 'connections' && <ConnectionsView />}
            {view === 'settings' && <SettingsView />}
            {editing?.kind === 'connection' && <ConnectionEditor initial={editing.item} />}
            {editing?.kind === 'group' && <GroupEditor initial={editing.item} />}
          </>
        )}
        {/* Browser tabs stay mounted so their state survives switching */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab ? 'block' : 'none' }}>
          {tabs.map((t) => (
            <BrowserTab key={t.id} tab={t} active={activeTab === t.id} />
          ))}
        </div>
      </div>

      <ConfirmHost />
      <PromptHost />
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  )
}
