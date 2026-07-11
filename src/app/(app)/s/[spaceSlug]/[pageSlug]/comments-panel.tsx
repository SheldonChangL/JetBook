"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, MessageSquare, Reply, Trash2 } from "lucide-react";
import {
  addComment,
  deleteComment,
  editComment,
  replyComment,
  resolveComment,
} from "@/actions/comment";
import type { CommentView } from "@/lib/comments/service";
import { relativeTime, type RelativeTime } from "@/lib/relative-time";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal, ModalContent } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * 頁面留言區（K-01，設計規範 §3.9 頁面級討論串）：閱讀頁底部呈現。
 * 討論串（回覆縮排）、已解決收合、樂觀更新（送出/回覆/解決/編輯/刪除即時反映，失敗回滾）。
 */

type UiComment = CommentView & { pending?: boolean; replies: UiComment[] };

let tempSeq = 0;
function tempId() {
  tempSeq += 1;
  return `temp-${tempSeq}-${Date.now()}`;
}

function countVisible(threads: UiComment[]): number {
  return threads.reduce(
    (sum, t) => sum + (t.deleted ? 0 : 1) + t.replies.filter((r) => !r.deleted).length,
    0,
  );
}

export function CommentsPanel({
  pageId,
  currentUser,
  canComment,
  canModerate,
  initialComments,
}: {
  pageId: string;
  currentUser: { id: string; name: string };
  canComment: boolean;
  canModerate: boolean;
  initialComments: CommentView[];
}) {
  const t = useTranslations("comments");
  const [threads, setThreads] = useState<UiComment[]>(
    () => initialComments as UiComment[],
  );
  const [showResolved, setShowResolved] = useState(false);

  const active = threads.filter((th) => th.resolvedAt === null);
  const resolved = threads.filter((th) => th.resolvedAt !== null);
  const total = countVisible(threads);

  // ── 樂觀狀態更新輔助 ──
  function replaceThread(id: string, next: UiComment | null) {
    setThreads((prev) => {
      if (next === null) return prev.filter((th) => th.id !== id);
      if (prev.some((th) => th.id === id)) {
        return prev.map((th) => (th.id === id ? next : th));
      }
      // 還原先前被樂觀移除的討論串：依 createdAt（ISO 可字典序排序）插回原位。
      return [...prev, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }
  function patchThread(id: string, patch: Partial<UiComment>) {
    setThreads((prev) => prev.map((th) => (th.id === id ? { ...th, ...patch } : th)));
  }

  return (
    <section aria-labelledby="comments-heading" className="mt-10 border-t border-edge pt-8">
      <h2 id="comments-heading" className="mb-4 flex items-center gap-2 text-h4 text-fg">
        <MessageSquare aria-hidden className="size-5 text-fg-tertiary" />
        {total > 0 ? t("headingWithCount", { count: total }) : t("heading")}
      </h2>

      {active.length === 0 && resolved.length === 0 ? (
        <p className="rounded-md border border-edge bg-raised px-4 py-6 text-center text-body-ui text-fg-tertiary">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {active.map((thread) => (
            <li key={thread.id}>
              <ThreadCard
                thread={thread}
                currentUser={currentUser}
                canComment={canComment}
                canModerate={canModerate}
                onReplace={(next) => replaceThread(thread.id, next)}
                onPatch={(patch) => patchThread(thread.id, patch)}
              />
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <NewCommentForm
          pageId={pageId}
          currentUser={currentUser}
          onCreated={(comment) => setThreads((prev) => [...prev, comment])}
          onReplaceTemp={(tempKey, real) =>
            setThreads((prev) => prev.map((th) => (th.id === tempKey ? real : th)))
          }
          onRemoveTemp={(tempKey) => setThreads((prev) => prev.filter((th) => th.id !== tempKey))}
        />
      ) : (
        <p className="mt-4 text-caption text-fg-tertiary">{t("readOnlyHint")}</p>
      )}

      {resolved.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-1 text-caption font-medium text-fg-secondary hover:text-fg"
            aria-expanded={showResolved}
          >
            {showResolved ? (
              <ChevronDown aria-hidden className="size-4" />
            ) : (
              <ChevronRight aria-hidden className="size-4" />
            )}
            {t("resolvedSection", { count: resolved.length })}
          </button>
          {showResolved ? (
            <ul className="mt-3 flex flex-col gap-4">
              {resolved.map((thread) => (
                <li key={thread.id}>
                  <ThreadCard
                    thread={thread}
                    currentUser={currentUser}
                    canComment={canComment}
                    canModerate={canModerate}
                    onReplace={(next) => replaceThread(thread.id, next)}
                    onPatch={(patch) => patchThread(thread.id, patch)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 相對時間顯示（純客戶端計算，避免時區/水合落差以 suppressHydrationWarning 處理）。 */
function TimeAgo({ iso }: { iso: string }) {
  const tc = useTranslations("common.relativeTime");
  const rt: RelativeTime = relativeTime(new Date(iso));
  let label: string;
  switch (rt.kind) {
    case "justNow":
      label = tc("justNow");
      break;
    case "minutesAgo":
      label = tc("minutesAgo", { minutes: rt.minutes });
      break;
    case "hoursAgo":
      label = tc("hoursAgo", { hours: rt.hours });
      break;
    case "yesterday":
      label = tc("yesterday");
      break;
    default:
      label = rt.label;
  }
  return (
    <time dateTime={iso} suppressHydrationWarning className="text-caption text-fg-tertiary">
      {label}
    </time>
  );
}

function ThreadCard({
  thread,
  currentUser,
  canComment,
  canModerate,
  onReplace,
  onPatch,
}: {
  thread: UiComment;
  currentUser: { id: string; name: string };
  canComment: boolean;
  canModerate: boolean;
  onReplace: (next: UiComment | null) => void;
  onPatch: (patch: Partial<UiComment>) => void;
}) {
  const t = useTranslations("comments");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [replying, setReplying] = useState(false);

  function setReplies(replies: UiComment[]) {
    onPatch({ replies });
  }

  function onToggleResolve() {
    const next = thread.resolvedAt === null ? new Date().toISOString() : null;
    onPatch({ resolvedAt: next });
    startTransition(async () => {
      try {
        await resolveComment({ commentId: thread.id, resolved: next !== null });
        toast({
          variant: "success",
          title: next !== null ? t("commentResolved") : t("commentReopened"),
        });
      } catch {
        onPatch({ resolvedAt: thread.resolvedAt });
        toast({ variant: "error", title: t("error") });
      }
    });
  }

  function onDeleteThread() {
    const hadReplies = thread.replies.some((r) => !r.deleted);
    const snapshot = thread;
    // 有回覆 → 墓碑；無回覆 → 整串移除
    if (hadReplies) onPatch({ deleted: true, body: "", authorName: null, authorId: null });
    else onReplace(null);
    startTransition(async () => {
      try {
        await deleteComment({ commentId: thread.id });
        toast({ variant: "success", title: t("commentDeleted") });
      } catch {
        onReplace(snapshot);
        toast({ variant: "error", title: t("error") });
      }
    });
  }

  function onAddReply(body: string) {
    const key = tempId();
    const temp: UiComment = {
      id: key,
      authorId: currentUser.id,
      authorName: currentUser.name,
      body,
      deleted: false,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
      replies: [],
      pending: true,
    };
    setReplies([...thread.replies, temp]);
    setReplying(false);
    startTransition(async () => {
      try {
        const real = (await replyComment({ parentCommentId: thread.id, body })) as UiComment;
        setReplies([...thread.replies.filter((r) => r.id !== key), real]);
      } catch {
        setReplies(thread.replies.filter((r) => r.id !== key));
        toast({ variant: "error", title: t("error") });
      }
    });
  }

  const isResolved = thread.resolvedAt !== null;

  return (
    <div
      className={`rounded-md border border-edge bg-raised p-4 ${isResolved ? "opacity-70" : ""}`}
    >
      <CommentBody
        comment={thread}
        canEdit={!thread.deleted && thread.authorId === currentUser.id}
        canDelete={!thread.deleted && (thread.authorId === currentUser.id || canModerate)}
        onSaveEdit={(body) => onPatch({ body })}
        onRevertEdit={(body) => onPatch({ body })}
        onDelete={onDeleteThread}
      />

      {isResolved ? (
        <span className="mt-2 inline-flex items-center gap-1 text-caption text-success">
          <Check aria-hidden className="size-3.5" />
          {t("resolvedBadge")}
        </span>
      ) : null}

      {/* 討論串動作列 */}
      {!thread.deleted ? (
        <div className="mt-2 flex items-center gap-1">
          {canComment ? (
            <Button variant="ghost" size="sm" onClick={() => setReplying((v) => !v)}>
              <Reply aria-hidden className="size-3.5" />
              {t("reply")}
            </Button>
          ) : null}
          {canComment ? (
            <Button variant="ghost" size="sm" onClick={onToggleResolve} disabled={pending}>
              <Check aria-hidden className="size-3.5" />
              {isResolved ? t("reopen") : t("resolve")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 回覆列表（縮排 12px） */}
      {thread.replies.length > 0 ? (
        <ul className="ml-3 mt-3 flex flex-col gap-3 border-l border-edge pl-3">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody
                comment={reply}
                canEdit={!reply.deleted && reply.authorId === currentUser.id}
                canDelete={!reply.deleted && (reply.authorId === currentUser.id || canModerate)}
                onSaveEdit={(body) =>
                  setReplies(thread.replies.map((r) => (r.id === reply.id ? { ...r, body } : r)))
                }
                onRevertEdit={(body) =>
                  setReplies(thread.replies.map((r) => (r.id === reply.id ? { ...r, body } : r)))
                }
                onDelete={() => {
                  const snapshot = thread.replies;
                  setReplies(thread.replies.filter((r) => r.id !== reply.id));
                  startTransition(async () => {
                    try {
                      await deleteComment({ commentId: reply.id });
                    } catch {
                      setReplies(snapshot);
                      toast({ variant: "error", title: t("error") });
                    }
                  });
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {replying ? (
        <div className="ml-3 mt-3 border-l border-edge pl-3">
          <ReplyForm onSubmit={onAddReply} onCancel={() => setReplying(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** 單則留言主體：頭像＋姓名＋時間＋內文（或墓碑），含編輯／刪除。 */
function CommentBody({
  comment,
  canEdit,
  canDelete,
  onSaveEdit,
  onRevertEdit,
  onDelete,
}: {
  comment: UiComment;
  canEdit: boolean;
  canDelete: boolean;
  onSaveEdit: (body: string) => void;
  onRevertEdit: (body: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("comments");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const authorName = comment.authorName ?? t("unknownAuthor");

  if (comment.deleted) {
    return <p className="text-body-ui italic text-fg-tertiary">{t("deleted")}</p>;
  }

  function onSave() {
    const body = draft.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      setDraft(comment.body);
      return;
    }
    const previous = comment.body;
    onSaveEdit(body);
    setEditing(false);
    startTransition(async () => {
      try {
        await editComment({ commentId: comment.id, body });
      } catch {
        onRevertEdit(previous);
        setDraft(previous);
        toast({ variant: "error", title: t("error") });
      }
    });
  }

  return (
    <div className="flex gap-3">
      <Avatar name={authorName} colorKey={comment.authorId ?? authorName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body-ui font-medium text-fg">{authorName}</span>
          <TimeAgo iso={comment.createdAt} />
        </div>

        {editing ? (
          <div className="mt-1.5 flex flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              aria-label={t("edit")}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(comment.body);
                }}
              >
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={onSave} loading={pending}>
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-body-ui text-fg">
            {comment.body}
          </p>
        )}

        {!editing && (canEdit || canDelete) ? (
          <div className="mt-1 flex items-center gap-1">
            {canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={comment.pending}
              >
                {t("edit")}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={comment.pending}
                aria-label={t("delete")}
              >
                <Trash2 aria-hidden className="size-3.5" />
                {t("delete")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent size="sm" title={t("deleteConfirmTitle")} closeLabel={t("cancel")}>
          <div className="flex flex-col gap-4">
            <p className="text-body-ui text-fg-secondary">{t("deleteConfirmBody")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmOpen(false);
                  onDelete();
                }}
              >
                {t("delete")}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** 頁面級新評論輸入框（頭像＋textarea＋送出）。 */
function NewCommentForm({
  pageId,
  currentUser,
  onCreated,
  onReplaceTemp,
  onRemoveTemp,
}: {
  pageId: string;
  currentUser: { id: string; name: string };
  onCreated: (comment: UiComment) => void;
  onReplaceTemp: (tempKey: string, real: UiComment) => void;
  onRemoveTemp: (tempKey: string) => void;
}) {
  const t = useTranslations("comments");
  const toast = useToast();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    const text = body.trim();
    if (!text) return;
    const key = tempId();
    const temp: UiComment = {
      id: key,
      authorId: currentUser.id,
      authorName: currentUser.name,
      body: text,
      deleted: false,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
      replies: [],
      pending: true,
    };
    onCreated(temp);
    setBody("");
    startTransition(async () => {
      try {
        const real = (await addComment({ pageId, body: text })) as UiComment;
        onReplaceTemp(key, real);
        toast({ variant: "success", title: t("commentAdded") });
      } catch {
        onRemoveTemp(key);
        setBody(text);
        toast({ variant: "error", title: t("error") });
      }
    });
  }

  return (
    <div className="mt-4 flex gap-3">
      <Avatar name={currentUser.name} colorKey={currentUser.id} size="md" />
      <div className="flex flex-1 flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("placeholder")}
          rows={3}
          aria-label={t("heading")}
        />
        <div className="flex justify-end">
          <Button onClick={onSubmit} loading={pending} disabled={!body.trim()}>
            {pending ? t("posting") : t("submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 討論串回覆輸入框。 */
function ReplyForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("comments");
  const [body, setBody] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("replyPlaceholder")}
        rows={2}
        aria-label={t("reply")}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const text = body.trim();
            if (text) onSubmit(text);
          }}
          disabled={!body.trim()}
        >
          {t("reply")}
        </Button>
      </div>
    </div>
  );
}
