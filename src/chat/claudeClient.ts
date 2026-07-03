/**
 * Minimal browser client for the Anthropic Messages API (streaming).
 *
 * The app is fully client-side, so the user's own Anthropic key is sent
 * straight from the browser (same trust model as the Alpha Vantage key) —
 * that requires the `anthropic-dangerous-direct-browser-access` header.
 */

export const DEFAULT_CHAT_MODEL = "claude-opus-4-8";
const API_URL = "https://api.anthropic.com/v1/messages";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Split an SSE buffer into complete events plus the unfinished remainder.
 * Anthropic streams `event: <name>\ndata: <json>\n\n` frames. The SSE spec
 * allows CRLF line endings (proxies sometimes rewrite to them), so frame and
 * line splits accept either — LF-only parsing would silently drop the stream.
 */
export function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? ""; // last piece may be incomplete
  for (const frame of frames) {
    let event = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (event || data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/** Extract the visible-text delta from one SSE event ("" for non-text events). */
export function textDeltaOf(ev: SseEvent): string {
  if (ev.event !== "content_block_delta") return "";
  try {
    const payload = JSON.parse(ev.data);
    return payload?.delta?.type === "text_delta" ? String(payload.delta.text ?? "") : "";
  } catch {
    return "";
  }
}

function friendlyError(status: number, apiMessage: string): string {
  if (status === 401) return "Anthropic rejected the API key — check it at console.anthropic.com.";
  if (status === 429) return "Rate limited by Anthropic — wait a few seconds and ask again.";
  if (status === 529 || status >= 500) return "Anthropic's API is briefly overloaded — try again in a moment.";
  return apiMessage || `Anthropic API error (HTTP ${status}).`;
}

/** API-level failure carrying the HTTP status (401 lets the UI re-open the key input). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AskOptions {
  apiKey: string;
  system: string;
  messages: ChatTurn[];
  model?: string;
  maxTokens?: number;
  /** Called with each streamed text fragment as it arrives. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export interface AskResult {
  text: string;
  /** "end_turn" for a complete answer; "max_tokens" = truncated; "refusal" = declined. */
  stopReason: string | null;
}

/** Stream one reply from Claude; resolves with the full text + stop reason. */
export async function askClaude(opts: AskOptions): Promise<AskResult> {
  const res = await fetch(API_URL, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_CHAT_MODEL,
      // Adaptive thinking spends from the same budget as the visible answer,
      // so leave real headroom — 2000 truncated long answers mid-sentence.
      max_tokens: opts.maxTokens ?? 6000,
      thinking: { type: "adaptive" },
      stream: true,
      system: opts.system,
      messages: opts.messages,
    }),
  });

  if (!res.ok) {
    let apiMessage = "";
    try {
      const body = await res.json();
      apiMessage = body?.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(friendlyError(res.status, apiMessage), res.status);
  }
  if (!res.body) throw new Error("The browser could not stream the response.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let stopReason: string | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseEvents(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.event === "error") {
          let msg = "The stream reported an error.";
          try {
            msg = JSON.parse(ev.data)?.error?.message ?? msg;
          } catch {
            /* keep default */
          }
          throw new Error(msg);
        }
        if (ev.event === "message_delta") {
          try {
            stopReason = JSON.parse(ev.data)?.delta?.stop_reason ?? stopReason;
          } catch {
            /* ignore malformed frame */
          }
        }
        const text = textDeltaOf(ev);
        if (text) {
          full += text;
          opts.onDelta?.(text);
        }
      }
    }
  } finally {
    // On any early exit (stream error, onDelta throw) release the connection.
    void reader.cancel().catch(() => undefined);
  }
  return { text: full, stopReason };
}
