import { encode } from "gpt-tokenizer";
import type { ChatMessage } from "./store";

/**
 * Approximate token count. The active model uses its own tokenizer; we use
 * cl100k-base as a stand-in (~10% off typically). Images counted at a flat
 * cost since we have no real tokenizer for them.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

const IMAGE_TOKENS = 256; // rough placeholder

export function countMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4 + countTokens(m.role);
    for (const p of m.parts) {
      if (p.type === "text") total += countTokens(p.text);
      else total += IMAGE_TOKENS;
    }
  }
  return total;
}
