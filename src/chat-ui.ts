/**
 * The in-app coach: a floating chat drawer, available from both tabs, powered
 * by Claude with the whole method + glossary + live screen state as context.
 * The user's Anthropic key lives in localStorage like the data-provider keys.
 */
import { askClaude, type ChatTurn } from "./chat/claudeClient";
import { buildSystemPrompt, collectLiveContext, trimHistory } from "./chat/context";

const LS_ANTHROPIC_KEY = "vs.key.anthropic";

const WELCOME =
  "Hey — I'm the coach. I know every term, gate and decision in this app, plus whatever is on your screen right now (scan results, the selected ticker's read, your positions). Ask me anything: “why is NVDA a WAIT?”, “what's expectancy?”, “did I understand the gap play right?”";

const CHIPS = [
  "Why did my ticker get its Final Call?",
  "Explain the gap play like I'm new",
  "What should I check before clicking buy?",
  "Quiz me on the method",
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Tiny safe renderer: escape, then **bold**, `code`, and line breaks. */
export function mdLite(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

export function initChat(): void {
  const fab = document.getElementById("chatFab");
  const drawer = document.getElementById("chatDrawer");
  const closeBtn = document.getElementById("chatClose");
  const msgs = document.getElementById("chatMsgs");
  const chips = document.getElementById("chatChips");
  const input = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  const send = document.getElementById("chatSend") as HTMLButtonElement | null;
  const keyRow = document.getElementById("chatKeyRow");
  const keyInput = document.getElementById("chatKey") as HTMLInputElement | null;
  const keySave = document.getElementById("chatKeySave") as HTMLButtonElement | null;
  if (!fab || !drawer || !closeBtn || !msgs || !chips || !input || !send || !keyRow || !keyInput || !keySave) return;

  const turns: ChatTurn[] = [];
  let streaming: AbortController | null = null;

  const hasKey = () => !!(localStorage.getItem(LS_ANTHROPIC_KEY) ?? "").trim();
  const syncKeyRow = () => {
    keyRow.hidden = hasKey();
  };

  function bubble(role: "user" | "coach", html: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `chat-msg ${role}`;
    el.innerHTML = html;
    msgs!.appendChild(el);
    msgs!.scrollTop = msgs!.scrollHeight;
    return el;
  }

  function setBusy(busy: boolean): void {
    input!.disabled = busy;
    send!.textContent = busy ? "Stop" : "Send";
    send!.classList.toggle("stop", busy);
  }

  async function ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q) return;
    if (!hasKey()) {
      keyRow!.hidden = false;
      keyInput!.focus();
      bubble("coach", mdLite("I need an Anthropic API key first — paste it above (stored only in this browser)."));
      return;
    }
    input!.value = "";
    bubble("user", mdLite(q));
    turns.push({ role: "user", content: q });
    const out = bubble("coach", `<span class="chat-typing">…</span>`);
    setBusy(true);
    streaming = new AbortController();
    let full = "";
    try {
      // Fresh snapshot of the screen for every question.
      const system = buildSystemPrompt(collectLiveContext());
      await askClaude({
        apiKey: (localStorage.getItem(LS_ANTHROPIC_KEY) ?? "").trim(),
        system,
        messages: trimHistory(turns),
        signal: streaming.signal,
        onDelta: (t) => {
          // Re-render the whole bubble each tick so markdown never splits mid-token.
          full += t;
          out.innerHTML = mdLite(full);
          msgs!.scrollTop = msgs!.scrollHeight;
        },
      });
      out.innerHTML = mdLite(full);
      turns.push({ role: "assistant", content: full });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        out.innerHTML = mdLite(full ? `${full} …(stopped)` : "(stopped)");
        // Keep history consistent: drop the unanswered user turn.
        if (turns[turns.length - 1]?.role === "user") turns.pop();
      } else {
        out.innerHTML = `<span class="neg">${esc(err instanceof Error ? err.message : String(err))}</span>`;
        if (turns[turns.length - 1]?.role === "user") turns.pop();
      }
    } finally {
      streaming = null;
      setBusy(false);
      msgs!.scrollTop = msgs!.scrollHeight;
      input!.focus();
    }
  }

  fab.addEventListener("click", () => {
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) {
      syncKeyRow();
      if (!msgs.childElementCount) bubble("coach", mdLite(WELCOME));
      input.focus();
    }
  });
  closeBtn.addEventListener("click", () => (drawer.hidden = true));

  keySave.addEventListener("click", () => {
    const k = keyInput.value.trim();
    if (!k) return;
    localStorage.setItem(LS_ANTHROPIC_KEY, k);
    keyInput.value = "";
    syncKeyRow();
    bubble("coach", mdLite("Key saved — ask away."));
    input.focus();
  });
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") keySave.click();
  });

  send.addEventListener("click", () => {
    if (streaming) {
      streaming.abort();
      return;
    }
    void ask(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) void ask(input.value);
    }
  });

  chips.innerHTML = CHIPS.map((c) => `<button class="chat-chip" type="button">${esc(c)}</button>`).join("");
  chips.querySelectorAll<HTMLButtonElement>(".chat-chip").forEach((b) => {
    b.addEventListener("click", () => {
      if (!streaming) void ask(b.textContent ?? "");
    });
  });
}
