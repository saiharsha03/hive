// Hive's mark beside the name: one cell of the hive seen from above, its top face in the accent (the design lead's
// "hive-cell" mark). Colours are theme tokens, so it reads in every theme.
export function HiveMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="hivemark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3L27.26 9.5L16 16L4.74 9.5Z" fill="var(--dim)" />
      <path d="M4.74 9.5L16 16L16 29L4.74 22.5Z" fill="var(--hi)" />
      <path d="M27.26 9.5L27.26 22.5L16 29L16 16Z" fill="none" stroke="var(--hi)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}
