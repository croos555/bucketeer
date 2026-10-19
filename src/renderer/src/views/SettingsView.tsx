import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Field, Segmented, Switch } from '../components/ui'

const BACKEND: Record<string, string> = {
  keychain: 'the macOS Keychain',
  dpapi: 'Windows DPAPI (tied to your Windows account)',
  gnome_libsecret: 'GNOME Keyring (libsecret)',
  kwallet: 'KWallet',
  kwallet5: 'KWallet',
  kwallet6: 'KWallet'
}

export default function SettingsView() {
  const { vault, saveSettings } = useStore()
  const [storage, setStorage] = useState<{ encrypted: boolean; backend: string } | null>(null)
  useEffect(() => {
    window.api.vault.storageInfo().then(setStorage)
  }, [])
  if (!vault) return null
  const s = vault.settings
  return (
    <div className="main">
      <div className="content">
        <div className="settings">
          <div className="section-title">Appearance</div>
          <div className="psection">
            <label className="row">
              <span>Theme</span>
              <div style={{ width: 260 }}>
                <Segmented
                  value={s.appearance}
                  onChange={(v) => saveSettings({ appearance: v })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' }
                  ]}
                />
              </div>
            </label>
            <label className="row">
              <span>Show hidden files (dotfiles)</span>
              <Switch on={s.showHidden} onChange={(v) => saveSettings({ showHidden: v })} />
            </label>
            <label className="row">
              <span>Confirm before deleting</span>
              <Switch on={s.confirmDelete} onChange={(v) => saveSettings({ confirmDelete: v })} />
            </label>
          </div>

          <div className="section-title">Transfers</div>
          <div className="psection">
            <label className="row">
              <span>Multipart part size</span>
              <div style={{ width: 110 }}>
                <Field
                  value={s.partSizeMB}
                  onChange={(v) => saveSettings({ partSizeMB: Math.max(5, Math.min(512, Number(v.replace(/\D/g, '')) || 16)) })}
                  suffix="MB"
                />
              </div>
            </label>
            <label className="row">
              <span>Parallel parts per upload</span>
              <div style={{ width: 110 }}>
                <Field
                  value={s.concurrency}
                  onChange={(v) => saveSettings({ concurrency: Math.max(1, Math.min(16, Number(v.replace(/\D/g, '')) || 4)) })}
                />
              </div>
            </label>
            <p className="hint">Large files are uploaded in parts (minimum 5 MB). Bigger parts and more parallelism go faster on good connections.</p>
          </div>

          <div className="section-title">General</div>
          <div className="psection">
            <label className="row">
              <span>Keep running when the window is closed</span>
              <Switch on={s.keepRunningInBackground} onChange={(v) => saveSettings({ keepRunningInBackground: v })} />
            </label>
            <p className="hint">
              Everything is stored locally on this computer.{' '}
              {storage &&
                (storage.encrypted && storage.backend !== 'basic_text' ? (
                  <>Secret keys are encrypted with {BACKEND[storage.backend] || storage.backend}.</>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>
                    No system keyring is available: secret keys are only obfuscated on disk.
                  </span>
                ))}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
