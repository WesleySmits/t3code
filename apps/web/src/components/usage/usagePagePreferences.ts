import { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  readLocalStorageValue,
  useLocalStorage,
  writeLocalStorageValue,
} from "../../hooks/useLocalStorage";
import { UsageLimitsLayoutSchema } from "./usageLimitsLayout";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
  limitsLayout: Schema.optional(UsageLimitsLayoutSchema),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "limits", windowDays: 30 };

export function readUsagePagePreferences(): UsagePagePreferences {
  return readLocalStorageValue(STORAGE_KEY, DEFAULT_PREFERENCES, UsagePagePreferencesSchema);
}

export function saveUsagePagePreferences(
  preferences: UsagePagePreferences | ((current: UsagePagePreferences) => UsagePagePreferences),
): void {
  writeLocalStorageValue(STORAGE_KEY, preferences, DEFAULT_PREFERENCES, UsagePagePreferencesSchema);
}

export function useSavedUsageLimitsLayout() {
  const [preferences] = useLocalStorage(
    STORAGE_KEY,
    DEFAULT_PREFERENCES,
    UsagePagePreferencesSchema,
  );
  return preferences.limitsLayout;
}
