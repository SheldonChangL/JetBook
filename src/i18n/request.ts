import { getRequestConfig } from "next-intl/server";

/**
 * 單語系設定：固定 zh-TW，不做路由前綴。
 * 新增語系時只需加入 messages/<locale>.json 並擴充 locale 解析邏輯。
 */
const LOCALE = "zh-TW";

export default getRequestConfig(async () => {
  return {
    locale: LOCALE,
    messages: (await import(`../../messages/${LOCALE}.json`)).default,
  };
});
