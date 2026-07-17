export const UI_VERSIONS = ["legacy", "archive"] as const;
export type UiVersion = (typeof UI_VERSIONS)[number];

export const UI_V2_ROLLOUTS = ["off", "opt-in", "on"] as const;
export type UiV2Rollout = (typeof UI_V2_ROLLOUTS)[number];

/** Resolve the presentation layer. The global off switch always wins. */
export function resolveUiVersion(
  rollout: UiV2Rollout,
  cookieValue: string | undefined,
): UiVersion {
  if (rollout === "off") return "legacy";
  if (cookieValue === "legacy" || cookieValue === "archive") return cookieValue;
  return rollout === "on" ? "archive" : "legacy";
}

export function canSwitchUiVersion(rollout: UiV2Rollout): boolean {
  return rollout !== "off";
}
