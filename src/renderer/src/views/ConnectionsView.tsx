import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Database, FolderOpen, FolderPlus, LayoutGrid, List, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Connection, Group } from '@shared/types'
import { preset } from '@shared/providers'
import { useStore } from '../store'
import { confirmDialog, ConnectionIcon, ContextMenu, Empty, GroupIcon, useMenu } from '../components/ui'
import { groupPath } from '../components/ConnectionEditor'

function loadLayout(): 'grid' | 'list' {
  try {
    return localStorage.getItem('bucketeer.layout') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export default function ConnectionsView() {
  const { vault, editing, setEditing, openBrowser, upsert, remove, currentGroup, setCurrentGroup } = useStore()
  const [query, setQuery] = useState('')
  const [layout, setLayoutState] = useState<'grid' | 'list'>(loadLayout)
  const [newMenu, setNewMenu] = useState(false)
  const { menu, open, close } = useMenu()
  const setLayout = (l: 'grid' | 'list') => {
    setLayoutState(l)
    try {
      localStorage.setItem('bucketeer.layout', l)
    } catch {
      // not persisted, fine
    }
  }

  const { groups, conns } = useMemo(() => {
    if (!vault) return { groups: [] as Group[], conns: [] as Connection[] }
    const q = query.trim().toLowerCase()
    const byName = (a: Connection, b: Connection) => a.label.localeCompare(b.label)
    if (q) {
      return {
        groups: vault.groups.filter((g) => g.name.toLowerCase().includes(q)),
        conns: vault.connections
          .filter((c) =>
            [c.label, c.endpoint, c.region, c.defaultBucket, preset(c.provider).name].some((v) => v?.toLowerCase().includes(q))
          )
          .sort(byName)
      }
    }
    return {
      groups: vault.groups.filter((g) => (g.parentId || null) === currentGroup).sort((a, b) => a.name.localeCompare(b.name)),
      conns: vault.connections.filter((c) => (c.groupId || null) === currentGroup).sort(byName)
    }
  }, [vault, query, currentGroup])

  if (!vault) return null

  const count = (gid: string): number =>
    vault.connections.filter((c) => c.groupId === gid).length +
    vault.groups.filter((g) => g.parentId === gid).reduce((n, g) => n + count(g.id), 0)

  const crumbs: Group[] = []
  {
    let id = currentGroup
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const g = vault.groups.find((x) => x.id === id)
      if (!g) break
      crumbs.unshift(g)
      id = g.parentId || null
    }
  }

  const newConnection = () =>
    setEditing({
      kind: 'connection',
      item: { provider: 'ovh', region: 'gra', endpoint: 'https://s3.gra.io.cloud.ovh.net', forcePathStyle: false, groupId: currentGroup }
    })

  const connMenu = (e: React.MouseEvent, c: Connection) =>
    open(e, [
      { label: 'Open', icon: FolderOpen, onClick: () => openBrowser(c.id) },
      { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'connection', item: c }) },
      {
        label: 'Duplicate',
        icon: Copy,
        onClick: async () => {
          const { id, createdAt, lastUsedAt, ...rest } = c
          setEditing({ kind: 'connection', item: await upsert('connections', { ...rest, label: c.label + ' copy' }) })
        }
      },
      '-',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onClick: async () => {
          if (await confirmDialog({ title: 'Delete connection', message: `Delete "${c.label}"?`, danger: true, confirm: 'Delete' })) {
            await remove('connections', c.id)
            setEditing(null)
          }
        }
      }
    ])

  const groupMenu = (e: React.MouseEvent, g: Group) =>
    open(e, [
      { label: 'Open', icon: FolderOpen, onClick: () => setCurrentGroup(g.id) },
      { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'group', item: g }) },
      '-',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onClick: async () => {
          if (
            await confirmDialog({
              title: 'Delete group',
              message: `Delete "${g.name}"? Its connections move to the parent group.`,
              danger: true,
              confirm: 'Delete'
            })
          ) {
            await remove('groups', g.id)
            setEditing(null)
          }
        }
      }
    ])

  const selectedId = editing?.item.id

  return (
    <div className="main">
      <div className="searchbar">
        <div className="field">
          <input placeholder="Find a connection, endpoint or bucket..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="toolbar">
        <div className="btn-group" style={{ position: 'relative' }}>
          <button className="btn soft" onClick={newConnection}>
            <Plus size={15} /> New connection
          </button>
          <button className="btn soft" onClick={() => setNewMenu(!newMenu)} onBlur={() => setTimeout(() => setNewMenu(false), 150)}>
            <ChevronDown size={14} />
          </button>
          {newMenu && (
            <div className="menu" style={{ position: 'absolute', top: 34, left: 0 }}>
              <button onClick={() => setEditing({ kind: 'group', item: { parentId: currentGroup } })}>
                <FolderPlus size={14} /> New group
              </button>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => openBrowser()}>
          <FolderOpen size={15} /> Local browser
        </button>
        <div className="grow" />
        <div className="view-switch">
          <button className={`icon-btn ${layout === 'grid' ? 'active' : ''}`} title="Grid" onClick={() => setLayout('grid')}>
            <LayoutGrid size={15} />
          </button>
          <button className={`icon-btn ${layout === 'list' ? 'active' : ''}`} title="List" onClick={() => setLayout('list')}>
            <List size={16} />
          </button>
        </div>
      </div>

      <div className="content" onClick={() => setEditing(null)}>
        {crumbs.length > 0 && !query && (
          <div className="crumbs">
            <button onClick={() => setCurrentGroup(null)}>All connections</button>
            {crumbs.map((g) => (
              <span key={g.id} className="row" style={{ gap: 4 }}>
                <ChevronRight size={14} className="sep" />
                <button onClick={() => setCurrentGroup(g.id)}>{g.name}</button>
              </span>
            ))}
          </div>
        )}
        {!groups.length && !conns.length ? (
          <Empty
            icon={Database}
            title={query ? 'No matches' : 'Add a storage connection'}
            text={
              query
                ? 'Nothing matches your search.'
                : 'Connect to OVHcloud Object Storage, Amazon S3, Scaleway, Wasabi, Cloudflare R2, MinIO or any S3-compatible service.'
            }
            action={
              !query && (
                <button
                  className="btn primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    newConnection()
                  }}
                >
                  <Plus size={15} /> New connection
                </button>
              )
            }
          />
        ) : (
          <>
            {groups.length > 0 && (
              <>
                <div className="section-title">Groups</div>
                <div className={`grid ${layout === 'list' ? 'list' : ''}`}>
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className={`card ${selectedId === g.id ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ kind: 'group', item: g })
                      }}
                      onDoubleClick={() => {
                        setQuery('')
                        setCurrentGroup(g.id)
                        setEditing(null)
                      }}
                      onContextMenu={(e) => groupMenu(e, g)}
                    >
                      <GroupIcon group={g} />
                      <div className="meta">
                        <div className="name">{g.name}</div>
                        <div className="sub">
                          {count(g.id)} connection{count(g.id) === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {conns.length > 0 && (
              <>
                <div className="section-title">Connections</div>
                <div className={`grid ${layout === 'list' ? 'list' : ''}`}>
                  {conns.map((c) => (
                    <div
                      key={c.id}
                      className={`card ${selectedId === c.id ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ kind: 'connection', item: c })
                      }}
                      onDoubleClick={() => openBrowser(c.id)}
                      onContextMenu={(e) => connMenu(e, c)}
                    >
                      <ConnectionIcon conn={c} />
                      <div className="meta">
                        <div className="name">{c.label}</div>
                        <div className="sub">
                          {preset(c.provider).name}
                          {c.region ? ` · ${c.region}` : ''}
                          {c.defaultBucket ? ` · ${c.defaultBucket}` : ''}
                          {query && c.groupId ? ` · ${groupPath(vault.groups, c.groupId)}` : ''}
                        </div>
                      </div>
                      <div className="actions">
                        <button
                          className="icon-btn"
                          title="Open"
                          onClick={(e) => {
                            e.stopPropagation()
                            openBrowser(c.id)
                          }}
                        >
                          <FolderOpen size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}
