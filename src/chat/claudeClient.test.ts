import { describe, expect, it } from "vitest";
import { parseSseEvents, textDeltaOf } from "./claudeClient";

describe("parseSseEvents", () => {
  it("parses complete frames and keeps the unfinished remainder", () => {
    const chunk =
      `event: message_start\ndata: {"type":"message_start"}\n\n` +
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n` +
      `event: content_block_del`; // torn mid-frame
    const { events, rest } = parseSseEvents(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("message_start");
    expect(events[1].event).toBe("content_block_delta");
    expect(rest).toBe("event: content_block_del");
  });

  it("resumes cleanly when the remainder is completed by the next chunk", () => {
    const first = parseSseEvents(`event: ping\ndata: {}\n\nevent: content_block_delta\nda`);
    const second = parseSseEvents(
      first.rest + `ta: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n`,
    );
    expect(second.events).toHaveLength(1);
    expect(textDeltaOf(second.events[0])).toBe("there");
  });

  it("returns no events for an empty buffer", () => {
    expect(parseSseEvents("").events).toEqual([]);
  });
});

describe("textDeltaOf", () => {
  it("extracts text deltas only", () => {
    expect(
      textDeltaOf({
        event: "content_block_delta",
        data: JSON.stringify({ delta: { type: "text_delta", text: "abc" } }),
      }),
    ).toBe("abc");
  });

  it("ignores thinking deltas and other events", () => {
    expect(
      textDeltaOf({
        event: "content_block_delta",
        data: JSON.stringify({ delta: { type: "thinking_delta", thinking: "hmm" } }),
      }),
    ).toBe("");
    expect(textDeltaOf({ event: "message_stop", data: "{}" })).toBe("");
  });

  it("never throws on malformed JSON", () => {
    expect(textDeltaOf({ event: "content_block_delta", data: "{oops" })).toBe("");
  });
});

describe("CRLF tolerance (SSE spec allows \\r\\n; proxies rewrite to it)", () => {
  it("parses CRLF-delimited frames identically to LF frames", () => {
    const chunk =
      `event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\r\n\r\n` +
      `event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\r\n\r\n`;
    const { events, rest } = parseSseEvents(chunk);
    expect(events).toHaveLength(2);
    expect(textDeltaOf(events[0])).toBe("Hi");
    expect(events[1].event).toBe("message_delta");
    expect(rest).toBe("");
  });

  it("handles mixed LF and CRLF in one buffer", () => {
    const chunk =
      `event: ping\ndata: {}\r\n\r\n` +
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n`;
    const { events } = parseSseEvents(chunk);
    expect(events).toHaveLength(2);
    expect(textDeltaOf(events[1])).toBe("ok");
  });
});
