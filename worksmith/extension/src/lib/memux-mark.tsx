/**
 * Brand mark — gradient circle (pink → orange → yellow) with a subtle fractal-
 * noise overlay and a thin highlight rim. Used in the popup header and (via
 * a canvas-rendered variant) as the extension's toolbar icon.
 *
 * The filter+gradient ids are deliberately suffixed so the same SVG can be
 * inlined twice on one page without collisions.
 */

let markIdCounter = 0;

export function MemuxMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const id = `memux-mark-${++markIdCounter}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="18%" y1="14%" x2="86%" y2="88%">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="55%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#fde047" />
        </linearGradient>
        <filter id={`${id}-n`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.3"
            numOctaves="2"
            seed="7"
          />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.14 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#${id}-g)`} />
      <circle cx="16" cy="16" r="15" filter={`url(#${id}-n)`} />
      {/* faint inner rim — gives a soft 3D feel without committing to a shadow */}
      <circle
        cx="16"
        cy="16"
        r="14.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.5"
      />
    </svg>
  );
}
