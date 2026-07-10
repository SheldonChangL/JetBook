"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search, Sparkles } from "lucide-react";
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Combobox,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  useToast,
} from "@/components/ui";

/** 設計系統預覽沙盒：A-08 元件驗收與後續 UI issue 的活樣式指南。 */
export default function DesignSystemPage() {
  const t = useTranslations("designSystem");
  const toast = useToast();
  const [member, setMember] = useState<string | null>(null);

  const members = [
    { value: "1", label: "陳志豪" },
    { value: "2", label: "王小明" },
    { value: "3", label: "林雅婷" },
    { value: "4", label: "Sheldon Chang" },
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
      <header>
        <h1 className="text-h1 text-fg">{t("title")}</h1>
        <p className="mt-1 text-body-ui text-fg-secondary">{t("subtitle")}</p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 text-fg">{t("buttons")}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t("primary")}</Button>
          <Button variant="secondary">{t("secondary")}</Button>
          <Button variant="ghost">{t("ghost")}</Button>
          <Button variant="danger">{t("danger")}</Button>
          <Button variant="ai">
            <Sparkles aria-hidden className="size-4" />
            {t("ai")}
          </Button>
          <Button loading>{t("loadingBtn")}</Button>
          <Button disabled>{t("disabled")}</Button>
          <IconButton label={t("kbdHint")}>
            <Search aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 text-body-ui text-fg-secondary">
          <span>{t("kbdHint")}</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 text-fg">{t("forms")}</h2>
        <div className="grid max-w-xl gap-4">
          <Input label={t("inputLabel")} helper={t("inputHelper")} />
          <Input label={t("inputError")} type="password" required error={t("inputErrorMsg")} />
          <Textarea label={t("textareaLabel")} rows={2} />
          <div className="flex flex-col gap-1.5">
            <span className="text-body-ui font-medium text-fg">{t("selectLabel")}</span>
            <Select>
              <SelectTrigger className="max-w-60">
                <SelectValue placeholder={t("selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                <SelectItem value="editor">{t("roleEditor")}</SelectItem>
                <SelectItem value="commenter">{t("roleCommenter")}</SelectItem>
                <SelectItem value="viewer">{t("roleViewer")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-body-ui font-medium text-fg">{t("comboLabel")}</span>
            <Combobox
              className="max-w-60"
              options={members}
              value={member}
              onValueChange={setMember}
              placeholder={t("comboPlaceholder")}
              searchPlaceholder={t("comboSearch")}
              emptyText={t("comboEmpty")}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 text-fg">{t("overlay")}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Modal>
            <ModalTrigger asChild>
              <Button variant="secondary">{t("modalOpen")}</Button>
            </ModalTrigger>
            <ModalContent
              size="sm"
              title={t("modalTitle")}
              description={t("modalDesc")}
              closeLabel={t("cancel")}
            >
              <div className="flex justify-end gap-2">
                <ModalClose asChild>
                  <Button variant="ghost">{t("cancel")}</Button>
                </ModalClose>
                <ModalClose asChild>
                  <Button variant="danger">{t("confirm")}</Button>
                </ModalClose>
              </div>
            </ModalContent>
          </Modal>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="secondary">{t("drawerOpen")}</Button>
            </DrawerTrigger>
            <DrawerContent title={t("drawerTitle")} closeLabel={t("cancel")}>
              <div className="p-4 text-body-ui text-fg-secondary">{t("popoverText")}</div>
            </DrawerContent>
          </Drawer>

          <Button
            variant="secondary"
            onClick={() => toast({ variant: "success", title: t("toastTitle"), description: t("toastDesc") })}
          >
            {t("toastShow")}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                variant: "error",
                title: t("toastErrorTitle"),
                description: t("toastErrorDesc"),
              })
            }
          >
            {t("toastError")}
          </Button>

          <Tooltip content={t("tooltipText")}>
            <Button variant="ghost">{t("tooltipDemo")}</Button>
          </Tooltip>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost">{t("popoverOpen")}</Button>
            </PopoverTrigger>
            <PopoverContent className="text-body-ui text-fg-secondary">
              {t("popoverText")}
            </PopoverContent>
          </Popover>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 text-fg">{t("display")}</h2>
        <Tabs defaultValue="one" className="max-w-xl">
          <TabsList>
            <TabsTrigger value="one">{t("tabOne")}</TabsTrigger>
            <TabsTrigger value="two">{t("tabTwo")}</TabsTrigger>
            <TabsTrigger value="three">{t("tabThree")}</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="pt-3 text-body-ui text-fg-secondary">
            {t("tabContentOne")}
          </TabsContent>
          <TabsContent value="two" className="pt-3 text-body-ui text-fg-secondary">
            {t("tabContentTwo")}
          </TabsContent>
          <TabsContent value="three" className="pt-3 text-body-ui text-fg-secondary">
            {t("tabContentThree")}
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t("badgeNeutral")}</Badge>
          <Badge variant="primary">{t("badgePrimary")}</Badge>
          <Badge variant="success">{t("badgeSuccess")}</Badge>
          <Badge variant="warning">{t("badgeWarning")}</Badge>
          <Badge variant="danger">{t("badgeDanger")}</Badge>
          <Badge variant="ai">
            <Sparkles aria-hidden className="size-3" />
            {t("badgeAi")}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <Avatar name="陳志豪" size="lg" />
          <Avatar name="Sheldon Chang" />
          <AvatarGroup names={["陳志豪", "王小明", "林雅婷", "張三", "李四", "王五"]} />
        </div>

        <div className="flex max-w-xl flex-col gap-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>

        <div className="max-w-xl rounded-md border border-dashed border-edge">
          <EmptyState
            icon={<Plus aria-hidden />}
            title={t("emptyTitle")}
            description={t("emptyDesc")}
            action={<Button>{t("emptyCta")}</Button>}
          />
        </div>
      </section>
    </main>
  );
}
