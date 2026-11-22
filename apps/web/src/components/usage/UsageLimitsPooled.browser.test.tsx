import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
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
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
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
): ServerProvider {
  const provider = managedChatGpt(driver, driver);
  return {
    ...provider,
    driver: ProviderDriverKind.make(driver),
    usageLimits: { checkedAt, windows },
  };
}

function LayoutExample() {
  const [layout, setLayout] = useState(DEFAULT_USAGE_LIMITS_LAYOUT);
  const [editing, setEditing] = useState(false);
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
  return (
    <>
      <button type="button" onClick={() => setEditing(!editing)}>
        {editing ? "Finish editing" : "Edit layout"}
      </button>
      <UsageLimitsPooled
        presentations={presentations}
        now={Date.parse(checkedAt)}
        layout={layout}
        onLayoutChange={editing ? setLayout : undefined}
      />
    </>
  );
}

it("reorders pools and windows with the keyboard and restores individual hidden windows", async () => {
  await using screen = await render(<LayoutExample />);
  await screen.getByRole("button", { name: "Edit layout" }).click();

  const moveProvider = screen.getByRole("button", { name: "Move Antigravity up" });
  moveProvider.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(moveProvider).toHaveFocus();
  expect(
    [...screen.container.querySelectorAll("h2")].map((heading) => heading.textContent),
  ).toEqual(["Antigravity", "Codex"]);

  const moveWindow = screen.getByRole("button", { name: "Move Gemini Weekly up" });
  await moveWindow.click();
  await expect.element(moveWindow).toHaveFocus();

  await screen.getByRole("button", { name: "Hide Gemini 4 Argon Weekly" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Show Gemini 4 Argon Weekly" }))
    .toHaveFocus();
  await screen.getByRole("button", { name: "Finish editing" }).click();
  await expect
    .element(screen.getByText("Gemini 4 Argon Weekly", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("Gemini 5-hour", { exact: true })).toBeVisible();
  const weekly = screen.getByText("Gemini Weekly", { exact: true }).element();
  const session = screen.getByText("Gemini 5-hour", { exact: true }).element();
  expect(weekly.compareDocumentPosition(session) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await screen.getByRole("button", { name: "Edit layout" }).click();
  await screen.getByRole("button", { name: "Show Gemini 4 Argon Weekly" }).click();
  await screen.getByRole("button", { name: "Finish editing" }).click();
  await expect.element(screen.getByText("Gemini 4 Argon Weekly", { exact: true })).toBeVisible();
});
