import "server-only";
import type { Readable } from "node:stream";
import { env } from "@/lib/env";
import { LocalStorageProvider } from "./local";

/**
 * 檔案儲存抽象（M-01）。DB 只存 metadata（attachments 表），
 * 檔案本體一律經 StorageProvider 存取——業務程式碼不得直接碰檔案系統。
 * 未來 S3/MinIO 只需新增實作並在 getStorageProvider() 切換，呼叫端不變。
 */
export interface StorageProvider {
  /** 寫入檔案內容；key 已存在時擲錯（storage key 為一次性 UUID，不覆寫）。 */
  put(key: string, data: Buffer): Promise<void>;
  /** 取得讀取串流；key 不存在時擲錯。 */
  getStream(key: string): Promise<Readable>;
  /** 刪除檔案；key 不存在視為成功（冪等）。 */
  delete(key: string): Promise<void>;
}

let instance: StorageProvider | null = null;

/** 取得 StorageProvider 單例（目前唯一實作：本地檔案系統，根目錄由 env.UPLOAD_DIR 決定）。 */
export function getStorageProvider(): StorageProvider {
  if (!instance) {
    instance = new LocalStorageProvider(env.UPLOAD_DIR);
  }
  return instance;
}
