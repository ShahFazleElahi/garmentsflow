"use client";

// Original GarmentFlow mark: a needle & thread forming a flowing "GF" garment loop.
export function GarmentFlowLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-label="GarmentFlow logo" role="img">
      <rect width="48" height="48" rx="12" fill="#231F33" />
      {/* needle */}
      <path d="M34 11 L20 34" stroke="#F7F6F3" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="33.4" cy="12" r="2.2" fill="#231F33" stroke="#F7F6F3" strokeWidth="1.6" />
      {/* thread loop (flow) */}
      <path
        d="M20 34 C 12 30, 12 20, 20 16 C 27 12.4, 33 15, 35 20 C 37 25, 33 30, 28 31.5"
        stroke="#8B5CF6" strokeWidth="2.6" strokeLinecap="round" fill="none"
      />
      <path
        d="M28 31.5 C 24.5 32.6, 21 32, 19 29.5"
        stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" fill="none"
      />
      {/* thread eye dot */}
      <circle cx="20" cy="34" r="1.8" fill="#8B5CF6" />
    </svg>
  );
}
