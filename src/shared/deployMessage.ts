// The message diffs.sh prints for the team: everything above its closing "-----" line (below it the script only says
// that the message is copied). Pure, shared by main (which copies it) and the Deploys page (its Copy button).
export function deployMessage(output: string): string {
  const lines = output.replace(/\r/g, '').split('\n')
  const end = lines.findIndex((l) => /^-{3,}\s*$/.test(l))
  return (end === -1 ? lines : lines.slice(0, end)).join('\n').trim()
}
