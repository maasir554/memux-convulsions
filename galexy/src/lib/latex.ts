/**
 * Markdown/LaTeX normalisation shared by the chat renderer (Streamdown) and
 * the notes renderer (react-markdown). Both feed KaTeX, which doesn't support
 * everything the source papers use.
 *
 * Source papers number equations with the plain-TeX `\eqno` / `\leqno`
 * primitives, which KaTeX does NOT implement — so `\eqno(16)` leaks through as
 * literal text. KaTeX *does* support `\tag{…}`, but only in display mode, and
 * remark-math only emits a display-math node for a *fenced* block:
 *     $$
 *     <eq>
 *     $$
 * A one-line `$$…$$` (or inline `$…$`) is parsed as inline math, where `\tag`
 * errors. So a numbered equation written one-line can't carry `\tag`.
 */

const EQNO_TO_TAG = /\\l?eqno\s*[({]\s*([^)}]*?)\s*[)}]/g;
// A one-line `$…$` OR `$$…$$` span carrying a number (\eqno or \tag). The
// backreference makes the closing delimiter match the opening one.
const NUMBERED_SPAN = /(\${1,2})([^\n$]*?(?:\\l?eqno|\\tag)[^\n$]*?)\1/g;
// Walks "<lhs> \tag{N}" chunks within a span body.
const CHUNK = /\s*(.*?)\s*\\tag\{([^}]*)\}/g;

/** Split a span body (already \eqno→\tag) into [lhs, number] chunks + trailing math. */
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
 * Block form (adds line breaks). For the chat renderer and for notes that have
 * no task checkboxes. Rewrites each numbered one-line equation into its own
 * fenced display block so `\tag` renders and the equation gets the line breaks
 * before/after that inline math lacks.
 */
export function normalizeEquations(md: string): string {
  return md
    .replace(NUMBERED_SPAN, (_full, _delim: string, body: string) => {
      const { equations, trailing } = splitEquations(
        body.replace(EQNO_TO_TAG, "\\tag{$1}"),
      );
      const blocks = equations.map(
        ({ lhs, num }) => `$$\n${lhs ? `${lhs} ` : ""}\\tag{${num}}\n$$`,
      );
      if (trailing) blocks.push(`$$\n${trailing}\n$$`);
      return `\n\n${blocks.join("\n\n")}\n\n`;
    })
    // Residual \eqno inside already-fenced (multi-line) display blocks.
    .replace(EQNO_TO_TAG, "\\tag{$1}");
}

/**
 * Line-count-preserving form. For notes that contain task checkboxes, whose
 * rendered line numbers are mapped back to the source to toggle them — so the
 * transform must not add/remove lines. Numbered one-line equations are kept
 * inline with the number dropped out of the math as plain "(N)" text (no
 * `\tag`, no display mode). `\eqno` left inside fenced display blocks is still
 * upgraded to `\tag` (a same-line edit, so no line is added).
 */
export function normalizeEquationsInline(md: string): string {
  return md
    .replace(NUMBERED_SPAN, (_full, _delim: string, body: string) => {
      const { equations, trailing } = splitEquations(
        body.replace(EQNO_TO_TAG, "\\tag{$1}"),
      );
      const parts = equations.map(({ lhs, num }) =>
        lhs ? `$${lhs}$ (${num})` : `(${num})`,
      );
      if (trailing) parts.push(`$${trailing}$`);
      return parts.join(" ");
    })
    .replace(EQNO_TO_TAG, "\\tag{$1}");
}

/** True if the markdown contains a GFM task checkbox (`- [ ]` / `- [x]`). */
export function hasTaskCheckbox(md: string): boolean {
  return /^\s*[-*+]\s+\[[ xX]\]/m.test(md);
}
