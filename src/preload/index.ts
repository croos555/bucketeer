import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
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

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,

  vault: {
    get: (): Promise<Vault> => ipcRenderer.invoke('vault:get'),
    upsert: <T>(col: Collection, item: T): Promise<T & { id: string }> => ipcRenderer.invoke('vault:upsert', col, item),
    remove: (col: Collection, id: string): Promise<void> => ipcRenderer.invoke('vault:remove', col, id),
    settings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('vault:settings', patch),
    storageInfo: (): Promise<{ encrypted: boolean; backend: string }> => ipcRenderer.invoke('vault:storageInfo'),
    onChanged: (cb: () => void) => on('vault:changed', cb)
  },

  s3: {
    test: (c: Partial<Connection>): Promise<{ buckets: number | null; message: string }> => ipcRenderer.invoke('s3:test', c),
    buckets: (id: string): Promise<{ buckets: BucketInfo[]; canList: boolean }> => ipcRenderer.invoke('s3:buckets', id),
    createBucket: (id: string, name: string): Promise<void> => ipcRenderer.invoke('s3:createBucket', id, name),
    deleteBucket: (id: string, name: string): Promise<void> => ipcRenderer.invoke('s3:deleteBucket', id, name),
    list: (id: string, bucket: string, prefix: string, token?: string): Promise<ListResult> =>
      ipcRenderer.invoke('s3:list', id, bucket, prefix, token),
    remove: (id: string, bucket: string, keys: string[]): Promise<number> => ipcRenderer.invoke('s3:delete', id, bucket, keys),
    mkdir: (id: string, bucket: string, prefix: string): Promise<void> => ipcRenderer.invoke('s3:mkdir', id, bucket, prefix),
    rename: (id: string, bucket: string, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke('s3:rename', id, bucket, from, to),
    info: (id: string, bucket: string, key: string): Promise<ObjectInfo> => ipcRenderer.invoke('s3:info', id, bucket, key),
    isPublic: (id: string, bucket: string, key: string): Promise<boolean> => ipcRenderer.invoke('s3:isPublic', id, bucket, key),
    setPublic: (id: string, bucket: string, keys: string[], on: boolean): Promise<number> =>
      ipcRenderer.invoke('s3:setPublic', id, bucket, keys, on),
    checkUrl: (url: string): Promise<{ ok: boolean; status: number }> => ipcRenderer.invoke('s3:checkUrl', url),
    presign: (id: string, bucket: string, key: string, seconds: number): Promise<string> =>
      ipcRenderer.invoke('s3:presign', id, bucket, key, seconds)
  },

  transfer: {
    upload: (id: string, bucket: string, prefix: string, paths: string[]): Promise<string> =>
      ipcRenderer.invoke('transfer:upload', id, bucket, prefix, paths),
    download: (id: string, bucket: string, keys: string[], dir: string): Promise<string> =>
      ipcRenderer.invoke('transfer:download', id, bucket, keys, dir),
    copy: (
      src: { connId: string; bucket: string },
      keys: string[],
      dst: { connId: string; bucket: string; prefix: string }
    ): Promise<string> => ipcRenderer.invoke('transfer:copy', src, keys, dst),
    cancel: (id: string) => ipcRenderer.send('transfer:cancel', id),
    onProgress: (cb: (t: TransferProgress) => void) => on('transfer:progress', cb)
  },

  local: {
    home: (): Promise<string> => ipcRenderer.invoke('local:home'),
    list: (dir: string): Promise<FileEntry[]> => ipcRenderer.invoke('local:list', dir),
    parent: (path: string): Promise<string> => ipcRenderer.invoke('local:parent', path),
    mkdir: (path: string): Promise<void> => ipcRenderer.invoke('local:mkdir', path),
    rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('local:rename', from, to),
    remove: (paths: string[]): Promise<void> => ipcRenderer.invoke('local:delete', paths),
    open: (path: string): Promise<string> => ipcRenderer.invoke('local:open', path),
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    pick: (dirs: boolean): Promise<string[]> => ipcRenderer.invoke('dialog:pick', dirs)
  },

  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
