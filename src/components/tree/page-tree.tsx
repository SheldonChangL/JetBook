"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Ellipsis, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { countDescendants, createPage, deletePage, renamePage } from "@/actions/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal, ModalClose, ModalContent } from "@/components/ui/modal";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export interface PageTreeNode {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
}

export interface PageTreeProps {
  spaceId: string;
  spaceSlug: string;
  nodes: PageTreeNode[];
  /** editor 以上才顯示新增/重新命名/刪除入口（伺服器端 lib/authz 判定後傳入） */
  canEdit: boolean;
}

/**
 * 頁面樹側欄（C-03，設計規範 §4.4 Tree／§4.5）：
 * 列高 30px、縮排 16px/層、chevron 僅有子節點顯示、目前頁 primary 淡底＋左緣 2px 色條、
 * hover 浮現 [＋子頁][⋯選單]、WAI-ARIA 方向鍵導航（↑↓ 移動、←→ 收展）。
 */
export function PageTree({ spaceId, spaceSlug, nodes, canEdit }: PageTreeProps) {
  const t = useTranslations("tree");
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // --- 前端組裝樹（鄰接表 → childrenOf map；nodes 已依 position 排序） ---
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, PageTreeNode[]>();
    for (const n of nodes) {
      const list = map.get(n.parentId);
      if (list) list.push(n);
      else map.set(n.parentId, [n]);
    }
    return map;
  }, [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // --- 目前頁（usePathname → /s/{spaceSlug}/{pageSlug}[/edit]） ---
  const currentSlug = useMemo(() => {
    const decoded = decodeURIComponent(pathname);
    const prefix = `/s/${spaceSlug}/`;
    if (!decoded.startsWith(prefix)) return null;
    return decoded.slice(prefix.length).split("/")[0] || null;
  }, [pathname, spaceSlug]);
  const currentId = useMemo(
    () => nodes.find((n) => n.slug === currentSlug)?.id ?? null,
    [nodes, currentSlug],
  );

  // --- 收合/展開；目前頁的祖先自動展開（lazy 初始值使 SSR 首繪即展開＋高亮） ---
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>();
    if (currentId) {
      let node = byId.get(currentId);
      while (node?.parentId) {
        init.add(node.parentId);
        node = byId.get(node.parentId);
      }
    }
    return init;
  });
  useEffect(() => {
    if (!currentId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let node = byId.get(currentId);
      while (node?.parentId) {
        next.add(node.parentId);
        node = byId.get(node.parentId);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [currentId, byId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // --- 可見節點（DFS，respect expanded）與鍵盤導航（roving tabindex） ---
  const visible = useMemo(() => {
    const out: { node: PageTreeNode; level: number }[] = [];
    const walk = (parentId: string | null, level: number) => {
      for (const n of childrenOf.get(parentId) ?? []) {
        out.push({ node: n, level });
        if (expanded.has(n.id)) walk(n.id, level + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [childrenOf, expanded]);

  const itemRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabbableId =
    (focusedId && visible.some((v) => v.node.id === focusedId) ? focusedId : null) ??
    (currentId && visible.some((v) => v.node.id === currentId) ? currentId : null) ??
    visible[0]?.node.id ??
    null;

  function focusItem(id: string) {
    setFocusedId(id);
    itemRefs.current.get(id)?.focus();
  }

  function onTreeKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
      return;
    }
    if (visible.length === 0) return;
    e.preventDefault();
    const activeId = focusedId ?? currentId ?? visible[0]!.node.id;
    const idx = visible.findIndex((v) => v.node.id === activeId);
    if (idx < 0) {
      focusItem(visible[0]!.node.id);
      return;
    }
    const { node } = visible[idx]!;
    const children = childrenOf.get(node.id) ?? [];
    switch (e.key) {
      case "ArrowDown":
        if (idx + 1 < visible.length) focusItem(visible[idx + 1]!.node.id);
        break;
      case "ArrowUp":
        if (idx > 0) focusItem(visible[idx - 1]!.node.id);
        break;
      case "ArrowRight":
        if (children.length > 0 && !expanded.has(node.id)) toggle(node.id);
        else if (children.length > 0) focusItem(children[0]!.id);
        break;
      case "ArrowLeft":
        if (expanded.has(node.id)) toggle(node.id);
        else if (node.parentId) focusItem(node.parentId);
        break;
      case "Home":
        focusItem(visible[0]!.node.id);
        break;
      case "End":
        focusItem(visible[visible.length - 1]!.node.id);
        break;
    }
  }

  // --- 新增（根頁面/子頁面）→ createPage → 編輯頁 ---
  function handleCreate(parentId: string | null) {
    startTransition(async () => {
      try {
        if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
        const { slug } = await createPage({ spaceId, parentId, title: "" });
        router.push(`/s/${spaceSlug}/${slug}/edit`);
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  // --- 重新命名 ---
  const [renameTarget, setRenameTarget] = useState<PageTreeNode | null>(null);
  function handleRename(formData: FormData) {
    const target = renameTarget;
    const title = String(formData.get("title") ?? "").trim();
    if (!target || !title) return;
    startTransition(async () => {
      try {
        const { slug } = await renamePage({ pageId: target.id, title });
        setRenameTarget(null);
        if (currentSlug === target.slug && slug !== target.slug) {
          const suffix = decodeURIComponent(pathname).endsWith("/edit") ? "/edit" : "";
          router.replace(`/s/${spaceSlug}/${slug}${suffix}`);
        } else {
          router.refresh();
        }
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  // --- 刪除（confirm 顯示後代數 countDescendants；僅 editor+ 可見入口） ---
  const [deleteTarget, setDeleteTarget] = useState<PageTreeNode | null>(null);
  const [descendants, setDescendants] = useState<number | null>(null);
  function openDelete(node: PageTreeNode) {
    setDeleteTarget(node);
    setDescendants(null);
    startTransition(async () => {
      try {
        setDescendants(await countDescendants(node.id));
      } catch {
        setDescendants(0);
      }
    });
  }
  function handleDelete() {
    const target = deleteTarget;
    if (!target) return;
    startTransition(async () => {
      try {
        // 先以客端樹資料算出子樹 slug 集合，判斷目前頁是否隨之刪除
        const subtreeSlugs = new Set<string>();
        const collect = (id: string) => {
          const n = byId.get(id);
          if (!n) return;
          subtreeSlugs.add(n.slug);
          for (const c of childrenOf.get(id) ?? []) collect(c.id);
        };
        collect(target.id);
        await deletePage({ pageId: target.id });
        setDeleteTarget(null);
        if (currentSlug && subtreeSlugs.has(currentSlug)) router.push(`/s/${spaceSlug}`);
        else router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  return (
    <div className="flex flex-col py-2">
      <div className="flex h-8 items-center justify-between pl-3 pr-2">
        <span className="text-caption font-medium text-fg-tertiary">{t("label")}</span>
        {canEdit ? (
          <IconButton
            label={t("newRootPage")}
            className="size-6"
            disabled={pending}
            onClick={() => handleCreate(null)}
          >
            <Plus className="size-4" />
          </IconButton>
        ) : null}
      </div>

      {nodes.length === 0 ? (
        <EmptyState
          className="px-3 py-6"
          icon={<FileText />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={
            canEdit ? (
              <Button size="sm" loading={pending} onClick={() => handleCreate(null)}>
                {t("createFirst")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul role="tree" aria-label={t("label")} className="px-1" onKeyDown={onTreeKeyDown}>
          {visible.map(({ node, level }) => {
            const children = childrenOf.get(node.id) ?? [];
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(node.id);
            const isCurrent = node.id === currentId;
            return (
              <li key={node.id} role="none">
                <div
                  className={cn(
                    "group relative flex h-[30px] items-center gap-0.5 rounded-sm pr-1",
                    isCurrent ? "bg-primary-tint" : "hover:bg-hover",
                  )}
                  style={{ paddingLeft: 4 + level * 16 }}
                >
                  {isCurrent ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                    />
                  ) : null}
                  {hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={isExpanded ? t("collapse") : t("expand")}
                      onClick={() => toggle(node.id)}
                      className="flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
                      />
                    </button>
                  ) : (
                    <span aria-hidden className="size-5 shrink-0" />
                  )}
                  <Link
                    href={`/s/${spaceSlug}/${node.slug}`}
                    ref={(el) => {
                      if (el) itemRefs.current.set(node.id, el);
                      else itemRefs.current.delete(node.id);
                    }}
                    role="treeitem"
                    aria-level={level + 1}
                    aria-expanded={hasChildren ? isExpanded : undefined}
                    aria-selected={isCurrent}
                    aria-current={isCurrent ? "page" : undefined}
                    tabIndex={node.id === tabbableId ? 0 : -1}
                    onFocus={() => setFocusedId(node.id)}
                    className={cn(
                      "flex h-full min-w-0 flex-1 items-center gap-1.5 text-body-ui",
                      isCurrent ? "font-medium text-fg" : "text-fg-secondary hover:text-fg",
                    )}
                  >
                    {node.icon ? (
                      <span aria-hidden className="shrink-0 text-sm leading-none">
                        {node.icon}
                      </span>
                    ) : (
                      <FileText aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
                    )}
                    <span className="truncate">{node.title}</span>
                  </Link>
                  {canEdit ? (
                    <span className="ml-auto hidden shrink-0 items-center group-focus-within:flex group-hover:flex group-has-[[data-state=open]]:flex">
                      <RowActionButton label={t("addChild")} onClick={() => handleCreate(node.id)}>
                        <Plus aria-hidden className="size-3.5" />
                      </RowActionButton>
                      <Popover>
                        <PopoverTrigger asChild>
                          <RowActionButton label={t("nodeMenu")}>
                            <Ellipsis aria-hidden className="size-3.5" />
                          </RowActionButton>
                        </PopoverTrigger>
                        <PopoverContent align="start" sideOffset={4} className="w-44 p-1">
                          <PopoverClose asChild>
                            <MenuItem onClick={() => setRenameTarget(node)}>
                              <Pencil aria-hidden className="size-4" />
                              {t("rename")}
                            </MenuItem>
                          </PopoverClose>
                          <PopoverClose asChild>
                            <MenuItem danger onClick={() => openDelete(node)}>
                              <Trash2 aria-hidden className="size-4" />
                              {t("delete")}
                            </MenuItem>
                          </PopoverClose>
                        </PopoverContent>
                      </Popover>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 重新命名 modal */}
      <Modal open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <ModalContent size="sm" title={t("renameTitle")} closeLabel={t("cancel")}>
          <form action={handleRename} className="flex flex-col gap-4">
            <Input
              name="title"
              label={t("titleLabel")}
              defaultValue={renameTarget?.title ?? ""}
              required
              maxLength={200}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <ModalClose asChild>
                <Button type="button" variant="secondary">
                  {t("cancel")}
                </Button>
              </ModalClose>
              <Button type="submit" loading={pending}>
                {t("save")}
              </Button>
            </div>
          </form>
        </ModalContent>
      </Modal>

      {/* 刪除 confirm modal（顯示後代數） */}
      <Modal open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <ModalContent size="sm" title={t("deleteTitle")} closeLabel={t("cancel")}>
          {descendants === null ? (
            <Skeleton className="h-5 w-3/4" />
          ) : (
            <p className="text-body-ui text-fg-secondary">
              {descendants > 0
                ? t("deleteDescWithChildren", {
                    title: deleteTarget?.title ?? "",
                    count: descendants,
                  })
                : t("deleteDesc", { title: deleteTarget?.title ?? "" })}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <ModalClose asChild>
              <Button type="button" variant="secondary">
                {t("cancel")}
              </Button>
            </ModalClose>
            <Button variant="danger" loading={pending} onClick={handleDelete}>
              {t("confirmDelete")}
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** 列尾 24×24 hover 動作鈕（比 IconButton 小一號，無 tooltip 以利 hover 流暢）。 */
function RowActionButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded-xs text-fg-tertiary transition-colors hover:bg-hover hover:text-fg"
      {...props}
    >
      {children}
    </button>
  );
}

/** ⋯ 選單項。 */
function MenuItem({
  danger,
  className,
  children,
  ...props
}: { danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-body-ui transition-colors",
        danger ? "text-danger hover:bg-danger-tint" : "text-fg hover:bg-hover",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
