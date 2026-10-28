import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { createSidebarListMotion, useSettleExit } from "./Sidebar.motion";

type SidebarListMotion = ReturnType<typeof createSidebarListMotion>;

function setup() {
  const list = document.createElement("ul");
  list.style.position = "relative";
  document.body.append(list);
  const motion = createSidebarListMotion(list);
  const row = (key: string) => {
    const element = document.createElement("li");
    element.dataset.threadItem = key;
    element.style.height = "24px";
    element.textContent = key;
    return element;
  };
  for (const key of ["a", "b", "c"]) list.append(row(key));
  motion.update(false);
  return {
    list,
    motion,
    row: (key: string) => list.querySelector<HTMLElement>(`[data-thread-item="${key}"]`)!,
    insertRow: (key: string, before: HTMLElement) => list.insertBefore(row(key), before),
    ghosts: () => [...list.querySelectorAll<HTMLElement>('[aria-hidden="true"]')],
    [Symbol.dispose]() {
      motion.dispose();
      list.remove();
    },
  };
}

function ghostEffect(ghost: HTMLElement) {
  const effect = ghost.getAnimations()[0]?.effect;
  if (!(effect instanceof KeyframeEffect)) throw new Error("The ghost is not animating.");
  return effect;
}
const ghostDuration = (ghost: HTMLElement) =>
  Number(ghostEffect(ghost).getComputedTiming().duration);
const FADE_MS = 150;

function preferReducedMotion() {
  const matchMedia = window.matchMedia.bind(window);
  return vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const list = matchMedia(query);
    Object.defineProperty(list, "matches", { value: query.includes("reduced-motion") });
    return list;
  });
}

function SettleExitProbe(props: {
  readonly enabled: boolean;
  readonly routeKey: string;
  readonly motion: SidebarListMotion;
}) {
  const settleExit = useSettleExit({
    enabled: props.enabled,
    routeRowThreadKey: props.routeKey,
  });
  return (
    <>
      <output aria-label="Settled shelf">{settleExit.settledShelfRouteKey ?? "none"}</output>
      <button type="button" onClick={() => settleExit.begin(props.motion, "b", true)}>
        Settle
      </button>
      <button type="button" onClick={() => settleExit.end(props.motion, "b", "failed")}>
        Fail
      </button>
      <button type="button" onClick={() => settleExit.end(props.motion, "b", "advanced")}>
        Advance
      </button>
    </>
  );
}

describe("createSidebarListMotion", () => {
  it("plays the settle exit for a settle that resolved before the row left, then removes it", async () => {
    using sidebar = setup();
    sidebar.motion.expectSettleExit("b");
    // The accepted settle resolves here; the removal commits in a later pass.
    sidebar.row("b").remove();
    sidebar.row("c").remove();
    sidebar.motion.update(true, new Set(["b"]));
    const settleExit = sidebar.ghosts().find((ghost) => ghost.textContent === "b")!;
    const fade = sidebar.ghosts().find((ghost) => ghost.textContent === "c")!;

    expect(settleExit.inert).toBe(true);
    expect(ghostDuration(fade)).toBe(FADE_MS);
    expect(ghostDuration(settleExit)).toBeGreaterThanOrEqual(250);
    expect(ghostDuration(settleExit)).toBeLessThanOrEqual(450);
    const animated = new Set(
      ghostEffect(settleExit)
        .getKeyframes()
        .flatMap((frame) =>
          Object.keys(frame).filter(
            (property) => !["offset", "computedOffset", "easing", "composite"].includes(property),
          ),
        ),
    );
    expect([...animated].toSorted()).toEqual(["opacity", "transform"]);
    settleExit.getAnimations()[0]!.finish();
    await vi.waitFor(() => expect(sidebar.list.contains(settleExit)).toBe(false));
  });

  it("forgets a settle once the thread shows settled or the settle fails", () => {
    using sidebar = setup();
    sidebar.motion.expectSettleExit("b");
    // The expanded shelf keeps the settled row listed.
    sidebar.motion.update(true, new Set(["b"]));
    sidebar.motion.expectSettleExit("c");
    sidebar.motion.cancelSettleExit("c");

    sidebar.row("b").remove();
    sidebar.row("c").remove();
    sidebar.motion.update(true);

    expect(sidebar.ghosts().map(ghostDuration)).toEqual([FADE_MS, FADE_MS]);
  });

  it("drops the settle exit when the row returns before it finishes", () => {
    using sidebar = setup();
    const c = sidebar.row("c");
    sidebar.motion.expectSettleExit("b");
    sidebar.row("b").remove();
    sidebar.motion.update(true, new Set(["b"]));
    expect(sidebar.ghosts()).toHaveLength(1);

    // Undo or a failed settle renders the row again.
    sidebar.insertRow("b", c);
    sidebar.motion.update(true);

    expect(sidebar.ghosts()).toHaveLength(0);
  });
});

describe("useSettleExit", () => {
  it("keeps the open thread out of the collapsed shelf only while its settle exit plays", async () => {
    using sidebar = setup();
    await using screen = await render(
      <SettleExitProbe enabled routeKey="b" motion={sidebar.motion} />,
    );
    const shelf = screen.getByRole("status", { name: "Settled shelf" });
    await expect.element(shelf).toHaveTextContent("b");

    await userEvent.click(screen.getByRole("button", { name: "Settle" }));
    await expect.element(shelf).toHaveTextContent("none");
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    await expect.element(shelf).toHaveTextContent("b");
    sidebar.row("b").remove();
    sidebar.motion.update(true);
    expect(sidebar.ghosts().map(ghostDuration)).toEqual([FADE_MS]);

    await userEvent.click(screen.getByRole("button", { name: "Settle" }));
    await userEvent.click(screen.getByRole("button", { name: "Advance" }));
    await expect.element(shelf).toHaveTextContent("none");
    await screen.rerender(<SettleExitProbe enabled routeKey="c" motion={sidebar.motion} />);
    await expect.element(shelf).toHaveTextContent("c");
    // Undo, then reopening the thread, lists it in the shelf again.
    await screen.rerender(<SettleExitProbe enabled routeKey="b" motion={sidebar.motion} />);
    await expect.element(shelf).toHaveTextContent("b");
  });

  it.each([
    { name: "disabled", enabled: false, reducedMotion: false },
    { name: "under reduced motion", enabled: true, reducedMotion: true },
  ])("settles exactly as before when $name", async ({ enabled, reducedMotion }) => {
    using _reducedMotion = reducedMotion ? preferReducedMotion() : undefined;
    using sidebar = setup();
    await using screen = await render(
      <SettleExitProbe enabled={enabled} routeKey="b" motion={sidebar.motion} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Settle" }));
    await expect
      .element(screen.getByRole("status", { name: "Settled shelf" }))
      .toHaveTextContent("b");
    sidebar.row("b").remove();
    sidebar.motion.update(true, new Set(["b"]));

    expect(sidebar.ghosts().map(ghostDuration)).toEqual(reducedMotion ? [] : [FADE_MS]);
  });
});
