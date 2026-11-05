// "v2.1.0" vs "2.0.3": true when latest is a higher release than current (numbers compared part by part;
// anything after a "-" is ignored, so a pre-release tag never counts as newer than its own release)
export function isNewer(latest: string, current: string): boolean {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const a = parts(latest), b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// what the status bar shows: an installer build has the update downloaded and waiting for a restart; a portable
// build can only point at the release page
export type UpdateState =
  | { kind: 'ready'; version: string }
  | { kind: 'available'; version: string; url: string }
