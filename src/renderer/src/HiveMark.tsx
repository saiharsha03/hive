// The honeycomb mark beside the name: a small cluster of hexagon cells in honey, one in the accent.
// Inline until the packaged icon lands; colours are theme tokens.
const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')

export function HiveMark({ size = 16 }: { size?: number }) {
  const r = 3.6
  const w = r * Math.sqrt(3)
  return (
    <svg className="hivemark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <polygon points={hex(8 - w / 2, 4.6, r)} fill="var(--brand)" />
      <polygon points={hex(8 + w / 2, 4.6, r)} fill="var(--brand)" opacity=".75" />
      <polygon points={hex(8 - w, 10.0, r)} fill="var(--brand)" opacity=".75" />
      <polygon points={hex(8, 10.0, r)} fill="var(--accent)" />
      <polygon points={hex(8 + w, 10.0, r)} fill="var(--brand)" />
    </svg>
  )
}
