import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectAclCommand,
  PutObjectAclCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { BucketInfo, Connection, ListResult, ObjectInfo } from '@shared/types'
import { store } from './store'

// One client per connection, rebuilt when the connection is edited
const clients = new Map<string, S3Client>()
store.onConnectionChange((id) => {
  if (!id) return
  clients.get(id)?.destroy()
  clients.delete(id)
})

export function makeClient(c: Pick<Connection, 'provider' | 'endpoint' | 'region' | 'accessKeyId' | 'secretAccessKey' | 'forcePathStyle'>): S3Client {
  return new S3Client({
    region: c.region || 'us-east-1',
    endpoint: c.endpoint || undefined,
    forcePathStyle: !!c.forcePathStyle,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    // The SDK now adds CRC32 checksums to every request; many S3-compatible stores (OVH, older MinIO, R2…)
    // reject or mishandle them, so only send/check them when the API requires it
    ...(c.provider === 'aws' ? {} : { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' }),
    maxAttempts: 3
  })
}

export function connection(id: string): Connection {
  const c = store.get().connections.find((x) => x.id === id)
  if (!c) throw new Error('Connection not found')
  return c
}

export function client(id: string): S3Client {
  let cl = clients.get(id)
  if (!cl) {
    cl = makeClient(connection(id))
    clients.set(id, cl)
  }
  return cl
}

// Turn SDK errors into something readable
export function s3Error(err: any): Error {
  const code = err?.name || err?.Code
  const status = err?.$metadata?.httpStatusCode
  const map: Record<string, string> = {
    InvalidAccessKeyId: 'Unknown access key',
    SignatureDoesNotMatch: 'Wrong secret key (signature mismatch)',
    AccessDenied: 'Access denied for this key',
    NoSuchBucket: 'Bucket not found',
    NoSuchKey: 'Object not found',
    BucketNotEmpty: 'The bucket is not empty',
    BucketAlreadyExists: 'This bucket name is already taken',
    BucketAlreadyOwnedByYou: 'You already own a bucket with this name',
    InvalidBucketName: 'Invalid bucket name (3-63 chars: lowercase letters, digits, dots, hyphens)',
    PermanentRedirect: 'Wrong region or endpoint for this bucket',
    AuthorizationHeaderMalformed: 'Wrong region for this endpoint',
    AccessControlListNotSupported: 'ACLs are disabled on this bucket (object ownership enforced): use a bucket policy instead',
    NotImplemented: 'This provider does not support this operation'
  }
  if (code && map[code]) return new Error(map[code])
  if (err?.code === 'ENOTFOUND') return new Error(`Endpoint not found: ${err.hostname || ''}`)
  if (err?.code === 'ECONNREFUSED') return new Error('Connection refused by the endpoint')
  const msg = err?.message && err.message !== 'UnknownError' ? err.message : code || 'Request failed'
  return new Error(status ? `${msg} (HTTP ${status})` : msg)
}

export async function testConnection(c: Connection): Promise<{ buckets: number | null; message: string }> {
  const cl = makeClient(c)
  try {
    const res = await cl.send(new ListBucketsCommand({}))
    return { buckets: res.Buckets?.length ?? 0, message: `Connected: ${res.Buckets?.length ?? 0} bucket(s)` }
  } catch (err: any) {
    // Keys scoped to one bucket often can't list buckets: try the default bucket instead
    if (err?.name === 'AccessDenied' && c.defaultBucket) {
      await cl.send(new ListObjectsV2Command({ Bucket: c.defaultBucket, MaxKeys: 1 })).catch((e) => {
        throw s3Error(e)
      })
      return { buckets: null, message: `Connected to bucket ${c.defaultBucket} (this key can't list buckets)` }
    }
    throw s3Error(err)
  } finally {
    cl.destroy()
  }
}

export async function listBuckets(id: string): Promise<{ buckets: BucketInfo[]; canList: boolean }> {
  try {
    const res = await client(id).send(new ListBucketsCommand({}))
    store.touch(id)
    return {
      canList: true,
      buckets: (res.Buckets || [])
        .map((b) => ({ name: b.Name!, created: b.CreationDate?.getTime() }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch (err: any) {
    const def = connection(id).defaultBucket
    if (err?.name === 'AccessDenied' && def) return { canList: false, buckets: [{ name: def }] }
    throw s3Error(err)
  }
}

export async function createBucket(id: string, name: string) {
  const c = connection(id)
  // AWS wants the region spelled out except in us-east-1; other providers infer it from the endpoint
  const cfg =
    c.provider === 'aws' && c.region && c.region !== 'us-east-1'
      ? { CreateBucketConfiguration: { LocationConstraint: c.region as any } }
      : {}
  await client(id).send(new CreateBucketCommand({ Bucket: name, ...cfg })).catch((e) => {
    throw s3Error(e)
  })
}

export async function deleteBucket(id: string, name: string) {
  // Some S3-compatible servers delete non-empty buckets: never rely on the server for that
  const probe = await client(id)
    .send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }))
    .catch((e) => {
      throw s3Error(e)
    })
  if (probe.KeyCount || probe.Contents?.length) throw new Error('The bucket is not empty')
  await client(id).send(new DeleteBucketCommand({ Bucket: name })).catch((e) => {
    throw s3Error(e)
  })
}

// One level of a "folder": common prefixes become folders, objects become files
export async function list(id: string, bucket: string, prefix: string, token?: string): Promise<ListResult> {
  let res: ListObjectsV2CommandOutput
  try {
    res = await client(id).send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token, MaxKeys: 1000 })
    )
  } catch (err) {
    throw s3Error(err)
  }
  const folders = (res.CommonPrefixes || []).map((p) => ({
    name: p.Prefix!.slice(prefix.length).replace(/\/$/, ''),
    path: p.Prefix!,
    isDir: true,
    size: 0,
    mtime: 0
  }))
  const files = (res.Contents || [])
    // The "folder marker" object for the current prefix itself
    .filter((o) => o.Key !== prefix)
    .map((o) => ({
      name: o.Key!.slice(prefix.length),
      path: o.Key!,
      isDir: false,
      size: o.Size || 0,
      mtime: o.LastModified?.getTime() || 0,
      storageClass: o.StorageClass,
      etag: o.ETag?.replace(/"/g, '')
    }))
  return { entries: [...folders, ...files], nextToken: res.IsTruncated ? res.NextContinuationToken : undefined }
}

// Every object under a prefix (recursive), for transfers, deletes and moves
export async function listAll(id: string, bucket: string, prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = []
  let token: string | undefined
  do {
    const res = await client(id)
      .send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
      .catch((e) => {
        throw s3Error(e)
      })
    for (const o of res.Contents || []) out.push({ key: o.Key!, size: o.Size || 0 })
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}

// Expand a mix of keys and "folder/" prefixes into concrete objects
export async function expand(id: string, bucket: string, keys: string[]) {
  const out: { key: string; size: number }[] = []
  for (const k of keys) {
    if (k.endsWith('/')) out.push(...(await listAll(id, bucket, k)))
    else {
      const head = await client(id)
        .send(new HeadObjectCommand({ Bucket: bucket, Key: k }))
        .catch((e) => {
          throw s3Error(e)
        })
      out.push({ key: k, size: head.ContentLength || 0 })
    }
  }
  return out
}

export async function deleteKeys(id: string, bucket: string, keys: string[]) {
  const all = (await expand(id, bucket, keys)).map((o) => o.key)
  // Folder markers ("a/b/") that listAll may not return for empty folders
  for (const k of keys) if (k.endsWith('/') && !all.includes(k)) all.push(k)
  for (let i = 0; i < all.length; i += 1000) {
    const batch = all.slice(i, i + 1000)
    const res = await client(id)
      .send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
      .catch((e) => {
        throw s3Error(e)
      })
    if (res.Errors?.length) throw new Error(`Could not delete ${res.Errors.length} object(s): ${res.Errors[0].Message}`)
  }
  return all.length
}

export async function mkdir(id: string, bucket: string, prefix: string) {
  const key = prefix.endsWith('/') ? prefix : prefix + '/'
  await client(id)
    .send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0), ContentLength: 0 }))
    .catch((e) => {
      throw s3Error(e)
    })
}

// CopySource must be URL-encoded per path segment
export function copySource(bucket: string, key: string) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// Rename = server-side copy then delete, recursively for folders
export async function rename(id: string, bucket: string, from: string, to: string) {
  // listAll includes the "folder/" marker object when one exists; implicit folders have none
  const objects = from.endsWith('/') ? await listAll(id, bucket, from) : [{ key: from, size: 0 }]
  for (const o of objects) {
    const dest = to + o.key.slice(from.length)
    await client(id)
      .send(new CopyObjectCommand({ Bucket: bucket, Key: dest, CopySource: copySource(bucket, o.key) }))
      .catch((e) => {
        throw s3Error(e)
      })
  }
  await deleteKeys(id, bucket, objects.map((o) => o.key))
}

export async function info(id: string, bucket: string, key: string): Promise<ObjectInfo> {
  const h = await client(id)
    .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    .catch((e) => {
      throw s3Error(e)
    })
  return {
    key,
    size: h.ContentLength || 0,
    mtime: h.LastModified?.getTime() || 0,
    etag: h.ETag?.replace(/"/g, ''),
    contentType: h.ContentType,
    storageClass: h.StorageClass,
    cacheControl: h.CacheControl,
    contentEncoding: h.ContentEncoding,
    versionId: h.VersionId,
    metadata: h.Metadata || {}
  }
}

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers'

// Public = anyone (AllUsers) may READ the object
export async function isPublic(id: string, bucket: string, key: string): Promise<boolean> {
  const acl = await client(id)
    .send(new GetObjectAclCommand({ Bucket: bucket, Key: key }))
    .catch((e) => {
      throw s3Error(e)
    })
  return (acl.Grants || []).some(
    (g) => g.Grantee?.URI === ALL_USERS && (g.Permission === 'READ' || g.Permission === 'FULL_CONTROL')
  )
}

// Apply a canned ACL to objects (folders recursively), a few requests in parallel
export async function setPublic(id: string, bucket: string, keys: string[], makePublic: boolean): Promise<number> {
  const objects = (await expand(id, bucket, keys)).filter((o) => !o.key.endsWith('/'))
  let i = 0
  const worker = async () => {
    while (i < objects.length) {
      const o = objects[i++]
      await client(id)
        .send(new PutObjectAclCommand({ Bucket: bucket, Key: o.key, ACL: makePublic ? 'public-read' : 'private' }))
        .catch((e) => {
          throw s3Error(e)
        })
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, objects.length) }, worker))
  return objects.length
}

// Ask the public URL itself, without credentials, whether it answers
export async function checkPublicUrl(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

export async function presign(id: string, bucket: string, key: string, expiresIn: number) {
  return getSignedUrl(client(id), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
}

export { GetObjectCommand, CopyObjectCommand }
