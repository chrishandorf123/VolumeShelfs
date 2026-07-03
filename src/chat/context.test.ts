import { describe, expect, it } from "vitest";
import { buildSystemPrompt, collectLiveContext, registerChatContext, trimHistory, METHOD_SUMMARY } from "./context";
import type { ChatTurn } from "./claudeClient";

describe("buildSystemPrompt", () => {
  it("embeds the method, the glossary and the live context", () => {
    const p = buildSystemPrompt("EXPLORE TAB — NVDA @ $120");
    expect(p).toContain("VolumeShelfs coach");
    expect(p).toContain(METHOD_SUMMARY.slice(0, 60)); // the method is in there
    expect(p).toContain("Anchored Volume Profile"); // a glossary term
    expect(p).toContain("Point of Control"); // another one
    expect(p).toContain("EXPLORE TAB — NVDA @ $120"); // the live state
    expect(p.toLowerCase()).toContain("not financial advice");
  });

  it("tells the model when nothing is loaded instead of leaving a blank section", () => {
    const p = buildSystemPrompt("   ");
    expect(p).toContain("Nothing loaded yet");
  });

  it("keeps the coach subordinate to the app's decisions", () => {
    const p = buildSystemPrompt("");
    expect(p).toMatch(/Never override the app's Final Call/);
  });
});

describe("live-context registry", () => {
  it("collects every provider and isolates a throwing one", () => {
    registerChatContext("t-ok", () => "alpha state");
    registerChatContext("t-empty", () => "   ");
    registerChatContext("t-boom", () => {
      throw new Error("nope");
    });
    const ctx = collectLiveContext();
    expect(ctx).toContain("alpha state");
    expect(ctx).toContain("t-boom context unavailable");
    expect(ctx).not.toContain("t-empty"); // empty providers add nothing
  });

  it("replaces a provider registered under the same id", () => {
    registerChatContext("t-swap", () => "old");
    registerChatContext("t-swap", () => "new");
    const ctx = collectLiveContext();
    expect(ctx).toContain("new");
    expect(ctx).not.toContain("old");
  });
});

describe("trimHistory", () => {
  const turn = (role: ChatTurn["role"], i: number): ChatTurn => ({ role, content: `m${i}` });

  it("keeps only the most recent turns", () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 20; i++) turns.push(turn(i % 2 === 0 ? "user" : "assistant", i));
    const kept = trimHistory(turns, 6);
    expect(kept).toHaveLength(6);
    expect(kept[kept.length - 1].content).toBe("m19");
  });

  it("always starts on a user turn (the API rejects assistant-first)", () => {
    const turns: ChatTurn[] = [turn("user", 0), turn("assistant", 1), turn("user", 2), turn("assistant", 3)];
    const kept = trimHistory(turns, 3); // slice would start on assistant m1
    expect(kept[0].role).toBe("user");
    expect(kept[0].content).toBe("m2");
  });

  it("handles an empty history", () => {
    expect(trimHistory([], 8)).toEqual([]);
  });
});
