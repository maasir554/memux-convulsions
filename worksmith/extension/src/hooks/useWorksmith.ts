import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundMessage, WorksmithState } from "../lib/types";

const EMPTY_STATE: WorksmithState = {
  sessionId: "",
  activeTabId: null,
  targetTabId: null,
  activeWindowId: null,
  tabs: {},
  events: [],
  eventTypes: [],
  savedCaptures: [],
  nextEventNumber: 1,
};

export interface UseWorksmith {
  state: WorksmithState;
  connected: boolean;
  captureError: string | null;
  clearLog: () => void;
  captureAccessibility: (tabId?: number | null) => void;
}

export function useWorksmith(): UseWorksmith {
  const [state, setState] = useState<WorksmithState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const port = chrome.runtime.connect({ name: "worksmith-console" });
      portRef.current = port;
      setConnected(true);

      port.onMessage.addListener((message: BackgroundMessage) => {
        // The background broadcasts full state on every event, so a "state"
        // message is sufficient; "event" messages are redundant here.
        if (message.type === "state") {
          setState(message.state);
        } else if (message.type === "accessibility-snapshot") {
          setCaptureError(null);
        } else if (message.type === "capture-error") {
          setCaptureError(message.error);
        }
      });

      port.onDisconnect.addListener(() => {
        setConnected(false);
        portRef.current = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 1000);
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  const clearLog = useCallback(() => {
    portRef.current?.postMessage({ type: "clear-log" });
  }, []);

  const captureAccessibility = useCallback((tabId?: number | null) => {
    setCaptureError(null);
    portRef.current?.postMessage({ type: "capture-accessibility", tabId });
  }, []);

  return { state, connected, captureError, clearLog, captureAccessibility };
}
