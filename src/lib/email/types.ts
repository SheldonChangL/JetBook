/**
 * 寄信共用型別。獨立於 index 之外，避免 provider 實作反向 import 造成循環相依。
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
