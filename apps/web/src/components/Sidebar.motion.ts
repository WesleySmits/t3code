import { useState } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";

const motionTiming = { duration: 150, easing: "ease-out" };
// A settled row pops, then shrinks away in place. Only the detached clone animates.
const settleExitTiming = { duration: 320, easing: "cubic-bezier(0.4, 0, 0.6, 1)" };
const settleExitKeyframes = (opacity: number): Keyframe[] => [
  { opacity, transform: "scale(1)" },
  { opacity, transform: "scale(1.03)", offset: 0.25 },
  { opacity: 0, transform: "translateX(16px) scale(0.85)" },
];
const NO_KEYS: ReadonlySet<string> = new Set();
const rowTravel = (height: number) => Math.min(height, 40);
// Fades clone removed rows and animate clones and entries; intervening layout reads force reflows.
const MAX_FADED_ROWS_PER_UPDATE = 40;

type RowPosition = { top: number; left: number; width: number; height: number };

function progress(animation: Animation) {
  return animation.playState === "finished"
    ? 1
    : (animation.effect?.getComputedTiming().progress ?? 0);
}

/** Position the list so all direct children's offsetTop share an origin. */
export function createSidebarListMotion(parent: HTMLUListElement) {
  let positions: Map<HTMLElement, RowPosition> | null = null;
  let disposed = false;
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const running = new Map<HTMLElement, { animation: Animation; offset: number }>();
  const entering = new Map<HTMLElement, { animation: Animation; travel: number }>();
  const exiting = new Map<HTMLElement, Animation>();
  // Settle exits by thread key, so a row that returns (undo, failed settle) drops its ghost.
  const settleExits = new Map<string, HTMLElement>();
  // Requested settles. A removal plays the settle exit until a pass sees the thread settled, since
  // an accepted settle can resolve before React commits the removal.
  const settleIntents = new Set<string>();
  let released: Map<HTMLElement, number> | null = null;

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node);
    const run = current ? current.offset * (1 - progress(current.animation)) : 0;
    const entry = entering.get(node);
    const enter = entry ? entry.travel * (1 - progress(entry.animation)) : 0;
    return run + enter;
  };
  const clearFades = () => {
    for (const entry of entering.values()) entry.animation.cancel();
    for (const animation of exiting.values()) animation.cancel();
    for (const node of exiting.keys()) node.remove();
    entering.clear();
    exiting.clear();
    settleExits.clear();
  };
  const dropSettleExit = (key: string) => {
    const clone = settleExits.get(key);
    if (clone === undefined) return;
    exiting.get(clone)?.cancel();
    exiting.delete(clone);
    settleExits.delete(key);
    clone.remove();
  };
  const fadeOut = (
    node: HTMLElement,
    position: RowPosition,
    travel: number,
    settleKey: string | null,
  ) => {
    if (position.height === 0) return;
    const clone = node.cloneNode(true) as HTMLElement;
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (
          (attribute.name === "id" && element.namespaceURI !== "http://www.w3.org/2000/svg") ||
          attribute.name === "data-thread-item" ||
          attribute.name === "data-thread-selection-safe" ||
          attribute.name === "data-testid"
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    Object.assign(clone.style, {
      position: "absolute",
      top: `${position.top + remainingOffset(node)}px`,
      left: `${position.left}px`,
      width: `${position.width}px`,
      height: `${position.height}px`,
      margin: "0",
      boxSizing: "border-box",
      contentVisibility: "visible",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    });
    parent.append(clone);
    const entry = entering.get(node);
    const entryProgress = entry ? progress(entry.animation) : 1;
    const animation =
      settleKey === null
        ? clone.animate(
            [
              { opacity: entryProgress, transform: "translateY(0px)" },
              { opacity: 0, transform: `translateY(${travel}px)` },
            ],
            motionTiming,
          )
        : clone.animate(settleExitKeyframes(entryProgress), settleExitTiming);
    exiting.set(clone, animation);
    if (settleKey !== null) {
      dropSettleExit(settleKey);
      settleExits.set(settleKey, clone);
    }
    animation.addEventListener(
      "finish",
      () => {
        clone.remove();
        exiting.delete(clone);
        if (settleKey !== null && settleExits.get(settleKey) === clone) {
          settleExits.delete(settleKey);
        }
      },
      { once: true },
    );
  };

  const cancel = (node: HTMLElement) => {
    running.get(node)?.animation.cancel();
    running.delete(node);
  };
  const suspend = () => {
    for (const node of running.keys()) cancel(node);
    clearFades();
    positions = null;
    released = null;
  };
  const move = (node: HTMLElement, offset: number) => {
    cancel(node);
    const entry = entering.get(node);
    if (entry) entry.travel = 0;
    if (offset === 0 && !entry) return;
    const animation = node.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
      motionTiming,
    );
    running.set(node, { animation, offset });
    animation.addEventListener(
      "finish",
      () => {
        if (running.get(node)?.animation === animation) running.delete(node);
      },
      { once: true },
    );
  };

  return {
    /** Plays the settle exit, not the fade, when this thread's row leaves before it shows settled. */
    expectSettleExit(key: string) {
      if (!disposed) settleIntents.add(key);
    },
    cancelSettleExit(key: string) {
      settleIntents.delete(key);
    },
    update(animate: boolean, settledKeys: ReadonlySet<string> = NO_KEYS) {
      if (disposed) return;
      const next = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [
            node,
            {
              top: node.offsetTop,
              left: node.offsetLeft,
              width: node.offsetWidth,
              height: node.offsetHeight,
            },
          ]),
      );
      let fadeCount = 0;
      if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node) && position.height > 0) fadeCount++;
        }
        for (const [node, position] of next) {
          if (!positions.has(node) && position.height > 0) fadeCount++;
        }
      }
      const shouldAnimate =
        animate &&
        positions !== null &&
        !reducedMotion?.matches &&
        fadeCount <= MAX_FADED_ROWS_PER_UPDATE;
      const movedDelta = new Map<HTMLElement, number>();
      const nextOrder = [...next.keys()];
      const oldOrder = positions === null ? [] : [...positions.keys()];
      const ridingDelta = (
        order: readonly HTMLElement[],
        index: number,
        retained: (node: HTMLElement) => boolean,
      ) => {
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          const node = order[cursor]!;
          const delta = movedDelta.get(node);
          if (delta !== undefined) return delta;
          if (retained(node)) return remainingOffset(node);
        }
        return undefined;
      };
      if (!shouldAnimate) clearFades();
      else {
        for (const [node, position] of next) {
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined || previousTop === position.top) continue;
          movedDelta.set(node, previousTop + remainingOffset(node) - position.top);
        }
        const listedKeys = new Set<string>();
        for (const node of next.keys()) {
          const key = node.dataset.threadItem;
          if (key === undefined) continue;
          listedKeys.add(key);
          dropSettleExit(key);
        }
        for (const [node, position] of positions!) {
          if (next.has(node)) continue;
          const delta = ridingDelta(oldOrder, oldOrder.indexOf(node), (n) => next.has(n));
          const key = node.dataset.threadItem;
          fadeOut(
            node,
            position,
            delta === undefined ? rowTravel(position.height) : -delta,
            key !== undefined && settleIntents.has(key) && !listedKeys.has(key) ? key : null,
          );
        }
      }
      for (const [node, entry] of entering) {
        if (!next.has(node)) {
          entry.animation.cancel();
          entering.delete(node);
        }
      }
      for (const node of running.keys()) {
        if (!shouldAnimate || !next.has(node)) cancel(node);
      }
      if (shouldAnimate) {
        for (const [index, node] of nextOrder.entries()) {
          const position = next.get(node)!;
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) {
            if (position.height > 0) {
              const delta = ridingDelta(nextOrder, index, (n) => positions!.has(n));
              const travel = delta === undefined ? -rowTravel(position.height) : delta;
              const animation = node.animate(
                [
                  { opacity: 0, transform: `translateY(${travel}px)` },
                  { opacity: 1, transform: "translateY(0px)" },
                ],
                motionTiming,
              );
              entering.set(node, { animation, travel });
              animation.addEventListener(
                "finish",
                () => {
                  if (entering.get(node)?.animation === animation) entering.delete(node);
                },
                { once: true },
              );
            }
            continue;
          }
          const delta = movedDelta.get(node);
          // Computed progress includes easing; carry forward only our translation, never dnd-kit's
          // transforms.
          if (delta !== undefined) move(node, delta);
        }
      }
      if (released !== null) {
        if (!reducedMotion?.matches) {
          for (const [node, position] of next) {
            const top = released.get(node);
            if (top !== undefined) move(node, top - position.top);
          }
        }
        released = null;
      }
      for (const key of settleIntents) if (settledKeys.has(key)) settleIntents.delete(key);
      positions = next;
    },
    release() {
      suspend();
      const origin = parent.getBoundingClientRect().top;
      released = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [node, node.getBoundingClientRect().top - origin]),
      );
    },
    suspend,
    dispose() {
      suspend();
      settleIntents.clear();
      disposed = true;
    },
  };
}

type SidebarListMotion = ReturnType<typeof createSidebarListMotion>;
type SettleOutcome = "failed" | "stayed" | "advanced";

/**
 * Settle's destroy motion: the row plays the settle exit, and the open thread stays out of the
 * collapsed Settled shelf until navigation leaves it. Disabled or under reduced motion, settle
 * behaves exactly as without it.
 */
export function useSettleExit(input: {
  readonly enabled: boolean;
  readonly routeRowThreadKey: string | null;
}) {
  const { enabled, routeRowThreadKey } = input;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [exitingRouteKey, setExitingRouteKey] = useState<string | null>(null);
  if (exitingRouteKey !== null && exitingRouteKey !== routeRowThreadKey) setExitingRouteKey(null);
  return {
    /** The thread the collapsed Settled shelf keeps: the open one, unless it is exiting. */
    settledShelfRouteKey: exitingRouteKey === routeRowThreadKey ? null : routeRowThreadKey,
    /** Call only for a thread not yet settled, so the exit cannot outlive its settle. */
    begin(motion: SidebarListMotion | null, threadKey: string, leavesRoute: boolean) {
      if (!enabled || reducedMotion) return;
      motion?.expectSettleExit(threadKey);
      if (leavesRoute) setExitingRouteKey(threadKey);
    },
    end(motion: SidebarListMotion | null, threadKey: string, outcome: SettleOutcome) {
      if (outcome === "advanced") return;
      if (outcome === "failed") motion?.cancelSettleExit(threadKey);
      setExitingRouteKey((key) => (key === threadKey ? null : key));
    },
  };
}
