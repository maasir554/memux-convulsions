/**
 * Brand mark — gradient circle (pink → orange → yellow) with a subtle
 * fractal-noise overlay and a soft inner rim. Used in the chat header
 * + wherever the MEMUX wordmark appears.
 *
 * The filter + gradient ids are derived from `useId()` so each instance
 * has a unique id AND the same id across SSR + hydration. A previous
 * implementation used a module-level counter, which is NOT stable
 * across SSR (server starts at 1, client may have already advanced to
 * 2 by the time hydration runs), causing the "tree hydrated but some
 * attributes didn't match" console error during fast navigation.
 */

import { useId } from "react";

export function MemuxMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // useId returns "<R:...>"-style ids which contain `:` — fine for
  // HTML id attributes but breaks `url(#...)` selectors in some
  // engines. Strip the colons to keep both happy.
  const rawId = useId();
  const id = `memux-mark-${rawId.replace(/:/g, "")}`;
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
      {/* Soft inner rim — gentle 3D suggestion without a heavy shadow. */}
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
