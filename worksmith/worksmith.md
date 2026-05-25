# Worksmith Browser Extension Plan

## Goal

Worksmith is a browser extension for browser automation debugging. It should observe user/browser activity tab by tab, record it with timestamps, and expose a debugging console UI where we can inspect what happened and what the active page currently looks like from an accessibility perspective.

The first version should focus on visibility rather than control. It should answer:

- Which tab was opened, activated, updated, or closed?
- Which URL did each tab navigate to?
- What is the current scroll position of each observed tab?
- What did the active tab's accessibility tree look like at a given moment?
- When did each event happen, and in which tab/session context?

## Core Capabilities

### Tab Activity Monitoring

The extension should listen for browser tab lifecycle events:

- New tab opened
- Tab activated/focused
- Tab URL changed
- Tab title changed
- Tab closed
- Window focus changed

Each event should be stored with:

- Event id
- Event type
- Timestamp
- Browser window id
- Tab id
- URL, when available
- Title, when available
- Previous known URL/title, when useful
- Optional metadata specific to the event

### Navigation Monitoring

Navigation should be captured through browser extension APIs and content-script signals.

Important events:

- Initial tab load
- URL committed
- History API navigation, such as `pushState`, `replaceState`, and `popstate`
- Page reload
- Redirects, if available from extension APIs

For single-page apps, content scripts should detect route changes because the tab URL can change without a full document load.

### Scroll Monitoring

The content script should monitor scroll activity in the current page.

For each tab, record:

- `scrollX`
- `scrollY`
- Document height
- Viewport width and height
- Scroll percentage
- Timestamp
- URL at the time of scroll

Scroll events should be throttled, likely around 250ms to 500ms, so the log remains useful without becoming noisy.

### Accessibility Tree Capture

The extension should be able to print or display an accessibility-like tree for the active tab.

Browser extensions generally cannot directly access the browser's native accessibility tree from normal web extension APIs. For Worksmith v1, we should generate a DOM-derived accessibility tree approximation from the page using a content script.

The tree should include:

- Role, inferred from explicit ARIA role or semantic HTML
- Accessible name, where reasonably derivable
- Tag name
- Text snippet for text-bearing elements
- State attributes such as `disabled`, `checked`, `expanded`, `selected`, and `hidden`
- Useful selectors or stable element paths
- Bounding box, if needed for automation debugging

The active tab's tree should be printable from the debugging UI. It can also be logged to the extension console during early development, but the primary interface should be visible inside Worksmith's own UI.

## Debugging Console UI

We should build the console as an extension page, not only as raw DevTools logging.

Recommended UI location:

- A dedicated extension page opened from the extension action, for example `worksmith/index.html`
- Optional later enhancement: a side panel, if the target browser supports the Side Panel API
- Optional later enhancement: a DevTools panel, if we want debugging to live next to browser devtools

Why an extension page first:

- It is easiest to build and debug.
- It can stay open while the user browses in other tabs.
- It can read from extension storage or connect to the background service worker.
- It avoids losing logs when the background service worker sleeps.
- It gives us room for a real tab-wise activity dashboard.

The `index.html` console should show:

- Active tab summary
- Tab list with status and last known URL
- Event stream filtered by tab or event type
- Scroll telemetry panel
- Accessibility tree viewer for the active tab
- Manual refresh button for accessibility tree capture
- Clear log button
- Export log button

The browser's normal extension/service-worker console is still useful for developer logs, but it should not be the main debugging surface.

## Debug Stream API Integration

In a later phase, Worksmith should expose or publish its debug stream through an API so other tools can consume the same browser activity data.

There are two useful directions:

- Push events from the extension to a local or remote API
- Serve events from a local Worksmith service that receives extension data and exposes query/stream endpoints

The extension should not assume the console UI is the only consumer. The background worker should treat every recorded activity item as a structured event that can be sent to multiple sinks:

- In-memory store for live UI
- Extension storage for local persistence
- Local API for automation tooling
- Remote API for team debugging, replay, or long-term history
- Database-backed API for querying sessions later

### API Publishing

The background service worker should own API communication.

Content scripts should not call external services directly. They should send page observations to the background worker, and the background worker should decide how and where to publish them.

Possible API targets:

- `http://localhost:<port>/worksmith/events` for local development
- `http://127.0.0.1:<port>/worksmith/events` for local automation tools
- `https://api.example.com/worksmith/events` for a hosted service

Example event publish payload:

```json
{
  "sessionId": "sess_2026_05_25_001",
  "source": "worksmith-extension",
  "events": [
    {
      "id": "evt_000001",
      "type": "tab.updated",
      "timestamp": "2026-05-25T11:31:10.000Z",
      "tabId": 123,
      "windowId": 1,
      "url": "https://example.com/dashboard",
      "title": "Dashboard",
      "payload": {
        "status": "complete"
      }
    }
  ]
}
```

### Streaming Modes

Worksmith should support multiple stream modes over time:

- Manual export from the console UI
- Periodic batch upload
- Near-real-time event push
- Live WebSocket or Server-Sent Events stream through a local service
- Session replay export for offline inspection

For v1, local UI and JSON export are enough. API publishing should be designed into the event model early, but implemented after the core extension is stable.

### Buffering and Retry

API delivery should be resilient.

The extension should:

- Queue events locally before upload
- Batch events to reduce network chatter
- Retry failed requests with backoff
- Track delivery state per event or per batch
- Avoid blocking the console UI if the API is unavailable
- Enforce a max queue size so storage cannot grow forever

Recommended default:

- Keep all events in the local debug console immediately
- Upload events in batches every 1 to 5 seconds when API streaming is enabled
- Persist undelivered batches in extension storage
- Drop or compact old events when retention limits are reached

### Auth and Privacy

If Worksmith pushes to a hosted API, it needs careful handling for credentials and sensitive browser data.

Considerations:

- Store API keys or tokens in extension storage, not in content scripts
- Allow API streaming to be disabled by default
- Let the user configure allowed destinations
- Redact sensitive query params, form values, or page text if needed
- Avoid sending full accessibility snapshots to remote APIs unless explicitly enabled
- Add session-level metadata so uploaded data can be grouped and deleted

The debug stream may include URLs, page text, element names, and user navigation patterns, so remote publishing should be treated as sensitive.

### Database Sink

If a backend service stores Worksmith events, a database model should preserve the session and tab structure.

Suggested entities:

- Session
- Tab
- Activity event
- Scroll sample
- Navigation event
- Accessibility snapshot
- Upload batch

The backend should support queries like:

- Get all events for a session
- Get timeline for a tab
- Get latest state of every tab
- Get scroll history for a URL
- Get latest accessibility snapshot for a tab
- Search events by URL, title, role, text snippet, or event type

This unlocks future debugging tools such as session replay, automated test artifact capture, and remote browser automation observability.

## Proposed Architecture

### `manifest.json`

Use Manifest V3.

Likely permissions:

- `tabs`
- `webNavigation`
- `scripting`
- `storage`
- `activeTab`

Likely host permissions:

- `<all_urls>` during local development
- Narrower permissions later, if we know the target automation domains

### Background Service Worker

Responsibilities:

- Listen for tab lifecycle events
- Listen for web navigation events
- Maintain tab-wise state
- Receive events from content scripts
- Persist recent activity to extension storage
- Broadcast updates to the Worksmith console UI
- Optionally publish activity batches to a local or remote API
- Inject or register content scripts as needed

### Content Script

Responsibilities:

- Detect scroll position
- Detect SPA route changes
- Build DOM-derived accessibility tree snapshots
- Send page-level events to the background worker

### Console UI

Responsibilities:

- Display tab-wise activity
- Display live event stream
- Request accessibility tree snapshots from the active tab
- Render the latest accessibility tree in a readable format
- Export recorded activity as JSON

## Data Model

### Tab State

```json
{
  "tabId": 123,
  "windowId": 1,
  "url": "https://example.com/dashboard",
  "title": "Dashboard",
  "active": true,
  "createdAt": "2026-05-25T11:30:00.000Z",
  "updatedAt": "2026-05-25T11:31:10.000Z",
  "lastScroll": {
    "scrollX": 0,
    "scrollY": 812,
    "scrollPercent": 42.3,
    "viewportWidth": 1440,
    "viewportHeight": 900,
    "documentHeight": 2100,
    "timestamp": "2026-05-25T11:31:10.000Z"
  }
}
```

### Activity Event

```json
{
  "id": "evt_000001",
  "type": "tab.updated",
  "timestamp": "2026-05-25T11:31:10.000Z",
  "tabId": 123,
  "windowId": 1,
  "url": "https://example.com/dashboard",
  "title": "Dashboard",
  "payload": {
    "status": "complete"
  }
}
```

### Accessibility Snapshot

```json
{
  "tabId": 123,
  "url": "https://example.com/dashboard",
  "capturedAt": "2026-05-25T11:32:00.000Z",
  "tree": {
    "role": "document",
    "name": "Dashboard",
    "tag": "body",
    "children": []
  }
}
```

## Recording Strategy

Activity should be recorded tab-wise in memory and periodically persisted.

For v1:

- Keep a global event stream capped at a configurable number, such as 2,000 events.
- Keep a per-tab event list capped at a smaller number, such as 300 events per tab.
- Store the latest tab states separately from event history.
- Store only the latest accessibility snapshot per tab unless export/history is explicitly needed.

This gives useful debugging visibility while limiting storage growth.

## Event Flow

1. User opens or activates a tab.
2. Background service worker receives the tab event.
3. Background updates tab state and appends an activity event.
4. Content script reports scroll or route changes.
5. Background merges those page-level events into the same tab timeline.
6. Console UI receives live updates over a runtime port or message listener.
7. User clicks "Capture accessibility tree."
8. Console asks background to request a snapshot from the active tab.
9. Content script returns the DOM-derived accessibility tree.
10. Console displays the tree and optionally prints it in the console UI log.

## Suggested File Structure

```text
worksmith/
  worksmith.md
  extension/
    manifest.json
    index.html
    src/
      background.js
      content.js
      console.js
      accessibility-tree.js
      storage.js
      types.js
    styles/
      console.css
```

## Implementation Phases

### Phase 1: Minimal Extension Shell

- Create Manifest V3 extension
- Add background service worker
- Add extension console page
- Confirm extension loads in the browser
- Show connected/ready state in the console UI

### Phase 2: Tab and URL Event Recording

- Listen to tab creation, activation, update, removal, and window focus events
- Listen to web navigation events
- Maintain tab-wise state
- Render event stream in the console UI

### Phase 3: Scroll and SPA Route Monitoring

- Add content script
- Report throttled scroll events
- Patch or observe history changes for SPA route updates
- Merge page-level events into per-tab timelines

### Phase 4: Accessibility Tree Snapshot

- Build DOM-derived accessibility tree utility
- Add manual capture button in console UI
- Render the tree as expandable JSON/tree UI
- Print snapshots in the console UI event log

### Phase 5: Export and Polish

- Add log clearing
- Add JSON export
- Add filters by tab and event type
- Add retention limits
- Improve accessibility tree naming and role inference

### Phase 6: API Streaming

- Add API destination settings
- Add background-worker event upload queue
- Add batch publishing to local or remote API
- Add retry and delivery status tracking
- Add controls to pause/resume streaming
- Add redaction options for sensitive URL params and page-derived text

### Phase 7: Database-Backed Debug History

- Define backend event schema
- Store sessions, tabs, events, scroll samples, and accessibility snapshots
- Add query endpoints for session and tab timelines
- Add remote debug viewer support
- Add export/replay workflows

## Open Questions

- Which browser should be the first target: Chrome, Edge, or another Chromium browser?
- Should this be local-development only, or eventually packaged for broader use?
- Should the accessibility tree be an approximation from DOM, or do we need integration with a browser automation layer that can expose a real accessibility tree?
- Do we want Worksmith to only observe, or eventually trigger automation actions too?
- Should API streaming target a local service first, a hosted service first, or support both from the start?
- What data should be redacted before events leave the user's machine?

## Recommendation

Start with a Chrome-compatible Manifest V3 extension and build the debugging console as an extension page at `extension/index.html`.

The console page should be the source of truth for visibility. Raw `console.log` output can help while developing, but the debugging experience should live in the extension UI so we can inspect tab histories, scroll telemetry, and accessibility snapshots without chasing logs across service workers, content scripts, and page consoles.

## Current Implementation Notes

The first Chromium-focused extension slice now lives in `extension/`.

Implemented:

- Manifest V3 extension shell for Chrome and Brave
- Extension action that opens the Worksmith console page
- Background service worker for tab, window, and navigation events
- Tab-wise state and capped event history in extension storage
- Content script for scroll telemetry and URL-change detection
- Visible scroll-container telemetry for scrollable boxes inside the active viewport
- Active-tab stable-scroll capture after 30 seconds, with pause/resume across tab switches
- Saved captures with screenshot, scroll state, and accessibility tree
- DOM-derived accessibility tree snapshot capture
- Console page with Live Tabs, Saved captures, event stream, event filter, target-tab summary, accessibility viewer, clear, and JSON export

The console tracks a separate target tab. This matters because opening the Worksmith console makes the console itself the browser's active tab. The target tab is the latest inspectable `http`, `https`, or `file` tab, so accessibility capture still points at the page we care about.

Stable capture behavior:

- Worksmith tracks scroll state for every page where the content script is running.
- The 30-second capture clock runs only for the currently active inspectable tab.
- When the user switches away, the active tab's clock pauses.
- When the user returns to that tab, the clock resumes from its prior elapsed time.
- If the page scroll position or any visible scroll box changes, the clock resets for the new scroll signature.
- If a stable signature has already been captured, Worksmith does not capture it again until the scroll signature changes.
- Each saved capture stores a visible-tab screenshot, the DOM-derived accessibility tree, page scroll state, visible scroll-box state, URL, title, tab id, and timestamp.

The extension is now a React + TypeScript app built with Vite and the
`@crxjs/vite-plugin` (MV3-aware). The console UI is React components, the
background worker and content scripts are bundled TS modules, and the shared
`styles/console.css` is preserved. Build with `npm run build`, then load the
generated `extension/dist/` folder unpacked. See `extension/README.md`.

Accessibility-tree views (all client-side, original raw tree preserved):

- **Tree** — the full DOM-derived snapshot.
- **Pruned** — a compact semantic interaction tree (drop structural wrappers,
  hoist meaningful descendants). `lib/prune.ts`.
- **AI** — an agent-optimized semantic interaction graph navigated one level at a
  time: prune, segment into a landmark/section hierarchy, assign stable
  document-order indices (`@1`, `@2`, …) to addressable items (links, buttons,
  inputs, images), and expose each node's direct children grouped by kind plus a
  count of interactive items deeper. Drill in/out via a breadcrumb. `lib/aitree.ts`
  + `components/AiTreeNavigator.tsx`. Synthesised from web-agent research
  (WebArena AX trees, Set-of-Marks / browser-use indexing, AgentOccam's
  pivotal-node consolidation and branch-into-subtree navigation).

Not implemented yet:

- API streaming
- Database-backed history
- Native browser accessibility-tree integration
- Side panel or DevTools panel UI
