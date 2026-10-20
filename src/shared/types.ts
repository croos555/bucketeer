export type Provider = 'ovh' | 'aws' | 'scaleway' | 'wasabi' | 'r2' | 'minio' | 'custom'

export interface Group {
  id: string
  name: string
  parentId?: string | null
  icon?: string | null
  color?: string | null
  createdAt: number
}

export interface Connection {
  id: string
  label: string
  provider: Provider
  // Empty for AWS (SDK default endpoint)
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  // Path-style URLs (endpoint/bucket/key) instead of virtual-hosted (bucket.endpoint/key); MinIO needs it
  forcePathStyle: boolean
  // Opened directly; also the way in when the key may not list buckets
  defaultBucket?: string
  // Custom public URL base (CDN, custom domain, static website). {bucket} is replaced by the bucket name.
  // Empty = derived from the endpoint.
  publicBaseUrl?: string
  // Canned ACL applied to uploaded/copied objects; public-read makes their public URL work
  uploadAcl?: 'private' | 'public-read'
  groupId?: string | null
  icon?: string | null
  color?: string | null
  lastUsedAt?: number
  createdAt: number
}

export interface Bookmark {
  id: string
  connectionId: string
  bucket: string
  prefix: string
  label: string
  createdAt: number
}

export interface Settings {
  appearance: 'system' | 'light' | 'dark'
  // Multipart upload tuning
  partSizeMB: number
  concurrency: number
  confirmDelete: boolean
  showHidden: boolean
  keepRunningInBackground: boolean
  // HTTP(S) proxy for S3 requests: the OS/environment setting, a manual one, or direct connections
  proxyMode: 'system' | 'manual' | 'none'
  proxyUrl?: string
  proxyUser?: string
  // Encrypted at rest like the secret keys
  proxyPassword?: string
  // Comma-separated hosts, .domains or CIDR ranges that bypass the proxy
  proxyNoProxy?: string
}

export interface Vault {
  version: 1
  groups: Group[]
  connections: Connection[]
  bookmarks: Bookmark[]
  settings: Settings
}

export type Collection = 'groups' | 'connections' | 'bookmarks'

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  partSizeMB: 16,
  concurrency: 4,
  confirmDelete: true,
  showHidden: true,
  keepRunningInBackground: false,
  proxyMode: 'system'
}

// ---- Browsing ----

export interface FileEntry {
  name: string
  // Local: absolute path. S3: full key (folders end with '/')
  path: string
  isDir: boolean
  size: number
  mtime: number
  storageClass?: string
  etag?: string
}

export interface BucketInfo {
  name: string
  created?: number
}

export interface ListResult {
  entries: FileEntry[]
  // Set when the listing was truncated; pass back to load the next page
  nextToken?: string
}

export interface ObjectInfo {
  key: string
  size: number
  mtime: number
  etag?: string
  contentType?: string
  storageClass?: string
  cacheControl?: string
  contentEncoding?: string
  versionId?: string
  metadata: Record<string, string>
}

// Where a pane points: the local disk, or a bucket of a saved connection
export type Location =
  | { kind: 'local'; path: string }
  | { kind: 's3'; connectionId: string; bucket: string; prefix: string }

export interface TransferProgress {
  transferId: string
  direction: 'upload' | 'download' | 'copy'
  name: string
  transferred: number
  total: number
  files: number
  filesDone: number
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
}
