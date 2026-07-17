import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import {
  canSwitchUiVersion,
  resolveUiVersion,
  type UiVersion,
} from "@/lib/ui-version";

export const UI_VERSION_COOKIE = "jetbook-ui-version";

const UI_VERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export async function getUiVersion(): Promise<UiVersion> {
  const store = await cookies();
  return resolveUiVersion(env.UI_V2_ROLLOUT, store.get(UI_VERSION_COOKIE)?.value);
}

export function isUiVersionSwitcherEnabled(): boolean {
  return canSwitchUiVersion(env.UI_V2_ROLLOUT);
}

export async function setUiVersionPreference(version: UiVersion): Promise<void> {
  if (!isUiVersionSwitcherEnabled()) return;

  const store = await cookies();
  store.set(UI_VERSION_COOKIE, version, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.BASE_URL.startsWith("https://"),
    path: "/",
    maxAge: UI_VERSION_COOKIE_MAX_AGE,
  });
}
