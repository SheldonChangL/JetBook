/**
 * Fractional indexing（ADR-001）：在兩個排序鍵之間取中間鍵，
 * 插入/搬移只改動單一節點的 position，免重排兄弟節點。
 * 鍵為 base-62 字串，字典序即排序。
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function midChar(lo: number, hi: number): number {
  return Math.floor((lo + hi) / 2);
}

/**
 * 回傳嚴格介於 a、b 之間的鍵。a 為 null＝最前、b 為 null＝最後。
 * 演算法：逐位比較，必要時延長字串以取得中間值。
 */
export function positionBetween(a: string | null, b: string | null): string {
  const lo = a ?? "";
  const hi = b ?? "";
  let prefix = "";
  let i = 0;
  for (;;) {
    const loD = i < lo.length ? DIGITS.indexOf(lo[i]!) : 0;
    const hiD = i < hi.length ? DIGITS.indexOf(hi[i]!) : BASE;
    if (loD === hiD) {
      prefix += DIGITS[loD];
      i += 1;
      continue;
    }
    const mid = midChar(loD, hiD);
    if (mid > loD) {
      return prefix + DIGITS[mid];
    }
    // 相鄰：沿用低位並在下一位擴展（低位取 loD，於更深位補中間值）
    prefix += DIGITS[loD];
    i += 1;
    // 當 hi 在此位已耗盡，下一輪 hiD=BASE，可取得空間
  }
}
