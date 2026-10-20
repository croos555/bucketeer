// window.api: the renderer's single door to the Rust backend (src-tauri), over Tauri commands and events.
// Command names are snake_case; event names ("vault:changed", "transfer:progress") match src-tauri.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type {
  BucketInfo,
  Collection,
  Connection,
  FileEntry,
  ListResult,
  ObjectInfo,
  Settings,
  TransferProgress,
  Vault
} from '@shared/types'

export interface ProxyInfo {
  url: string
  source: 'manual' | 'environment' | 'system'
  noProxy: string
}

function on<T>(event: string, cb: (payload: T) => void): () => void {
  const unlisten = listen<T>(event, (e) => cb(e.payload))
  return () => void unlisten.then((f) => f())
}

function platform(): 'darwin' | 'win32' | 'linux' {
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

const fire = (cmd: string, args?: Record<string, unknown>) => void invoke(cmd, args).catch(() => {})

const api = {
  platform: platform(),

  vault: {
    get: () => invoke<Vault>('vault_get'),
    upsert: <T>(col: Collection, item: T) => invoke<T & { id: string }>('vault_upsert', { col, item }),
    remove: (col: Collection, id: string) => invoke<void>('vault_remove', { col, id }),
    settings: (patch: Partial<Settings>) => invoke<Settings>('vault_settings', { patch }),
    storageInfo: () => invoke<{ encrypted: boolean; backend: string }>('vault_storage_info'),
    onChanged: (cb: () => void) => on('vault:changed', cb)
  },

  s3: {
    test: (c: Partial<Connection>) => invoke<{ buckets: number | null; message: string }>('s3_test', { c }),
    buckets: (id: string) => invoke<{ buckets: BucketInfo[]; canList: boolean }>('s3_buckets', { id }),
    createBucket: (id: string, name: string) => invoke<void>('s3_create_bucket', { id, name }),
    deleteBucket: (id: string, name: string) => invoke<void>('s3_delete_bucket', { id, name }),
    list: (id: string, bucket: string, prefix: string, token?: string) =>
      invoke<ListResult>('s3_list', { id, bucket, prefix, token }),
    remove: (id: string, bucket: string, keys: string[]) => invoke<number>('s3_delete', { id, bucket, keys }),
    mkdir: (id: string, bucket: string, prefix: string) => invoke<void>('s3_mkdir', { id, bucket, prefix }),
    rename: (id: string, bucket: string, from: string, to: string) => invoke<void>('s3_rename', { id, bucket, from, to }),
    info: (id: string, bucket: string, key: string) => invoke<ObjectInfo>('s3_info', { id, bucket, key }),
    isPublic: (id: string, bucket: string, key: string) => invoke<boolean>('s3_is_public', { id, bucket, key }),
    setPublic: (id: string, bucket: string, keys: string[], on: boolean) =>
      invoke<number>('s3_set_public', { id, bucket, keys, on }),
    checkUrl: (url: string) => invoke<{ ok: boolean; status: number }>('s3_check_url', { url }),
    presign: (id: string, bucket: string, key: string, seconds: number) =>
      invoke<string>('s3_presign', { id, bucket, key, seconds })
  },

  transfer: {
    upload: (id: string, bucket: string, prefix: string, paths: string[]) =>
      invoke<string>('transfer_upload', { id, bucket, prefix, paths }),
    download: (id: string, bucket: string, keys: string[], dir: string) =>
      invoke<string>('transfer_download', { id, bucket, keys, dir }),
    copy: (src: { connId: string; bucket: string }, keys: string[], dst: { connId: string; bucket: string; prefix: string }) =>
      invoke<string>('transfer_copy', { src, keys, dst }),
    cancel: (id: string) => fire('transfer_cancel', { id }),
    onProgress: (cb: (t: TransferProgress) => void) => on('transfer:progress', cb)
  },

  local: {
    home: () => invoke<string>('local_home'),
    list: (dir: string) => invoke<FileEntry[]>('local_list', { dir }),
    parent: (path: string) => invoke<string>('local_parent', { path }),
    mkdir: (path: string) => invoke<void>('local_mkdir', { path }),
    rename: (from: string, to: string) => invoke<void>('local_rename', { from, to }),
    remove: (paths: string[]) => invoke<void>('local_delete', { paths }),
    open: (path: string) => invoke<string>('local_open', { path }),
    pick: async (dirs: boolean): Promise<string[]> => {
      const res = await open(dirs ? { directory: true } : { multiple: true })
      return res ? (Array.isArray(res) ? res : [res]) : []
    }
  },

  proxyStatus: () => invoke<{ current: ProxyInfo | null; system: ProxyInfo | null }>('proxy_status'),

  copyText: (text: string) => writeText(text)
}

export type Api = typeof api

declare global {
  interface Window {
    api: Api
  }
}

window.api = api

// Files dropped from the OS: Tauri reports paths and a position; hand them to the element under the
// cursor as an "os-file-drop" DOM event (panes listen for it). Disabled on Windows (see tauri.windows.conf.json).
void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type !== 'drop' || !e.payload.paths.length) return
  const ratio = window.devicePixelRatio || 1
  const el = document.elementFromPoint(e.payload.position.x / ratio, e.payload.position.y / ratio)
  el?.dispatchEvent(new CustomEvent('os-file-drop', { bubbles: true, detail: { paths: e.payload.paths } }))
})
