import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const key = "t3code:usage-page-preferences:v1";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("round-trips usage preferences and reads older saves without a limits layout", () => {
    const limitsLayout = {
      providerOrder: ["claudeAgent", "antigravity"],
      windowOrder: ['["antigravity","weekly","gemini-weekly"]'],
      hiddenWindows: ['["antigravity","weekly","gemini-argon-wtu-weekly"]'],
    };
    const preferences = { metric: "cost", windowDays: 7, hiddenProviders: ["codex"] } as const;
    saveUsagePagePreferences({ ...preferences, limitsLayout });
    expect(readUsagePagePreferences()).toEqual({ ...preferences, limitsLayout });

    // Changing the metric in another client reads the layout saved by the first.
    saveUsagePagePreferences((current) => ({ ...current, metric: "tokens" }));
    expect(readUsagePagePreferences()).toEqual({ ...preferences, metric: "tokens", limitsLayout });

    saveUsagePagePreferences((current) => ({ ...current, limitsLayout: undefined }));
    expect(readUsagePagePreferences()).toEqual({ ...preferences, metric: "tokens" });

    values.set(key, '{"metric":"tokens","windowDays":30}');
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 30 });
  });

  // regression: #10189 an invalid saved usage selection was never replaced
  it.each([
    "not-json",
    '{"metric":"unknown","windowDays":7}',
    '{"metric":"cost","windowDays":365}',
  ])("replaces invalid preferences on the next save: %s", (value) => {
    values.set(key, value);
    expect(readUsagePagePreferences()).toEqual({ metric: "limits", windowDays: 30 });
    saveUsagePagePreferences({ metric: "tokens", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 7 });
  });
});
