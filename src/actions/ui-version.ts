"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UI_VERSIONS } from "@/lib/ui-version";
import { setUiVersionPreference } from "@/lib/ui-version-server";

const uiVersionSchema = z.enum(UI_VERSIONS);

export async function setUiVersionAction(value: string): Promise<void> {
  const parsed = uiVersionSchema.safeParse(value);
  if (!parsed.success) return;

  await setUiVersionPreference(parsed.data);
  revalidatePath("/", "layout");
}
