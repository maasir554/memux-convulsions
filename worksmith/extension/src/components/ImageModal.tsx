import { useEffect } from "react";
import type { SavedCapture } from "../lib/types";
import { Icon } from "./IconSprite";

interface ImageModalProps {
  capture: SavedCapture | null;
  onClose: () => void;
}

export function ImageModal({ capture, onClose }: ImageModalProps) {
  useEffect(() => {
    if (!capture) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [capture, onClose]);

  if (!capture) {
    return null;
  }

  return (
    <div className="image-modal" role="dialog" aria-modal="true" aria-label="Capture image preview">
      <div className="image-modal-backdrop" onClick={onClose} />
      <div className="image-modal-panel">
        <div className="image-modal-header">
          <strong>{capture.title || capture.url || "Capture preview"}</strong>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close image preview"
          >
            <Icon id="icon-x" />
          </button>
        </div>
        <div className="image-modal-body">
          <img className="image-modal-img" src={capture.screenshotDataUrl} alt="Saved page screenshot" />
        </div>
      </div>
    </div>
  );
}
