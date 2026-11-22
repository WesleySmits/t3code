import { describe, expect, it } from "vite-plus/test";

import { moveLimitItem, orderLimitItems } from "./usageLimitsLayout";

describe("usage limits ordering", () => {
  it("keeps saved positions outside the current filter and appends new items in default order", () => {
    const savedOrder = ["codex", "cursor", "claude"];
    const editedOrder = moveLimitItem(savedOrder, ["codex", "claude"], 1, -1);
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
    expect(moveLimitItem([], ["codex", "claude"], 1, -1, defaults)).toEqual([
      "claude",
      "cursor",
      "codex",
      "antigravity",
    ]);
  });

  it("moves the requested item when a filter changes the visible default order", () => {
    const defaults = ["codex", "cursor", "claude", "antigravity"];
    const visible = ["claude", "codex", "antigravity"];
    const editedOrder = moveLimitItem([], visible, 0, 1, defaults);
    expect(editedOrder).toEqual(["codex", "cursor", "claude", "antigravity"]);
    expect(orderLimitItems(visible, editedOrder, (id) => id)).toEqual([
      "codex",
      "claude",
      "antigravity",
    ]);
  });
});
