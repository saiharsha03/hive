// The "★ Insight" boxes the Learning / Explanatory output styles put in answers: a `★ Insight ───` line, the points,
// and a closing `───` line (each in backticks). Turned into a quote that starts with the ★ Insight marker, which the
// chat renders as a callout.
export const INSIGHT = '★ Insight'
const BOX = /`★ Insight\s*─+`[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*`─+`/g

export function insightCallouts(text: string): string {
  if (!text.includes(INSIGHT)) return text
  return text.replace(BOX, (_m, body: string) => {
    const lines = body.split(/\r?\n/).map((l) => `> ${l}`)
    return [`> **${INSIGHT}**`, '>', ...lines].join('\n')
  })
}
