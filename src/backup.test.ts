import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportBackup, importBackup } from "./backup";

// jsdom isn't configured for these node tests, so stub a minimal localStorage.
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe("backup export/import", () => {
  it("captures only vs.* keys and restores them exactly", () => {
    localStorage.setItem("vs.tickers", "AAPL MSFT NVDA");
    localStorage.setItem("vs.positions.v1", '[{"symbol":"AAPL"}]');
    localStorage.setItem("unrelated", "ignore me");

    const json = exportBackup();
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe("VolumeShelfs");
    expect(parsed.data["vs.tickers"]).toBe("AAPL MSFT NVDA");
    expect(parsed.data["unrelated"]).toBeUndefined(); // non-vs keys excluded

    localStorage.clear();
    const n = importBackup(json);
    expect(n).toBe(2);
    expect(localStorage.getItem("vs.tickers")).toBe("AAPL MSFT NVDA");
    expect(localStorage.getItem("vs.positions.v1")).toBe('[{"symbol":"AAPL"}]');
  });

  it("round-trips without loss (export → clear → import → export equal)", () => {
    localStorage.setItem("vs.a", "1");
    localStorage.setItem("vs.b", "two");
    const before = JSON.parse(exportBackup()).data;
    const json = exportBackup();
    localStorage.clear();
    importBackup(json);
    expect(JSON.parse(exportBackup()).data).toEqual(before);
  });

  it("rejects a file that isn't a VolumeShelfs backup", () => {
    expect(() => importBackup('{"app":"SomethingElse","data":{}}')).toThrow(/VolumeShelfs backup/);
    expect(() => importBackup("not json at all")).toThrow(/valid JSON/);
    expect(() => importBackup('{"app":"VolumeShelfs"}')).toThrow(/VolumeShelfs backup/);
  });

  it("only writes string vs.* values from the data block", () => {
    localStorage.clear();
    const n = importBackup(
      JSON.stringify({ app: "VolumeShelfs", version: 1, savedAt: "x", data: { "vs.ok": "yes", "vs.num": 5, evil: "no" } }),
    );
    expect(n).toBe(1);
    expect(localStorage.getItem("vs.ok")).toBe("yes");
    expect(localStorage.getItem("vs.num")).toBeNull(); // non-string skipped
    expect(localStorage.getItem("evil")).toBeNull(); // non-vs skipped
  });
});
