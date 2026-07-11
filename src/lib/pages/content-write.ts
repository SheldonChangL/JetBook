import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { pages, pageVersions } from "@/lib/db/schema";
import { docToMarkdown, docToPlainText } from "@/lib/content/serialize";
import { EMPTY_DOC, type ProseMirrorDoc } from "@/lib/content/types";
import { VersionConflictError } from "@/lib/pages/errors";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Session 合併窗：同作者連續存檔於此時間內合併為單一版本（E-01）。 */
export const SNAPSHOT_MERGE_MS = 5 * 60 * 1000;

export interface WritePageContentInput {
  pageId: string;
  /** 版本快照要記的標題（＝頁面現行標題） */
  pageTitle: string;
  /** 樂觀鎖：呼叫端載入時的版本號；不符即拒寫（C1 第二道防線） */
  expectedVersionNo: number;
  /** TipTap/ProseMirror JSON（canonical） */
  content: ProseMirrorDoc;
  /** 存檔者（版本快照 created_by 與合併窗判定用） */
  userId: string;
}

/**
 * 內容儲存管線核心（D-02，架構鐵律 #5）：於呼叫端提供的同一交易內，同步
 * `content`(JSON canonical)、`content_md`、`content_text` 三欄位並以樂觀鎖遞增版本號，
 * 再寫入版本快照（同作者 SNAPSHOT_MERGE_MS 內合併，否則新增）。回傳新版本號。
 *
 * 這是**唯一**的內容寫入管線：`savePage`（編輯／還原）薄殼與匯入 worker（無 session）
 * 皆呼叫本函式，確保任何寫入路徑都三欄同交易同步、不旁路。權限與 session 由呼叫端薄殼
 * 先行驗證——本函式只負責 DB 管線，不散寫權限邏輯。
 */
export async function writePageContentTx(
  tx: Tx,
  input: WritePageContentInput,
): Promise<number> {
  const doc = input.content ?? EMPTY_DOC;
  const contentMd = docToMarkdown(doc);
  const contentText = docToPlainText(doc);

  // 樂觀鎖：以 WHERE current_version_no = expected 原子更新
  const updated = await tx
    .update(pages)
    .set({
      content: doc,
      contentMd,
      contentText,
      currentVersionNo: input.expectedVersionNo + 1,
      updatedBy: input.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(pages.id, input.pageId), eq(pages.currentVersionNo, input.expectedVersionNo)))
    .returning({ versionNo: pages.currentVersionNo });

  if (updated.length === 0) {
    // 版本不符：讀回目前版本號供前端提示重載
    const fresh = await tx.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
    throw new VersionConflictError(fresh?.currentVersionNo ?? 0);
  }
  const versionNo = updated[0]!.versionNo;

  // 版本快照（E-01，ADR-008 完整 JSON）：同交易寫入。
  // Session 合併：同一作者於 SNAPSHOT_MERGE_MS 內的連續存檔更新最後一筆快照，
  // 避免高頻 autosave 產生數百筆微版本。
  const last = await tx.query.pageVersions.findFirst({
    where: eq(pageVersions.pageId, input.pageId),
    orderBy: desc(pageVersions.versionNo),
  });
  const mergeable =
    last &&
    last.createdBy === input.userId &&
    Date.now() - last.createdAt.getTime() < SNAPSHOT_MERGE_MS;

  if (mergeable) {
    await tx
      .update(pageVersions)
      .set({ versionNo, title: input.pageTitle, content: doc, contentMd, createdAt: new Date() })
      .where(eq(pageVersions.id, last.id));
  } else {
    await tx.insert(pageVersions).values({
      pageId: input.pageId,
      versionNo,
      title: input.pageTitle,
      content: doc,
      contentMd,
      createdBy: input.userId,
    });
  }
  return versionNo;
}
