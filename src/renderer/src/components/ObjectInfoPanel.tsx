import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Link2, Loader2, X, Clock, AlertCircle, Globe, Lock } from 'lucide-react'
import type { Connection, ObjectInfo } from '@shared/types'
import { publicUrl, s3Uri } from '@shared/urls'
import { errMsg, useStore } from '../store'
import { formatSize, Segmented } from './ui'

const EXPIRIES = [
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '7 days' }
] as const

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i

// Slide-over with an object's details and its links
export default function ObjectInfoPanel({
  conn,
  bucket,
  objectKey,
  onClose
}: {
  conn: Connection
  bucket: string
  objectKey: string
  onClose: () => void
}) {
  const { notify } = useStore()
  const [info, setInfo] = useState<ObjectInfo | null>(null)
  const [error, setError] = useState('')
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]['value']>('3600')
  const [preview, setPreview] = useState<string | null>(null)
  // null = unknown (provider without ACL support), undefined = loading
  const [pub, setPub] = useState<boolean | null | undefined>(undefined)
  const [reach, setReach] = useState<{ ok: boolean; status: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const url = publicUrl(conn, bucket, objectKey)

  const check = () => {
    setReach(null)
    window.api.s3.checkUrl(url).then(setReach)
  }
  useEffect(() => {
    setPub(undefined)
    window.api.s3
      .isPublic(conn.id, bucket, objectKey)
      .then(setPub)
      .catch(() => setPub(null))
    check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, bucket, objectKey])

  const toggle = async () => {
    setBusy(true)
    try {
      await window.api.s3.setPublic(conn.id, bucket, [objectKey], !pub)
      setPub(!pub)
      notify(pub ? 'Object is now private' : 'Object is now public')
      // Give eventually-consistent providers a moment before probing the URL
      setTimeout(check, 600)
    } catch (e) {
      notify(errMsg(e), true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setInfo(null)
    setError('')
    setPreview(null)
    window.api.s3
      .info(conn.id, bucket, objectKey)
      .then(setInfo)
      .catch((e) => setError(errMsg(e)))
    // Images are previewed through a short-lived signed link, so it works on private buckets too
    if (IMAGE.test(objectKey)) window.api.s3.presign(conn.id, bucket, objectKey, 300).then(setPreview).catch(() => {})
  }, [conn.id, bucket, objectKey])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const copy = async (text: string, what: string) => {
    await window.api.copyText(text)
    notify(`${what} copied`)
  }

  const signed = async () => {
    try {
      const link = await window.api.s3.presign(conn.id, bucket, objectKey, Number(expiry))
      copy(link, `Signed link (${EXPIRIES.find((e) => e.value === expiry)?.label})`)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }

  const name = objectKey.split('/').pop() || objectKey

  return (
    <div className="info-panel" onClick={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <span className="title" title={objectKey}>
          {name}
        </span>
        <button className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="panel-body">
        {preview && (
          <div className="preview">
            <img src={preview} alt="" />
          </div>
        )}

        <div className="psection">
          <div className="row">
            <h4 className="grow">Visibility</h4>
            <span className={`pill ${pub ? 'on' : ''}`}>
              {pub === undefined ? '…' : pub === null ? 'Unknown' : pub ? (
                <>
                  <Globe size={11} /> Public
                </>
              ) : (
                <>
                  <Lock size={11} /> Private
                </>
              )}
            </span>
          </div>
          <button className={`btn ${pub ? 'soft' : 'primary'}`} onClick={toggle} disabled={busy || pub === undefined}>
            {pub ? <Lock size={13} /> : <Globe size={13} />} {pub ? 'Make private' : 'Make public'}
          </button>
          {pub === null && <p className="hint">This provider doesn’t report object ACLs; you can still try to make it public.</p>}
        </div>

        <div className="psection">
          <h4>Public URL</h4>
          <div className="url-box mono">{url}</div>
          <div className="row">
            <button className="btn soft" onClick={() => copy(url, 'Public URL')}>
              <Copy size={13} /> Copy
            </button>
            <button className="btn" onClick={() => window.open(url)}>
              <ExternalLink size={13} /> Open
            </button>
          </div>
          <div className="row" style={{ fontSize: 12 }}>
            {!reach ? (
              <span className="hint">Checking the URL…</span>
            ) : reach.ok ? (
              <span style={{ color: 'var(--success)' }}>✓ Reachable without credentials</span>
            ) : (
              <span style={{ color: 'var(--danger)' }}>
                ✗ Not reachable{reach.status ? ` (HTTP ${reach.status})` : ''}
                {reach.status === 403 ? ': make the object public' : ''}
              </span>
            )}
            <button className="link" onClick={check}>
              Re-check
            </button>
          </div>
          <p className="hint">Change the base in the connection settings for a CDN or custom domain.</p>
        </div>

        <div className="psection">
          <h4>Signed link</h4>
          <p className="hint">Temporary link that works even on a private bucket.</p>
          <Segmented value={expiry} onChange={setExpiry} options={EXPIRIES.map((e) => ({ value: e.value, label: e.label }))} />
          <button className="btn primary" onClick={signed}>
            <Clock size={13} /> Copy signed link
          </button>
        </div>

        <div className="psection">
          <h4>Details</h4>
          {error ? (
            <div className="warning-box">
              <AlertCircle size={13} /> {error}
            </div>
          ) : !info ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <table className="kv">
              <tbody>
                <tr>
                  <th>Key</th>
                  <td className="mono">{info.key}</td>
                </tr>
                <tr>
                  <th>Size</th>
                  <td>
                    {formatSize(info.size)} <span className="hint">({info.size.toLocaleString()} bytes)</span>
                  </td>
                </tr>
                <tr>
                  <th>Modified</th>
                  <td>{info.mtime ? new Date(info.mtime).toLocaleString() : '—'}</td>
                </tr>
                <tr>
                  <th>Type</th>
                  <td>{info.contentType || '—'}</td>
                </tr>
                <tr>
                  <th>Class</th>
                  <td>{info.storageClass || 'STANDARD'}</td>
                </tr>
                {info.cacheControl && (
                  <tr>
                    <th>Cache</th>
                    <td>{info.cacheControl}</td>
                  </tr>
                )}
                {info.contentEncoding && (
                  <tr>
                    <th>Encoding</th>
                    <td>{info.contentEncoding}</td>
                  </tr>
                )}
                <tr>
                  <th>ETag</th>
                  <td className="mono">{info.etag || '—'}</td>
                </tr>
                {info.versionId && (
                  <tr>
                    <th>Version</th>
                    <td className="mono">{info.versionId}</td>
                  </tr>
                )}
                {Object.entries(info.metadata).map(([k, v]) => (
                  <tr key={k}>
                    <th>x-amz-meta-{k}</th>
                    <td className="mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="link" onClick={() => copy(s3Uri(bucket, objectKey), 'S3 URI')}>
            <Link2 size={12} /> Copy {s3Uri(bucket, objectKey).length > 48 ? 'S3 URI' : s3Uri(bucket, objectKey)}
          </button>
        </div>
      </div>
    </div>
  )
}
