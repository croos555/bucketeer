import type { WebContents } from 'electron'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'
import { Transform, Readable } from 'stream'
import { Upload } from '@aws-sdk/lib-storage'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import mime from 'mime-types'
import type { TransferProgress } from '@shared/types'
import { client, CopyObjectCommand, copySource, expand, GetObjectCommand, s3Error } from './s3'
import { store } from './store'

interface Running {
  t: TransferProgress
  abort: AbortController
  // The in-flight multipart upload, aborted on cancel
  upload?: Upload
}

const running = new Map<string, Running>()

function emit(wc: WebContents, t: TransferProgress) {
  if (!wc.isDestroyed()) wc.send('transfer:progress', { ...t })
}

function start(
  wc: WebContents,
  direction: TransferProgress['direction'],
  name: string,
  work: (r: Running, report: () => void) => Promise<void>
): string {
  const transferId = randomUUID()
  const r: Running = {
    t: { transferId, direction, name, transferred: 0, total: 0, files: 0, filesDone: 0, status: 'running' },
    abort: new AbortController()
  }
  running.set(transferId, r)
  let last = 0
  const report = () => {
    const now = Date.now()
    if (now - last > 120) {
      last = now
      emit(wc, r.t)
    }
  }
  emit(wc, r.t)
  work(r, report)
    .then(() => {
      r.t.status = r.abort.signal.aborted ? 'cancelled' : 'done'
    })
    .catch((err) => {
      r.t.status = r.abort.signal.aborted ? 'cancelled' : 'error'
      r.t.error = s3Error(err).message
    })
    .finally(() => {
      emit(wc, r.t)
      running.delete(transferId)
    })
  return transferId
}

export function cancel(id: string) {
  const r = running.get(id)
  if (!r) return
  r.abort.abort()
  r.upload?.abort().catch(() => {})
}

// Counts bytes flowing through a stream
function counter(onBytes: (n: number) => void) {
  return new Transform({
    transform(chunk, _enc, cb) {
      onBytes(chunk.length)
      cb(null, chunk)
    }
  })
}

// Connection setting "new uploads are public"
function aclFor(connId: string): { ACL?: 'public-read' } {
  return store.get().connections.find((c) => c.id === connId)?.uploadAcl === 'public-read' ? { ACL: 'public-read' } : {}
}

function uploadOptions() {
  const { partSizeMB, concurrency } = store.get().settings
  return { partSize: Math.max(5, partSizeMB) * 1024 * 1024, queueSize: Math.max(1, Math.min(16, concurrency)) }
}

async function walkLocal(path: string, base: string, out: { path: string; rel: string; size: number }[]) {
  const st = await fsp.stat(path)
  if (st.isDirectory()) {
    const children = await fsp.readdir(path)
    // Keep empty folders visible in S3 with a folder marker
    if (!children.length) out.push({ path, rel: relative(base, path).split(sep).join('/') + '/', size: -1 })
    for (const c of children) await walkLocal(join(path, c), base, out)
  } else out.push({ path, rel: relative(base, path).split(sep).join('/'), size: st.size })
}

export function upload(wc: WebContents, connId: string, bucket: string, prefix: string, localPaths: string[]) {
  const name = localPaths.length === 1 ? basename(localPaths[0]) : `${localPaths.length} items`
  return start(wc, 'upload', name, async (r, report) => {
    const files: { path: string; rel: string; size: number }[] = []
    for (const p of localPaths) await walkLocal(p, dirname(p), files)
    r.t.files = files.length
    r.t.total = files.reduce((n, f) => n + Math.max(0, f.size), 0)
    report()
    for (const f of files) {
      if (r.abort.signal.aborted) throw new Error('Cancelled')
      const key = prefix + f.rel
      const base = r.t.transferred
      if (f.size < 0) {
        // Empty local folder: create the "folder/" marker object
        await client(connId).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0), ContentLength: 0 }), { abortSignal: r.abort.signal })
        r.t.filesDone++
        report()
        continue
      }
      const up = new Upload({
        client: client(connId),
        params: {
          Bucket: bucket,
          Key: key,
          Body: createReadStream(f.path),
          ...aclFor(connId),
          // Known length: lets small files go as a plain PUT instead of a chunked stream some providers refuse
          ContentLength: f.size,
          ContentType: mime.lookup(f.path) || 'application/octet-stream'
        },
        ...uploadOptions()
      })
      r.upload = up
      up.on('httpUploadProgress', (p) => {
        r.t.transferred = base + (p.loaded || 0)
        report()
      })
      await up.done()
      r.upload = undefined
      r.t.transferred = base + Math.max(0, f.size)
      r.t.filesDone++
      report()
    }
  })
}

// Selected "a/b/c.txt" lands as "c.txt"; selected folder "a/b/" lands as "b/…"
function relativeTo(selected: string, key: string) {
  const base = selected.endsWith('/') ? selected.slice(0, selected.slice(0, -1).lastIndexOf('/') + 1) : selected.slice(0, selected.lastIndexOf('/') + 1)
  return key.slice(base.length)
}

export function download(wc: WebContents, connId: string, bucket: string, keys: string[], localDir: string) {
  const name = keys.length === 1 ? keys[0].replace(/\/$/, '').split('/').pop()! : `${keys.length} items`
  return start(wc, 'download', name, async (r, report) => {
    const plan: { key: string; size: number; rel: string }[] = []
    for (const sel of keys) for (const o of await expand(connId, bucket, [sel])) plan.push({ ...o, rel: relativeTo(sel, o.key) })
    r.t.files = plan.length
    r.t.total = plan.reduce((n, o) => n + o.size, 0)
    report()
    for (const o of plan) {
      if (r.abort.signal.aborted) throw new Error('Cancelled')
      const dest = join(localDir, ...o.rel.split('/'))
      if (o.key.endsWith('/')) {
        await fsp.mkdir(dest, { recursive: true })
        r.t.filesDone++
        continue
      }
      await fsp.mkdir(dirname(dest), { recursive: true })
      const res = await client(connId).send(new GetObjectCommand({ Bucket: bucket, Key: o.key }), {
        abortSignal: r.abort.signal
      })
      await pipeline(
        res.Body as Readable,
        counter((n) => {
          r.t.transferred += n
          report()
        }),
        createWriteStream(dest)
      )
      r.t.filesDone++
      report()
    }
  })
}

// S3 → S3. Same connection: server-side copy (no data through this machine, objects up to 5 GB).
// Otherwise the object is streamed from one provider to the other.
export function copy(
  wc: WebContents,
  src: { connId: string; bucket: string },
  keys: string[],
  dst: { connId: string; bucket: string; prefix: string }
) {
  const name = keys.length === 1 ? keys[0].replace(/\/$/, '').split('/').pop()! : `${keys.length} items`
  return start(wc, 'copy', name, async (r, report) => {
    const plan: { key: string; size: number; rel: string }[] = []
    for (const sel of keys) for (const o of await expand(src.connId, src.bucket, [sel])) plan.push({ ...o, rel: relativeTo(sel, o.key) })
    r.t.files = plan.length
    r.t.total = plan.reduce((n, o) => n + o.size, 0)
    report()
    const FIVE_GB = 5 * 1024 ** 3
    for (const o of plan) {
      if (r.abort.signal.aborted) throw new Error('Cancelled')
      const destKey = dst.prefix + o.rel
      if (src.connId === dst.connId && o.size < FIVE_GB) {
        await client(dst.connId).send(
          // A copy doesn't keep the source ACL: apply the destination connection's choice
          new CopyObjectCommand({ Bucket: dst.bucket, Key: destKey, CopySource: copySource(src.bucket, o.key), ...aclFor(dst.connId) }),
          { abortSignal: r.abort.signal }
        )
        r.t.transferred += o.size
      } else {
        const res = await client(src.connId).send(new GetObjectCommand({ Bucket: src.bucket, Key: o.key }), {
          abortSignal: r.abort.signal
        })
        const base = r.t.transferred
        const up = new Upload({
          client: client(dst.connId),
          params: {
            Bucket: dst.bucket,
            Key: destKey,
            Body: res.Body as Readable,
            ContentLength: res.ContentLength,
            ContentType: res.ContentType,
            ...aclFor(dst.connId)
          },
          ...uploadOptions()
        })
        r.upload = up
        up.on('httpUploadProgress', (p) => {
          r.t.transferred = base + (p.loaded || 0)
          report()
        })
        await up.done()
        r.upload = undefined
        r.t.transferred = base + o.size
      }
      r.t.filesDone++
      report()
    }
  })
}
