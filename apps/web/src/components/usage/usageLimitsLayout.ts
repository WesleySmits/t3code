import type { LimitPool, LimitPoolWindow } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";

export const UsageLimitsLayoutSchema = Schema.Struct({
  providerOrder: Schema.Array(Schema.String),
  windowOrder: Schema.Array(Schema.String),
  hiddenWindows: Schema.Array(Schema.String),
  /**
   * The latest hide of each hidden window, so an Undo reverses only the hide it reports. Layouts
   * saved before it, or shown elsewhere, have no entry and no Undo to match.
   */
  hiddenWindowIds: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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

/**
 * Moves `key` past its neighbor in the visible list as `order` ranks it now, so a view rendered
 * before another tab's change still applies its intent to the latest order. `visibleKeys` are in
 * default display order. Saved items outside the view keep their slots. Returns `order` itself
 * when there is nothing to move past.
 */
export function moveLimitItem(
  order: readonly string[],
  visibleKeys: readonly string[],
  key: string,
  direction: LimitMoveDirection,
  defaultKeys: readonly string[] = visibleKeys,
): readonly string[] {
  const current = orderLimitItems(visibleKeys, order, (id) => id);
  const index = current.indexOf(key);
  const neighbor = current[index + direction];
  if (index < 0 || neighbor === undefined) return order;
  const moved = [...current];
  moved[index] = neighbor;
  moved[index + direction] = key;
  const visible = new Set(visibleKeys);
  let next = 0;
  return [...new Set([...order, ...defaultKeys, ...visibleKeys])].map((id) =>
    visible.has(id) ? (moved[next++] ?? id) : id,
  );
}

/** Hides `key` as the hide `hideId`. Returns `layout` itself when `key` is already hidden. */
export function hideLimitWindow(
  layout: UsageLimitsLayout,
  key: string,
  hideId: string,
): UsageLimitsLayout {
  if (layout.hiddenWindows.includes(key)) return layout;
  return {
    ...layout,
    hiddenWindows: [...layout.hiddenWindows, key],
    hiddenWindowIds: { ...layout.hiddenWindowIds, [key]: hideId },
  };
}

/**
 * Shows `key`. With `hideId`, only while that hide is still the latest one, so a stale Undo cannot
 * reverse a later hide. Returns `layout` itself when there is nothing to show.
 */
export function showLimitWindow(
  layout: UsageLimitsLayout,
  key: string,
  hideId?: string,
): UsageLimitsLayout {
  if (!layout.hiddenWindows.includes(key)) return layout;
  if (hideId !== undefined && layout.hiddenWindowIds?.[key] !== hideId) return layout;
  return {
    ...layout,
    hiddenWindows: layout.hiddenWindows.filter((window) => window !== key),
    hiddenWindowIds: Object.fromEntries(
      Object.entries(layout.hiddenWindowIds ?? {}).filter(([window]) => window !== key),
    ),
  };
}
