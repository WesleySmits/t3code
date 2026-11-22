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
});
