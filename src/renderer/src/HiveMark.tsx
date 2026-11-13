// Orbit's mark beside the name: a hexagon (one cell of the hive) holding an H whose bar is in the brand token (the
// signal colour where the theme has one). Colours are theme tokens, so it reads in every theme.
export function HiveMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="hivemark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" stroke="var(--hi)" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.6 8.2v7.6M15.4 8.2v7.6" stroke="var(--hi)" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.6 12h6.8" stroke="var(--brand-bar)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}
