import { describe, expect, it } from "vite-plus/test";

import {
  hideLimitWindow,
  moveLimitItem,
  orderLimitItems,
  showLimitWindow,
} from "./usageLimitsLayout";

describe("usage limits ordering", () => {
  it("keeps saved positions outside the current filter and appends new items in default order", () => {
    const savedOrder = ["codex", "cursor", "claude"];
    const editedOrder = moveLimitItem(savedOrder, ["codex", "claude"], "claude", -1);
    expect(editedOrder).toEqual(["claude", "cursor", "codex"]);
    expect(
      orderLimitItems(
        ["grok", "codex", "antigravity", "claude", "cursor"],
        editedOrder,
        (id) => id,
      ),
    ).toEqual(["claude", "cursor", "codex", "grok", "antigravity"]);
  });

  it("keeps the default slots of filtered providers on the first move", () => {
    const defaults = ["codex", "cursor", "claude", "antigravity"];
    expect(moveLimitItem([], ["codex", "claude"], "claude", -1, defaults)).toEqual([
      "claude",
      "cursor",
      "codex",
      "antigravity",
    ]);
  });

  it("moves the requested item when a filter changes the visible default order", () => {
    const defaults = ["codex", "cursor", "claude", "antigravity"];
    const visible = ["claude", "codex", "antigravity"];
    const editedOrder = moveLimitItem([], visible, "claude", 1, defaults);
    expect(editedOrder).toEqual(["codex", "cursor", "claude", "antigravity"]);
    expect(orderLimitItems(visible, editedOrder, (id) => id)).toEqual([
      "codex",
      "claude",
      "antigravity",
    ]);
  });

  it("applies a move from a stale view to the latest saved order", () => {
    // Another tab raised D after this one rendered A B C D; lowering A keeps D above C.
    const latest = ["A", "B", "D", "C"];
    expect(moveLimitItem(latest, ["A", "B", "C", "D"], "A", 1)).toEqual(["B", "A", "D", "C"]);
    // C is already last in the latest order, so there is nothing to move it past.
    expect(moveLimitItem(latest, ["A", "B", "C", "D"], "C", 1)).toBe(latest);
  });
});

describe("usage limits visibility", () => {
  const empty = { providerOrder: [], windowOrder: [], hiddenWindows: [] };

  it("undoes only the hide that is still saved", () => {
    const hidden = hideLimitWindow(empty, "A", "first");
    expect(hideLimitWindow(hidden, "A", "second")).toBe(hidden);
    const rehidden = hideLimitWindow(showLimitWindow(hidden, "A"), "A", "second");
    expect(showLimitWindow(rehidden, "A", "first")).toBe(rehidden);
    expect(showLimitWindow(rehidden, "A", "second")).toEqual({ ...empty, hiddenWindowIds: {} });
  });

  it("shows a limit hidden before hides had an identity", () => {
    const saved = { ...empty, hiddenWindows: ["A", "B"] };
    expect(showLimitWindow(saved, "A", "any")).toBe(saved);
    expect(showLimitWindow(saved, "A")).toEqual({
      ...empty,
      hiddenWindows: ["B"],
      hiddenWindowIds: {},
    });
  });
});
