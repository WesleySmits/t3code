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
import { DEFAULT_USAGE_LIMITS_LAYOUT } from "./usageLimitsLayout";

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

/** The page owns the saved layout and the header menu; this stands in for both. */
function LayoutExample({ writable = true }: { readonly writable?: boolean }) {
  const [layout, setLayout] = useState(DEFAULT_USAGE_LIMITS_LAYOUT);
  const layoutMenu = useRef<HTMLButtonElement>(null);
  const change = (update: (current: typeof layout) => typeof layout) => {
    if (writable) setLayout(update);
    return writable;
  };
  return (
    <ToastProvider>
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
  const layoutMenu = page.getByRole("button", { name: /^Edit limits layout/ });

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
  await expect.element(layoutMenu).toHaveAccessibleName("Edit limits layout, 1 hidden");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByRole("button", { name: "Hide Codex · Weekly" })).toHaveFocus();
  await expect.element(layoutMenu).toHaveAccessibleName("Edit limits layout");

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
  await expect.element(layoutMenu).toHaveAccessibleName("Edit limits layout, 5 hidden");
  await expect.element(screen.getByText("All limits in this view are hidden.")).toBeVisible();

  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Show Antigravity · Gemini 5-hour" }).click();
  await expect.element(screen.getByText("Gemini 5-hour", { exact: true })).toBeVisible();
  await expect.element(layoutMenu).toHaveFocus();

  await layoutMenu.click();
  await page.getByRole("menuitem", { name: "Reset layout" }).click();
  await expect.element(layoutMenu).toHaveAccessibleName("Edit limits layout");
  expect(screen.container.querySelectorAll("[data-limit-card]")).toHaveLength(5);
  await layoutMenu.click();
  await expect
    .element(page.getByRole("menuitem", { name: "Reset layout" }))
    .toHaveAttribute("aria-disabled", "true");
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
  const after = getComputedStyle(more.element(), "::after");
  expect(Number.parseFloat(after.width)).toBeGreaterThanOrEqual(44);
  expect(Number.parseFloat(after.height)).toBeGreaterThanOrEqual(44);
  // The enlarged target is not clipped: a tap 20px above the glyph's center still hits it.
  const box = more.element().getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2 - 20);
  expect(hit?.closest("button")).toBe(more.element());
  // In the two-column layout the bar can start at the card's top edge; the target stops short of it.
  for (const card of screen.container.querySelectorAll("[data-limit-card]")) {
    const target = card.querySelector('[data-limit-action="more"]')!.getBoundingClientRect();
    const bar = card.children[1]!.getBoundingClientRect();
    const below = document.elementFromPoint(target.left + target.width / 2, bar.top + 1);
    expect(below?.closest('[data-limit-action="more"]')).toBeNull();
  }

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
