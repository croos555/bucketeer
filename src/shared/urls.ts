import type { Connection } from './types'

// Keys can hold any character: encode each path segment, keep the slashes
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

// Public (unsigned) URL of an object. It only opens if the bucket/object is publicly readable.
export function publicUrl(
  c: Pick<Connection, 'provider' | 'endpoint' | 'region' | 'forcePathStyle' | 'publicBaseUrl'>,
  bucket: string,
  key: string
): string {
  const path = encodeKey(key)
  if (c.publicBaseUrl?.trim()) {
    const base = c.publicBaseUrl.trim().replace('{bucket}', bucket).replace(/\/+$/, '')
    return `${base}/${path}`
  }
  if (c.provider === 'aws' && !c.endpoint) {
    const region = c.region || 'us-east-1'
    // Dots in bucket names break the virtual-hosted TLS certificate: fall back to path style
    return bucket.includes('.') || c.forcePathStyle
      ? `https://s3.${region}.amazonaws.com/${bucket}/${path}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${path}`
  }
  let endpoint = (c.endpoint || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(endpoint)) endpoint = 'https://' + endpoint
  if (c.forcePathStyle || bucket.includes('.')) return `${endpoint}/${bucket}/${path}`
  const u = new URL(endpoint)
  return `${u.protocol}//${bucket}.${u.host}${u.pathname.replace(/\/$/, '')}/${path}`
}

export function s3Uri(bucket: string, key: string) {
  return `s3://${bucket}/${key}`
}
