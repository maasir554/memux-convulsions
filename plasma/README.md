# Plasma

Local-first chat harness with a swappable backend.

- **frontend** — React + Vite + TS chat UI. Streaming, context-window meter, compact-context action, think-mode toggle, settings.
- **backend** — Node + Hono server. Exposes an OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`) to the frontend, and adapts under the hood to a local AI server. First target: **AMD Lemonade** (`http://localhost:13305/v1`). Ollama / OpenAI-compatible upstreams to follow.

## Why a backend at all?

We could call Lemonade straight from the browser, but the backend lets us:
- Normalise differences between providers (Lemonade, Ollama, OpenAI, …) behind one shape.
- Translate features the frontend exposes (`think`, `compact`) into per-provider request shapes.
- Hide / proxy the upstream URL so we can later run Plasma remotely with the upstream still local.

## Quickstart

```bash
cd plasma
npm install
npm run dev
```

Frontend on http://localhost:5173, backend on http://localhost:8787.

Open settings in the UI and point the backend at your Lemonade server (defaults to `http://localhost:13305/v1`).

## Layout

```
plasma/
  backend/   Hono server, provider adapters
  frontend/  React chat UI
```
