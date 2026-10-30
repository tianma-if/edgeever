<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="EdgeEver Logo" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>AI 原生知識庫與 Evernote / Obsidian 替代方案，支援多端瞬時同步與原生 MCP。Cloudflare 免費代管或 Docker 自行託管</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="GitHub Stars" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="GitHub Forks" /></a>
    <a href="https://github.com/tianma-if/edgeever"><img src="https://img.shields.io/badge/Git_Clones-40K%2B%20%2F%2014d-brightgreen?style=social&logo=git" alt="Git 克隆量" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Docker Pulls" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Featured｜HelloGitHub" /></a>
    <a href="#贊助與支持"><img src="https://img.shields.io/badge/Sponsor-支持專案-ea4aaa?logo=github-sponsors" alt="贊助與支持" /></a>
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> | <b>繁體中文</b> | <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl-PL.md">Polski</a>
  </p>
  <p>
    <a href="#wechat-group"><img src="assets/readme/community/wechat.svg" alt="WeChat" width="16" height="16" align="absmiddle" /> 微信交流群</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 線上展示</a> &nbsp;|&nbsp;
    <a href="#全平台用戶端與瀏覽器外掛">📱 用戶端與外掛下載</a> &nbsp;|&nbsp;
    <a href="#features">核心功能與場景矩陣</a>
  </p>
  <p align="center">
    <img src="assets/readme/edgeever-hero-v6.png" alt="EdgeEver 產品工作區預覽" width="800" />
  </p>
</div>

EdgeEver 是一款現代化的開源筆記與個人知識庫工作區。它延續經典高效的三欄工作區體驗（目錄樹 · 筆記列表 · 編輯寫作），同時具備完全開放的資料架構與原生 AI Agent 聯動能力，讓個人知識沉澱更輕量、更自由。

> 💡 **終身免伺服器，100% 免費**
> EdgeEver 可以免費執行在 Cloudflare 配額內，無需購買或維護伺服器；希望使用 VPS、NAS 或家用伺服器的使用者，也可以透過 Docker 部署同一套應用程式。

> ⭐ 如果 EdgeEver 對你有幫助，歡迎點個 Star。你的支持會幫助更多人發現這個專案。

## 為什麼做 EdgeEver

很多**筆記與個人知識庫**的使用者，核心需求只是一個**可靠、開放、回應迅速**的個人知識庫。然而，當下的主流方案都各有痛點：

* **印象筆記 / Evernote**：擁有最無感、最絲滑的多端雲端同步體驗。然而隨著它演進為全功能商業套件，廣告與附加功能漸多，系統開銷也隨之走高；加之免費版配額收緊、高級 AI 訂閱昂貴，且難以靈活接入現代自託管與私有 AI 工作流。
* **Obsidian**：Markdown 開放，核心閉源；官方同步收費，第三方同步繁瑣；純本地檔案依賴遍歷掃描，當筆記累積到數千上萬條或載入複雜外掛後，冷啟動與全庫檢索明顯卡頓遲緩；圖片與附件與文字混存，儲存庫體積極易膨脹導致行動端同步緩慢，且刪除筆記後殘留附件難清理；對於「隨時隨地隨手記」的輕量場景來說偏重。
* **Joplin**：老牌開源三欄筆記，但介面觀感與編輯互動彷彿還停留在十幾年前，缺乏現代軟體的精緻與流暢感；官方高速同步（Joplin Cloud）需付費訂閱，免費同步若走 WebDAV 或雲端硬碟，受限於逐檔輪詢，筆記與附件增多後（尤其在行動端）同步緩慢，而自建 Joplin Server 又必須自備伺服器維護，缺少零成本 Serverless 方案；此外它沒有可在瀏覽器即開即用的完整 Web 工作區，也缺乏原生 AI Agent（MCP/ACP）與多模態知識型態。
* **Memos / Flomo 等輕量筆記**：雖然簡單好用，但時間軸卡片版面與習慣了經典「三欄工作流程」的使用者有著天然的互動習慣差異。
* **思源筆記等區塊級知識庫**：功能深厚且支援開源自託管，但全盤的「區塊級（Block）」架構使得日常隨手記錄與連續排版書寫的心智負擔偏重；且缺少零伺服器成本的 Serverless 部署型態，多端同步主要依賴官方付費訂閱，或需額外付費解鎖 S3/WebDAV 同步特性並自備儲存。

**EdgeEver 恰好填補了這一空白**：全端開源，提供真正**零感知、低延遲的多端瞬時雲端同步**，且全部服務均可免費自行託管；同時保留經典三欄版面與流暢排版，萬條筆記常駐依然輕盈絲滑，原生支援接入 AI Agent，部署維護零門檻、零費用。

## 線上展示

- Demo 網址：[https://demo.edgeever.org](https://demo.edgeever.org)

公開展示環境會在每天凌晨 3:00（北京時間）自動重設並還原範例筆記，請不要儲存私密內容。

## 全平台用戶端與瀏覽器外掛

### 用戶端下載

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="下載 macOS 用戶端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="下載 Windows 用戶端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="下載 Linux x86_64 AppImage 預覽版" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=zh-TW"><img src="assets/readme/platforms/google-play.svg" alt="從 Google Play 下載 Android 用戶端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/tw/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="從 App Store 下載 iOS 用戶端" width="40" height="40" /></a>
</p>

> iOS 用戶端需要使用非中國大陸區 Apple ID 下載。

### 瀏覽器網頁擷取外掛

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="為 Google Chrome 安裝 EdgeEver 網頁擷取外掛" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="為 Microsoft Edge 安裝 EdgeEver 網頁擷取外掛" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/zh-TW/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="為 Firefox 安裝 EdgeEver 網頁擷取外掛" width="36" height="36" /></a>
</p>

- 支援一鍵擷取網頁內文為純淨 Markdown，或選取文字與圖片精準儲存，直傳自託管執行個體。
- 深度適配 20+ 主流平台結構化擷取：涵蓋社群（X、小紅書、微信公眾號、即刻、豆瓣、Threads、Bluesky）、社群與資訊（知乎、Reddit、GitHub、V2EX、Hacker News、Medium、Substack）及影音播客（Bilibili、YouTube、小宇宙）等。

<a id="features"></a>
## 核心功能與場景矩陣

一站式連結「靈感擷取 · 深度創作 · 知識沉澱」的全能工作區（👉 **[查看 19 個實機案例展示與最佳實踐](docs/best-practices.zh-CN.md)**）：

| 模組 | 基礎功能 | 進階特性 |
| :--- | :--- | :--- |
| **寫作與編輯** | • 經典三欄工作區，面板寬度自由調節<br>• 富文字所見即所得與 Markdown 雙視圖切換<br>• 程式碼語法突顯、數學公式、待辦清單與專注模式<br>• 秒級自動儲存、多端瞬時同步與版本歷程回溯 | • **原生海報筆記**：畫布級圖文排版與視覺卡片，按兩下即改<br>• **微信公眾號一鍵排版**：一鍵轉內嵌樣式富文字直接貼上後台<br>• **高質感長圖分享**：質感主題海報與 Monogram 頭像，支援 MD/HTML/PDF 匯出 |
| **組織與檢索** | • 無限層級筆記本與目錄樹導覽<br>• 標籤體系（Tags）與筆記拖放排序、批次合併/移動<br>• 毫秒級即時全文搜尋與歷史記錄篩選 | • **獨立知識庫網站發布**：一鍵將整個筆記本公開發布為帶目錄樹導覽的獨立靜態網站（支援密碼保護）<br>• 多帳號與工作區多空間資料實體隔離 |
| **擷取與附件** | • 桌面與行動端全格式附件上傳（PDF、Office、影音等）<br>• 瀏覽器選取網頁文字與圖片精準擷取<br>• 手機系統分享一鍵轉存全網圖片與微信文章 | • **全渠道結構化擷取**：深度適配小紅書、X (Twitter)、知乎、Reddit、GitHub 等 20+ 平台<br>• **微信聊天記錄一鍵歸檔**：整段對話轉筆記，保留時間軸、引用、表情與附件<br>• **端側靜默壓縮**：圖片上傳前壓縮 50%–90%；分塊串流上傳安全支援最大 1 GiB 附件 |
| **資料與視覺化** | • 原生表格編輯與 Markdown 表格繪製<br>• 原生 Mermaid 流程圖、循序圖與架構圖繪製 | • **AI 多維表格**：自然語言一句話產生業務資料庫（含標籤、日期等欄位）<br>• **線上公開收集表單**：多維表格一鍵產生免登入外鏈表單，填報資料即時入庫<br>• **AI 智慧資訊圖與導圖**：一鍵產生時間線、對比圖、象限矩陣及心智圖 |
| **AI 與生態** | • 側邊伴隨式 AI 助手，選取範圍/全文一鍵摘要、翻譯與修飾潤色<br>• BYOK（自備金鑰）：相容 OpenAI、Anthropic、Gemini 等主流協定 | • **原生 Agent 協定互聯**：內建 MCP（外部 Agent 讀寫筆記）與 ACP（桌面端直接喚起本機 Agent 協同創作）<br>• **AI RSS 智慧訂閱日報**：定時聚合資訊來源，AI 自動過濾雜訊並產生精煉日報<br>• 開放外掛開發文件自由擴充 |
| **多端同步與底座** | • 電腦、手機全端秒級無感同步，無裝置數量限制<br>• 官方涵蓋 Web / macOS / Windows / Linux / iOS / Android 全平台<br>• 離線優先與同步佇列：斷網流暢寫作，連網自動復原並增量同步<br>• 標準 SQLite 儲存，無損 ZIP 封存與 Markdown 匯出匯入 | • **終身零伺服器成本**：100% 執行於 Cloudflare 免費配額（容量約 15 萬條短筆記與 5 萬張圖片）<br>• **彈性 Docker 自託管**：私有 VPS/NAS 一鍵部署，輕鬆承載百萬級筆記與瞬時同步<br>• 伺服端防暴力破解限流保護與安全資料隔離 |

## 部署

Cloudflare 是建議的零伺服器部署方式；希望使用 VPS、NAS 或家用伺服器的使用者也可以選擇 Docker。

Cloudflare 線上部署可以選擇以下兩種方式之一：

### 方案一：交給 AI Agent 部署（建議）

將下方提示詞直接複製傳送給 AI Agent（如 Codex、Claude、Cursor、WorkBuddy、Antigravity、OpenClaw、Hermes Agent 等）。執行過程中，如需存取 GitHub 或 Cloudflare，請確認權限範圍並依提示完成授權。

```text
請全程透過 GitHub 和 Cloudflare 線上部署 EdgeEver：
1. Fork https://github.com/tianma-if/edgeever。
2. 在 Cloudflare 中建立 D1 `edgeever` 與 R2 `edgeever-resources`。
3. 在 Workers & Pages 中從 Fork 的 `main` 分支建立名為 `edgeever` 的 Worker。
   使用儲存庫根目錄，保留 Cloudflare Workers Builds 的預設部署指令，確認其 API Token
   具備 D1 讀取及編輯權限，然後儲存並部署。
4. Worker 建立後，設定執行時 Secret `EDGE_EVER_AUTH_PASSWORD`，值為使用者指定的密碼
   （建議至少 32 個字元）。管理員使用者名稱預設為 `admin`；如需自訂，請在再次建置前
   設定 Workers Builds 建置變數 `EDGE_EVER_AUTH_USERNAME`。
5. 再次建置，驗證 `/api/health` 和 `/api/openapi.json`，再用該管理員
   使用者名稱和密碼驗證登入。
6. 啟用並手動執行一次名為 `Update deployed EdgeEver` 的 GitHub Actions 工作流程，
   以便後續自動同步正式版本，持續獲得 EdgeEver 的功能更新與問題修復。
```

> 詳細約定與要求請查看：[AI Agent 線上部署約定](docs/agent-deploy-cloudflare.zh-CN.md)。

### 方案二：手動線上部署

<details>
<summary>📖 展開查看：網頁端 6 步手動部署流程</summary>

只需在網頁端完成 6 步設定：

1. **Fork 儲存庫**：在 GitHub 點選右上角 **Fork**，將專案 Fork 到您的個人帳戶下。
2. **建立 Cloudflare 資源**：建立 D1 `edgeever` 與 R2 `edgeever-resources`。
3. **匯入並設定專案**：在 Cloudflare **Workers & Pages** 中從 Fork 的 `main` 分支建立名為 `edgeever` 的 Worker。使用儲存庫根目錄，保留由 Cloudflare 線上執行的 Workers Builds 預設部署指令，並確認其 API Token 具備 D1 讀取及編輯權限。binding 由部署指令產生，不要修改 Fork 中的檔案。
4. **準備管理員密碼**：準備管理員登入密碼，建議至少 32 個字元。Worker 建立後，將它儲存為執行時 Secret `EDGE_EVER_AUTH_PASSWORD`。
5. **首次建置與驗證**：儲存並部署會建立 Worker 並啟動建置。首次建置主要用於初始化實例，若因尚未配置管理員 Secret 而報錯屬於預期行為，只需在第 4 步新增執行時 Secret `EDGE_EVER_AUTH_PASSWORD` 後點擊重試建置即可通過。管理員使用者名稱預設為 `admin`；如需使用其他名稱，請在重試建置前設定 Workers Builds 建置變數 `EDGE_EVER_AUTH_USERNAME`。部署完成後造訪 `/api/health`，確認回傳 `200`，再用設定的管理員使用者名稱和密碼登入。
6. **啟用自動更新**：進入 Fork 的 **Actions** 分頁，點選 **I understand my workflows, go ahead and enable them**，然後手動執行一次 **Update deployed EdgeEver**，確保後續能夠自動獲得正式版本的功能更新與修復。

> 📖 包含具體參數與建置指令的詳細步驟，請查看 [線上部署完整文件](docs/deploy-cloudflare-button.zh-CN.md)。

</details>

<details>
<summary>📌 查看 Cloudflare 部署須知（自訂網域綁定與 R2 免費額度）</summary>

> **網域與存取**：實例部署完成後，可以直接使用 Cloudflare 預設分配的 `*.workers.dev` 網域存取，也可以在 Worker 設定中的 **Settings → Domains & Routes** 綁定自己的自訂網域。
>
> **Cloudflare R2 開通**：雖然 Cloudflare R2 儲存提供了足夠寬裕、在筆記場景中完全不會超量的[免費儲存額度](https://developers.cloudflare.com/r2/pricing/#free-tier)，但需先開通 R2 subscription 並綁定付款方式。Cloudflare [官方支援](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) 銀聯（UnionPay）、Visa、Mastercard 等金融卡與信用卡，以及 PayPal、Apple Pay、Google Pay 等付款方式。

</details>

### 方案三：在 VPS 或 NAS 上使用 Docker

Docker 與 Cloudflare 共用同一套前端、API 路由、業務服務、鑑權、MCP 實作和 migration。容器使用 SQLite，並支援本機檔案或 S3 相容附件儲存，提供 `amd64` 與 `arm64` 映像。詳見[使用 Docker 部署 EdgeEver](docs/deploy-docker.zh-CN.md)和[自行託管與 Docker 架構](docs/self-hosting-architecture.zh-CN.md)。

使用 GitHub 託管的安裝指令碼和官方 GHCR 映像：

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

此指令會自動拉取最新映像、產生管理員密碼，並使用 Docker Compose 啟動 EdgeEver。手動部署與設定說明見 [Docker 部署文件](docs/deploy-docker.zh-CN.md)。

安裝後預設每日自動更新。如需手動更新，請在部署伺服器上執行 `~/edgeever/update.sh`。

> 💡 **網路提示**：官方映像檔託管於 GitHub（GHCR）。若在部分網路環境下遇到拉取緩慢或逾時，請在部署前自行設定可用的網路代理或可信的映像檔加速服務。

---

## 進階設定與管理

### 資料匯入匯出與備份

無論是日常資料備份、跨實例無縫遷移，還是從既有筆記平台遷入，EdgeEver 均提供完整可靠的資料流轉方案：

- **EdgeEver 原生備份與還原**：在應用程式內進入 **個人中心** -> **匯入與匯出**，可隨時匯出或匯入 EdgeEver ZIP 封存檔。解壓縮後的 `notes/` 目錄保留清晰的純文字 Markdown 檔案與附件，可直接用於本機封存或獨立閱讀；內部結構化中繼資料則支援在不同 EdgeEver 實例間無損完整還原。匯入時保留目標實例的既有資料，同 ID 內容自動覆蓋更新。
- **第三方筆記平滑遷入**：
  - **Evernote（印象筆記）遷入**：請參考 [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
  - **flomo 筆記遷入**：請参考 [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
  - **Memos 筆記遷入**：請參考 [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
  - **Notion 筆記遷入**：請參考 [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

### AI 與 MCP 協定互聯

在 **個人中心** -> **API / MCP** 中建立 API Token 並一鍵複製 Remote MCP 設定，即可讓 Claude Code、Cursor、Antigravity、OpenClaw 等 AI Agent 在帳號授權範圍內安全管理你的知識庫。系統支援文字筆記、圖表筆記（心智圖、流程圖與架構圖）、多維表格筆記與原生海報筆記的完整增刪改查，Agent 還可管理筆記本目錄、標籤、附件、歷史版本、筆記範本與 AI 指令。

> 💡 **情境啟發：**
> 讓 AI 真正成為你的知識管家與創作外腦——不僅能將方案秒級產生為可互動的心智圖、流程圖、架構圖與多維表格，還能為 AI Agent 提供私有脈絡。憑藉 EdgeEver 強大的富文字編輯與精美排版能力，AI 協同沉澱的不再是冰冷文字，而是結構工整、排版優雅、隨時可一鍵分發的高品質知識資產。

### 多帳號登入與儲存管理

部署完成後，單一實例支援多帳號登入。

實例管理員可以在 **個人中心** -> **帳號管理** 中建立、停用成員帳號或重設密碼。每個成員擁有完全隔離的個人空間，包括筆記本、筆記、附件、回收筒、匯入匯出和 MCP Token 等。系統同時提供直觀的儲存用量面板，可即時掌握實例整體與各帳號的附件儲存占用明細。

### 儲存擴充與第三方圖床

- **OSS 物件儲存**：實例 Owner 可在**設定 → 進階設定 → OSS 物件儲存**中設定相容 S3 API 的物件儲存。切換儲存不會遷移或影響既有附件。
- **桌面端 PicGo 圖床**：桌面端可以把新插入的圖片交給本機或你信任的遠端 PicGo、PicList 服務（例如 NAS），再由它上傳到 GitHub、SM.MS、又拍雲、七牛雲或自建圖床。位址只需以 `/upload` 結尾，經過反向代理的 PicList 也能使用。
- **桌面端 CloudFlare ImgBed 圖床**：桌面端也可以用 API Token 把新插入的圖片直接上傳到你自建的 [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)。上傳目錄支援 `{Y}/{m}/{d}`、`{memoId}` 等 PicList 風格的佔位符。

### 外掛與個人化主題

Web 與桌面版支援功能外掛與個人化主題，可從官方市集、GitHub 或 Manifest 網址一鍵安裝，並隨工作區跨端同步。開發者可使用 `@edgeever/plugin-api` 擴充功能，詳情參閱[外掛開發文件](docs/plugin-development.zh-CN.md)與[官方外掛市集上架政策](docs/plugin-marketplace-policy.zh-CN.md)。

---

## 開發者指南與貢獻

### 快速開始

```sh
bun install
bun run dev
```

本機開發預設自動登入，首次帳號為 `owner` / `edgeever-local-dev`；測試登入頁可主動登出。

### 架構設計與技術棧

#### 技術棧選型

- Bun workspace monorepo，包含 Web、API、官網與共享型別套件。
- 前端：Vite、React、React Router、TanStack Query，UI 基於 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支援 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
- Android App：`apps/mobile` 中的 Expo + React Native，採用 SQLite 本機儲存與增量同步。
- iOS App：`apps/ios` 中的原生 SwiftUI（iOS 17+），內建 TipTap EditorBundle、GRDB 本機鏡像／outbox，介面與 Android 殼層對齊。
- 原生桌面版：Electron + Rust sidecar，兼顧跨平台一致體驗與高效能本機資料服務；基於 SQLite 支援離線編輯、連網後增量同步與本機備份。
- 網頁擷取：Manifest V3、Mozilla Readability、Turndown，支援 Chrome、Microsoft Edge 與 Firefox。
- 後端：一套基於 Hono/Zod 的業務應用，提供 REST API 與 Remote MCP；Cloudflare 使用 Workers/D1/R2，Docker 使用 Bun/SQLite/本機檔案或 S3。
- 官網：Astro 靜態網站，位於 `apps/site`，可獨立建置並部署到 Cloudflare Pages。

#### 目錄結構

<details>
<summary>📁 展開查看：Monorepo 專案目錄結構</summary>

```text
apps/web          Vite + React 前端、PWA、離線草稿與同步佇列
apps/extension    Chrome/Edge/Firefox Manifest V3 網頁擷取擴充功能
apps/api          Cloudflare Worker + Hono API、MCP endpoint
apps/mobile       Expo + React Native Android App
apps/ios          原生 SwiftUI iOS App（TipTap EditorBundle、GRDB）
apps/desktop      Electron 桌面版殼層、preload bridge 與原生打包設定
apps/site         Astro 官方網站，可獨立部署
packages/client   Web 與行動端共享的 API Client
packages/shared   共享型別、Zod schema、TipTap / Markdown 內容轉換
crates/desktop-sidecar
                   Rust sidecar，負責本機 SQLite、離線資料、備份與資源服務
scripts           Wrangler 封裝、密碼雜湊、CLI、MCP stdio bridge、Evernote ENEX 匯入
migrations        D1/SQLite 共用、只增不改的資料庫 migration
docs              架構、遷移與部署文件
.github/workflows Web、行動端、iOS、桌面版打包、部署與 Release 的 CI
wrangler.toml     Cloudflare Workers、Assets、D1、R2 設定
```

</details>

#### 資料儲存模型

EdgeEver 在資料庫中同時保存三種內容形態，以兼顧編輯效能、開放性與全庫檢索效率：

```text
content_json      TipTap/ProseMirror 文件，編輯器權威格式
content_markdown  API、Agent、匯入匯出與外部生態取用格式
content_text      全文搜尋、摘要與快速索引使用
```

### 核心機制與設計決策

- **端側靜默壓縮**：為避免在 Serverless（如 Cloudflare Worker）上執行圖片轉碼消耗寶貴的運算額度，圖片壓縮全部放在 Web 用戶端上傳前完成（PNG/JPEG/WebP/AVIF 轉 WebP，最大邊限制 2560px；不減小體積則保留原圖）。伺服端 REST API 與 MCP 介面直接入庫用戶端傳輸的原始內容。
- **離線優先與同步時序**：Web、PWA 與桌面版會在使用者停止編輯 30 秒後自動上傳增量，並在前景頁面可見時每 5 分鐘拉取一次雲端變更；視窗重新聚焦或手動重新整理時立即同步。開發者可在 [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts) 中調整相關時序常數（`DEFERRED_MEMO_SYNC_DELAY_MS` 與 `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS`）。

### 參與程式碼貢獻

我們非常歡迎社群貢獻！貢獻前請留意以下約定：

- 提交程式碼前請仔細閱讀 [貢獻程式碼須知](CONTRIBUTING.zh-CN.md)。
- **分支與部署隔離**：如果您的 GitHub Fork 同時用於線上部署 EdgeEver，請將 `main` 分支嚴格保留為唯讀部署分支；請從官方 `upstream/main` 建立新分支進行功能開發並提交 Pull Request，嚴禁在部署用的 `main` 分支上直接修改程式碼或執行 Sync fork。

---

## 社群與回饋

- **問題回饋與功能建議**：遇到 Bug、功能建議或部署疑問，請優先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便社群沉澱並檢索解決方案。

<hr>

<h3 id="wechat-group">微信交流群</h3>

歡迎加入 EdgeEver AI 交流群，這裡聚集了大量 Vibe Coding 與 AI 玩家。一起交流前沿 AI 生產力與個人知識庫的最佳實踐。

> 掃描下方 QR Code 或加入微信 `m1245207870`（備註「EdgeEver 進群」），群主將手動邀請入群。

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="微信聯絡人 QR Code" width="260" />
</p>

## 友情連結

- [LINUX DO](https://linux.do/) —— 技術交流與開源專案分享社群。

## 贊助與支持

EdgeEver 是免費開源專案。保持跨平台用戶端（macOS、Windows、Linux、iOS、Android）的持續演進、真機測試、憑證簽章以及多執行時期生態建設，都需要長期的精力與資源投入。

- [支持 EdgeEver](docs/sponsor.zh-CN.md) —— 透過微信支付或支付寶自願贊助
- [贊助商與合作夥伴](docs/partners.zh-CN.md) —— 支持基礎設施、開發工具、服務或社群合作

## 致謝

- EdgeEver 的筆記產品設計也參考了 [Evernote（印象筆記）](https://evernote.com/)、[Notion](https://www.notion.com/) 等成熟筆記工具的公開產品體驗。相關功能由 EdgeEver 獨立設計與實作。
- 心智圖與視覺化圖表筆記的產品設計參考了 [XMind](https://xmind.com/) 和 [ProcessOn](https://www.processon.com/) 等圖表工具的公開產品體驗。相關功能由 EdgeEver 獨立設計與實作。
- EdgeEver 的海報設計工作台借鑑了向阳乔木（joeseesun）的 [Qiaomu Design](https://github.com/joeseesun/qiaomu-cover-design)，並基於其 MIT 開源授權改編了範本與字型排版引擎。
- EdgeEver 圖片分享卡片的主題視覺與排版參考了 [流光卡片](https://fireflycard.shushiai.com/)，感謝其設計帶來的啟發。

## 商標與品牌使用

EdgeEver 名稱、Logo 及其他品牌識別用於識別官方專案。Fork 或修改版可以說明其「基於 EdgeEver」，但不得暗示官方身分或誤導使用者。開源授權不授予商標權利；其他使用須事先取得專案維護者的書面許可。

## 免責聲明

EdgeEver 是一款完全獨立的開源筆記軟體，由個人和社群自主開發維護。本專案與 Evernote®（印象筆記）及其關聯公司不存在任何商業合作、授權、贊助或隸屬關係。

EdgeEver 是自行託管軟體。除官方展示實例外，專案維護者不託管、控制或審核使用者內容。實例中儲存或展示的內容由使用者或實例營運者負責，不代表專案維護者的立場。

## 貢獻者

<!-- readme-contributors:start -->
<p align="left">
  <a href="https://github.com/tianma-if"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/5895871?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@tianma-if" /></a>
  <a href="https://github.com/dkoryto"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/2572180?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@dkoryto" /></a>
  <a href="https://github.com/sivdead"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/27731043?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@sivdead" /></a>
  <a href="https://github.com/thorufur"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/55167?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@thorufur" /></a>
  <a href="https://github.com/yulei666"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/7358439?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@yulei666" /></a>
  <a href="https://github.com/arsaboo"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/18319734?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@arsaboo" /></a>
  <a href="https://github.com/alyyasser"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/16476111?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@alyyasser" /></a>
  <a href="https://github.com/MadlyFX"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/4896705?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@MadlyFX" /></a>
  <a href="https://github.com/claude"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81847?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@claude" /></a>
  <a href="https://github.com/Crowszzz"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/75199133?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Crowszzz" /></a>
  <a href="https://github.com/CottonChou"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/17818375?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@CottonChou" /></a>
  <a href="https://github.com/Z-DDV"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/122068983?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Z-DDV" /></a>
  <a href="https://github.com/0xfelixli"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81979996?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@0xfelixli" /></a>
  <a href="https://github.com/Sergmay911"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/304439776?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Sergmay911" /></a>
  <a href="https://github.com/X77seven"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/171017641?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@X77seven" /></a>
  <a href="https://github.com/imgdown"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/348032096?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@imgdown" /></a>
  <a href="https://github.com/mookim-eth"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/97934198?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@mookim-eth" /></a>
  <a href="https://github.com/nzhdotme"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/9588882?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@nzhdotme" /></a>
  <a href="https://github.com/Shunamxiao"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/92215296?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Shunamxiao" /></a>
</p>
<!-- readme-contributors:end -->
