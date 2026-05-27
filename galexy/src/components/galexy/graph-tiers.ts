/**
 * Shared tier-y layout constants for the graph view. Lives in its own
 * value-only module so both the SSR-safe orchestrator (`graph-view.tsx`)
 * and the client-only canvas (`force-graph-canvas.tsx`) can import the
 * same numbers without the canvas's `ForceGraph2D` module — which touches
 * `window` at load — being pulled into the SSR module graph.
 */
export const TIER_Y = {
  user: -180,
  workspace: -90,
  folder: 0,
  file: 120,
} as const;
