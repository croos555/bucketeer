import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { Collection, Connection, FileEntry, Settings } from '@shared/types'
import { store } from './store'
import * as s3 from './s3'
import * as transfers from './transfers'
import { handOff, showSplash } from './splash'
import icon from '../../build/icon.png?asset'

function createWindow(splash?: BrowserWindow) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#14161d',
    title: 'Bucketeer',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    // Windows/macOS take the icon from the packaged app; Linux needs it on the window
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (splash) handOff(splash, win)
  else win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------- vault ----------

ipcMain.handle('vault:get', () => store.get())
ipcMain.handle('vault:upsert', (_e, col: Collection, item: any) => store.upsert(col, item))
ipcMain.handle('vault:remove', (_e, col: Collection, id: string) => store.remove(col, id))
ipcMain.handle('vault:settings', (_e, patch: Partial<Settings>) => store.updateSettings(patch))
ipcMain.handle('vault:storageInfo', () => ({
  encrypted: safeStorage.isEncryptionAvailable(),
  backend:
    process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'keychain' : 'dpapi'
}))

// ---------- S3 ----------

ipcMain.handle('s3:test', (_e, c: Connection) => s3.testConnection(c))
ipcMain.handle('s3:buckets', (_e, id: string) => s3.listBuckets(id))
ipcMain.handle('s3:createBucket', (_e, id: string, name: string) => s3.createBucket(id, name))
ipcMain.handle('s3:deleteBucket', (_e, id: string, name: string) => s3.deleteBucket(id, name))
ipcMain.handle('s3:list', (_e, id: string, bucket: string, prefix: string, token?: string) => s3.list(id, bucket, prefix, token))
ipcMain.handle('s3:delete', (_e, id: string, bucket: string, keys: string[]) => s3.deleteKeys(id, bucket, keys))
ipcMain.handle('s3:mkdir', (_e, id: string, bucket: string, prefix: string) => s3.mkdir(id, bucket, prefix))
ipcMain.handle('s3:rename', (_e, id: string, bucket: string, from: string, to: string) => s3.rename(id, bucket, from, to))
ipcMain.handle('s3:info', (_e, id: string, bucket: string, key: string) => s3.info(id, bucket, key))
ipcMain.handle('s3:isPublic', (_e, id: string, bucket: string, key: string) => s3.isPublic(id, bucket, key))
ipcMain.handle('s3:setPublic', (_e, id: string, bucket: string, keys: string[], on: boolean) => s3.setPublic(id, bucket, keys, on))
ipcMain.handle('s3:checkUrl', (_e, url: string) => s3.checkPublicUrl(url))
ipcMain.handle('s3:presign', (_e, id: string, bucket: string, key: string, seconds: number) => s3.presign(id, bucket, key, seconds))

ipcMain.handle('transfer:upload', (e, id: string, bucket: string, prefix: string, paths: string[]) =>
  transfers.upload(e.sender, id, bucket, prefix, paths)
)
ipcMain.handle('transfer:download', (e, id: string, bucket: string, keys: string[], dir: string) =>
  transfers.download(e.sender, id, bucket, keys, dir)
)
ipcMain.handle('transfer:copy', (e, src: { connId: string; bucket: string }, keys: string[], dst: { connId: string; bucket: string; prefix: string }) =>
  transfers.copy(e.sender, src, keys, dst)
)
ipcMain.on('transfer:cancel', (_e, id: string) => transfers.cancel(id))

// ---------- local disk ----------

ipcMain.handle('local:home', () => homedir())
ipcMain.handle('local:list', async (_e, dir: string): Promise<FileEntry[]> => {
  const out: FileEntry[] = []
  for (const name of await fsp.readdir(dir)) {
    const full = join(dir, name)
    try {
      const lst = await fsp.lstat(full)
      const st = lst.isSymbolicLink() ? await fsp.stat(full).catch(() => lst) : lst
      out.push({ name, path: full, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
    } catch {
      // unreadable entry (permissions, broken mount): skip
    }
  }
  return out
})
ipcMain.handle('local:parent', (_e, path: string) => dirname(path))
ipcMain.handle('local:mkdir', (_e, path: string) => fsp.mkdir(path))
ipcMain.handle('local:rename', (_e, from: string, to: string) => fsp.rename(from, to))
ipcMain.handle('local:delete', async (_e, paths: string[]) => {
  for (const p of paths) await shell.trashItem(p)
})
ipcMain.handle('local:open', (_e, path: string) => shell.openPath(path))
ipcMain.handle('dialog:pick', async (_e, dirs: boolean) => {
  const res = await dialog.showOpenDialog({ properties: dirs ? ['openDirectory'] : ['openFile', 'multiSelections'] })
  return res.canceled ? [] : res.filePaths
})
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))

// ---------- lifecycle ----------

// One instance only: a second launch brings back (or reopens) the running window
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

app.whenReady().then(() => {
  // Packaged builds have the bundle icon; show it in the Dock during development too
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
  const splash = showSplash()
  store.load()
  createWindow(splash)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Closing the window quits, on macOS too, unless transfers should keep running in the background
app.on('window-all-closed', () => {
  if (!store.get().settings.keepRunningInBackground) app.quit()
})
