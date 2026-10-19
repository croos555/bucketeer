import { useEffect, useState } from 'react'
import { Eye, EyeOff, Folder, Globe, KeyRound, Lock, MapPin, PlugZap, Trash2, Link2, Box } from 'lucide-react'
import type { Connection, Group, Provider } from '@shared/types'
import { endpointFor, preset, PROVIDERS } from '@shared/providers'
import { errMsg, useStore } from '../store'
import { confirmDialog, ConnectionIcon, Field, GroupIcon, Panel, Segmented, Select, Switch } from './ui'
import { IconPicker } from './icons'

export function groupPath(groups: Group[], id?: string | null): string {
  const parts: string[] = []
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const g = groups.find((x) => x.id === id)
    if (!g) break
    parts.unshift(g.name)
    id = g.parentId
  }
  return parts.join(' / ')
}

function groupOptions(groups: Group[], exclude?: string) {
  // A group can't become its own descendant
  const banned = new Set<string>()
  if (exclude) {
    banned.add(exclude)
    let grew = true
    while (grew) {
      grew = false
      for (const g of groups)
        if (g.parentId && banned.has(g.parentId) && !banned.has(g.id)) {
          banned.add(g.id)
          grew = true
        }
    }
  }
  return groups
    .filter((g) => !banned.has(g.id))
    .map((g) => ({ value: g.id, label: groupPath(groups, g.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function ConnectionEditor({ initial }: { initial: Partial<Connection> }) {
  const { vault, upsert, remove, setEditing, openBrowser, notify } = useStore()
  const [c, setC] = useState<Partial<Connection>>(initial)
  const [showSecret, setShowSecret] = useState(false)
  const [pickIcon, setPickIcon] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  useEffect(() => {
    setC(initial)
    setTestResult(null)
  }, [initial])
  if (!vault) return null
  const set = (patch: Partial<Connection>) => setC((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)
  const p = preset(c.provider)

  // Picking a provider or region fills the endpoint, unless the user typed a custom one
  const autoEndpoint = (prov: Provider, region: string) => endpointFor(preset(prov), region)
  const chooseProvider = (prov: Provider) => {
    const np = preset(prov)
    const region = np.regions[0]?.id || c.region || ''
    set({ provider: prov, region, endpoint: autoEndpoint(prov, region), forcePathStyle: np.forcePathStyle })
  }
  const chooseRegion = (region: string) => {
    const wasAuto = !c.endpoint || c.endpoint === autoEndpoint(c.provider || 'custom', c.region || '')
    set({ region, ...(wasAuto ? { endpoint: autoEndpoint(c.provider || 'custom', region) } : {}) })
  }

  const normalized = (): Partial<Connection> => ({
    ...c,
    label: c.label?.trim() || `${p.name}${c.region ? ' ' + c.region : ''}`,
    endpoint: (c.endpoint || '').trim(),
    region: (c.region || '').trim(),
    accessKeyId: (c.accessKeyId || '').trim(),
    secretAccessKey: (c.secretAccessKey || '').trim(),
    defaultBucket: c.defaultBucket?.trim() || undefined,
    publicBaseUrl: c.publicBaseUrl?.trim() || undefined,
    forcePathStyle: !!c.forcePathStyle,
    provider: c.provider || 'custom'
  })

  const valid = () => {
    if (!c.accessKeyId?.trim() || !c.secretAccessKey?.trim()) return 'Access key and secret key are required'
    if (c.provider !== 'aws' && !c.endpoint?.trim()) return 'Endpoint is required'
    if (c.endpoint?.includes('<')) return 'Complete the endpoint (replace the <placeholder>)'
    return null
  }

  const save = async (): Promise<string | null> => {
    const err = valid()
    if (err) {
      notify(err, true)
      return null
    }
    const saved = await upsert('connections', normalized())
    setC(saved)
    return saved.id
  }

  const test = async () => {
    const err = valid()
    if (err) return setTestResult({ ok: false, message: err })
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.s3.test(normalized())
      setTestResult({ ok: true, message: res.message })
    } catch (e) {
      setTestResult({ ok: false, message: errMsg(e) })
    } finally {
      setTesting(false)
    }
  }

  const del = async () => {
    if (!c.id) return
    if (await confirmDialog({ title: 'Delete connection', message: `Delete "${c.label}"?`, danger: true, confirm: 'Delete' })) {
      await remove('connections', c.id)
      close()
    }
  }

  return (
    <Panel
      title={c.id ? 'Connection' : 'New Connection'}
      onClose={close}
      actions={
        c.id && (
          <button className="icon-btn" title="Delete" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <>
          <button className="btn soft block" onClick={async () => (await save()) && notify('Connection saved')}>
            Save
          </button>
          <button
            className="btn primary block"
            onClick={async () => {
              const id = await save()
              if (id) {
                openBrowser(id)
                close()
              }
            }}
          >
            Open
          </button>
        </>
      }
    >
      <div className="psection">
        <h4>Provider</h4>
        <div className="provider-grid">
          {PROVIDERS.map((pr) => (
            <button key={pr.id} className={`provider ${c.provider === pr.id ? 'on' : ''}`} onClick={() => chooseProvider(pr.id)}>
              <ConnectionIcon conn={{ provider: pr.id }} size="sm" />
              <span>{pr.name}</span>
            </button>
          ))}
        </div>
        {p.hint && <p className="hint">{p.hint}</p>}
      </div>

      <div className="psection">
        <h4>General</h4>
        <div className="row">
          <button className="tile-btn" title="Change icon" onClick={() => setPickIcon(true)}>
            <ConnectionIcon conn={c} size="sm" />
          </button>
          {pickIcon && (
            <IconPicker
              icon={c.icon}
              color={c.color}
              autoLabel={`${p.name} badge`}
              autoPreview={<ConnectionIcon conn={{ ...c, icon: null }} size="sm" />}
              onChange={(patch) => set(patch)}
              onClose={() => setPickIcon(false)}
            />
          )}
          <div className="grow">
            <Field value={c.label} onChange={(v) => set({ label: v })} placeholder={`Label (e.g. ${p.name} prod)`} />
          </div>
        </div>
        <Select
          icon={Folder}
          value={c.groupId}
          onChange={(v) => set({ groupId: v })}
          options={groupOptions(vault.groups)}
          placeholder="Group"
        />
      </div>

      <div className="psection">
        <h4>Endpoint</h4>
        {p.regions.length > 0 ? (
          <Select
            icon={MapPin}
            value={p.regions.some((r) => r.id === c.region) ? c.region : null}
            onChange={(v) => v && chooseRegion(v)}
            options={p.regions.map((r) => ({ value: r.id, label: r.name }))}
            placeholder="Region"
          />
        ) : null}
        <Field icon={MapPin} value={c.region} onChange={chooseRegion} placeholder="Region id (e.g. gra, us-east-1)" />
        <Field
          icon={Globe}
          value={c.endpoint}
          onChange={(v) => set({ endpoint: v })}
          placeholder={c.provider === 'aws' ? 'Default AWS endpoint' : 'https://s3.example.com'}
        />
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>Path-style URLs</span>
          <Switch on={!!c.forcePathStyle} onChange={(v) => set({ forcePathStyle: v })} />
        </label>
      </div>

      <div className="psection">
        <h4>Credentials</h4>
        <Field icon={KeyRound} value={c.accessKeyId} onChange={(v) => set({ accessKeyId: v })} placeholder="Access key ID" />
        <label className="input">
          <Lock size={15} />
          <input
            type={showSecret ? 'text' : 'password'}
            value={c.secretAccessKey ?? ''}
            placeholder="Secret access key"
            spellCheck={false}
            onChange={(e) => set({ secretAccessKey: e.target.value })}
          />
          <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShowSecret(!showSecret)}>
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </label>
        <p className="hint">The secret key is stored on this computer only, encrypted with the OS keychain.</p>
        <button className="btn soft" onClick={test} disabled={testing}>
          <PlugZap size={14} /> {testing ? 'Testing…' : 'Test connection'}
        </button>
        {testResult && (
          <div className={testResult.ok ? 'ok-box' : 'warning-box'} style={{ fontSize: 12 }}>
            {testResult.message}
          </div>
        )}
      </div>

      <div className="psection">
        <h4>Options</h4>
        <Field icon={Box} value={c.defaultBucket} onChange={(v) => set({ defaultBucket: v })} placeholder="Default bucket (optional)" />
        <p className="hint">Opened directly, and required when the key is limited to one bucket and can’t list buckets.</p>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>New uploads</span>
          <div style={{ width: 170 }}>
            <Segmented
              value={c.uploadAcl || 'private'}
              onChange={(v) => set({ uploadAcl: v })}
              options={[
                { value: 'private', label: 'Private' },
                { value: 'public-read', label: 'Public' }
              ]}
            />
          </div>
        </label>
        <p className="hint">Public: uploaded and copied files are readable by anyone at their public URL.</p>
        <Field
          icon={Link2}
          value={c.publicBaseUrl}
          onChange={(v) => set({ publicBaseUrl: v })}
          placeholder="Public URL base (optional, e.g. https://cdn.example.com)"
        />
        <p className="hint">
          Used for “public URL” instead of the endpoint (custom domain, CDN, static website). <code>{'{bucket}'}</code> is
          replaced by the bucket name.
        </p>
      </div>
    </Panel>
  )
}

export function GroupEditor({ initial }: { initial: Partial<Group> }) {
  const { vault, upsert, remove, setEditing, notify } = useStore()
  const [g, setG] = useState<Partial<Group>>(initial)
  const [pickIcon, setPickIcon] = useState(false)
  useEffect(() => setG(initial), [initial])
  if (!vault) return null
  const close = () => setEditing(null)
  const save = async () => {
    if (!g.name?.trim()) return notify('Name is required', true)
    setG(await upsert('groups', { ...g, name: g.name.trim() }))
    notify('Group saved')
  }
  const del = async () => {
    if (!g.id) return
    if (
      await confirmDialog({
        title: 'Delete group',
        message: `Delete "${g.name}"? Its connections and subgroups move to the parent group.`,
        danger: true,
        confirm: 'Delete'
      })
    ) {
      await remove('groups', g.id)
      close()
    }
  }
  return (
    <Panel
      title={g.id ? 'Group' : 'New Group'}
      onClose={close}
      actions={
        g.id && (
          <button className="icon-btn" title="Delete" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <button className="btn primary block" onClick={save}>
          Save
        </button>
      }
    >
      <div className="psection">
        <h4>General</h4>
        <div className="row">
          <button className="tile-btn" title="Change icon" onClick={() => setPickIcon(true)}>
            <GroupIcon group={g} size="sm" />
          </button>
          {pickIcon && (
            <IconPicker
              icon={g.icon}
              color={g.color}
              autoLabel="folder"
              autoPreview={<GroupIcon size="sm" />}
              onChange={(patch) => setG((x) => ({ ...x, ...patch }))}
              onClose={() => setPickIcon(false)}
            />
          )}
          <div className="grow">
            <Field value={g.name} onChange={(v) => setG({ ...g, name: v })} placeholder="Name" autoFocus={!g.id} onEnter={save} />
          </div>
        </div>
        <Select
          icon={Folder}
          value={g.parentId}
          onChange={(v) => setG({ ...g, parentId: v })}
          options={groupOptions(vault.groups, g.id)}
          placeholder="Parent group"
        />
      </div>
    </Panel>
  )
}
