import "server-only";
import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { StorageProvider } from "./provider";

/**
 * 本地檔案系統實作：所有檔案存於根目錄（env.UPLOAD_DIR）之下。
 * key 由上傳管線產生（UUID＋副檔名），仍防禦性阻擋路徑跳脫。
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** 解析 key 為根目錄下的絕對路徑；任何跳脫根目錄的 key 一律拒絕。 */
  private resolveKey(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error(`非法 storage key：${key}`);
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    // wx：檔案已存在即失敗——storage key 為一次性 UUID，絕不覆寫既有檔案
    await writeFile(target, data, { flag: "wx" });
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.resolveKey(key);
    await access(target); // 不存在時在此擲錯（createReadStream 的錯誤只在事件裡冒出）
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // 冪等
      throw error;
    }
  }
}
