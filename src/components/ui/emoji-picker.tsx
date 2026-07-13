"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * Emoji 選擇器（M4-03）：emoji-mart core（framework-agnostic，React 19 相容）
 * 以 ref 掛載；data 與 picker 皆動態載入，不進首屏 bundle。
 * 選擇即回呼 native emoji 字串；value 存入 spaces.icon / pages.icon text 欄位。
 */

interface EmojiSelectEvent {
  native?: string;
}

/** emoji-mart Picker 的 i18n 形狀（僅列會用到的鍵）。 */
function usePickerI18n() {
  const t = useTranslations("emojiPicker");
  return {
    search: t("search"),
    search_no_results_1: t("searchNoResults1"),
    search_no_results_2: t("searchNoResults2"),
    pick: t("pick"),
    add_custom: t("addCustom"),
    categories: {
      activity: t("categories.activity"),
      custom: t("categories.custom"),
      flags: t("categories.flags"),
      foods: t("categories.foods"),
      frequent: t("categories.frequent"),
      nature: t("categories.nature"),
      objects: t("categories.objects"),
      people: t("categories.people"),
      places: t("categories.places"),
      search: t("categories.search"),
      symbols: t("categories.symbols"),
    },
    skins: {
      choose: t("skins.choose"),
      "1": t("skins.default"),
      "2": t("skins.light"),
      "3": t("skins.mediumLight"),
      "4": t("skins.medium"),
      "5": t("skins.mediumDark"),
      "6": t("skins.dark"),
    },
  };
}

function PickerMount({ onPick }: { onPick: (native: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const i18n = usePickerI18n();
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let cancelled = false;
    void (async () => {
      const [{ Picker }, dataModule] = await Promise.all([
        import("emoji-mart"),
        import("@emoji-mart/data"),
      ]);
      if (cancelled || !host) return;
      const isDark = document.documentElement.classList.contains("dark");
      // emoji-mart Picker 為 web component；建構時掛進 parent
      new Picker({
        parent: host,
        data: dataModule.default,
        i18n,
        theme: isDark ? "dark" : "light",
        previewPosition: "none",
        skinTonePosition: "none",
        onEmojiSelect: (emoji: EmojiSelectEvent) => {
          if (emoji.native) onPickRef.current(emoji.native);
        },
      } as ConstructorParameters<typeof Picker>[0]);
    })();
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
    // i18n 內容為固定翻譯，不隨 render 變動；僅掛載一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} />;
}

export function EmojiPickerButton({
  value,
  onChange,
  ariaLabel,
  disabled,
  triggerClassName,
}: {
  /** 目前 icon（native emoji 字串）；null/空＝未設定 */
  value: string | null;
  /** 選擇 emoji 或清除（null） */
  onChange: (icon: string | null) => void;
  ariaLabel: string;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const t = useTranslations("emojiPicker");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={
            triggerClassName ??
            "flex size-9 items-center justify-center rounded-md border border-edge text-xl hover:bg-sidebar disabled:opacity-40"
          }
        >
          {value ? (
            <span aria-hidden>{value}</span>
          ) : (
            <Smile aria-hidden className="size-5 text-fg-tertiary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          {/* open 時才掛載 → picker 與 data 延遲載入 */}
          {open && (
            <PickerMount
              onPick={(native) => {
                onChange(native);
                setOpen(false);
              }}
            />
          )}
          {value && (
            <div className="border-t border-edge p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t("clear")}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
