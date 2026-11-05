// Rewind a turn: where the conversation resumes once one of your messages is taken back. That is the chain entry
// just before the message (its parentUuid), so the fork keeps everything up to the previous turn's last entry.
// at null = the message opened the conversation, so the thread starts fresh.
export function forkPoint(transcript: string, uuid: string): { found: boolean; at: string | null } {
  for (const line of transcript.split('\n')) {
    if (!line.startsWith('{') || !line.includes(uuid)) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'user' && e.uuid === uuid) return { found: true, at: e.parentUuid ?? null }
  }
  return { found: false, at: null }
}
