/** 樂觀鎖版本衝突（savePage）；attrs 帶目前版本號供前端提示重載。 */
export class VersionConflictError extends Error {
  constructor(public currentVersionNo: number) {
    super("VERSION_CONFLICT");
    this.name = "VersionConflictError";
  }
}

/** 頁面搬移循環（movePage）：目標父節點位於被搬移頁面的子樹內（含自身）。 */
export class PageMoveCycleError extends Error {
  constructor() {
    super("MOVE_CYCLE");
    this.name = "PageMoveCycleError";
  }
}

/** 刪除被拒（M4-15 API delete_page）：頁面有未刪除子頁且未指定 recursive。 */
export class HasChildrenError extends Error {
  constructor(public childCount: number) {
    super("HAS_CHILDREN");
    this.name = "HasChildrenError";
  }
}
