import type { Rect, TreeNode, TreeNodeState } from "../lib/types";

const MAX_NODES = 1200;
const MAX_DEPTH = 24;
const TEXT_LIMIT = 140;

type RoleResolver = string | ((element: Element) => string | null);

const semanticRoles: Record<string, RoleResolver> = {
  A: (element) => (element.hasAttribute("href") ? "link" : null),
  ARTICLE: "article",
  ASIDE: "complementary",
  BUTTON: "button",
  DETAILS: "group",
  DIALOG: "dialog",
  FOOTER: "contentinfo",
  FORM: "form",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  HEADER: "banner",
  IMG: "img",
  INPUT: inferInputRole,
  LI: "listitem",
  MAIN: "main",
  NAV: "navigation",
  OL: "list",
  OPTION: "option",
  PROGRESS: "progressbar",
  SECTION: "region",
  SELECT: "combobox",
  TABLE: "table",
  TBODY: "rowgroup",
  TD: "cell",
  TEXTAREA: "textbox",
  TH: "columnheader",
  THEAD: "rowgroup",
  TR: "row",
  UL: "list",
};

export interface BuiltTree {
  nodeCount: number;
  tree: TreeNode;
}

export function buildAccessibilityTree(): BuiltTree {
  let nodeCount = 0;
  const root = document.body || document.documentElement;

  const tree = visitElement(root, 0);

  return {
    nodeCount,
    tree:
      tree || {
        role: "document",
        name: document.title || location.href,
        tag: "document",
        children: [],
      },
  };

  function visitElement(element: Element, depth: number): TreeNode | null {
    if (!element || nodeCount >= MAX_NODES || depth > MAX_DEPTH || shouldSkipElement(element)) {
      return null;
    }

    nodeCount += 1;

    const role = inferRole(element);
    const name = getAccessibleName(element);
    const text = getDirectText(element);
    const state = getState(element);
    const rect = getRect(element);
    // Resolve a visual source — first an explicit <img>/<source> src, then
    // a CSS background-image URL (so divs styled with a hero background
    // survive into the tree even when they have no other a11y signal).
    const src = getImageSrc(element) ?? getBackgroundImageUrl(element, rect);
    const href = getHref(element);
    const children: TreeNode[] = [];

    for (const child of Array.from(element.children)) {
      const childNode = visitElement(child, depth + 1);
      if (childNode) {
        children.push(childNode);
      }

      if (nodeCount >= MAX_NODES) {
        break;
      }
    }

    const hasSignal =
      role ||
      name ||
      text ||
      Object.keys(state).length > 0 ||
      children.length > 0 ||
      src ||
      href;

    if (!hasSignal) {
      return null;
    }

    return compactObject({
      role: role || "generic",
      name,
      tag: element.tagName.toLowerCase(),
      text,
      selector: getSelector(element),
      state,
      rect,
      src: src ?? undefined,
      href: href ?? undefined,
      children,
    });
  }
}

/**
 * Extract an image's resolved source. `currentSrc` picks the right entry from
 * srcset/picture; falls back to the bare `src` attr. Returns null for non-img
 * elements so compactObject drops the field.
 */
function getImageSrc(element: Element): string | null {
  const tag = element.tagName;
  if (tag === "IMG") {
    const img = element as HTMLImageElement;
    return img.currentSrc || img.src || null;
  }
  if (tag === "SOURCE") {
    const src = (element as HTMLSourceElement).src;
    if (src) return src;
    const srcset = element.getAttribute("srcset");
    if (srcset) {
      // First candidate from srcset, dropping the descriptor.
      return srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? null;
    }
  }
  return null;
}

/**
 * Pick the first `url(...)` out of a computed `background-image` declaration.
 * Background-image can be a gradient (skipped), can mix gradients and URLs
 * ("url(a), linear-gradient(...)"), and the URL can be relative — we resolve
 * against the page's location so the SW fetcher gets an absolute URL.
 *
 * `data:` URIs are skipped (they're already inline; encoding them again would
 * waste bytes). Elements smaller than 16×16 are skipped — that filters out
 * sprite-style 1×1 / icon backgrounds that are visual noise.
 */
function getBackgroundImageUrl(
  element: Element,
  rect: Rect | null,
): string | null {
  const tag = element.tagName;
  if (tag === "IMG" || tag === "SOURCE") return null;
  if (!rect || rect.width < 16 || rect.height < 16) return null;
  let bg: string;
  try {
    bg = window.getComputedStyle(element as HTMLElement).backgroundImage;
  } catch {
    return null;
  }
  if (!bg || bg === "none") return null;
  const match = /url\(['"]?([^'")]+)['"]?\)/i.exec(bg);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const absolute = new URL(raw, window.location.href).href;
    return /^https?:/i.test(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

/** Extract an href for link-like elements. */
function getHref(element: Element): string | null {
  if (element.tagName === "A" || element.tagName === "AREA") {
    const href = (element as HTMLAnchorElement).href;
    // Skip degenerate hrefs.
    if (!href || href.startsWith("javascript:") || href === window.location.href + "#")
      return null;
    return href;
  }
  return null;
}

function inferRole(element: Element): string | null {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    return explicitRole;
  }

  const resolver = semanticRoles[element.tagName];
  if (typeof resolver === "function") {
    return resolver(element);
  }

  return resolver || null;
}

function inferInputRole(element: Element): string {
  const type = (element.getAttribute("type") || "text").toLowerCase();
  const roles: Record<string, string> = {
    button: "button",
    checkbox: "checkbox",
    email: "textbox",
    number: "spinbutton",
    password: "textbox",
    radio: "radio",
    range: "slider",
    search: "searchbox",
    submit: "button",
    tel: "textbox",
    text: "textbox",
    url: "textbox",
  };

  return roles[type] || "textbox";
}

function getAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return cleanText(ariaLabel);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");

    if (cleanText(text)) {
      return cleanText(text);
    }
  }

  if (element instanceof HTMLImageElement) {
    return cleanText(element.alt || element.title || "");
  }

  if (element instanceof HTMLInputElement) {
    const label = getLabelText(element);
    return cleanText(label || element.value || element.placeholder || element.title || "");
  }

  if (element instanceof HTMLTextAreaElement) {
    const label = getLabelText(element);
    return cleanText(label || element.placeholder || element.title || "");
  }

  if (element instanceof HTMLSelectElement) {
    return cleanText(getLabelText(element) || element.title || "");
  }

  if (element instanceof HTMLButtonElement || element.tagName === "A") {
    return cleanText(element.textContent || element.getAttribute("title") || "");
  }

  if (/^H[1-6]$/.test(element.tagName)) {
    return cleanText(element.textContent || "");
  }

  return cleanText(element.getAttribute("title") || "");
}

function getLabelText(element: Element): string {
  const id = (element as HTMLElement).id;
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (label) {
      return label.textContent || "";
    }
  }

  return element.closest("label")?.textContent || "";
}

function getDirectText(element: Element): string {
  const directText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ");

  return cleanText(directText);
}

function getState(element: Element): TreeNodeState {
  const state: TreeNodeState = {};
  const ariaStateAttributes = [
    "aria-checked",
    "aria-disabled",
    "aria-expanded",
    "aria-hidden",
    "aria-pressed",
    "aria-selected",
  ];

  ariaStateAttributes.forEach((attribute) => {
    if (element.hasAttribute(attribute)) {
      state[attribute.replace("aria-", "")] = element.getAttribute(attribute) || "";
    }
  });

  if ("disabled" in element && (element as HTMLInputElement).disabled) {
    state.disabled = true;
  }

  if ("checked" in element && (element as HTMLInputElement).checked) {
    state.checked = true;
  }

  if ((element as HTMLElement).hidden) {
    state.hidden = true;
  }

  return state;
}

function getRect(element: Element): Rect | null {
  const rect = element.getBoundingClientRect();

  if (!rect.width && !rect.height) {
    return null;
  }

  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function getSelector(element: Element): string {
  if ((element as HTMLElement).id) {
    return `#${cssEscape((element as HTMLElement).id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
    let part = current.tagName.toLowerCase();

    if (current.classList.length) {
      part += `.${Array.from(current.classList).slice(0, 2).map(cssEscape).join(".")}`;
    }

    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
}

function shouldSkipElement(element: Element): boolean {
  const tag = element.tagName;

  if (["SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT", "TEMPLATE"].includes(tag)) {
    return true;
  }

  if (element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const style = window.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden";
}

function cleanText(value: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}...` : text;
}

function compactObject(object: TreeNode): TreeNode {
  const compacted: Record<string, unknown> = {};

  Object.entries(object).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }

    if (Array.isArray(value) && value.length === 0) {
      return;
    }

    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0
    ) {
      return;
    }

    compacted[key] = value;
  });

  return compacted as unknown as TreeNode;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function cssEscape(value: string): string {
  if (typeof window.CSS?.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
