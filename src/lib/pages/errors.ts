/** 樂觀鎖版本衝突（savePage）；attrs 帶目前版本號供前端提示重載。 */
export class VersionConflictError extends Error {
  constructor(public currentVersionNo: number) {
    super("VERSION_CONFLICT");
    this.name = "VersionConflictError";
  }
}
