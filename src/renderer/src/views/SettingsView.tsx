import { useEffect, useState } from 'react'
import { Globe, Lock, ShieldOff, User } from 'lucide-react'
import { useStore } from '../store'
import type { ProxyInfo } from '../api'
import { Field, Segmented, Switch } from '../components/ui'

const BACKEND: Record<string, string> = {
  keychain: 'a key kept in the macOS Keychain',
  'credential-manager': 'a key kept in the Windows Credential Manager',
  'secret-service': 'a key kept in the system keyring (Secret Service)'
}

const SOURCE: Record<ProxyInfo['source'], string> = {
  environment: 'from the HTTPS_PROXY / HTTP_PROXY environment variables',
  system: 'from the system network settings',
  manual: 'manual'
}

function ProxySection() {
  const { vault, saveSettings } = useStore()
  const [status, setStatus] = useState<{ current: ProxyInfo | null; system: ProxyInfo | null } | null>(null)
  const s = vault!.settings
  const mode = s.proxyMode || 'system'
  useEffect(() => {
    window.api.proxyStatus().then(setStatus)
  }, [mode, s.proxyUrl, s.proxyNoProxy])
  return (
    <>
      <div className="section-title">Network</div>
      <div className="psection">
        <label className="row">
          <span>Proxy</span>
          <div style={{ width: 260 }}>
            <Segmented
              value={mode}
              onChange={(v) => saveSettings({ proxyMode: v })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'manual', label: 'Manual' },
                { value: 'none', label: 'None' }
              ]}
            />
          </div>
        </label>
        {mode === 'manual' && (
          <>
            <Field
              icon={Globe}
              value={s.proxyUrl}
              onChange={(v) => saveSettings({ proxyUrl: v })}
              placeholder="Proxy URL (e.g. http://proxy.example.com:3128)"
            />
            <div className="row">
              <div className="grow">
                <Field icon={User} value={s.proxyUser} onChange={(v) => saveSettings({ proxyUser: v })} placeholder="User (optional)" />
              </div>
              <div className="grow">
                <Field
                  icon={Lock}
                  type="password"
                  value={s.proxyPassword}
                  onChange={(v) => saveSettings({ proxyPassword: v })}
                  placeholder="Password"
                />
              </div>
            </div>
            <Field
              icon={ShieldOff}
              value={s.proxyNoProxy}
              onChange={(v) => saveSettings({ proxyNoProxy: v })}
              placeholder="Bypass for (e.g. .corp.example.com, 10.0.0.0/8)"
            />
          </>
        )}
        <p className="hint">
          {mode === 'none'
            ? 'Bucketeer always connects directly.'
            : status?.current
              ? <>Requests go through <code>{status.current.url}</code> ({SOURCE[status.current.source]}).</>
              : mode === 'manual'
                ? 'Enter the proxy URL.'
                : 'No proxy is configured on this computer: Bucketeer connects directly.'}{' '}
          Local addresses (localhost, 127.0.0.1) never use the proxy.
        </p>
      </div>
    </>
  )
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

          <ProxySection />

          <div className="section-title">General</div>
          <div className="psection">
            <label className="row">
              <span>Keep running when the window is closed</span>
              <Switch on={s.keepRunningInBackground} onChange={(v) => saveSettings({ keepRunningInBackground: v })} />
            </label>
            <p className="hint">
              Everything is stored locally on this computer.{' '}
              {storage &&
                (storage.encrypted ? (
                  <>Secret keys and the proxy password are encrypted with {BACKEND[storage.backend] || storage.backend}.</>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>
                    No system keyring is available: secret keys are stored unencrypted on disk.
                  </span>
                ))}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
