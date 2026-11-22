import type { LimitPool, LimitPoolWindow } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";

export const UsageLimitsLayoutSchema = Schema.Struct({
  providerOrder: Schema.Array(Schema.String),
  windowOrder: Schema.Array(Schema.String),
  hiddenWindows: Schema.Array(Schema.String),
});

export type UsageLimitsLayout = typeof UsageLimitsLayoutSchema.Type;
export type UsageLimitsLayoutUpdate = (current: UsageLimitsLayout) => UsageLimitsLayout;
export type LimitMoveDirection = -1 | 1;

export const DEFAULT_USAGE_LIMITS_LAYOUT: UsageLimitsLayout = {
  providerOrder: [],
  windowOrder: [],
  hiddenWindows: [],
};

export function limitWindowKey(
  driver: LimitPool["driver"],
  window: Pick<LimitPoolWindow, "kind" | "id">,
): string {
  return JSON.stringify([driver, window.kind, window.id]);
}

export function orderLimitItems<T>(
  items: readonly T[],
  order: readonly string[],
  key: (item: T) => string,
): readonly T[] {
  if (order.length === 0) return items;
  const ranks = new Map(order.map((id, index) => [id, index]));
  const rank = (item: T) => ranks.get(key(item)) ?? order.length;
  return [...items].sort((left, right) => rank(left) - rank(right));
}

/** Reorder only the visible list's slots, retaining saved items outside the current view. */
export function moveLimitItem(
  order: readonly string[],
  visibleKeys: readonly string[],
  index: number,
  direction: LimitMoveDirection,
  defaultKeys: readonly string[] = visibleKeys,
): readonly string[] {
  const key = visibleKeys[index];
  const neighbor = visibleKeys[index + direction];
  if (key === undefined || neighbor === undefined) return order;
  const moved = [...visibleKeys];
  moved[index] = neighbor;
  moved[index + direction] = key;
  const visible = new Set(visibleKeys);
  let next = 0;
  return [...new Set([...order, ...defaultKeys, ...visibleKeys])].map((id) =>
    visible.has(id) ? (moved[next++] ?? id) : id,
  );
}
