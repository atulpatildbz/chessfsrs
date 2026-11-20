// A knight's L drawn on a 3x2 patch of squares: the "spaced" jump of a knight.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor" />
      <rect x="11.5" y="11.5" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="21" y="21" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="2" y="21" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="21" y="2" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <path d="M6.5 6.5 V25.5 H25.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25.5" cy="25.5" r="3" fill="currentColor" />
    </svg>
  );
}
