const schemes = ["optic", "archive"];
const screens = ["dashboard", "reading", "editor", "search"];
const themes = ["light", "dark"];

const labels = {
  optic: "Optic Grid／稜光格線",
  archive: "Archive Studio／知識工坊",
  dashboard: "Dashboard／空間總覽",
  reading: "文件閱讀工作區",
  editor: "區塊編輯器",
  search: "搜尋＋AI 工作層",
};

const pageTree = [
  ["⌁", "產品總覽", ""],
  ["⌄", "硬體安裝", ""],
  ["·", "環境需求", "indent-1"],
  ["·", "雷射模組安裝指南", "indent-1 current"],
  ["·", "散熱系統組裝", "indent-1"],
  ["⌄", "韌體與軟體", ""],
  ["·", "韌體燒錄流程", "indent-1"],
  ["·", "控制軟體設定", "indent-1"],
  ["›", "品質檢驗", ""],
  ["↗", "Redmine 專案", ""],
];

function logo(scheme) {
  if (scheme === "archive") {
    return `
      <svg viewBox="0 0 32 32" role="img" aria-label="Archive Studio JetBook 標誌">
        <path d="M4 5h20l4 5v17H4z" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>
        <path d="M8 10h16M8 15h16M8 20h10" stroke="var(--accent)" stroke-width="1.5"/>
        <path d="M22 5v6h6" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
      </svg>`;
  }

  return `
    <svg viewBox="0 0 32 32" role="img" aria-label="Optic Grid JetBook 標誌">
      <rect x="2" y="2" width="28" height="28" rx="5" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <path d="M7 23 15.5 7 25 23Z" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
      <path d="M9 19h14M11 15h10M13 11h5" stroke="var(--accent)" stroke-width="1.2"/>
      <circle cx="23.5" cy="9" r="2" fill="var(--accent)"/>
    </svg>`;
}

function archiveRail(screen) {
  const active = screen === "search" ? "search" : screen === "dashboard" ? "home" : "book";
  return `
    <aside class="archive-rail" aria-label="Archive Studio Command Rail">
      <div class="rail-mark">J</div>
      <button class="rail-item ${active === "home" ? "active" : ""}" aria-label="首頁">⌂</button>
      <button class="rail-item ${active === "book" ? "active" : ""}" aria-label="知識庫">▤</button>
      <button class="rail-item ${active === "search" ? "active" : ""}" aria-label="搜尋">⌕</button>
      <button class="rail-item" aria-label="AI 助手">✦</button>
      <button class="rail-item" aria-label="通知">◌</button>
      <div class="rail-bottom">
        <button class="rail-item" aria-label="設定">⚙</button>
        <span class="avatar">家豪</span>
      </div>
    </aside>`;
}

function topbar(scheme, screen) {
  const context =
    screen === "dashboard"
      ? "工作區 / 今日摘要"
      : screen === "search"
        ? "探索 / 搜尋與 AI"
        : "產品手冊 / 硬體安裝";

  return `
    <header class="app-topbar">
      <div class="brand">
        ${logo(scheme)}
        <span>JetBook<small>${scheme === "optic" ? "OPTICAL KNOWLEDGE GRID" : "KNOWLEDGE ARCHIVE"}</small></span>
      </div>
      <div class="topbar-context"><span class="chip accent">產品手冊</span><span>${context}</span></div>
      <div class="topbar-search" role="search"><span>⌕</span><span>搜尋頁面、附件或問 AI…</span><kbd>⌘K</kbd></div>
      <div class="top-actions">
        <button class="button" type="button">＋ 建立</button>
        <button class="icon-button active" type="button" aria-label="AI 助手">✦</button>
        <button class="icon-button" type="button" aria-label="3 則未讀通知">◉</button>
        <button class="icon-button" type="button" aria-label="切換深淺模式">◐</button>
        <span class="avatar">家豪</span>
      </div>
    </header>`;
}

function sidebar(screen) {
  const dashboard = screen === "dashboard";
  const search = screen === "search";
  const mainRows = dashboard
    ? [
        ["⌂", "工作台", "current"],
        ["▤", "所有空間", ""],
        ["◇", "收藏與最近", ""],
        ["♲", "回收桶", ""],
      ]
    : pageTree;

  return `
    <aside class="side-nav" aria-label="${dashboard ? "全域導航" : "產品手冊頁面樹"}">
      <div class="nav-head">
        <div class="nav-space"><span>${dashboard ? "◎" : "▣"}</span><span>${dashboard ? "知識工作台" : "產品手冊"}</span></div>
        <span class="chip">${dashboard ? "全域" : "全公司"}</span>
      </div>
      <div class="section-label">${dashboard ? "Workspace" : "Page tree"}</div>
      <nav class="nav-list">
        ${mainRows
          .map(
            ([icon, text, state]) =>
              `<div class="nav-row ${state} ${search && text === "產品總覽" ? "current" : ""}"><span>${icon}</span><span>${text}</span></div>`,
          )
          .join("")}
      </nav>
      ${
        dashboard
          ? `<div class="section-label">Collections</div>
             <nav class="nav-list">
               <div class="nav-row"><span>01</span><span>產品研發</span><span class="tiny">3</span></div>
               <div class="nav-row"><span>02</span><span>營運流程</span><span class="tiny">2</span></div>
               <div class="nav-row"><span>03</span><span>人員訓練</span><span class="tiny">4</span></div>
             </nav>`
          : `<div class="section-label">Views</div>
             <nav class="nav-list">
               <div class="nav-row"><span>⌕</span><span>篩選此空間</span><kbd>/</kbd></div>
               <div class="nav-row"><span>◇</span><span>最近更新</span></div>
             </nav>`
      }
      <div class="nav-footer">
        <div class="nav-row"><span>♲</span><span>回收桶</span><span class="chip warning">7</span></div>
        <div class="nav-row"><span>⚙</span><span>${dashboard ? "個人設定" : "Space 設定"}</span></div>
      </div>
    </aside>`;
}

function dashboardInspector() {
  return `
    <aside class="inspector" aria-label="今日脈動">
      <div class="inspector-head"><strong>今日脈動</strong><span class="chip">7 月 16 日</span></div>
      <section class="inspector-section">
        <h3>待處理</h3>
        <div class="metric"><span>未讀通知</span><strong>3</strong><small class="tiny">留言回覆、頁面 Mention</small><span class="chip accent">查看</span></div>
        <div class="metric"><span>轉檔工作</span><strong>2</strong><small class="tiny">Office 預覽處理中</small><span class="chip success">正常</span></div>
      </section>
      <section class="inspector-section">
        <h3>AI 使用量</h3>
        <div class="metric"><span>本月問答</span><strong>118 / 500</strong></div>
        <div class="progress"><span></span></div>
        <p class="tiny">LLM 與 BGE-M3 連線正常 · 剛剛檢查</p>
      </section>
      <section class="inspector-section">
        <h3>快速入口</h3>
        <div class="nav-row"><span>＋</span><span>建立新頁面</span></div>
        <div class="nav-row"><span>⇧</span><span>匯入 Word / Markdown</span></div>
        <div class="nav-row"><span>✦</span><span>從 AI 初稿開始</span></div>
      </section>
      <section class="inspector-section">
        <h3>系統狀態</h3>
        <p class="tiny">Web、Worker、Database、Backup</p>
        <span class="chip success">● 全部正常</span>
      </section>
    </aside>`;
}

function readingInspector() {
  return `
    <aside class="inspector" aria-label="頁面情境面板">
      <div class="inspector-head"><strong>頁面情境</strong><span class="chip">v18</span></div>
      <section class="inspector-section">
        <h3>本頁目錄</h3>
        <div class="toc-list">
          <span class="current">安裝前準備</span><span>工具與材料清單</span><span>安裝步驟</span><span>模組固定與接線</span><span>光軸校準</span><span>常見問題</span>
        </div>
      </section>
      <section class="inspector-section">
        <div class="section-head"><h3>留言 · 3</h3><span class="chip accent">新增</span></div>
        <div class="comment"><span class="avatar">美玲</span><div><strong>陳美玲</strong><p>LS-2 訓練連結已更新，請協助確認。</p><span class="tiny">12 分鐘前 · 回覆</span></div></div>
        <div class="comment"><span class="avatar">大明</span><div><strong>王大明</strong><p>扭力值與最新版 SOP 一致。</p><span class="tiny">昨天 · 已解決</span></div></div>
      </section>
      <section class="inspector-section">
        <button class="button ai" type="button">✦ 問 AI 關於此頁</button>
      </section>
    </aside>`;
}

function editorInspector() {
  return `
    <aside class="inspector" aria-label="編輯資訊">
      <div class="inspector-head"><strong>編輯資訊</strong><span class="chip success">已連線</span></div>
      <section class="inspector-section">
        <div class="status-card"><strong>你持有編輯鎖</strong><br><span class="tiny">11:24 取得 · 心跳正常 · 另 1 人檢視</span></div>
      </section>
      <section class="inspector-section">
        <h3>頁面設定</h3>
        <label class="field">頁面圖示<span class="field-value">🔦　選擇 emoji</span></label>
        <label class="field">固定連結<span class="field-value">laser-module-installation</span></label>
        <label class="field">父頁面<span class="field-value">硬體安裝</span></label>
      </section>
      <section class="inspector-section">
        <h3>插入內容</h3>
        <div class="nav-row"><span>▧</span><span>圖片或多個附件</span></div>
        <div class="nav-row"><span>▤</span><span>內嵌 Office / PDF</span></div>
        <div class="nav-row"><span>⌘</span><span>Mermaid / 程式碼</span></div>
        <div class="nav-row"><span>✦</span><span>AI 改寫選取內容</span></div>
      </section>
      <section class="inspector-section">
        <h3>衝突防護</h3>
        <p class="tiny">閒置 5 分鐘釋放；版本衝突時保留內容並提供複製變更。</p>
        <span class="chip warning">搶鎖需再次確認</span>
      </section>
    </aside>`;
}

function dashboardScreen() {
  return `
    <section class="workspace">
      <div class="workspace-scroll">
        <div class="page-heading">
          <div><span class="eyebrow">Wednesday / 16 July</span><h1 class="page-title">早安，家豪</h1><p class="page-subtitle">從上次離開的地方繼續，或跨空間探索最新知識。</p></div>
          <div class="action-cluster"><button class="button ai">✦ 問 JetBook</button><button class="button primary">＋ 新頁面</button></div>
        </div>
        <div class="dashboard-grid">
          <div class="dashboard-column">
            <section>
              <div class="section-head"><h2>繼續閱讀</h2><a href="#">查看全部 12 筆</a></div>
              <div class="doc-list">
                ${[
                  ["🔦", "雷射模組安裝指南", "產品手冊 · 10 分鐘前", "64%"],
                  ["🧰", "VPN 連線疑難排解", "IT SOP · 昨天 16:20", "22%"],
                  ["🧾", "出差費用報支辦法", "行政流程 · 昨天 09:15", "已讀"],
                  ["🔬", "光學鍍膜製程參數整理", "研發知識庫 · 3 天前", "41%"],
                ]
                  .map(
                    ([icon, title, meta, progress]) =>
                      `<div class="doc-row"><span class="doc-icon">${icon}</span><div><div class="doc-title">${title}</div><div class="doc-meta">${meta}</div></div><span class="chip">${progress}</span></div>`,
                  )
                  .join("")}
              </div>
            </section>
            <section>
              <div class="section-head"><h2>我的空間</h2><a href="#">管理 Collections</a></div>
              <div class="space-strip">
                ${[
                  ["▣", "產品手冊", "128 頁", "全公司"],
                  ["▤", "IT SOP", "56 頁", "全公司"],
                  ["⌬", "研發知識庫", "210 頁", "私人"],
                ]
                  .map(
                    ([icon, name, count, scope]) =>
                      `<div class="space-item"><span class="space-icon">${icon}</span><div><strong>${name}</strong><span class="tiny">${count}</span></div><span class="chip ${scope === "私人" ? "warning" : "accent"}">${scope}</span></div>`,
                  )
                  .join("")}
              </div>
            </section>
          </div>
          <div class="dashboard-column">
            <section>
              <div class="section-head"><h2>最近更新</h2><a href="#">依 Space 篩選</a></div>
              <div class="activity-list">
                ${[
                  ["美玲", "陳美玲更新了 雷射校準作業指引", "5 分鐘前"],
                  ["大明", "王大明回覆了 新人到職 IT 設定清單", "32 分鐘前"],
                  ["家豪", "你匯入了 DA005 使用手冊.docx", "1 小時前"],
                  ["志豪", "林志豪移動了 3 個頁面", "昨天"],
                  ["系統", "Office 預覽轉檔已完成", "昨天"],
                ]
                  .map(
                    ([name, text, time]) =>
                      `<div class="activity-row"><span class="avatar">${name.slice(0, 2)}</span><span>${text}</span><span class="tiny">${time}</span></div>`,
                  )
                  .join("")}
              </div>
            </section>
            <section>
              <div class="section-head"><h2>常用操作</h2></div>
              <div class="space-strip">
                <div class="space-item"><span class="space-icon">⇧</span><div><strong>匯入文件</strong><span class="tiny">Word / Markdown / ZIP</span></div></div>
                <div class="space-item"><span class="space-icon">⌕</span><div><strong>附件搜尋</strong><span class="tiny">PDF / Office / 圖片</span></div></div>
                <div class="space-item"><span class="space-icon">⚙</span><div><strong>管理後台</strong><span class="tiny">使用者與系統</span></div></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>`;
}

function readingScreen() {
  return `
    <section class="workspace">
      <div class="workspace-scroll">
        <div class="reading-canvas">
          <div class="breadcrumb"><span>產品手冊</span><span>/</span><span>硬體安裝</span><span>/</span><strong>雷射模組安裝指南</strong><span class="chip success">可編輯</span></div>
          <div class="page-heading">
            <div><span class="eyebrow">Hardware / Installation</span><h1 class="page-title">🔦 雷射模組安裝指南</h1></div>
            <div class="action-cluster"><button class="button primary">編輯 <kbd>E</kbd></button><button class="button">留言 3</button><button class="button">歷史 18</button><button class="button">•••</button></div>
          </div>
          <div class="article-meta"><span>最後更新 3 小時前</span><span>·</span><span>陳志豪</span><span class="chip">3 位貢獻者</span><span>·</span><span>約 6 分鐘</span><span class="chip accent">AI 已索引</span></div>
          <article class="article">
            <p>本指南說明 JO-L 系列雷射模組於整機組裝線上的標準安裝流程，涵蓋安裝前準備、模組固定與接線、光軸校準與允收判定。</p>
            <h2>安裝前準備</h2>
            <p>開始安裝前，請先確認工單上的模組型號與序號，並核對來料檢驗標籤。全程遵守無塵室 Class 10000 作業規範。</p>
            <div class="callout"><span>ⓘ</span><div>本文件適用於 JO-L200 / JO-L350 兩款模組。舊款 JO-L100 請參閱維護手冊。</div></div>
            <h2>工具與材料清單</h2>
            <table class="compact-table"><thead><tr><th>品項</th><th>規格</th><th>數量</th><th>備註</th></tr></thead><tbody><tr><td>六角扳手組</td><td>1.5–5 mm</td><td>1 組</td><td>校準座固定</td></tr><tr><td>扭力起子</td><td>0.6 N·m</td><td>1 支</td><td>鏡座螺絲</td></tr><tr><td>無塵手套</td><td>Class 100</td><td>2 雙</td><td>接觸光學件必戴</td></tr></tbody></table>
            <div class="attachment-row"><span class="doc-icon">PDF</span><div><strong>JO-L350_組裝圖面_R18.pdf</strong><div class="tiny">4.8 MB · 可線上預覽 · 版本 18</div></div><button class="button">預覽</button></div>
            <div class="mermaid-mini"><span class="flow-node">來料檢查</span><span>→</span><span class="flow-node">模組固定</span><span>→</span><span class="flow-node">光軸校準</span><span>→</span><span class="flow-node">允收</span><button class="chip accent">放大 100%</button></div>
          </article>
        </div>
      </div>
    </section>`;
}

function editorScreen() {
  return `
    <section class="workspace">
      <div class="workspace-scroll">
        <div class="editor-canvas">
          <div class="editor-status"><div><span class="chip success">● 已自動儲存 · 剛剛</span><span class="tiny">　版本 18 · 編輯鎖由你持有</span></div><div class="action-cluster"><button class="button">留言</button><button class="button">版本</button><button class="button primary">完成編輯 <kbd>⌘↵</kbd></button></div></div>
          <input class="title-input" aria-label="頁面標題" value="🔦 雷射模組安裝指南" readonly />
          <div class="editor-surface article">
            <span class="block-handle">⠿<br>＋</span>
            <p>本指南說明 <strong>JO-L 系列雷射模組</strong>於整機組裝線上的標準安裝流程，涵蓋安裝前準備、模組固定與接線、光軸校準與允收判定。</p>
            <h2>安裝前準備</h2>
            <p>開始安裝前，請先確認工單上的模組型號與序號，並核對來料檢驗標籤。</p>
            <div class="callout"><span>ⓘ</span><div>選取文字後可使用 <span class="chip ai">✦ AI 改寫</span>：更精簡、正式化、翻譯或修正文法。</div></div>
            <p>/</p>
            <div class="upload-zone"><span>⇧ 拖放圖片、PDF 或多個 Office 文件至此　·　支援貼上圖片</span></div>
            <div class="attachment-row"><span class="doc-icon">DOC</span><div><strong>雷射模組校準紀錄表.docx</strong><div class="tiny">轉換中 · 將產生 PDF 線上預覽</div></div><span class="chip warning">64%</span></div>
            <div class="mermaid-mini"><span class="flow-node">Tabs</span><span class="flow-node">摺疊</span><span class="flow-node">Stepper</span><span class="flow-node">Mermaid</span><span class="flow-node">Embed</span></div>
            <div class="slash-menu" role="listbox" aria-label="Slash 指令選單">
              <div class="slash-search"><div>⌕ 搜尋區塊：「表格」或 table</div></div>
              <div class="slash-group"><div class="slash-label">基本與進階</div>
                <div class="slash-item selected"><span>▦</span><div><strong>表格</strong><div class="tiny">插入可調整欄寬的表格</div></div><kbd>↵</kbd></div>
                <div class="slash-item"><span>⌘</span><div><strong>程式碼區塊</strong><div class="tiny">語法高亮與複製</div></div></div>
                <div class="slash-item"><span>▧</span><div><strong>圖片與附件</strong><div class="tiny">批次上傳、預覽與圖說</div></div></div>
                <div class="slash-item"><span>↯</span><div><strong>Mermaid 圖表</strong><div class="tiny">閱讀時可放大與拖曳</div></div></div>
                <div class="slash-item"><span>✦</span><div><strong>AI 寫作輔助</strong><div class="tiny">續寫、摘要、翻譯與改寫</div></div><span class="chip ai">AI</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function aiDrawer() {
  return `
    <aside class="ai-drawer" aria-label="AI 助手">
      <div class="ai-head"><strong>✦ JetBook AI</strong><div class="action-cluster"><span class="chip success">已連線</span><button class="icon-button">×</button></div></div>
      <div class="ai-history"><span>對話歷史：雷射模組校準</span><span>118 / 500 次</span></div>
      <div class="ai-thread">
        <div class="user-bubble">JO-L350 安裝完成後，光軸校準的允收標準是什麼？</div>
        <div class="assistant-answer"><strong>JO-L350 的校準需同時符合三項條件：</strong><br>1. X/Y 軸偏移均不超過 ±0.05 mm。<br>2. 量測功率落在工單設定值的 ±3%。<br>3. 連續三次量測結果差異小於 1.5%。<span class="citation">1</span><br><br>若任一條件不符，應回到模組固定步驟檢查扭力與鏡座方向。<span class="citation">2</span></div>
        <div class="source-card"><span class="doc-icon">1</span><div><strong>雷射模組安裝指南</strong><div class="tiny">光軸校準 · 相似度 92%</div></div></div>
        <div class="source-card"><span class="doc-icon">2</span><div><strong>JO-L350 品質允收規範</strong><div class="tiny">第 4.2 節 · 相似度 87%</div></div></div>
        <div class="stream-status"><span>◌</span><span>已找到 6 篇來源，正在補充例外處理…</span><button class="chip ai">■ 停止</button></div>
      </div>
      <div class="ai-composer"><div><span>追問、要求摘要，或貼上頁面連結…<br><small>Enter 送出 · Shift+Enter 換行</small></span><button class="icon-button active">↑</button></div></div>
    </aside>`;
}

function searchScreen() {
  return `
    <section class="workspace">
      <div class="search-main">
        <span class="eyebrow">Discovery / Full text + Semantic</span>
        <h1 class="page-title">搜尋整個知識庫</h1>
        <div class="search-box-large"><span>⌕</span><input value="雷射模組 校準" aria-label="搜尋關鍵字" readonly><span class="chip accent">18 筆結果</span></div>
        <div class="filter-bar"><span class="chip accent">全部</span><span class="chip">產品手冊</span><span class="chip">更新時間：一年內</span><span class="chip">類型：頁面＋附件</span><span class="chip ai">✦ 語意搜尋已啟用</span></div>
        <div class="section-head"><h2>頁面結果 · 14</h2><a href="#">依相關度排序</a></div>
        <div class="search-results">
          ${[
            [
              "🔦",
              "雷射模組安裝指南",
              "產品手冊 / 硬體安裝",
              "…完成模組固定後，執行光軸校準並依允收標準記錄量測結果。",
              "92%",
            ],
            [
              "✓",
              "JO-L350 品質允收規範",
              "品質系統 / 檢驗規範",
              "X/Y 軸偏移不超過 ±0.05 mm，量測功率須落在設定值 ±3%。",
              "87%",
            ],
            [
              "⚙",
              "雷射校準台操作與保養",
              "設備維護 / 校準設備",
              "校準台每日點檢、異常排除與年度保養程序。",
              "79%",
            ],
            [
              "🧾",
              "DA005 光學模組異常案例",
              "研發知識庫 / 問題分析",
              "彙整歷年偏軸、功率不足與鏡座鬆動案例。",
              "73%",
            ],
          ]
            .map(
              ([icon, title, path, excerpt, score]) =>
                `<div class="result-row"><span class="doc-icon">${icon}</span><div><strong>${title.replace("雷射", "<mark>雷射</mark>")}</strong><div class="tiny">${path}</div><p>${excerpt.replace("校準", "<mark>校準</mark>")}</p></div><span class="chip ai">語意 ${score}</span></div>`,
            )
            .join("")}
        </div>
        <section class="attachment-result">
          <div class="section-head"><h2>附件結果 · 4</h2><a href="#">顯示全部</a></div>
          <div class="attachment-row"><span class="doc-icon">PDF</span><div><strong>JO-L350_光軸校準紀錄_R18.pdf</strong><div class="tiny">產品手冊 / 雷射模組安裝指南 · 4.8 MB</div></div><button class="button">線上預覽</button></div>
          <div class="attachment-row"><span class="doc-icon">XLS</span><div><strong>2026Q2_雷射模組量測數據.xlsx</strong><div class="tiny">研發知識庫 / DA005 驗證 · 2.1 MB</div></div><span class="chip warning">轉檔中</span></div>
        </section>
      </div>
    </section>`;
}

function renderApp({ scheme, screen, theme }) {
  const content =
    screen === "dashboard"
      ? dashboardScreen()
      : screen === "reading"
        ? readingScreen()
        : screen === "editor"
          ? editorScreen()
          : searchScreen();

  const context =
    screen === "dashboard"
      ? dashboardInspector()
      : screen === "reading"
        ? readingInspector()
        : screen === "editor"
          ? editorInspector()
          : aiDrawer();

  return `
    <article class="mock-app" data-scheme="${scheme}" data-screen="${screen}" data-theme="${theme}" aria-label="${labels[scheme]} ${labels[screen]} ${theme === "light" ? "淺色" : "深色"} mockup">
      ${archiveRail(screen)}
      ${topbar(scheme, screen)}
      <div class="app-body">
        ${sidebar(screen)}
        ${content}
        ${context}
      </div>
    </article>`;
}

function readState() {
  const params = new URLSearchParams(window.location.search);
  const scheme = schemes.includes(params.get("scheme")) ? params.get("scheme") : "optic";
  const screen = screens.includes(params.get("screen")) ? params.get("screen") : "dashboard";
  const theme = themes.includes(params.get("theme")) ? params.get("theme") : "light";
  return { scheme, screen, theme };
}

function writeState(state) {
  const params = new URLSearchParams(window.location.search);
  params.set("scheme", state.scheme);
  params.set("screen", state.screen);
  params.set("theme", state.theme);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function render() {
  const state = readState();
  const root = document.querySelector("#mock-root");
  root.innerHTML = renderApp(state);
  document.title = `${labels[state.scheme]} — ${labels[state.screen]} — ${state.theme}`;
  document.querySelectorAll("[data-control]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.value === state[button.dataset.control]),
    );
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("capture") === "1") document.documentElement.classList.add("capture");

  document.querySelectorAll("[data-control]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = readState();
      state[button.dataset.control] = button.dataset.value;
      writeState(state);
      render();
    });
  });

  window.addEventListener("popstate", render);
  render();
});
