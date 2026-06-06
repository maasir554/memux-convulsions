/**
 * Markdown/LaTeX normalisation shared by the chat renderer (Streamdown) and
 * the notes renderer (react-markdown). Both feed KaTeX, which doesn't support
 * everything the source papers use.
 *
 * Source papers number equations with the plain-TeX `\eqno` / `\leqno`
 * primitives, which KaTeX does NOT implement — so `\eqno(16)` leaks through as
 * literal text. The two renderers handle this differently (see each export).
 */

const EQNO = /\\l?eqno\s*[({]\s*([^)}]*?)\s*[)}]/g;
// An inline single-$ span (not $$, not escaped) that carries a number.
const NUMBERED_INLINE = /(?<!\$)\$(?!\$)([^\n$]*\\tag\{[^\n$]*)\$(?!\$)/g;
// Walks "<lhs> \tag{N}" chunks within a span body.
const CHUNK = /\s*(.*?)\s*\\tag\{([^}]*)\}/g;

/** Split a span body into [lhs, number] equation chunks plus any trailing math. */
function splitEquations(
  body: string,
): { equations: Array<{ lhs: string; num: string }>; trailing: string } {
  const equations: Array<{ lhs: string; num: string }> = [];
  CHUNK.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = CHUNK.exec(body)) !== null) {
    equations.push({ lhs: m[1].trim(), num: m[2].trim() });
    last = CHUNK.lastIndex;
  }
  return { equations, trailing: body.slice(last).trim() };
}

/**
 * Chat renderer. KaTeX's `\tag` only works in *display* mode, and remark-math
 * only emits a display-math node for a *fenced* block (`$$` on its own lines);
 * a one-line `$$…$$` is parsed as inline math where `\tag` errors. So rewrite
 * each numbered inline equation into its own fenced display block — which also
 * gives the line breaks before/after that inline math lacks.
 */
export function normalizeEquations(md: string): string {
  const out = md.replace(EQNO, "\\tag{$1}");
  return out.replace(NUMBERED_INLINE, (_full, body: string) => {
    const { equations, trailing } = splitEquations(body);
    const blocks = equations.map(
      ({ lhs, num }) => `$$\n${lhs ? `${lhs} ` : ""}\\tag{${num}}\n$$`,
    );
    if (trailing) blocks.push(`$$\n${trailing}\n$$`);
    return `\n\n${blocks.join("\n\n")}\n\n`;
  });
}

/**
 * Notes renderer. Must preserve line count — rendered line numbers are mapped
 * back to the source to toggle task checkboxes, so the transform may not
 * add/remove lines. A display block would add lines (and `\tag` needs display
 * mode), so instead drop the number out of the math and render it as plain
 * "(N)" text right after an inline equation. No `\tag`, no display mode, no
 * line added.
 */
export function normalizeEquationsInline(md: string): string {
  const out = md.replace(EQNO, "\\tag{$1}");
  return out.replace(NUMBERED_INLINE, (_full, body: string) => {
    const { equations, trailing } = splitEquations(body);
    const parts = equations.map(({ lhs, num }) =>
      lhs ? `$${lhs}$ (${num})` : `(${num})`,
    );
    if (trailing) parts.push(`$${trailing}$`);
    return parts.join(" ");
  });
}
