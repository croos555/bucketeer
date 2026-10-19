import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  Clock,
  Globe,
  Lock
} from 'lucide-react'
import type { BucketInfo, FileEntry, Location, TransferProgress } from '@shared/types'
import { publicUrl, s3Uri } from '@shared/urls'
import { errMsg, Tab, useStore } from '../store'
import { confirmDialog, ConnectionIcon, ContextMenu, formatSize, MenuItem, promptDialog, useMenu } from './ui'
import ObjectInfoPanel from './ObjectInfoPanel'

const isWin = window.api.platform === 'win32'
const sepOf = (l: Location) => (l.kind === 'local' && isWin ? '\\' : '/')

function localJoin(dir: string, name: string) {
  const s = isWin ? '\\' : '/'
  return dir.endsWith(s) ? dir + name : dir + s + name
}
function localParent(p: string) {
  const s = isWin ? '\\' : '/'
  const t = p.replace(/[\\/]+$/, '')
  const i = t.lastIndexOf(s)
  if (i <= 0) return s === '/' ? '/' : t.slice(0, 3)
  const parent = t.slice(0, i)
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
}
// "a/b/c/" -> "a/b/"
function prefixParent(prefix: string) {
  const t = prefix.replace(/\/$/, '')
  const i = t.lastIndexOf('/')
  return i < 0 ? '' : t.slice(0, i + 1)
}
function kindOf(e: FileEntry) {
  if (e.isDir) return 'folder'
  const m = e.name.match(/\.([^./]+)$/)
  return m ? m[1].toLowerCase() : 'file'
}
const sameLoc = (a?: Location, b?: Location) => JSON.stringify(a) === JSON.stringify(b)

export default function BrowserTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { notify, transfers, vault, renameTab } = useStore()
  const [locs, setLocs] = useState<[Location | null, Location | null]>([tab.left, tab.right || null])
  const [refresh, setRefresh] = useState<[number, number]>([0, 0])
  const pending = useRef(new Map<string, number>())
  const [mine, setMine] = useState<string[]>([])

  // Local panes start in the home folder
  useEffect(() => {
    window.api.local.home().then((home) =>
      setLocs((ls) => ls.map((l) => (l?.kind === 'local' && !l.path ? { ...l, path: home } : l)) as [Location | null, Location | null])
    )
  }, [])

  // Tab title follows the right pane
  useEffect(() => {
    const r = locs[1]
    if (r?.kind === 's3') {
      const c = vault?.connections.find((x) => x.id === r.connectionId)
      renameTab(tab.id, c ? (r.bucket ? `${c.label} · ${r.bucket}` : c.label) : 'Browser')
    }
  }, [locs, vault, tab.id, renameTab])

  const setLoc = useCallback((i: number, l: Location | null) => {
    setLocs((ls) => {
      const n = [...ls] as [Location | null, Location | null]
      n[i] = l
      return n
    })
  }, [])

  // Refresh the destination pane when one of our transfers finishes
  useEffect(() => {
    for (const [id, pane] of pending.current) {
      const t = transfers[id]
      if (t && t.status !== 'running') {
        pending.current.delete(id)
        setRefresh((r) => {
          const n = [...r] as [number, number]
          n[pane]++
          return n
        })
        if (t.status === 'error') notify(`Transfer failed: ${t.error}`, true)
      }
    }
  }, [transfers, notify])

  const track = (id: string, destPane: number) => {
    pending.current.set(id, destPane)
    setMine((m) => [...m, id])
  }

  // Send items from pane `from` to the other pane (or an explicit destination folder in it)
  const send = async (from: number, paths: string[], destOverride?: string) => {
    const src = locs[from]
    const dst = locs[1 - from]
    if (!src || !dst) return
    try {
      if (src.kind === 'local' && dst.kind === 's3') {
        if (!dst.bucket) return notify('Open a bucket on the other side first', true)
        track(await window.api.transfer.upload(dst.connectionId, dst.bucket, destOverride ?? dst.prefix, paths), 1 - from)
      } else if (src.kind === 's3' && dst.kind === 'local') {
        track(await window.api.transfer.download(src.connectionId, src.bucket, paths, destOverride ?? dst.path), 1 - from)
      } else if (src.kind === 's3' && dst.kind === 's3') {
        if (!dst.bucket) return notify('Open a bucket on the other side first', true)
        track(
          await window.api.transfer.copy(
            { connId: src.connectionId, bucket: src.bucket },
            paths,
            { connId: dst.connectionId, bucket: dst.bucket, prefix: destOverride ?? dst.prefix }
          ),
          1 - from
        )
      } else notify('Both panes are local: use your file manager for that', true)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const uploadExternal = async (pane: number, paths: string[], destOverride?: string) => {
    const dst = locs[pane]
    if (dst?.kind !== 's3' || !dst.bucket) return
    try {
      track(await window.api.transfer.upload(dst.connectionId, dst.bucket, destOverride ?? dst.prefix, paths), pane)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const visible = mine.map((id) => transfers[id]).filter(Boolean) as TransferProgress[]

  return (
    <div className={`sftp ${active ? '' : 'hidden'}`}>
      {[0, 1].map((i) => (
        <Pane
          key={i}
          index={i}
          loc={locs[i]}
          other={locs[1 - i]}
          refresh={refresh[i]}
          onLoc={(l) => setLoc(i, l)}
          onSend={(paths, dest) => send(i, paths, dest)}
          onReceive={(paths, dest) => send(1 - i, paths, dest)}
          onExternal={(paths, dest) => uploadExternal(i, paths, dest)}
          onDownloadTo={async (paths) => {
            const l = locs[i]
            if (l?.kind !== 's3') return
            const [dir] = await window.api.local.pick(true)
            if (dir) track(await window.api.transfer.download(l.connectionId, l.bucket, paths, dir), 1 - i)
          }}
        />
      ))}
      {visible.length > 0 && <Transfers list={visible} onClear={() => setMine([])} />}
    </div>
  )
}

function Transfers({ list, onClear }: { list: TransferProgress[]; onClear: () => void }) {
  return (
    <div className="transfers">
      <div className="row" style={{ padding: '2px 6px' }}>
        <strong className="grow">Transfers</strong>
        {list.every((t) => t.status !== 'running') && (
          <button className="link" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {list.map((t) => (
        <div key={t.transferId} className="transfer">
          {t.status === 'running' ? (
            <Loader2 size={15} className="spin" />
          ) : t.status === 'done' ? (
            <CheckCircle2 size={15} color="var(--success)" />
          ) : (
            <AlertCircle size={15} color="var(--danger)" />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {t.direction === 'upload' ? <Upload size={11} /> : t.direction === 'download' ? <Download size={11} /> : <Copy size={11} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            </div>
            <div className="bar">
              <span style={{ width: `${t.total ? Math.min(100, (t.transferred / t.total) * 100) : t.status === 'done' ? 100 : 0}%` }} />
            </div>
            <div className="sub">
              {t.status === 'error'
                ? t.error
                : t.status === 'cancelled'
                  ? 'Cancelled'
                  : `${formatSize(t.transferred)} / ${formatSize(t.total)}${t.files > 1 ? ` · ${t.filesDone}/${t.files} files` : ''}`}
            </div>
          </div>
          {t.status === 'running' && (
            <button className="icon-btn" title="Cancel" onClick={() => window.api.transfer.cancel(t.transferId)}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

type SortKey = 'name' | 'mtime' | 'size' | 'kind'

interface PaneProps {
  index: number
  loc: Location | null
  other: Location | null
  refresh: number
  onLoc: (l: Location | null) => void
  onSend: (paths: string[], dest?: string) => void
  onReceive: (paths: string[], dest?: string) => void
  onExternal: (paths: string[], dest?: string) => void
  onDownloadTo: (paths: string[]) => void
}

function Pane(props: PaneProps) {
  const { loc, other, index } = props
  const { vault, notify } = useStore()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [history, setHistory] = useState<{ back: Location[]; fwd: Location[] }>({ back: [], fwd: [] })
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const [sourceMenu, setSourceMenu] = useState(false)
  const [showUrls, setShowUrls] = useState(false)
  const [infoKey, setInfoKey] = useState<string | null>(null)
  const { menu, open, close } = useMenu()

  const conn = loc?.kind === 's3' ? vault?.connections.find((c) => c.id === loc.connectionId) : undefined
  const inBucket = loc?.kind === 's3' && !!loc.bucket
  const ready = !!loc && (loc.kind === 'local' ? !!loc.path : true)

  const reload = useCallback(async () => {
    if (!loc || !ready) return
    if (loc.kind === 's3' && !loc.bucket) return
    setLoading(true)
    setError('')
    try {
      if (loc.kind === 'local') {
        setEntries(await window.api.local.list(loc.path))
        setNextToken(undefined)
      } else {
        const res = await window.api.s3.list(loc.connectionId, loc.bucket, loc.prefix)
        setEntries(res.entries)
        setNextToken(res.nextToken)
      }
    } catch (err) {
      setError(errMsg(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(loc), ready])

  useEffect(() => {
    reload()
    setSelected(new Set())
    setInfoKey(null)
  }, [reload, props.refresh])

  const loadMore = async () => {
    if (loc?.kind !== 's3' || !nextToken) return
    setLoading(true)
    try {
      const res = await window.api.s3.list(loc.connectionId, loc.bucket, loc.prefix, nextToken)
      setEntries((e) => [...e, ...res.entries])
      setNextToken(res.nextToken)
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setLoading(false)
    }
  }

  const go = (l: Location, push = true) => {
    if (sameLoc(l, loc || undefined)) return
    if (push && loc) setHistory((h) => ({ back: [...h.back, loc], fwd: [] }))
    setFilter('')
    props.onLoc(l)
  }
  const back = () => {
    const prev = history.back[history.back.length - 1]
    if (!prev || !loc) return
    setHistory((h) => ({ back: h.back.slice(0, -1), fwd: [loc, ...h.fwd] }))
    props.onLoc(prev)
  }
  const fwd = () => {
    const next = history.fwd[0]
    if (!next || !loc) return
    setHistory((h) => ({ back: [...h.back, loc], fwd: h.fwd.slice(1) }))
    props.onLoc(next)
  }
  const up = () => {
    if (!loc) return
    if (loc.kind === 'local') go({ ...loc, path: localParent(loc.path) })
    else if (loc.prefix) go({ ...loc, prefix: prefixParent(loc.prefix) })
    else if (loc.bucket) go({ ...loc, bucket: '', prefix: '' })
  }

  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    const hidden = vault?.settings.showHidden ?? true
    const list = entries.filter((e) => (!f || e.name.toLowerCase().includes(f)) && (hidden || !e.name.startsWith('.')))
    const dir = sort.asc ? 1 : -1
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let c = 0
      if (sort.key === 'name') c = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      else if (sort.key === 'mtime') c = a.mtime - b.mtime
      else if (sort.key === 'size') c = a.size - b.size
      else c = kindOf(a).localeCompare(kindOf(b))
      return c * dir
    })
  }, [entries, filter, sort, vault?.settings.showHidden])

  const otherReady = !!other && (other.kind === 'local' ? !!other.path : !!other.bucket)
  const canSend = otherReady && !(loc?.kind === 'local' && other?.kind === 'local')
  const sendLabel = loc?.kind === 'local' ? 'Upload' : other?.kind === 'local' ? 'Download' : 'Copy to other side'

  const urlFor = (key: string) => (conn && loc?.kind === 's3' ? publicUrl(conn, loc.bucket, key) : '')

  const clickRow = (e: React.MouseEvent, entry: FileEntry) => {
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((x) => x.path === anchor)
      const b = shown.findIndex((x) => x.path === entry.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelected(new Set(shown.slice(lo, hi + 1).map((x) => x.path)))
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path)
      setSelected(next)
      setAnchor(entry.path)
    } else {
      setSelected(new Set([entry.path]))
      setAnchor(entry.path)
    }
  }

  const openEntry = (entry: FileEntry) => {
    if (!loc) return
    if (entry.isDir) go(loc.kind === 'local' ? { ...loc, path: entry.path } : { ...loc, prefix: entry.path })
    else if (loc.kind === 'local') window.api.local.open(entry.path)
    else setInfoKey(entry.path)
  }

  const newFolder = async () => {
    if (!loc) return
    const name = await promptDialog({ title: 'New folder', label: 'Folder name' })
    if (!name) return
    try {
      if (loc.kind === 'local') await window.api.local.mkdir(localJoin(loc.path, name))
      else await window.api.s3.mkdir(loc.connectionId, loc.bucket, loc.prefix + name.replace(/\/+$/, '') + '/')
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const renameEntry = async (entry: FileEntry) => {
    if (!loc) return
    const name = await promptDialog({ title: `Rename ${entry.isDir ? 'folder' : 'file'}`, label: 'New name', value: entry.name })
    if (!name || name === entry.name) return
    try {
      if (loc.kind === 'local') await window.api.local.rename(entry.path, localJoin(localParent(entry.path), name))
      else {
        const parent = entry.isDir ? prefixParent(entry.path) : entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
        await window.api.s3.rename(loc.connectionId, loc.bucket, entry.path, parent + name + (entry.isDir ? '/' : ''))
      }
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const deleteSelected = async (paths = [...selected]) => {
    if (!loc || !paths.length) return
    const isS3 = loc.kind === 's3'
    if (
      (vault?.settings.confirmDelete ?? true) &&
      !(await confirmDialog({
        title: `Delete ${paths.length === 1 ? 'item' : `${paths.length} items`}`,
        message: isS3
          ? 'Selected objects will be permanently deleted from the bucket, including everything inside folders.'
          : 'Selected items will be moved to the Trash.',
        danger: true,
        confirm: 'Delete'
      }))
    )
      return
    try {
      if (loc.kind === 'local') await window.api.local.remove(paths)
      else {
        const n = await window.api.s3.remove(loc.connectionId, loc.bucket, paths)
        notify(`Deleted ${n} object${n === 1 ? '' : 's'}`)
      }
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const copy = async (text: string, what: string) => {
    await window.api.copyText(text)
    notify(`${what} copied`)
  }

  const presign = async (key: string, seconds: number, label: string) => {
    if (loc?.kind !== 's3') return
    try {
      await copy(await window.api.s3.presign(loc.connectionId, loc.bucket, key, seconds), `Signed link (${label})`)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const rowMenu = (e: React.MouseEvent, entry?: FileEntry) => {
    if (!loc) return
    let sel = selected
    if (entry && !selected.has(entry.path)) {
      sel = new Set([entry.path])
      setSelected(sel)
      setAnchor(entry.path)
    }
    const paths = [...sel]
    const files = paths.filter((p) => !p.endsWith('/') || loc.kind === 'local')
    const items: (MenuItem | '-')[] = []
    if (entry) {
      items.push({ label: entry.isDir ? 'Open' : loc.kind === 's3' ? 'Details' : 'Open', icon: entry.isDir ? FolderOpen : Info, onClick: () => openEntry(entry) })
      if (canSend)
        items.push({
          label: `${sendLabel}${paths.length > 1 ? ` ${paths.length} items` : ''}`,
          icon: loc.kind === 'local' ? Upload : Download,
          onClick: () => props.onSend(paths)
        })
      if (loc.kind === 's3') {
        items.push({ label: 'Download to…', icon: Download, onClick: () => props.onDownloadTo(paths) })
        items.push('-')
        const fileKeys = paths.filter((p) => !p.endsWith('/'))
        if (fileKeys.length) {
          items.push({
            label: fileKeys.length > 1 ? `Copy ${fileKeys.length} public URLs` : 'Copy public URL',
            icon: Link2,
            onClick: () => copy(fileKeys.map(urlFor).join('\n'), fileKeys.length > 1 ? 'Public URLs' : 'Public URL')
          })
        }
        if (!entry.isDir && paths.length === 1) {
          items.push({ label: 'Copy signed link (1 hour)', icon: Clock, onClick: () => presign(entry.path, 3600, '1 hour') })
          items.push({ label: 'Copy signed link (7 days)', icon: Clock, onClick: () => presign(entry.path, 7 * 86400, '7 days') })
        }
        const setVisibility = async (on: boolean) => {
          try {
            const n = await window.api.s3.setPublic(loc.connectionId, loc.bucket, paths, on)
            notify(`${n} object${n === 1 ? '' : 's'} made ${on ? 'public' : 'private'}`)
          } catch (err) {
            notify(errMsg(err), true)
          }
        }
        items.push('-')
        items.push({ label: paths.length > 1 || entry.isDir ? 'Make public (recursive)' : 'Make public', icon: Globe, onClick: () => setVisibility(true) })
        items.push({ label: paths.length > 1 || entry.isDir ? 'Make private (recursive)' : 'Make private', icon: Lock, onClick: () => setVisibility(false) })
        items.push('-')
        items.push({
          label: 'Copy S3 URI',
          icon: Copy,
          onClick: () => copy(paths.map((p) => s3Uri(loc.bucket, p)).join('\n'), 'S3 URI')
        })
      } else {
        items.push('-')
        items.push({ label: 'Copy path', icon: Copy, onClick: () => copy(files.join('\n'), 'Path') })
      }
      items.push('-')
      if (paths.length === 1) items.push({ label: 'Rename', icon: Pencil, onClick: () => renameEntry(entry) })
      items.push({ label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteSelected(paths) })
      items.push('-')
    }
    items.push({ label: 'New folder', icon: FolderPlus, onClick: newFolder })
    items.push({ label: 'Refresh', icon: RefreshCw, onClick: reload })
    if (loc.kind === 's3' && loc.bucket)
      items.push({
        label: 'Upload files…',
        icon: Upload,
        onClick: async () => {
          const ps = await window.api.local.pick(false)
          if (ps.length) props.onExternal(ps)
        }
      })
    open(e, items)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingPath !== null) return
    if ((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') deleteSelected()
    else if (e.key === 'Backspace') up()
    else if (e.key === 'Enter' && selected.size === 1) {
      const entry = entries.find((x) => selected.has(x.path))
      if (entry) openEntry(entry)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      setSelected(new Set(shown.map((x) => x.path)))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = shown.findIndex((x) => x.path === anchor)
      const next = shown[Math.max(0, Math.min(shown.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        setSelected(new Set([next.path]))
        setAnchor(next.path)
      }
    }
  }

  // ---------- drag & drop ----------
  const onDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selected.has(entry.path) ? [...selected] : [entry.path]
    if (!selected.has(entry.path)) setSelected(new Set([entry.path]))
    e.dataTransfer.setData('application/x-bucketeer', JSON.stringify({ pane: index, paths }))
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleDrop = (e: React.DragEvent, dest?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(false)
    const internal = e.dataTransfer.getData('application/x-bucketeer')
    if (internal) {
      const { pane, paths } = JSON.parse(internal)
      if (pane !== index) props.onReceive(paths, dest)
      return
    }
    if (loc?.kind === 's3' && e.dataTransfer.files.length) {
      const paths = Array.from(e.dataTransfer.files).map((f) => window.api.local.pathForFile(f)).filter(Boolean)
      if (paths.length) props.onExternal(paths, dest)
    }
  }

  // ---------- render ----------
  const sourceButton = (
    <div style={{ position: 'relative' }}>
      <button className="source" onClick={() => setSourceMenu(!sourceMenu)} onBlur={() => setTimeout(() => setSourceMenu(false), 150)}>
        {conn ? (
          <ConnectionIcon conn={conn} size="sm" />
        ) : (
          <div className="icon-tile sm" style={{ background: 'var(--group-icon)' }}>
            <HardDrive size={15} />
          </div>
        )}
        {conn ? conn.label : loc ? 'Local' : 'Choose…'}
        <ChevronDown size={13} />
      </button>
      {sourceMenu && (
        <div className="menu" style={{ position: 'absolute', top: 38, left: 0, maxHeight: 380, overflow: 'auto' }}>
          <button onClick={() => window.api.local.home().then((home) => go({ kind: 'local', path: home }))}>
            <HardDrive size={14} /> Local
          </button>
          {vault?.connections.length ? <hr /> : null}
          {vault?.connections.map((c) => (
            <button key={c.id} onClick={() => go({ kind: 's3', connectionId: c.id, bucket: c.defaultBucket || '', prefix: '' })}>
              <Box size={14} /> {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (!loc) {
    return (
      <div className="pane">
        <div className="empty">
          <div className="tile">
            <Box size={20} />
          </div>
          <h3>Open a bucket</h3>
          <p>Pick a saved connection to browse its buckets.</p>
          <div className="host-picker">
            {vault?.connections.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => go({ kind: 's3', connectionId: c.id, bucket: c.defaultBucket || '', prefix: '' }, false)}
              >
                <ConnectionIcon conn={c} size="sm" />
                <div className="meta">
                  <div className="name">{c.label}</div>
                  <div className="sub">{c.defaultBucket || c.endpoint || c.region}</div>
                </div>
              </div>
            ))}
            {!vault?.connections.length && <p>No saved connections yet.</p>}
          </div>
        </div>
      </div>
    )
  }

  // Breadcrumbs
  const crumbs: { label: string; to: Location; icon?: React.ReactNode }[] = []
  if (loc.kind === 'local') {
    const s = sepOf(loc)
    if (s === '/') {
      const parts = loc.path.split('/').filter(Boolean)
      crumbs.push({ label: '/', to: { ...loc, path: '/' } })
      parts.forEach((p, i) => crumbs.push({ label: p, to: { ...loc, path: '/' + parts.slice(0, i + 1).join('/') } }))
    } else {
      const parts = loc.path.split('\\').filter(Boolean)
      parts.forEach((p, i) => crumbs.push({ label: p, to: { ...loc, path: parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') } }))
    }
  } else {
    crumbs.push({ label: 'Buckets', to: { ...loc, bucket: '', prefix: '' } })
    if (loc.bucket) {
      crumbs.push({ label: loc.bucket, to: { ...loc, prefix: '' }, icon: <Box size={13} color="var(--accent)" /> })
      const parts = loc.prefix.split('/').filter(Boolean)
      parts.forEach((p, i) => crumbs.push({ label: p, to: { ...loc, prefix: parts.slice(0, i + 1).join('/') + '/' } }))
    }
  }

  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <div onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }))}>
      {label}
      {sort.key === k && (sort.asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </div>
  )

  return (
    <div
      className={`pane ${dropTarget ? 'drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dropTarget) setDropTarget(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(false)
      }}
      onDrop={(e) => handleDrop(e)}
    >
      <div className="pane-head">
        {sourceButton}
        <div style={{ flex: 1 }} />
        {(loc.kind === 'local' || inBucket) && (
          <label className="filter">
            <Search size={14} />
            <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
        {inBucket && (
          <button className={`icon-btn ${showUrls ? 'active' : ''}`} title="Show public URLs" onClick={() => setShowUrls(!showUrls)}>
            <Link2 size={15} />
          </button>
        )}
        {(loc.kind === 'local' || inBucket) && (
          <button className="icon-btn" title="New folder" onClick={newFolder}>
            <FolderPlus size={15} />
          </button>
        )}
        <button className="icon-btn" title="Refresh" onClick={() => (loc.kind === 's3' && !loc.bucket ? props.onLoc({ ...loc }) : reload())}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="pane-path">
        <button className="icon-btn" disabled={!history.back.length} onClick={back}>
          <ArrowLeft size={14} />
        </button>
        <button className="icon-btn" disabled={!history.fwd.length} onClick={fwd}>
          <ArrowRight size={14} />
        </button>
        <button className="icon-btn" title="Up" onClick={up}>
          <ArrowUp size={14} />
        </button>
        {editingPath !== null ? (
          <input
            autoFocus
            value={editingPath}
            onChange={(e) => setEditingPath(e.target.value)}
            onBlur={() => setEditingPath(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const p = editingPath.trim()
                setEditingPath(null)
                if (!p) return
                if (loc.kind === 'local') go({ ...loc, path: p })
                else {
                  // "bucket/some/prefix" or "s3://bucket/prefix"
                  const m = p.replace(/^s3:\/\//, '').match(/^([^/]+)\/?(.*)$/)
                  if (m) go({ ...loc, bucket: m[1], prefix: m[2] && !m[2].endsWith('/') ? m[2] + '/' : m[2] })
                }
              }
              if (e.key === 'Escape') setEditingPath(null)
            }}
          />
        ) : (
          <div
            className="crumbs-scroll"
            title="Double-click to type a path"
            onDoubleClick={() => setEditingPath(loc.kind === 'local' ? loc.path : loc.bucket ? `${loc.bucket}/${loc.prefix}` : '')}
          >
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <ChevronRight size={12} color="var(--text-3)" />}
                <button
                  className="crumb"
                  onClick={() => go(c.to)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, c.to.kind === 'local' ? c.to.path : c.to.prefix)}
                >
                  {c.icon}
                  {i === crumbs.length - 1 && !c.icon && <Folder size={14} color="var(--accent)" />}
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {loc.kind === 's3' && !loc.bucket ? (
        <BucketList connectionId={loc.connectionId} onOpen={(b) => go({ ...loc, bucket: b, prefix: '' })} />
      ) : error ? (
        <div className="empty">
          <div className="tile">
            <AlertCircle size={20} color="var(--danger)" />
          </div>
          <h3>Cannot list this location</h3>
          <p>{error}</p>
          <button className="btn primary" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <div
          className="ftable"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
          onContextMenu={(e) => rowMenu(e)}
        >
          <div className={`frow head ${showUrls ? 'with-url' : ''}`}>
            <SortHead k="name" label="Name" />
            <SortHead k="mtime" label="Date Modified" />
            <SortHead k="size" label="Size" />
            <SortHead k="kind" label={loc.kind === 's3' ? 'Class' : 'Kind'} />
            {showUrls && <div>Public URL</div>}
          </div>
          {shown.map((e) => (
            <div
              key={e.path}
              className={`frow ${showUrls ? 'with-url' : ''} ${selected.has(e.path) ? 'selected' : ''}`}
              draggable
              onDragStart={(ev) => onDragStart(ev, e)}
              onDragOver={e.isDir ? (ev) => ev.preventDefault() : undefined}
              onDrop={e.isDir ? (ev) => handleDrop(ev, e.path) : undefined}
              onClick={(ev) => clickRow(ev, e)}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => rowMenu(ev, e)}
            >
              <div className="fname">
                {e.isDir ? (
                  <Folder size={18} color="#5aa9f0" fill="#5aa9f0" className="icon" />
                ) : (
                  <File size={18} color="var(--text-3)" className="icon" />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
              </div>
              <div>{e.mtime ? new Date(e.mtime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
              <div>{e.isDir ? '- -' : formatSize(e.size)}</div>
              <div>{loc.kind === 's3' ? (e.isDir ? 'folder' : e.storageClass || 'STANDARD') : kindOf(e)}</div>
              {showUrls && (
                <div className="url-cell">
                  {!e.isDir && (
                    <>
                      <span className="mono" title={urlFor(e.path)}>
                        {urlFor(e.path)}
                      </span>
                      <button
                        className="icon-btn"
                        title="Copy public URL"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          copy(urlFor(e.path), 'Public URL')
                        }}
                      >
                        <Copy size={12} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {!loading && shown.length === 0 && (
            <div className="empty" style={{ minHeight: 160 }}>
              <p>{filter ? 'No matches.' : loc.kind === 's3' ? 'This folder is empty. Drop files here to upload.' : 'Empty folder.'}</p>
            </div>
          )}
          {nextToken && (
            <div style={{ padding: 10, textAlign: 'center' }}>
              <button className="btn soft" onClick={loadMore} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
      {infoKey && loc.kind === 's3' && conn && (
        <ObjectInfoPanel conn={conn} bucket={loc.bucket} objectKey={infoKey} onClose={() => setInfoKey(null)} />
      )}
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}

function BucketList({ connectionId, onOpen }: { connectionId: string; onOpen: (bucket: string) => void }) {
  const { notify } = useStore()
  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null)
  const [canList, setCanList] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const { menu, open, close } = useMenu()

  const load = useCallback(async () => {
    setError('')
    setBuckets(null)
    try {
      const res = await window.api.s3.buckets(connectionId)
      setBuckets(res.buckets)
      setCanList(res.canList)
    } catch (err) {
      setError(errMsg(err))
    }
  }, [connectionId])
  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    const name = await promptDialog({ title: 'New bucket', label: 'Bucket name (lowercase, digits, hyphens)' })
    if (!name) return
    try {
      await window.api.s3.createBucket(connectionId, name.trim())
      notify(`Bucket ${name} created`)
      load()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const del = async (b: string) => {
    if (
      !(await confirmDialog({
        title: 'Delete bucket',
        message: `Delete bucket “${b}”? It must be empty.`,
        danger: true,
        confirm: 'Delete'
      }))
    )
      return
    try {
      await window.api.s3.deleteBucket(connectionId, b)
      notify(`Bucket ${b} deleted`)
      load()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  if (error)
    return (
      <div className="empty">
        <div className="tile">
          <AlertCircle size={20} color="var(--danger)" />
        </div>
        <h3>Cannot list buckets</h3>
        <p>{error}</p>
        <p className="hint">If this key is limited to one bucket, set it as the connection’s default bucket, or type it in the path bar.</p>
        <button className="btn primary" onClick={load}>
          Retry
        </button>
      </div>
    )
  if (!buckets)
    return (
      <div className="empty">
        <Loader2 size={22} className="spin" />
      </div>
    )
  const shown = buckets.filter((b) => b.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="ftable" style={{ padding: 14 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="input" style={{ flex: 1, height: 32 }}>
          <Search size={14} />
          <input placeholder="Find a bucket" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn soft" onClick={create}>
          <Plus size={14} /> New bucket
        </button>
      </div>
      {!canList && <p className="hint">This key can’t list buckets: showing the connection’s default bucket.</p>}
      {shown.length === 0 && <p className="hint">No buckets.</p>}
      <div className="grid list">
        {shown.map((b) => (
          <div
            key={b.name}
            className="card"
            style={{ cursor: 'pointer' }}
            onDoubleClick={() => onOpen(b.name)}
            onClick={() => onOpen(b.name)}
            onContextMenu={(e) =>
              open(e, [
                { label: 'Open', icon: FolderOpen, onClick: () => onOpen(b.name) },
                '-',
                { label: 'Delete bucket', icon: Trash2, danger: true, onClick: () => del(b.name) }
              ])
            }
          >
            <div className="icon-tile sm" style={{ background: '#14707a' }}>
              <Box size={15} />
            </div>
            <div className="meta">
              <div className="name">{b.name}</div>
              {b.created && <div className="sub">Created {new Date(b.created).toLocaleDateString()}</div>}
            </div>
            <ExternalLink size={13} color="var(--text-3)" />
          </div>
        ))}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}
