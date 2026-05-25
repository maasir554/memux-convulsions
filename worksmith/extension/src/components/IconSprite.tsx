export function IconSprite() {
  return (
    <svg className="icon-sprite" aria-hidden="true">
      <symbol id="icon-panel-left" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2"></rect>
        <path d="M9 4v16"></path>
      </symbol>
      <symbol id="icon-panel-right" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2"></rect>
        <path d="M15 4v16"></path>
      </symbol>
      <symbol id="icon-list" viewBox="0 0 24 24">
        <path d="M8 6h13"></path>
        <path d="M8 12h13"></path>
        <path d="M8 18h13"></path>
        <path d="M3 6h.01"></path>
        <path d="M3 12h.01"></path>
        <path d="M3 18h.01"></path>
      </symbol>
      <symbol id="icon-accessibility" viewBox="0 0 24 24">
        <circle cx="12" cy="4" r="2"></circle>
        <path d="M18 8H6"></path>
        <path d="M12 6v7"></path>
        <path d="m7 21 5-8 5 8"></path>
      </symbol>
      <symbol id="icon-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 11v5"></path>
        <path d="M12 8h.01"></path>
      </symbol>
      <symbol id="icon-settings" viewBox="0 0 24 24">
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.37.42.72.6 1H20a2 2 0 1 1 0 4h-.09c-.18.28-.38.63-.51 1Z"></path>
      </symbol>
      <symbol id="icon-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path>
        <path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path>
        <path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path>
        <path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path>
        <path d="m19.07 4.93-1.41 1.41"></path>
      </symbol>
      <symbol id="icon-moon" viewBox="0 0 24 24">
        <path d="M20.99 12.8A8.5 8.5 0 1 1 11.2 3.01a6.5 6.5 0 1 0 9.79 9.79Z"></path>
      </symbol>
      <symbol id="icon-monitor" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="13" rx="2"></rect>
        <path d="M8 21h8"></path>
        <path d="M12 17v4"></path>
      </symbol>
      <symbol id="icon-x" viewBox="0 0 24 24">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </symbol>
    </svg>
  );
}

export function Icon({ id, className = "icon" }: { id: string; className?: string }) {
  return (
    <svg className={className}>
      <use href={`#${id}`} />
    </svg>
  );
}
