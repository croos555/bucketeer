// Tauri build: provides the same window.api as the Electron preload, on top of Tauri commands and
// events. Command names are the Electron channel names in snake_case; event names are unchanged.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { Api } from '../../preload/index'

function on<T>(event: string, cb: (payload: T) => void): () => void {
  const unlisten = listen<T>(event, (e) => cb(e.payload))
  return () => void unlisten.then((f) => f())
}

function platform(): NodeJS.Platform {
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

const fire = (cmd: string, args?: Record<string, unknown>) => void invoke(cmd, args).catch(() => {})

const api = {
  platform: platform(),

  vault: {
    get: () => invoke('vault_get'),
    upsert: (col: string, item: unknown) => invoke('vault_upsert', { col, item }),
    remove: (col: string, id: string) => invoke('vault_remove', { col, id }),
    settings: (patch: unknown) => invoke('vault_settings', { patch }),
    storageInfo: () => invoke('vault_storage_info'),
    onChanged: (cb: () => void) => on('vault:changed', cb)
  },

  s3: {
    test: (c: unknown) => invoke('s3_test', { c }),
    buckets: (id: string) => invoke('s3_buckets', { id }),
    createBucket: (id: string, name: string) => invoke('s3_create_bucket', { id, name }),
    deleteBucket: (id: string, name: string) => invoke('s3_delete_bucket', { id, name }),
    list: (id: string, bucket: string, prefix: string, token?: string) => invoke('s3_list', { id, bucket, prefix, token }),
    remove: (id: string, bucket: string, keys: string[]) => invoke('s3_delete', { id, bucket, keys }),
    mkdir: (id: string, bucket: string, prefix: string) => invoke('s3_mkdir', { id, bucket, prefix }),
    rename: (id: string, bucket: string, from: string, to: string) => invoke('s3_rename', { id, bucket, from, to }),
    info: (id: string, bucket: string, key: string) => invoke('s3_info', { id, bucket, key }),
    isPublic: (id: string, bucket: string, key: string) => invoke('s3_is_public', { id, bucket, key }),
    setPublic: (id: string, bucket: string, keys: string[], on: boolean) => invoke('s3_set_public', { id, bucket, keys, on }),
    checkUrl: (url: string) => invoke('s3_check_url', { url }),
    presign: (id: string, bucket: string, key: string, seconds: number) => invoke('s3_presign', { id, bucket, key, seconds })
  },

  transfer: {
    upload: (id: string, bucket: string, prefix: string, paths: string[]) => invoke('transfer_upload', { id, bucket, prefix, paths }),
    download: (id: string, bucket: string, keys: string[], dir: string) => invoke('transfer_download', { id, bucket, keys, dir }),
    copy: (src: unknown, keys: string[], dst: unknown) => invoke('transfer_copy', { src, keys, dst }),
    cancel: (id: string) => fire('transfer_cancel', { id }),
    onProgress: (cb: (t: unknown) => void) => on('transfer:progress', cb)
  },

  local: {
    home: () => invoke('local_home'),
    list: (dir: string) => invoke('local_list', { dir }),
    parent: (path: string) => invoke('local_parent', { path }),
    mkdir: (path: string) => invoke('local_mkdir', { path }),
    rename: (from: string, to: string) => invoke('local_rename', { from, to }),
    remove: (paths: string[]) => invoke('local_delete', { paths }),
    open: (path: string) => invoke('local_open', { path }),
    // A webview's File objects carry no path: OS drops arrive through the drop event below instead
    pathForFile: () => '',
    pick: async (dirs: boolean) => {
      const res = await open(dirs ? { directory: true } : { multiple: true })
      return res ? (Array.isArray(res) ? res : [res]) : []
    }
  },

  copyText: (text: string) => writeText(text)
}

window.api = api as unknown as Api

// Files dropped from the OS: Tauri reports paths and a position; hand them to the element under the
// cursor as an "os-file-drop" DOM event (panes listen for it). Disabled on Windows (see tauri.windows.conf.json).
void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type !== 'drop' || !e.payload.paths.length) return
  const ratio = window.devicePixelRatio || 1
  const el = document.elementFromPoint(e.payload.position.x / ratio, e.payload.position.y / ratio)
  el?.dispatchEvent(new CustomEvent('os-file-drop', { bubbles: true, detail: { paths: e.payload.paths } }))
})
