"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronRight,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  copyPageToSpace,
  countDescendants,
  createExternalLinkNode,
  createGroupNode,
  createPage,
  deletePage,
  importMarkdownPage,
  listMoveTargetSpaces,
  movePage,
  movePageToSpace,
  renamePage,
  updateExternalLink,
} from "@/actions/page";
import type { PageKind } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
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
  /** 節點型別（C-11）：page＝內容頁；group＝分節標題；external_link＝外部連結 */
  kind: PageKind;
  /** external_link 節點目標 URL；其餘型別為 null */
  externalUrl: string | null;
}

/** 前端匯入檔案大小上限（bytes），對齊 server 端 IMPORT_MARKDOWN_MAX_CHARS（2 MiB）。 */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** 外部連結 URL 前端驗證：僅接受 http/https 絕對網址（與 server 端一致）。 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface PageTreeProps {
  spaceId: string;
  spaceSlug: string;
  nodes: PageTreeNode[];
  /** editor 以上才顯示新增/重新命名/刪除入口（伺服器端 lib/authz 判定後傳入） */
  canEdit: boolean;
}

/**
 * 頁面樹側欄（C-03／C-11，設計規範 §4.4 Tree／§4.5）：
 * 列高 30px、縮排 16px/層、chevron 僅有子節點顯示、目前頁 primary 淡底＋左緣 2px 色條、
 * hover 浮現 [＋新增][⋯選單]、WAI-ARIA 方向鍵導航（↑↓ 移動、←→ 收展）。
 * 三種節點型別（F-PAGE-04）：page＝內部連結頁；group＝不可點的分節標題（可含子節點）；
 * external_link＝以新分頁開啟目標 URL 的葉節點。
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
    () => nodes.find((n) => n.slug === currentSlug && n.kind === "page")?.id ?? null,
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

  const itemRefs = useRef(new Map<string, HTMLElement>());
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

  // --- 拖曳排序與搬移（C-04，原生 HTML5 drag&drop） ---
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: "before" | "after" | "inside";
  } | null>(null);
  /** hover 600ms 自動展開的待觸發計時器 */
  const hoverExpandRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // 被拖曳節點的整支子樹（含自身）：禁止落入其中（循環）
  const dragSubtree = useMemo(() => {
    const set = new Set<string>();
    if (!dragId) return set;
    const collect = (id: string) => {
      set.add(id);
      for (const c of childrenOf.get(id) ?? []) collect(c.id);
    };
    collect(dragId);
    return set;
  }, [dragId, childrenOf]);

  function clearHoverExpand() {
    if (hoverExpandRef.current) {
      clearTimeout(hoverExpandRef.current.timer);
      hoverExpandRef.current = null;
    }
  }

  function resetDrag() {
    setDragId(null);
    setDropTarget(null);
    clearHoverExpand();
  }

  function onHandleDragStart(e: DragEvent<HTMLElement>, node: PageTreeNode) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    // 以整列作為拖曳影像（把手只是啟動點）
    const row = e.currentTarget.closest("li");
    if (row) e.dataTransfer.setDragImage(row, 8, 15);
    setDragId(node.id);
  }

  function onRowDragOver(e: DragEvent<HTMLDivElement>, node: PageTreeNode) {
    if (!dragId) return;
    if (dragSubtree.has(node.id)) {
      // 拖入自身或子孫：不 preventDefault ＝ 不允許 drop，游標顯示 not-allowed
      e.dataTransfer.dropEffect = "none";
      if (dropTarget) setDropTarget(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    // 外部連結為葉節點，不接受「放入內部」：只允許前後排序（C-11）。
    const canContain = node.kind !== "external_link";
    const pos = !canContain
      ? ratio < 0.5
        ? "before"
        : "after"
      : ratio < 0.25
        ? "before"
        : ratio > 0.75
          ? "after"
          : "inside";
    setDropTarget((prev) => (prev?.id === node.id && prev.pos === pos ? prev : { id: node.id, pos }));
    // 停留 600ms 自動展開（收合且有子節點時），方便拖進深層
    if (hoverExpandRef.current && hoverExpandRef.current.id !== node.id) clearHoverExpand();
    const hasChildren = (childrenOf.get(node.id) ?? []).length > 0;
    if (canContain && hasChildren && !expanded.has(node.id) && !hoverExpandRef.current) {
      hoverExpandRef.current = {
        id: node.id,
        timer: setTimeout(() => {
          setExpanded((prev) => new Set(prev).add(node.id));
          hoverExpandRef.current = null;
        }, 600),
      };
    }
  }

  function onRowDrop(e: DragEvent<HTMLDivElement>, node: PageTreeNode) {
    e.preventDefault();
    const sourceId = dragId ?? e.dataTransfer.getData("text/plain");
    let pos = dropTarget?.id === node.id ? dropTarget.pos : "inside";
    // 外部連結不可作為父：防禦性地把 inside 轉為 after（正常情況已於 dragOver 夾住）。
    if (pos === "inside" && node.kind === "external_link") pos = "after";
    const blocked = !sourceId || sourceId === node.id || dragSubtree.has(node.id);
    resetDrag();
    if (blocked) return;
    startTransition(async () => {
      try {
        if (pos === "inside") {
          await movePage({ pageId: sourceId, newParentId: node.id });
          setExpanded((prev) => new Set(prev).add(node.id));
        } else if (pos === "before") {
          await movePage({ pageId: sourceId, newParentId: node.parentId, beforeId: node.id });
        } else {
          await movePage({ pageId: sourceId, newParentId: node.parentId, afterId: node.id });
        }
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  function onTreeDragLeave(e: DragEvent<HTMLUListElement>) {
    // 離開整棵樹（含拖出視窗）才清插入指示，避免列間移動閃爍
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDropTarget(null);
    clearHoverExpand();
  }

  // --- 新增內容頁（根/子）→ createPage → 編輯頁 ---
  function handleCreatePage(parentId: string | null) {
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

  // --- 新增群組分節（C-11）→ createGroupNode（停留於樹） ---
  const [groupModal, setGroupModal] = useState<{ parentId: string | null } | null>(null);
  function handleCreateGroup(formData: FormData) {
    const modal = groupModal;
    const title = String(formData.get("title") ?? "").trim();
    if (!modal || !title) return;
    startTransition(async () => {
      try {
        if (modal.parentId) setExpanded((prev) => new Set(prev).add(modal.parentId!));
        await createGroupNode({ spaceId, parentId: modal.parentId, title });
        setGroupModal(null);
        toast({ variant: "success", title: t("createGroupSuccess") });
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  // --- 新增/編輯外部連結（C-11）→ createExternalLinkNode / updateExternalLink ---
  const [externalModal, setExternalModal] = useState<
    { mode: "create"; parentId: string | null } | { mode: "edit"; node: PageTreeNode } | null
  >(null);
  const [externalUrlError, setExternalUrlError] = useState<string | null>(null);
  function handleExternalSubmit(formData: FormData) {
    const modal = externalModal;
    if (!modal) return;
    const title = String(formData.get("title") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    if (!title) return;
    if (!isHttpUrl(url)) {
      setExternalUrlError(t("externalUrlInvalid"));
      return;
    }
    setExternalUrlError(null);
    startTransition(async () => {
      try {
        if (modal.mode === "create") {
          if (modal.parentId) setExpanded((prev) => new Set(prev).add(modal.parentId!));
          await createExternalLinkNode({ spaceId, parentId: modal.parentId, title, url });
          toast({ variant: "success", title: t("createExternalSuccess") });
        } else {
          await updateExternalLink({ pageId: modal.node.id, title, url });
          toast({ variant: "success", title: t("updateExternalSuccess") });
        }
        setExternalModal(null);
        router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  // --- 匯入單檔 Markdown（J-01）→ importMarkdownPage → 閱讀頁 ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // 重設，使再次選同一檔仍觸發 onChange
    if (!file) return;
    if (file.size === 0) {
      toast({ variant: "error", title: t("importEmpty") });
      return;
    }
    // 與 server 端 IMPORT_MARKDOWN_MAX_CHARS（2 MiB）對齊的前端保護
    if (file.size > MAX_IMPORT_BYTES) {
      toast({ variant: "error", title: t("importTooLarge") });
      return;
    }
    startTransition(async () => {
      try {
        const markdown = await file.text();
        const { slug } = await importMarkdownPage({ spaceId, fileName: file.name, markdown });
        toast({ variant: "success", title: t("importSuccess") });
        router.push(`/s/${spaceSlug}/${slug}`);
      } catch {
        toast({ variant: "error", title: t("importError") });
      }
    });
  }

  // --- 重新命名（page / group；external 走「編輯連結」） ---
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
        const subtreeSlugs = subtreeSlugsOf(target.id);
        await deletePage({ pageId: target.id });
        setDeleteTarget(null);
        if (currentSlug && subtreeSlugs.has(currentSlug)) router.push(`/s/${spaceSlug}`);
        else router.refresh();
      } catch {
        toast({ variant: "error", title: t("actionError") });
      }
    });
  }

  /** 以客端樹資料算出某節點子樹（含自身）的 slug 集合（判斷目前頁是否隨操作離開本 space）。 */
  function subtreeSlugsOf(rootId: string): Set<string> {
    const slugs = new Set<string>();
    const collect = (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      slugs.add(n.slug);
      for (const c of childrenOf.get(id) ?? []) collect(c.id);
    };
    collect(rootId);
    return slugs;
  }

  // --- 跨 Space 移動／複製（C-10）：⋯選單觸發，Combobox 選目標空間 ---
  const [crossTarget, setCrossTarget] = useState<{ node: PageTreeNode; mode: "move" | "copy" } | null>(
    null,
  );
  const [spaceOptions, setSpaceOptions] = useState<
    { id: string; slug: string; name: string }[] | null
  >(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  function openCrossSpace(node: PageTreeNode, mode: "move" | "copy") {
    setCrossTarget({ node, mode });
    setSelectedSpaceId(null);
    setSpaceOptions(null);
    startTransition(async () => {
      try {
        setSpaceOptions(await listMoveTargetSpaces(spaceId));
      } catch {
        setSpaceOptions([]);
      }
    });
  }

  function handleCrossSpace() {
    const target = crossTarget;
    const destId = selectedSpaceId;
    if (!target || !destId) return;
    const destName = spaceOptions?.find((s) => s.id === destId)?.name ?? "";
    startTransition(async () => {
      try {
        if (target.mode === "move") {
          // 搬移前先以客端樹資料判斷目前頁是否隨子樹離開本 space（移動後本 space 樹已無該頁）。
          const subtreeSlugs = subtreeSlugsOf(target.node.id);
          const { rootSlug, targetSpaceSlug } = await movePageToSpace({
            pageId: target.node.id,
            targetSpaceId: destId,
          });
          setCrossTarget(null);
          toast({ variant: "success", title: t("moveSuccess", { space: destName }) });
          if (currentSlug && subtreeSlugs.has(currentSlug)) {
            // 目前頁已移到新 space：導向搬移後的子樹根頁（子頁新 slug 不必然可知，導根頁最穩妥）。
            const suffix = decodeURIComponent(pathname).endsWith("/edit") ? "/edit" : "";
            router.push(`/s/${targetSpaceSlug}/${rootSlug}${suffix}`);
          } else {
            router.refresh();
          }
        } else {
          const { rootSlug, targetSpaceSlug } = await copyPageToSpace({
            pageId: target.node.id,
            targetSpaceId: destId,
          });
          setCrossTarget(null);
          toast({ variant: "success", title: t("copySuccess", { space: destName }) });
          router.push(`/s/${targetSpaceSlug}/${rootSlug}`);
        }
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
          <div className="flex items-center gap-0.5">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("addNode")}
                  title={t("addNode")}
                  disabled={pending}
                  className="inline-flex size-6 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled"
                >
                  <Plus className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-44 p-1">
                <PopoverClose asChild>
                  <MenuItem onClick={() => handleCreatePage(null)}>
                    <FileText aria-hidden className="size-4" />
                    {t("newPage")}
                  </MenuItem>
                </PopoverClose>
                <PopoverClose asChild>
                  <MenuItem onClick={() => setGroupModal({ parentId: null })}>
                    <Folder aria-hidden className="size-4" />
                    {t("newGroup")}
                  </MenuItem>
                </PopoverClose>
                <PopoverClose asChild>
                  <MenuItem
                    onClick={() => {
                      setExternalUrlError(null);
                      setExternalModal({ mode: "create", parentId: null });
                    }}
                  >
                    <ExternalLink aria-hidden className="size-4" />
                    {t("newExternalLink")}
                  </MenuItem>
                </PopoverClose>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("spaceMenu")}
                  title={t("spaceMenu")}
                  disabled={pending}
                  className="inline-flex size-6 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled"
                >
                  <Ellipsis className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-48 p-1">
                <PopoverClose asChild>
                  <MenuItem onClick={() => fileInputRef.current?.click()}>
                    <Upload aria-hidden className="size-4" />
                    {t("importMarkdown")}
                  </MenuItem>
                </PopoverClose>
              </PopoverContent>
            </Popover>
            {/* 隱藏 file input：由匯入選單觸發；只接受 Markdown 副檔名 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.mdown,.mkd,.mkdn,text/markdown"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
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
              <Button size="sm" loading={pending} onClick={() => handleCreatePage(null)}>
                {t("createFirst")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul
          role="tree"
          aria-label={t("label")}
          className="px-1"
          onKeyDown={onTreeKeyDown}
          onDragLeave={canEdit ? onTreeDragLeave : undefined}
        >
          {visible.map(({ node, level }) => {
            const children = childrenOf.get(node.id) ?? [];
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(node.id);
            const isCurrent = node.id === currentId;
            const isGroup = node.kind === "group";
            const isExternal = node.kind === "external_link";
            const canHaveChildren = node.kind !== "external_link";
            const isDropInside = dropTarget?.id === node.id && dropTarget.pos === "inside";
            const isTabbable = node.id === tabbableId;
            const setRef = (el: HTMLElement | null) => {
              if (el) itemRefs.current.set(node.id, el);
              else itemRefs.current.delete(node.id);
            };
            return (
              <li key={node.id} role="none">
                <div
                  className={cn(
                    "group relative flex h-[30px] items-center gap-0.5 rounded-sm pr-1",
                    isCurrent ? "bg-primary-tint" : "hover:bg-hover",
                    dragId === node.id && "opacity-50",
                    isDropInside && "bg-primary-tint ring-1 ring-inset ring-primary",
                  )}
                  style={{ paddingLeft: 4 + level * 16 }}
                  onDragOver={canEdit ? (e) => onRowDragOver(e, node) : undefined}
                  onDrop={canEdit ? (e) => onRowDrop(e, node) : undefined}
                >
                  {dropTarget?.id === node.id && dropTarget.pos !== "inside" ? (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-primary",
                        dropTarget.pos === "before" ? "-top-px" : "-bottom-px",
                      )}
                      style={{ marginLeft: 4 + level * 16 }}
                    />
                  ) : null}
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

                  {isGroup ? (
                    // 群組分節：不可開啟為頁面（C-11）；點整列僅收展。role=treeitem 供鍵盤導航。
                    <button
                      type="button"
                      ref={setRef}
                      role="treeitem"
                      aria-level={level + 1}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      aria-selected={false}
                      tabIndex={isTabbable ? 0 : -1}
                      onFocus={() => setFocusedId(node.id)}
                      onClick={() => hasChildren && toggle(node.id)}
                      className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-caption font-semibold uppercase tracking-wide text-fg-tertiary"
                    >
                      {node.icon ? (
                        <span aria-hidden className="shrink-0 text-sm leading-none">
                          {node.icon}
                        </span>
                      ) : (
                        <Folder aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
                      )}
                      <span className="truncate">{node.title}</span>
                    </button>
                  ) : isExternal ? (
                    // 外部連結：新分頁開啟目標 URL（C-11）。
                    <a
                      ref={setRef}
                      href={node.externalUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      role="treeitem"
                      aria-level={level + 1}
                      aria-selected={false}
                      title={t("externalLinkHint")}
                      tabIndex={isTabbable ? 0 : -1}
                      onFocus={() => setFocusedId(node.id)}
                      className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-body-ui text-fg-secondary hover:text-fg"
                    >
                      {node.icon ? (
                        <span aria-hidden className="shrink-0 text-sm leading-none">
                          {node.icon}
                        </span>
                      ) : (
                        <ExternalLink aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
                      )}
                      <span className="truncate">{node.title}</span>
                    </a>
                  ) : (
                    <Link
                      href={`/s/${spaceSlug}/${node.slug}`}
                      ref={setRef}
                      role="treeitem"
                      aria-level={level + 1}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      aria-selected={isCurrent}
                      aria-current={isCurrent ? "page" : undefined}
                      tabIndex={isTabbable ? 0 : -1}
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
                  )}

                  {canEdit ? (
                    <span className="ml-auto hidden shrink-0 items-center group-focus-within:flex group-hover:flex group-has-[[data-state=open]]:flex">
                      <span
                        role="button"
                        aria-label={t("dragHandle")}
                        title={t("dragHandle")}
                        draggable
                        onDragStart={(e) => onHandleDragStart(e, node)}
                        onDragEnd={resetDrag}
                        className="flex size-6 cursor-grab items-center justify-center rounded-xs text-fg-tertiary transition-colors hover:bg-hover hover:text-fg active:cursor-grabbing"
                      >
                        <GripVertical aria-hidden className="size-3.5" />
                      </span>
                      {canHaveChildren ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <RowActionButton label={t("addChildNode")}>
                              <Plus aria-hidden className="size-3.5" />
                            </RowActionButton>
                          </PopoverTrigger>
                          <PopoverContent align="start" sideOffset={4} className="w-44 p-1">
                            <PopoverClose asChild>
                              <MenuItem onClick={() => handleCreatePage(node.id)}>
                                <FileText aria-hidden className="size-4" />
                                {t("newPage")}
                              </MenuItem>
                            </PopoverClose>
                            <PopoverClose asChild>
                              <MenuItem onClick={() => setGroupModal({ parentId: node.id })}>
                                <Folder aria-hidden className="size-4" />
                                {t("newGroup")}
                              </MenuItem>
                            </PopoverClose>
                            <PopoverClose asChild>
                              <MenuItem
                                onClick={() => {
                                  setExternalUrlError(null);
                                  setExternalModal({ mode: "create", parentId: node.id });
                                }}
                              >
                                <ExternalLink aria-hidden className="size-4" />
                                {t("newExternalLink")}
                              </MenuItem>
                            </PopoverClose>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                      <Popover>
                        <PopoverTrigger asChild>
                          <RowActionButton label={t("nodeMenu")}>
                            <Ellipsis aria-hidden className="size-3.5" />
                          </RowActionButton>
                        </PopoverTrigger>
                        <PopoverContent align="start" sideOffset={4} className="w-44 p-1">
                          {isExternal ? (
                            <PopoverClose asChild>
                              <MenuItem
                                onClick={() => {
                                  setExternalUrlError(null);
                                  setExternalModal({ mode: "edit", node });
                                }}
                              >
                                <Pencil aria-hidden className="size-4" />
                                {t("editExternalLink")}
                              </MenuItem>
                            </PopoverClose>
                          ) : (
                            <PopoverClose asChild>
                              <MenuItem onClick={() => setRenameTarget(node)}>
                                <Pencil aria-hidden className="size-4" />
                                {t("rename")}
                              </MenuItem>
                            </PopoverClose>
                          )}
                          <PopoverClose asChild>
                            <MenuItem onClick={() => openCrossSpace(node, "move")}>
                              <FolderInput aria-hidden className="size-4" />
                              {t("moveToSpace")}
                            </MenuItem>
                          </PopoverClose>
                          <PopoverClose asChild>
                            <MenuItem onClick={() => openCrossSpace(node, "copy")}>
                              <Copy aria-hidden className="size-4" />
                              {t("copyToSpace")}
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

      {/* 重新命名 modal（page / group） */}
      <Modal open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <ModalContent
          size="sm"
          title={renameTarget?.kind === "group" ? t("renameGroupTitle") : t("renameTitle")}
          closeLabel={t("cancel")}
        >
          <form action={handleRename} className="flex flex-col gap-4">
            <Input
              name="title"
              label={renameTarget?.kind === "group" ? t("groupNameLabel") : t("titleLabel")}
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

      {/* 新增群組 modal */}
      <Modal open={groupModal !== null} onOpenChange={(open) => !open && setGroupModal(null)}>
        <ModalContent size="sm" title={t("createGroupTitle")} closeLabel={t("cancel")}>
          <form action={handleCreateGroup} className="flex flex-col gap-4">
            <Input name="title" label={t("groupNameLabel")} required maxLength={200} autoFocus />
            <div className="flex justify-end gap-2">
              <ModalClose asChild>
                <Button type="button" variant="secondary">
                  {t("cancel")}
                </Button>
              </ModalClose>
              <Button type="submit" loading={pending}>
                {t("create")}
              </Button>
            </div>
          </form>
        </ModalContent>
      </Modal>

      {/* 新增／編輯外部連結 modal */}
      <Modal
        open={externalModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExternalModal(null);
            setExternalUrlError(null);
          }
        }}
      >
        <ModalContent
          size="sm"
          title={externalModal?.mode === "edit" ? t("editExternalTitle") : t("createExternalTitle")}
          closeLabel={t("cancel")}
        >
          <form action={handleExternalSubmit} className="flex flex-col gap-4">
            <Input
              name="title"
              label={t("externalNameLabel")}
              defaultValue={externalModal?.mode === "edit" ? externalModal.node.title : ""}
              required
              maxLength={200}
              autoFocus
            />
            <Input
              name="url"
              type="url"
              inputMode="url"
              label={t("externalUrlLabel")}
              placeholder={t("externalUrlPlaceholder")}
              defaultValue={externalModal?.mode === "edit" ? (externalModal.node.externalUrl ?? "") : ""}
              error={externalUrlError ?? undefined}
              onChange={() => externalUrlError && setExternalUrlError(null)}
              required
              maxLength={2048}
            />
            <div className="flex justify-end gap-2">
              <ModalClose asChild>
                <Button type="button" variant="secondary">
                  {t("cancel")}
                </Button>
              </ModalClose>
              <Button type="submit" loading={pending}>
                {externalModal?.mode === "edit" ? t("save") : t("create")}
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

      {/* 跨 Space 移動／複製 modal（Combobox 選目標空間） */}
      <Modal open={crossTarget !== null} onOpenChange={(open) => !open && setCrossTarget(null)}>
        <ModalContent
          size="sm"
          title={crossTarget?.mode === "copy" ? t("copyTitle") : t("moveTitle")}
          closeLabel={t("cancel")}
        >
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">
              {crossTarget?.mode === "copy"
                ? t("copyDesc", { title: crossTarget?.node.title ?? "" })
                : t("moveDesc", { title: crossTarget?.node.title ?? "" })}
            </p>
            {spaceOptions !== null && spaceOptions.length === 0 ? (
              <p className="text-body-ui text-fg-tertiary">{t("noTargetSpaces")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-fg-secondary">
                  {t("targetSpaceLabel")}
                </span>
                <Combobox
                  options={(spaceOptions ?? []).map((s) => ({ value: s.id, label: s.name }))}
                  value={selectedSpaceId}
                  onValueChange={setSelectedSpaceId}
                  placeholder={spaceOptions === null ? t("targetSpaceLoading") : t("targetSpacePlaceholder")}
                  searchPlaceholder={t("targetSpaceSearch")}
                  emptyText={t("targetSpaceEmpty")}
                  disabled={spaceOptions === null || spaceOptions.length === 0}
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <ModalClose asChild>
                <Button type="button" variant="secondary">
                  {t("cancel")}
                </Button>
              </ModalClose>
              <Button
                loading={pending}
                disabled={!selectedSpaceId}
                onClick={handleCrossSpace}
              >
                {crossTarget?.mode === "copy" ? t("copyConfirm") : t("moveConfirm")}
              </Button>
            </div>
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
