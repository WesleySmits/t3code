import {
  CHATGPT_USAGE_URL,
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPool,
  type LimitPoolMember,
  type LimitPoolWindow,
  type LimitPresentations,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import { T, useGT, useMessages } from "gt-react";
import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  TicketIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { ensureLocalApi } from "../../localApi";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { OpenAI } from "../Icons";
import { Alert, AlertTitle } from "../ui/alert";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PaceIcon, ResetCreditDialog, barColor, usePaceMark, useResetCredit } from "./UsageLimits";
import {
  collectExternalUsageLinks,
  collectLimitNotices,
  cursorUsageWindowDetails,
  formatResetsIn,
  resetCreditChoices,
} from "@t3tools/shared/usageLimitsCopy";
import {
  DEFAULT_USAGE_LIMITS_LAYOUT,
  limitWindowKey,
  moveLimitItem,
  orderLimitItems,
  type LimitMoveDirection,
  type UsageLimitsLayout,
  type UsageLimitsLayoutUpdate,
} from "./usageLimitsLayout";

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  const gt = useGT();
  return (
    <span
      role="img"
      aria-label={gt("Account {initials}", { initials: accountInitials(email) })}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {accountInitials(email)}
    </span>
  );
}

function AccountAvatar({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.redeem) {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={
          account.displayName ??
          providerClients.get(account.driver)?.label ??
          String(account.driver)
        }
        accentColor={account.accentColor}
        showBadge={Boolean(account.displayName)}
        indicatorBackground="var(--popover)"
        className={cn("size-5", className)}
        iconClassName="size-4 text-foreground/80"
      />
    );
  }
  return account.email ? <AccountChip email={account.email} /> : null;
}

function AccountName({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.displayName) return <span className={className}>{account.displayName}</span>;
  if (account.email) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", className)}>
        <AccountChip email={account.email} />
      </span>
    );
  }
  return (
    <span className={className}>
      {providerClients.get(account.driver)?.label ?? String(account.driver)}
    </span>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function SegmentPopover({
  account,
  window,
  reset,
  now,
  redeem,
  onRedeem,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly now: number;
  readonly redeem: ReturnType<typeof useResetCredit> | null;
  readonly onRedeem: (choice: ResetCreditChoice) => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const choices =
    redeem && account.redeem && account.limits.resetCredits?.availableCount
      ? resetCreditChoices(account.limits.resetCredits, account.redeem.input, now, true, m)
      : [];
  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountAvatar account={account} />
          <span className="truncate">
            {account.displayName ?? providerClients.get(account.driver)?.label ?? account.driver}
          </span>
        </span>
        {account.email ? (
          <RedactedSensitiveText
            value={account.email}
            ariaLabel={gt("Toggle account email visibility")}
            revealTooltip={gt("Click to reveal email")}
            hideTooltip={gt("Click to hide email")}
            className="w-fit"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {account.plan ? (
          <Row label={gt("Plan", { $context: "subscription plan" })}>{account.plan}</Row>
        ) : null}
        {where ? (
          <Row
            label={
              account.environments.length > 0
                ? gt("Signed in")
                : gt("Via", { $context: "signed in through a source" })
            }
          >
            {where}
          </Row>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        <Row label={gt("Left", { $context: "remaining usage" })}>{remaining}%</Row>
        {window.resetsAt ? (
          <Row label={gt("Resets", { $context: "when the usage window resets" })}>
            {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)}
            {resetsIn ? ` · ${resetsIn}` : ""}
          </Row>
        ) : null}
        {timeLeft !== null ? (
          <Row label={gt("Even pace")}>{gt("{timeLeft}% left by now", { timeLeft })}</Row>
        ) : null}
        {reset && reset.restoresPercent > 0 ? (
          <Row label={gt("Restores", { $context: "a reset credit restores part of the pool" })}>
            {gt("+{percent}% of pool", { percent: reset.restoresPercent })}
          </Row>
        ) : null}
      </div>
      {choices.length > 0 && redeem ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 text-muted-foreground">
          {choices.map((choice) => (
            <span key={choice.key} className="flex items-center gap-3">
              <span className="tabular-nums">{choice.summary}</span>
              {choice.availableCount > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={redeem.busy || !redeem.canManageProviders}
                  className="ms-auto"
                  onClick={() => onRedeem(choice)}
                >
                  {redeem.busy ? gt("Using…") : choice.actionLabel}
                </Button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every segment on the page shares one popover, so hovering or clicking another
 * segment moves it instead of opening a second one. The payload is the segment
 * it currently describes.
 */
type SegmentPayload = Omit<Parameters<typeof SegmentPopover>[0], "now" | "onRedeem">;
const SegmentPopoverContext = createContext<ReturnType<
  typeof PopoverCreateHandle<SegmentPayload>
> | null>(null);

function ActiveSegmentPopover({
  handle,
  actions,
  payload,
  windows,
  now,
}: {
  readonly handle: ReturnType<typeof PopoverCreateHandle<SegmentPayload>>;
  readonly actions: RefObject<PopoverPrimitive.Root.Actions | null>;
  readonly payload: SegmentPayload;
  readonly windows: readonly LimitPoolWindow[];
  readonly now: number;
}) {
  const available = windows.some((window) =>
    window.members.some(
      (member) =>
        member.account.key === payload.account.key &&
        member.window.id === payload.window.id &&
        member.window.kind === payload.window.kind &&
        Boolean(member.account.redeem) === Boolean(payload.redeem),
    ),
  );
  // The trigger is gone, so the popup has nothing to anchor to: an exit transition would
  // slide it to the viewport origin. Unmount it outright, which also clears Base UI's
  // active-trigger bookkeeping so the segment can open again when it comes back.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the popover handle and unmounts the Base UI popup before paint when its trigger is gone
  useLayoutEffect(() => {
    if (available) return;
    handle.close();
    actions.current?.unmount();
  }, [available, handle, actions]);
  return (
    <PopoverPopup side="top" sideOffset={6}>
      <SegmentPopover
        {...payload}
        now={now}
        onRedeem={(choice) => {
          handle.close();
          payload.redeem?.confirm(choice);
        }}
      />
    </PopoverPopup>
  );
}

/**
 * The confirm is a sibling of the popover, not a child: dialogs stack under
 * popovers, and the popover closes as the confirm opens.
 */
function PoolSegment({
  account,
  ...props
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
}) {
  return account.redeem ? (
    <RedeemableSegment account={account} redeemAt={account.redeem} {...props} />
  ) : (
    <SegmentTriggers account={account} redeem={null} {...props} />
  );
}

function RedeemableSegment({
  redeemAt,
  ...props
}: Omit<Parameters<typeof SegmentTriggers>[0], "redeem"> & {
  readonly redeemAt: NonNullable<LimitAccount["redeem"]>;
}) {
  const redeem = useResetCredit(redeemAt.environmentId);
  const gt = useGT();
  return (
    <>
      <SegmentTriggers redeem={redeem} {...props} />
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        choice={redeem.choice}
        onConfirm={() => void redeem.redeem()}
        disabled={!redeem.canManageProviders}
      />
      {/* The popover closed before the confirm, so progress and the outcome need a home outside it. */}
      {redeem.busy || redeem.status ? (
        <span role="status" className="col-span-full text-xs text-muted-foreground">
          <AccountName account={props.account} className="font-medium text-foreground" />{" "}
          {redeem.busy ? gt("Using reset credit…") : redeem.status}
        </span>
      ) : null}
    </>
  );
}

function SegmentTriggers({
  account,
  window,
  reset,
  redeem,
  refillPercent,
  color,
  now,
  index,
  showAccountName,
}: SegmentPayload & {
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const payload: SegmentPayload = { account, window, reset, redeem };
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const [segmentRef, paceMark] = usePaceMark(timeLeft);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m);
  const refillIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  const segmentLabel = [
    gt("{name}: {remaining}% left", {
      name:
        account.displayName ?? (account.email ? accountInitials(account.email) : account.driver),
      remaining,
    }),
    resetsIn,
    timeLeft === null ? null : gt("{timeLeft}% of the window left", { timeLeft }),
    credits
      ? gt(
          "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
          { count: credits },
        )
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <PopoverTrigger
        handle={popover}
        payload={payload}
        openOnHover
        render={
          <button
            ref={segmentRef}
            type="button"
            style={{ gridColumn: index, gridRow: 1, ...paceMark?.gappedTrack }}
            aria-label={segmentLabel}
            className="relative h-5 min-w-0 cursor-pointer rounded-md bg-muted text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[popup-open]:ring-1 data-[popup-open]:ring-inset data-[popup-open]:ring-border @2xl/pool:h-8"
          />
        }
      >
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-md">
          {/* Clipped inside the rounded clip so the bar's own corners keep their antialiasing. */}
          <div className="absolute inset-0" style={paceMark?.gap}>
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-md opacity-35"
              style={{ width: `${remaining}%`, backgroundColor: color }}
            />
            {remaining < 100 && reset && refillPercent > 0 ? (
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 opacity-20"
                style={{
                  width: `${Math.min(100 - remaining, refillPercent)}%`,
                  // A bare 45° gradient repeats every 5√2px, so some stripes rasterize thinner; a whole-pixel tile doesn't.
                  backgroundImage: `repeating-linear-gradient(135deg, transparent 0 1px, ${color} 1px 2px, transparent 2px 50%)`,
                  backgroundSize: "7px 7px",
                }}
              />
            ) : null}
          </div>
        </div>
        {paceMark ? (
          <span
            aria-hidden
            className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={paceMark.tick}
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md text-3xs leading-none font-semibold text-foreground/80 tabular-nums @2xl/pool:hidden"
        >
          {index}
        </span>
        <div className="relative hidden h-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs @2xl/pool:flex">
          {showAccountName ? (
            <AccountName
              account={account}
              className="min-w-0 truncate font-medium text-foreground"
            />
          ) : null}
          {/* A single-account bar repeats the headline percentage. */}
          {showAccountName ? (
            <span className="shrink-0 font-semibold text-foreground tabular-nums">
              {remaining}%
            </span>
          ) : null}
          {resetsIn || credits ? (
            <span className="ms-auto flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs whitespace-nowrap text-foreground tabular-nums">
              {refillIn ?? ""}
              {credits ? (
                <>
                  {resetsIn ? (
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                  ) : null}
                  <span aria-hidden className="inline-flex items-center gap-0.5 font-semibold">
                    <TicketIcon className="size-3" aria-hidden />
                    {credits}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      </PopoverTrigger>
      <LegendRow payload={payload} color={color} now={now} index={index} />
    </>
  );
}

function LegendRow({
  payload,
  color,
  now,
  index,
}: {
  readonly payload: SegmentPayload;
  readonly color: string;
  readonly now: number;
  readonly index: number;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const { account, window } = payload;
  const remaining = remainingPercent(window);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  return (
    <PopoverTrigger
      handle={popover}
      payload={payload}
      style={{ gridColumn: "1 / -1", gridRow: index + 1 }}
      render={<Button variant="ghost" size="compact" />}
      className="min-w-0 @2xl/pool:hidden"
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-3xs leading-none font-semibold text-foreground/80 tabular-nums">
        <span
          aria-hidden
          className="absolute inset-0 rounded-sm opacity-35"
          style={{ backgroundColor: color }}
        />
        <span className="sr-only">{`${gt("Segment")} `}</span>
        <span className="relative">{index}</span>
      </span>
      <AccountName account={account} className="min-w-0 truncate font-medium text-foreground" />
      <span className="shrink-0 font-semibold text-foreground tabular-nums">{remaining}%</span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
        {resetsIn ?? ""}
        {credits ? (
          <>
            {resetsIn ? <span aria-hidden>·</span> : null}
            <span
              aria-hidden
              className="inline-flex items-center gap-0.5 font-semibold text-foreground"
            >
              <TicketIcon className="size-3" aria-hidden />
              {credits}
            </span>
            <span className="sr-only">
              {gt(
                "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
                { count: credits },
              )}
            </span>
          </>
        ) : null}
      </span>
    </PopoverTrigger>
  );
}

function PoolBar({
  pool,
  color,
  now,
  className,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly className?: string;
}) {
  const restores = new Map(pool.resets.map((reset) => [reset.member.account.key, reset]));
  const gt = useGT();
  return (
    <div className={cn("@container/pool min-w-0", className)}>
      <div
        className="grid gap-x-1 gap-y-1"
        style={{ gridTemplateColumns: `repeat(${pool.columns.length}, minmax(0, 1fr))` }}
      >
        {pool.columns.map((member, position) =>
          member.window ? (
            <PoolSegment
              key={member.account.key}
              account={member.account}
              window={member.window}
              reset={restores.get(member.account.key)}
              refillPercent={member.refillPercent}
              color={normalizeProviderAccentColor(member.account.accentColor) ?? color}
              now={now}
              index={position + 1}
              showAccountName={pool.columns.length > 1}
            />
          ) : pool.kind === "monthly" && member.account.limits.zeroSpendCap ? (
            <div
              key={member.account.key}
              style={{ gridColumn: position + 1, gridRow: 1 }}
              className="flex h-5 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-dashed border-border text-3xs whitespace-nowrap text-muted-foreground @2xl/pool:h-8 @2xl/pool:justify-start @2xl/pool:px-2 @2xl/pool:text-xs"
            >
              <AccountName
                account={member.account}
                className="hidden min-w-0 truncate @2xl/pool:inline-flex"
              />
              {gt("$0 cap")}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function PoolWindowSummary({
  pool,
  label,
  hidden,
  className,
}: {
  readonly pool: LimitPoolWindow;
  readonly label: string | null | undefined;
  readonly hidden: boolean;
  readonly className: string;
}) {
  const nextRefill = pool.resets.find((reset) => reset.restoresPercent > 0);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label !== null ? (
        <span className="text-sm font-medium text-foreground">{label ?? pool.label}</span>
      ) : null}
      {hidden ? (
        <span className="text-xs text-muted-foreground">
          <T>Hidden</T>
        </span>
      ) : null}
      <span className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-foreground tabular-nums">
          {pool.remainingPercent}%
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            <T context="remaining usage percentage">left</T>
          </span>
          {pool.pace ? <PaceIcon pace={pool.pace} /> : null}
        </span>
      </span>
      {nextRefill && pool.columns.length > 1 ? (
        <span className="text-xs font-medium text-foreground tabular-nums">
          ↻ +{nextRefill.restoresPercent}%
        </span>
      ) : null}
    </div>
  );
}

function PoolWindowCard({
  pool,
  color,
  now,
  label,
  description,
  controls,
  hidden = false,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly label?: string | null | undefined;
  readonly description?: string | undefined;
  readonly controls?: ReactNode;
  readonly hidden?: boolean;
}) {
  const dimmed = hidden && "opacity-60";
  return (
    <div
      className={cn(
        "grid items-center gap-y-3 rounded-lg border border-border/60 p-4",
        controls
          ? "grid-cols-[minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[11rem_minmax(0,1fr)_auto]"
          : "gap-x-6 md:grid-cols-[11rem_minmax(0,1fr)]",
        hidden && "border-dashed",
      )}
    >
      <PoolWindowSummary
        pool={pool}
        label={label}
        hidden={hidden}
        className={cn(controls && "min-w-0 max-[360px]:col-span-full", dimmed)}
      />
      <PoolBar
        pool={pool}
        color={color}
        now={now}
        className={cn(controls && "max-md:col-span-2", dimmed)}
      />
      {controls ? (
        <div className="col-start-2 row-start-1 flex items-center gap-1 max-[360px]:col-span-full max-[360px]:col-start-1 max-[360px]:row-start-2 max-[360px]:justify-end md:col-start-3">
          {controls}
        </div>
      ) : null}
      {description ? (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            controls ? "col-span-full" : "md:col-span-2",
            dimmed,
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

type MoveLimit = (direction: LimitMoveDirection, button: HTMLButtonElement, label: string) => void;

function MoveButtons({
  label,
  position,
  count,
  onMove,
}: {
  readonly label: string;
  readonly position: number;
  readonly count: number;
  readonly onMove: MoveLimit;
}) {
  const gt = useGT();
  const up = gt("Move {label} up", { label });
  const down = gt("Move {label} down", { label });
  return (
    <>
      <Button
        variant="ghost-muted"
        size="icon-sm-touch"
        aria-label={up}
        title={up}
        aria-disabled={position === 0}
        onClick={position > 0 ? (event) => onMove(-1, event.currentTarget, label) : undefined}
      >
        <ArrowUpIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-sm-touch"
        aria-label={down}
        title={down}
        aria-disabled={position === count - 1}
        onClick={
          position < count - 1 ? (event) => onMove(1, event.currentTarget, label) : undefined
        }
      >
        <ArrowDownIcon aria-hidden="true" />
      </Button>
    </>
  );
}

type LayoutSectionEditor = {
  readonly providerPosition: number;
  readonly providerCount: number;
  readonly hiddenWindows: ReadonlySet<string>;
  readonly moveProvider: MoveLimit;
  readonly moveWindow: (index: number, ...move: Parameters<MoveLimit>) => void;
  readonly toggleWindow: (key: string) => void;
};

function PoolSection({
  pool,
  windows,
  now,
  editor,
}: {
  readonly pool: LimitPool;
  readonly windows: readonly LimitPoolWindow[];
  readonly now: number;
  readonly editor?: LayoutSectionEditor | undefined;
}) {
  const color = barColor(pool.driver);
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const m = useMessages();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ProviderInstanceIcon
            driverKind={pool.driver}
            displayName={label}
            indicatorBackground="var(--background)"
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          {label}
        </h2>
        {editor ? (
          <span className="ms-auto flex items-center gap-1">
            <MoveButtons
              label={label}
              position={editor.providerPosition}
              count={editor.providerCount}
              onMove={editor.moveProvider}
            />
          </span>
        ) : null}
      </div>
      {windows.map((window, index) => {
        const details =
          pool.driver === "cursor" ? cursorUsageWindowDetails(window.id, pool, m) : undefined;
        const key = limitWindowKey(pool.driver, window);
        const windowLabel = details ? details.label : window.label;
        const name = windowLabel === null ? label : `${label} · ${windowLabel}`;
        const hidden = editor?.hiddenWindows.has(key) ?? false;
        return (
          <PoolWindowCard
            key={key}
            pool={window}
            color={color}
            now={now}
            label={details?.label}
            description={details?.description}
            hidden={hidden}
            controls={
              editor ? (
                <>
                  <MoveButtons
                    label={name}
                    position={index}
                    count={windows.length}
                    onMove={(...move) => editor.moveWindow(index, ...move)}
                  />
                  <ToggleLimitVisibility
                    label={name}
                    hidden={hidden}
                    onToggle={() => editor.toggleWindow(key)}
                  />
                </>
              ) : null
            }
          />
        );
      })}
    </section>
  );
}

function ToggleLimitVisibility({
  label,
  hidden,
  onToggle,
}: {
  readonly label: string;
  readonly hidden: boolean;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const action = hidden ? gt("Show {label}", { label }) : gt("Hide {label}", { label });
  return (
    <Button
      size="icon-sm-touch"
      variant="ghost-muted"
      aria-label={action}
      title={action}
      onClick={onToggle}
    >
      {hidden ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
    </Button>
  );
}

export function UsageLimitsPooled({
  presentations,
  allPresentations = presentations,
  pools,
  now,
  layout = DEFAULT_USAGE_LIMITS_LAYOUT,
  onLayoutChange,
}: {
  readonly presentations: LimitPresentations;
  readonly allPresentations?: LimitPresentations;
  readonly pools: readonly LimitPool[];
  readonly now: number;
  readonly layout?: UsageLimitsLayout;
  readonly onLayoutChange?: ((update: UsageLimitsLayoutUpdate) => boolean) | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const [segmentPopover] = useState(() => PopoverCreateHandle<SegmentPayload>());
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const segmentPopoverActions = useRef<PopoverPrimitive.Root.Actions | null>(null);
  const hiddenWindows = new Set(layout.hiddenWindows);
  const sections = orderLimitItems(pools, layout.providerOrder, (pool) => pool.driver).flatMap(
    (pool) => {
      const key = (window: LimitPoolWindow) => limitWindowKey(pool.driver, window);
      const ordered = orderLimitItems(displayLimitWindows(pool), layout.windowOrder, key);
      const windows = onLayoutChange
        ? ordered
        : ordered.filter((window) => !hiddenWindows.has(key(window)));
      return windows.length > 0 ? [{ pool, windows }] : [];
    },
  );
  const move = (
    field: "providerOrder" | "windowOrder",
    keys: readonly string[],
    index: number,
    direction: LimitMoveDirection,
    button: HTMLButtonElement,
    label: string,
  ) => {
    if (!onLayoutChange) return;
    const allPools =
      allPresentations === presentations
        ? pools
        : collectLimitPools(collectLimitAccounts(allPresentations), now);
    const defaultKeys =
      field === "providerOrder"
        ? allPools.map((pool) => pool.driver)
        : allPools.flatMap((pool) =>
            displayLimitWindows(pool).map((window) => limitWindowKey(pool.driver, window)),
          );
    // A keyed item can lose focus when React moves it to a new position.
    flushSync(() => {
      const saved = onLayoutChange((current) => ({
        ...current,
        [field]: moveLimitItem(current[field], keys, index, direction, defaultKeys),
      }));
      if (!saved) return;
      setMoveAnnouncement(
        gt("{label} moved to position {position} of {total}.", {
          label,
          position: index + direction + 1,
          total: keys.length,
        }),
      );
    });
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const notices = collectLimitNotices(presentations, m);
  const externalLinks = collectExternalUsageLinks(presentations, m);
  return (
    <div className="flex flex-col gap-8">
      <span role="status" className="sr-only">
        {moveAnnouncement}
      </span>
      {pools.length === 0 && notices.length === 0 && externalLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No provider on the selected environments reports subscription limits.</T>
        </p>
      ) : null}
      {pools.length > 0 && sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>All limits in this view are hidden.</T>
        </p>
      ) : null}
      <SegmentPopoverContext value={segmentPopover}>
        {sections.map(({ pool, windows }, index) => (
          <PoolSection
            key={pool.driver}
            pool={pool}
            windows={windows}
            now={now}
            editor={
              onLayoutChange
                ? {
                    providerPosition: index,
                    providerCount: sections.length,
                    hiddenWindows,
                    moveProvider: (...moveAction) =>
                      move(
                        "providerOrder",
                        sections.map(({ pool }) => pool.driver),
                        index,
                        ...moveAction,
                      ),
                    moveWindow: (windowIndex, ...moveAction) =>
                      move(
                        "windowOrder",
                        windows.map((window) => limitWindowKey(pool.driver, window)),
                        windowIndex,
                        ...moveAction,
                      ),
                    toggleWindow: (key) =>
                      onLayoutChange((current) => ({
                        ...current,
                        hiddenWindows: current.hiddenWindows.includes(key)
                          ? current.hiddenWindows.filter((window) => window !== key)
                          : [...current.hiddenWindows, key],
                      })),
                  }
                : undefined
            }
          />
        ))}
      </SegmentPopoverContext>
      <Popover handle={segmentPopover} actionsRef={segmentPopoverActions}>
        {({ payload }) =>
          payload ? (
            <ActiveSegmentPopover
              handle={segmentPopover}
              actions={segmentPopoverActions}
              payload={payload}
              windows={sections.flatMap(({ windows }) => windows)}
              now={now}
            />
          ) : null
        }
      </Popover>
      {externalLinks.map((link) => (
        <section
          key={link.url}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {link.url === CHATGPT_USAGE_URL ? (
              <OpenAI className="size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-medium">{link.label}</h2>
              <p className="text-xs break-words text-muted-foreground">
                {link.accounts.join(", ")}
              </p>
              {link.url === CHATGPT_USAGE_URL ? (
                <p className="text-xs text-muted-foreground">
                  <T>View usage in ChatGPT with your connected account.</T>
                </p>
              ) : link.message ? (
                <p className="max-w-xl text-xs text-muted-foreground">{link.message}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {gt("Manage usage")}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </section>
      ))}
      <LimitNotices notices={notices} />
    </div>
  );
}

function LimitNotices({ notices }: { readonly notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <AlertTriangleIcon />
      {notices.map((notice) => (
        <AlertTitle key={notice} className="break-words">
          {notice}
        </AlertTitle>
      ))}
    </Alert>
  );
}
