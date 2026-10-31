// Right-hand Preview panel: images, HTML pages, PDFs, video/audio and text, inside the app.
// Opened from the Files panel now; Claude will open it through a tool once the chat is connected.
import { useEffect, useState } from 'react'

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
const VIDEO = ['mp4', 'webm', 'mov', 'm4v']
const AUDIO = ['mp3', 'wav', 'ogg', 'm4a']
const TEXT = ['txt', 'md', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'toml', 'ini', 'xml', 'py', 'ts', 'tsx', 'js', 'jsx',
  'mjs', 'cjs', 'css', 'scss', 'vue', 'sql', 'sh', 'ps1', 'bat', 'env', 'gitignore', 'dockerfile', 'tmdl', 'dax']

const ext = (p: string) => (p.split(/[\\/]/).at(-1)!.split('.').at(-1) ?? '').toLowerCase()
const base = (p: string) => p.split(/[\\/]/).at(-1) ?? p

export function kindOf(path: string): 'image' | 'html' | 'pdf' | 'video' | 'audio' | 'text' | 'other' {
  if (path.startsWith('data:image/')) return 'image' // pasted images
  const e = ext(path)
  if (IMAGE.includes(e)) return 'image'
  if (e === 'html' || e === 'htm') return 'html'
  if (e === 'pdf') return 'pdf'
  if (VIDEO.includes(e)) return 'video'
  if (AUDIO.includes(e)) return 'audio'
  if (TEXT.includes(e) || !base(path).includes('.')) return 'text'
  return 'other'
}

function TextView({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setText(null)
    window.api.readText(path).then(setText).catch((e) => setError(String(e?.message ?? e)))
  }, [path])
  if (error) return <div className="pv-msg">Can't read this file: {error}</div>
  if (text === null) return <div className="pv-msg">Loading…</div>
  return <pre className="pv-text">{text}</pre>
}

// The address a local file is served at: hive-file://<token for its folder>/<name>, from the main
// process. Pasted images are data: URLs already.
export function usePreviewUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(path.startsWith('data:') ? path : null)
  useEffect(() => {
    if (path.startsWith('data:')) { setUrl(path); return }
    let current = true
    setUrl(null)
    window.api.previewUrl(path).then((u) => current && setUrl(u)).catch(() => current && setUrl(''))
    return () => { current = false }
  }, [path])
  return url
}

export function Preview({ path, onClose }: { path: string; onClose: () => void }) {
  const kind = kindOf(path)
  const pasted = path.startsWith('data:')
  const url = usePreviewUrl(path) ?? ''
  const title = pasted ? 'Pasted image' : base(path)
  return (
    <aside className="preview">
      <div className="pv-head" title={pasted ? '' : path}>
        <span className="pv-name">{title}</span>
        {!pasted && <button data-testid="preview-button-1" className="link" onClick={() => window.api.openExternal(path)}>Open outside</button>}
        <button data-testid="preview-button-2" className="x pv-x" aria-label="Close preview" onClick={onClose}>×</button>
      </div>
      <div className={`pv-body ${kind}`}>
        {!url && kind !== 'text' && kind !== 'other' && <div className="pv-msg">Loading…</div>}
        {url && kind === 'image' && <img src={url} alt={title} />}
        {/* allow-scripts without allow-same-origin: the page gets an opaque origin, so its scripts
            can't fetch other local files through hive-file:// (its own <img>/<link> tags still load) */}
        {url && kind === 'html' && <iframe key={path} src={url} sandbox="allow-scripts" title={base(path)} />}
        {url && kind === 'pdf' && <iframe key={path} src={url} title={base(path)} />}
        {url && kind === 'video' && <video key={path} src={url} controls />}
        {url && kind === 'audio' && <audio key={path} src={url} controls />}
        {kind === 'text' && <TextView path={path} />}
        {kind === 'other' && <div className="pv-msg">No preview for .{ext(path)} files. Use Open outside.</div>}
      </div>
    </aside>
  )
}
