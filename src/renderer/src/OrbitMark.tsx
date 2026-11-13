// Orbit's mark beside the name: a centre, one orbit, and a body on it in the brand token (--brand-bar, the theme's
// accent text colour). The rest is currentColor, so the mark follows the theme. Below 24 px the heavier cut is drawn.
export function OrbitMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="orbitmark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {size < 24 ? (
        <>
          <circle cx="12" cy="12" r="3.7" fill="currentColor" />
          <path d="M20.199 12.15A8.2 8.2 0 1 1 13.276 3.9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="18.282" cy="6.729" r="3.3" fill="var(--brand-bar)" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="3.3" fill="currentColor" />
          <path d="M20.341 11.006A8.4 8.4 0 1 1 14.427 3.958" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="18.435" cy="6.601" r="2.8" fill="var(--brand-bar)" />
        </>
      )}
    </svg>
  )
}
