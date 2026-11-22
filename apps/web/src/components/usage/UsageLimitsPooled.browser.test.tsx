import "~/index.css";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  CHATGPT_USAGE_URL,
  collectLimitAccounts,
  collectLimitPools,
} from "@t3tools/shared/usageLimits";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ToastProvider } from "../ui/toast";
import { LimitsLayoutMenu, UsageLimitsPooled } from "./UsageLimitsPooled";
import {
  DEFAULT_USAGE_LIMITS_LAYOUT,
  hideLimitWindow,
  limitWindowKey,
  showLimitWindow,
  type UsageLimitsLayout,
} from "./usageLimitsLayout";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} pools={[]} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

function quotaProvider(
  driver: string,
  windows: NonNullable<ServerProvider["usageLimits"]>["windows"],
  instanceId = driver,
): ServerProvider {
  const provider = managedChatGpt(instanceId, driver);
  return {
    ...provider,
    driver: ProviderDriverKind.make(driver),
    usageLimits: { checkedAt, windows },
  };
}

const presentations = new Map([
  [
    EnvironmentId.make("desk"),
    {
      entry: { target: { label: "Desk" } },
      serverConfig: {
        providers: [
          quotaProvider("codex", [
            { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 76 },
          ]),
          quotaProvider(
            "codex",
            [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 20 }],
            "codex_work",
          ),
          quotaProvider("cursor", [
            { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 25 },
          ]),
          quotaProvider("antigravity", [
            { id: "gemini-5h", kind: "session", label: "Gemini 5-hour", usedPercent: 3 },
            { id: "gemini-weekly", kind: "weekly", label: "Gemini Weekly", usedPercent: 50 },
            {
              id: "gemini-argon-wtu-weekly",
              kind: "weekly",
              label: "Gemini 4 Argon Weekly",
              usedPercent: 0,
            },
          ]),
        ],
      },
    },
  ],
]);
const pools = collectLimitPools(collectLimitAccounts(presentations), Date.parse(checkedAt));

/**
 * The page owns the saved layout and the header menu; this stands in for both. Another tab writes
 * `storage.layout` directly, which this view sees only on its own next save.
 */
function LayoutExample({
  writable = true,
  storage = { layout: DEFAULT_USAGE_LIMITS_LAYOUT },
}: {
  readonly writable?: boolean;
  readonly storage?: { layout: UsageLimitsLayout };
}) {
  const [layout, setLayout] = useState(storage.layout);
  const layoutMenu = useRef<HTMLButtonElement>(null);
  const change = (update: (current: UsageLimitsLayout) => UsageLimitsLayout) => {
    if (!writable) return false;
    storage.layout = update(storage.layout);
    setLayout(storage.layout);
    return true;
  };
  return (
    // Toasts stay until closed, so a test sees an Undo retire because of the layout, not a timer.
    <ToastProvider timeout={0}>
      <LimitsLayoutMenu
        ref={layoutMenu}
        pools={pools}
        layout={layout}
        onLayoutChange={change}
        onReset={() => setLayout(DEFAULT_USAGE_LIMITS_LAYOUT)}
      />
      <UsageLimitsPooled
        presentations={presentations}
        pools={pools}
        now={Date.parse(checkedAt)}
        layout={layout}
        onLayoutChange={change}
        focusLayoutMenu={() => layoutMenu.current?.focus()}
      />
    </ToastProvider>
  );
}

const cardOf = (element: Element) => element.closest("[data-limit-card]")!;
const headingRowOf = (name: string) =>
  page.getByRole("heading", { name, exact: true }).element().parentElement!.parentElement!;

function geometry(card: Element, heading: Element) {
  const [summary, bar] = [...card.children];
  return [card, summary!, bar!, heading].map((element) => element.getBoundingClientRect().toJSON());
}

function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** A control's box, grown to the pseudo-element that enlarges its touch target. */
function touchTarget(control: HTMLElement) {
  const box = control.getBoundingClientRect();
  const after = getComputedStyle(control, "::after");
  if (after.position !== "absolute") return box;
  const left = box.left + control.clientLeft + Number.parseFloat(after.left);
  const top = box.top + control.clientTop + Number.parseFloat(after.top);
  const target = new DOMRect(
    left,
    top,
    Number.parseFloat(after.width),
    Number.parseFloat(after.height),
  );
  return new DOMRect(
    Math.min(box.left, target.left),
    Math.min(box.top, target.top),
    Math.max(box.right, target.right) - Math.min(box.left, target.left),
    Math.max(box.bottom, target.bottom) - Math.min(box.top, target.top),
  );
}

it("reveals card and provider actions without moving the layout", async () => {
  await using screen = await render(<LayoutExample />);
  const hide = screen.getByRole("button", { name: "Hide Antigravity · Gemini Weekly" });
  const card = cardOf(hide.element());
  const cluster = hide.element().parentElement!.parentElement!;
  const heading = headingRowOf("Antigravity");
  const providerActions = screen.getByRole("group", { name: "Antigravity", exact: true });
  const rest = geometry(card, heading);
  expect(getComputedStyle(cluster).opacity).toBe("0");
  // Invisible actions cannot be clicked or tapped by accident.
  expect(getComputedStyle(cluster).pointerEvents).toBe("none");

  await userEvent.hover(card);
  await vi.waitFor(() => expect(getComputedStyle(cluster).opacity).toBe("1"));
  expect(geometry(card, heading)).toEqual(rest);

  await userEvent.hover(heading);
  const providerCluster = providerActions.element().parentElement!;
  await vi.waitFor(() => expect(getComputedStyle(providerCluster).opacity).toBe("1"));
  expect(geometry(card, heading)).toEqual(rest);

  // The bar's segment and legend rows come first, then the card's actions.
  const barControls = [...card.children[1]!.querySelectorAll("button")];
  barControls.at(-1)!.focus();
  await userEvent.tab();
  await expect
    .element(screen.getByRole("button", { name: "Move Antigravity · Gemini Weekly up" }))
    .toHaveFocus();
  await vi.waitFor(() => expect(getComputedStyle(cluster).opacity).toBe("1"));
  expect(geometry(card, heading)).toEqual(rest);

  // The notch never covers a card's content, in the compact and the wide bar layout.
  for (const width of ["360px", "1000px"]) {
    screen.container.style.width = width;
    for (const each of screen.container.querySelectorAll("[data-limit-card]")) {
      const notch = each.lastElementChild!.getBoundingClientRect();
      for (const content of [...each.children].slice(0, -1)) {
        expect(intersects(notch, content.getBoundingClientRect())).toBe(false);
      }
    }
  }
});

it("reorders providers and limits with the keyboard", async () => {
  await using screen = await render(<LayoutExample />);
  const moveProvider = screen.getByRole("button", { name: "Move Antigravity up" });
  moveProvider.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(moveProvider).toHaveFocus();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Antigravity moved to position 2 of 3.");
  expect(
    [...screen.container.querySelectorAll("h2")].map((heading) => heading.textContent),
  ).toEqual(["Codex", "Antigravity", "Cursor"]);

  const moveWindow = screen.getByRole("button", { name: "Move Antigravity · Gemini Weekly up" });
  moveWindow.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(moveWindow).toHaveFocus();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Antigravity · Gemini Weekly moved to position 1 of 3.");
  const weekly = screen.getByText("Gemini Weekly", { exact: true }).element();
  const session = screen.getByText("Gemini 5-hour", { exact: true }).element();
  expect(weekly.compareDocumentPosition(session) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // A provider with one visible limit has nothing to reorder it against.
  const cursor = cardOf(screen.getByRole("button", { name: "Hide Cursor · Overall" }).element());
  expect(cursor.querySelector('[aria-label^="Move"]')).toBeNull();
});

it("hides limits, moves focus to a neighbor and restores them", async () => {
  await using screen = await render(<LayoutExample />);
  const layoutMenu = page.getByRole("button", { name: /^Limits layout/ });

  // An open segment popover closes when its card is hidden.
  const codexHide = screen.getByRole("button", { name: "Hide Codex · Weekly" });
  const codexCard = cardOf(codexHide.element());
  await userEvent.hover(codexCard.children[1]!.querySelector("button")!);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="popover-popup"]')).not.toBeNull(),
  );
  codexHide.element().focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(document.querySelector('[data-slot="popover-popup"]')).toBeNull());
  await expect.element(screen.getByRole("button", { name: "Hide Cursor · Overall" })).toHaveFocus();
  await expect.element(page.getByText("Codex · Weekly hidden")).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent("");
  await expect.element(layoutMenu).toHaveAccessibleName("Limits layout, 1 hidden");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByRole("button", { name: "Hide Codex · Weekly" })).toHaveFocus();
  await expect.element(layoutMenu).toHaveAccessibleName("Limits layout");

  // The last card has no next neighbor, so focus moves back; with none left it lands on the menu.
  // With the pointer: hovering the card makes its actions clickable.
  const argonHide = screen.getByRole("button", {
    name: "Hide Antigravity · Gemini 4 Argon Weekly",
  });
  await userEvent.hover(cardOf(argonHide.element()));
  await argonHide.click();
  const previous = [
    "Hide Antigravity · Gemini Weekly",
    "Hide Antigravity · Gemini 5-hour",
    "Hide Cursor · Overall",
    "Hide Codex · Weekly",
  ];
  for (const name of previous) {
    await expect.element(screen.getByRole("button", { name })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
  }
  await expect.element(layoutMenu).toHaveFocus();
  await expect.element(layoutMenu).toHaveAccessibleName("Limits layout, 5 hidden");
  await expect.element(screen.getByText("All limits in this view are hidden.")).toBeVisible();

  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Show Antigravity · Gemini 5-hour" }).click();
  await expect.element(screen.getByText("Gemini 5-hour", { exact: true })).toBeVisible();
  await expect.element(layoutMenu).toHaveFocus();

  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Reset layout" }).click();
  await expect.element(layoutMenu).toHaveAccessibleName("Limits layout");
  expect(screen.container.querySelectorAll("[data-limit-card]")).toHaveLength(5);
  await layoutMenu.click();
  await expect
    .element(page.getByRole("menuitem", { name: "Reset layout" }))
    .toHaveAttribute("aria-disabled", "true");
});

it("ties each Undo to the hide it reports", async () => {
  await using screen = await render(<LayoutExample />);
  const layoutMenu = page.getByRole("button", { name: /^Limits layout/ });
  const undo = page.getByRole("button", { name: "Undo" });
  const hideCodex = () => {
    screen.getByRole("button", { name: "Hide Codex · Weekly" }).element().focus();
    return userEvent.keyboard("{Enter}");
  };
  await hideCodex();
  await expect.element(undo).toBeVisible();

  // Restoring it from the header retires that toast, so it cannot undo a later hide.
  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Show Codex · Weekly" }).click();
  await expect.element(undo).not.toBeInTheDocument();
  await hideCodex();
  await vi.waitFor(() => expect(undo.elements()).toHaveLength(1));
  await undo.click();
  await expect.element(screen.getByRole("button", { name: "Hide Codex · Weekly" })).toHaveFocus();
  await expect.element(layoutMenu).toHaveAccessibleName("Limits layout");
});

it("leaves another tab's hides to that tab's Undo", async () => {
  const storage = { layout: DEFAULT_USAGE_LIMITS_LAYOUT };
  await using screen = await render(<LayoutExample storage={storage} />);
  const undo = page.getByRole("button", { name: "Undo" });
  const key = (driver: string, kind: "weekly" | "monthly", id: string) =>
    limitWindowKey(ProviderDriverKind.make(driver), { kind, id });
  const argon = key("antigravity", "weekly", "gemini-argon-wtu-weekly");
  const cursor = key("cursor", "monthly", "totalPercentUsed");
  const codex = key("codex", "weekly", "weekly");
  const hide = async (name: string) => {
    screen
      .getByRole("button", { name: `Hide ${name}` })
      .element()
      .focus();
    await userEvent.keyboard("{Enter}");
  };
  const otherTabRehides = (window: string) => {
    storage.layout = hideLimitWindow(showLimitWindow(storage.layout, window), window, "other-tab");
  };

  // Before this view hears of it, another tab shows Argon and hides it again.
  await hide("Antigravity · Gemini 4 Argon Weekly");
  otherTabRehides(argon);
  await undo.click();
  await expect.element(undo).not.toBeInTheDocument();
  expect(storage.layout.hiddenWindowIds?.[argon]).toBe("other-tab");

  // Once this view saves and sees the other tab's hide, it retires its own Undo.
  await hide("Cursor · Overall");
  await expect.element(undo).toBeVisible();
  otherTabRehides(cursor);
  screen.getByRole("button", { name: "Move Antigravity up" }).element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(undo).not.toBeInTheDocument();

  // A hide that arrives after the other tab's own offers no Undo here.
  storage.layout = hideLimitWindow(storage.layout, codex, "other-tab");
  await hide("Codex · Weekly");
  await expect.element(screen.getByText("Gemini Weekly", { exact: true })).toBeVisible();
  expect(screen.container.querySelectorAll("[data-limit-card]")).toHaveLength(2);
  await expect.element(page.getByText("Codex · Weekly hidden")).not.toBeInTheDocument();
  expect(storage.layout.hiddenWindowIds?.[codex]).toBe("other-tab");
});

it("hides one limit per double-click while the next card slides under the pointer", async () => {
  await using screen = await render(<LayoutExample />);
  const hide = screen.getByRole("button", { name: "Hide Antigravity · Gemini 5-hour" });
  await userEvent.hover(cardOf(hide.element()));
  await userEvent.dblClick(hide);
  await expect.element(page.getByText("Antigravity · Gemini 5-hour hidden")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Hide Antigravity · Gemini Weekly" }))
    .toHaveFocus();
  expect(screen.container.querySelectorAll("[data-limit-card]")).toHaveLength(4);

  // Separate activations still act each time.
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("button", { name: "Hide Antigravity · Gemini 4 Argon Weekly" }))
    .toHaveFocus();
  expect(screen.container.querySelectorAll("[data-limit-card]")).toHaveLength(3);
});

it("keeps focus and stays quiet when the layout cannot be saved", async () => {
  await using screen = await render(<LayoutExample writable={false} />);
  const hide = screen.getByRole("button", { name: "Hide Codex · Weekly" });
  hide.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(hide).toHaveFocus();
  await expect.element(screen.getByRole("status")).toHaveTextContent("");
  await expect.element(page.getByRole("button", { name: "Undo" })).not.toBeInTheDocument();
});

function expectCardTouchTarget(card: Element, previous: Element | undefined) {
  card.scrollIntoView({ block: "center" });
  const trigger = card.querySelector<HTMLElement>('[data-limit-action="more"]')!;
  const target = touchTarget(trigger);
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  for (const x of [target.left + 1, target.left + target.width / 2, target.right - 1]) {
    for (const y of [target.top + 1, target.top + target.height / 2, target.bottom - 1]) {
      expect(document.elementFromPoint(x, y)?.closest("button")).toBe(trigger);
    }
  }
  if (previous && previous.parentElement === card.parentElement) {
    expect(target.top).toBeGreaterThanOrEqual(previous.getBoundingClientRect().bottom);
  }
  for (const control of card.children[1]!.querySelectorAll("button")) {
    if (control.getClientRects().length === 0) continue;
    expect(intersects(target, touchTarget(control))).toBe(false);
  }
}

it("offers the same actions from a menu on touch", async () => {
  const session = cdp();
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await using _touch = {
    async [Symbol.asyncDispose]() {
      await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    },
  };
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const viewport = { width: innerWidth, height: innerHeight };
  await page.viewport(900, 800);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  await using screen = await render(<LayoutExample />);
  await expect
    .element(screen.getByRole("button", { name: "Hide Antigravity · Gemini Weekly" }))
    .not.toBeInTheDocument();
  const more = screen.getByRole("button", { name: "More actions for Antigravity · Gemini Weekly" });
  await expect.element(more).toBeVisible();
  // Every point of each card's 44px target reaches its menu, and the target stays clear of the
  // previous card (and its legend rows) and of the card's own bar and legend, compact and wide.
  for (const width of [360, 900]) {
    await page.viewport(width, 800);
    const cards = [...screen.container.querySelectorAll("[data-limit-card]")];
    for (const [index, card] of cards.entries()) {
      expectCardTouchTarget(card, cards[index - 1]);
    }
  }
  await page.viewport(900, 800);

  await more.click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.element(more).toHaveFocus();
  const weekly = screen.getByText("Gemini Weekly", { exact: true }).element();
  const session5h = screen.getByText("Gemini 5-hour", { exact: true }).element();
  expect(weekly.compareDocumentPosition(session5h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await more.click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  await expect
    .element(screen.getByRole("button", { name: "More actions for Antigravity · Gemini 5-hour" }))
    .toHaveFocus();
  await expect.element(page.getByText("Antigravity · Gemini Weekly hidden")).toBeVisible();
});
