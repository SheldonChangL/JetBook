"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Folder } from "lucide-react";
import { assignSpaceCollectionAction } from "@/actions/collection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { CollectionRef } from "@/lib/spaces/grouping";

/** Radix Select 不接受空字串值，以 sentinel 代表「未分組」。 */
const UNGROUPED = "__ungrouped__";

/** Space 下拉指派 collection（C-09，org admin）。選「未分組」即移出分組。 */
export function SpaceCollectionAssign({
  spaceId,
  currentCollectionId,
  collections,
}: {
  spaceId: string;
  currentCollectionId: string | null;
  collections: CollectionRef[];
}) {
  const t = useTranslations("spaces");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onValueChange(value: string) {
    const collectionId = value === UNGROUPED ? null : value;
    if (collectionId === (currentCollectionId ?? null)) return;
    startTransition(async () => {
      try {
        const result = await assignSpaceCollectionAction({ spaceId, collectionId });
        if (!result.ok) {
          toast({ variant: "error", title: t("assignError") });
          return;
        }
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("assignError") });
      }
    });
  }

  return (
    <Select
      value={currentCollectionId ?? UNGROUPED}
      onValueChange={onValueChange}
      disabled={pending}
    >
      <SelectTrigger
        aria-label={t("moveToCollection")}
        className="h-8 gap-1.5 border-edge px-2 text-caption text-fg-secondary"
      >
        <Folder aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNGROUPED}>{t("ungrouped")}</SelectItem>
        {collections.map((collection) => (
          <SelectItem key={collection.id} value={collection.id}>
            {collection.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
