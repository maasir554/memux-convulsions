import { buildAccessibilityTree } from "./accessibility-tree";
import type { ScrollBox, ScrollState } from "../lib/types";

const SCROLL_THROTTLE_MS = 350;
const ROUTE_POLL_MS = 500;
const MAX_SCROLL_BOXES = 60;

let lastUrl = location.href;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "worksmith.ping") {
    // Used by the background script to detect whether this tab already has
    // the content script loaded. Avoid re-injecting (and double-registering
    // listeners + timers) when the answer is yes.
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "worksmith.captureAccessibility") {
    try {
      const snapshot = buildAccessibilityTree();
      sendResponse({
        ok: true,
        url: location.href,
        title: document.title,
        nodeCount: snapshot.nodeCount,
        tree: snapshot.tree,
      });
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
    return true;
  }

  if (message?.type === "worksmith.captureMoment") {
    try {
      const snapshot = buildAccessibilityTree();
      const scrollState = getScrollState();
      sendResponse({
        ok: true,
        url: location.href,
        title: document.title,
        nodeCount: snapshot.nodeCount,
        tree: snapshot.tree,
        scrollState,
        scrollSignature: createScrollSignature(scrollState),
      });
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
    return true;
  }

  if (message?.type === "worksmith.getScrollState") {
    const scrollState = getScrollState();
    sendResponse({
      ok: true,
      url: location.href,
      title: document.title,
      scrollState,
      scrollSignature: createScrollSignature(scrollState),
    });
    return true;
  }

  if (message?.type === "worksmith.flash") {
    showFlash();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "worksmith.scrollStep") {
    const by = typeof message.by === "number" ? message.by : 0;
    const to = typeof message.to === "number" ? message.to : null;
    if (to !== null) {
      window.scrollTo({ top: to, left: 0, behavior: "auto" });
    } else {
      window.scrollBy({ top: by, left: 0, behavior: "auto" });
    }
    const scrollState = getScrollState();
    sendResponse({
      ok: true,
      scrollState,
      url: location.href,
      title: document.title,
    });
    return true;
  }

  return false;
});

function ensureFlashStyles(): void {
  if (document.getElementById("__worksmith_flash_kf__")) return;
  const style = document.createElement("style");
  style.id = "__worksmith_flash_kf__";
  style.textContent = `
    @property --ws-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
    #__worksmith_flash__ {
      position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      padding: 7px;
      background: conic-gradient(from var(--ws-angle, 0deg),
        #f472b6 0deg, #fbe055 90deg, #f472b6 180deg, #fbe055 270deg, #f472b6 360deg);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
              mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: source-out;
              mask-composite: exclude;
      opacity: 0; filter: blur(0);
      animation: ws-flash-fade 1100ms ease-out forwards, ws-flash-rotate 1100ms linear forwards;
    }
    @keyframes ws-flash-fade {
      0% { opacity: 0; filter: blur(2px); }
      18% { opacity: 0.95; filter: blur(0); }
      60% { opacity: 0.65; }
      100% { opacity: 0; }
    }
    @keyframes ws-flash-rotate { to { --ws-angle: 540deg; } }
  `;
  document.documentElement.appendChild(style);
}

function showFlash(): void {
  ensureFlashStyles();
  document.getElementById("__worksmith_flash__")?.remove();
  const el = document.createElement("div");
  el.id = "__worksmith_flash__";
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

document.addEventListener(
  "scroll",
  () => {
    if (scrollTimer) {
      return;
    }
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      reportScroll();
    }, SCROLL_THROTTLE_MS);
  },
  { capture: true, passive: true },
);

window.addEventListener(
  "scroll",
  () => {
    if (!scrollTimer) {
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        reportScroll();
      }, SCROLL_THROTTLE_MS);
    }
  },
  { passive: true },
);

window.addEventListener("hashchange", reportRouteChange);
window.addEventListener("popstate", reportRouteChange);

setInterval(() => {
  if (location.href !== lastUrl) {
    reportRouteChange();
  }
}, ROUTE_POLL_MS);

reportScroll();

function reportScroll(): void {
  const scrollState = getScrollState();
  sendMessage({
    type: "worksmith.scroll",
    payload: {
      url: location.href,
      ...scrollState.page,
      scrollState,
      scrollSignature: createScrollSignature(scrollState),
    },
  });
}

function getScrollState(): ScrollState {
  const documentElement = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0);
  const scrollWidth = Math.max(documentElement?.scrollWidth || 0, body?.scrollWidth || 0);
  const viewportHeight = window.innerHeight || documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || documentElement.clientWidth || 0;
  const maxScrollY = Math.max(scrollHeight - viewportHeight, 0);
  const maxScrollX = Math.max(scrollWidth - viewportWidth, 0);
  const scrollY = window.scrollY || documentElement.scrollTop || 0;
  const scrollX = window.scrollX || documentElement.scrollLeft || 0;

  return {
    page: {
      scrollX: round(scrollX),
      scrollY: round(scrollY),
      scrollPercent: round(maxScrollY > 0 ? (scrollY / maxScrollY) * 100 : 0),
      scrollXPercent: round(maxScrollX > 0 ? (scrollX / maxScrollX) * 100 : 0),
      viewportWidth,
      viewportHeight,
      documentWidth: scrollWidth,
      documentHeight: scrollHeight,
    },
    boxes: getVisibleScrollBoxes(viewportWidth, viewportHeight),
  };
}

function getVisibleScrollBoxes(viewportWidth: number, viewportHeight: number): ScrollBox[] {
  const boxes: ScrollBox[] = [];
  const elements = document.querySelectorAll("body *");

  for (const element of Array.from(elements)) {
    if (boxes.length >= MAX_SCROLL_BOXES) {
      break;
    }
    if (!isScrollableElement(element)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (!intersectsViewport(rect, viewportWidth, viewportHeight)) {
      continue;
    }

    boxes.push({
      selector: getSelector(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: getElementName(element),
      scrollTop: round(element.scrollTop),
      scrollLeft: round(element.scrollLeft),
      scrollHeight: round(element.scrollHeight),
      scrollWidth: round(element.scrollWidth),
      clientHeight: round(element.clientHeight),
      clientWidth: round(element.clientWidth),
      rect: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
      },
    });
  }

  return boxes;
}

function isScrollableElement(element: Element): boolean {
  if (!(element instanceof Element)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const canScrollY = element.scrollHeight - element.clientHeight > 2 && /(auto|scroll|overlay)/.test(overflowY);
  const canScrollX = element.scrollWidth - element.clientWidth > 2 && /(auto|scroll|overlay)/.test(overflowX);

  return canScrollY || canScrollX;
}

function intersectsViewport(rect: DOMRect, viewportWidth: number, viewportHeight: number): boolean {
  if (rect.width < 8 || rect.height < 8) {
    return false;
  }
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
}

function createScrollSignature(scrollState: ScrollState): string {
  const page = scrollState.page;
  const boxes = scrollState.boxes.map((box) =>
    [box.selector, box.scrollTop, box.scrollLeft, box.clientHeight, box.clientWidth].join(":"),
  );

  return JSON.stringify({
    page: [
      page.scrollX,
      page.scrollY,
      page.viewportWidth,
      page.viewportHeight,
      page.documentWidth,
      page.documentHeight,
    ],
    boxes,
  });
}

function reportRouteChange(): void {
  const previousUrl = lastUrl;
  lastUrl = location.href;

  sendMessage({
    type: "worksmith.route.changed",
    payload: {
      previousUrl,
      url: location.href,
      title: document.title,
    },
  });

  reportScroll();
}

function sendMessage(message: { type: string; payload: unknown }): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // The extension may be reloading or the page may not be reachable anymore.
  });
}

function getElementName(element: Element): string {
  return cleanText(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      "",
  );
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

function cleanText(value: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function cssEscape(value: string): string {
  if (typeof window.CSS?.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
