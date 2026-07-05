import { chatOnce } from "./api";
import { newId, type ChatMessage } from "./store";

/**
 * Compact the older portion of the conversation into a single system summary,
 * keeping the most recent `keepRecent` messages verbatim. Returns the new
 * message list.
 */
export const COMPACT_MIN_MESSAGES = 4;

export async function compactConversation(
  messages: ChatMessage[],
  model: string,
  keepRecent = 2,
): Promise<ChatMessage[]> {
  if (messages.length < COMPACT_MIN_MESSAGES || messages.length <= keepRecent + 1) {
    return messages;
  }
  const recent = messages.slice(-keepRecent);
  const older = messages.slice(0, -keepRecent);

  const prompt: ChatMessage[] = [
    {
      id: newId(),
      role: "system",
      parts: [
        {
          type: "text",
          text:
            "You are a summariser. Compress the following conversation into a concise " +
            "factual recap that preserves names, decisions, code-relevant details, and " +
            "open questions. Output plain prose, no headings.",
        },
      ],
      createdAt: Date.now(),
    },
    {
      id: newId(),
      role: "user",
      parts: [
        {
          type: "text",
          text: older
            .map(
              (m) =>
                `[${m.role}]\n` +
                m.parts
                  .map((p) => (p.type === "text" ? p.text : "[image]"))
                  .join("\n"),
            )
            .join("\n\n"),
        },
      ],
      createdAt: Date.now(),
    },
  ];

  const summary = await chatOnce(prompt, model);

  const summaryMsg: ChatMessage = {
    id: newId(),
    role: "system",
    parts: [
      {
        type: "text",
        text: `[Compacted summary of earlier messages]\n${summary.trim()}`,
      },
    ],
    createdAt: Date.now(),
  };

  return [summaryMsg, ...recent];
}
