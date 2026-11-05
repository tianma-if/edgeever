export const alternativePageCopy = {
  "zh-CN": {
    eyebrow: "自托管笔记",
    title: "自托管印象笔记替代方案：Cloudflare 或 Docker",
    description:
      "EdgeEver 是开源、原生支持 AI 的自托管笔记工作区。保留印象笔记式三栏布局，可在 Cloudflare 免费额度内运行，或用同一套应用在 VPS、NAS、家庭服务器上 Docker 部署。",
    lead: [
      "EdgeEver 面向长期使用印象笔记、只想要一个可靠、开放、可自己部署的个人知识库的人。整栈开源，数据在你控制的 SQLite 里，并提供 REST API、MCP 与 ENEX 迁移路径。",
      "它不是又一个时间流动的碎片笔记，也不是本地 Markdown 仓库。交互上接近经典三栏：笔记本树、笔记列表、编辑区。",
    ],
    fitTitle: "适合谁",
    fit: [
      "习惯印象笔记三栏，而不是时间流动或纯文件仓库。",
      "希望自托管，不想再为笔记 SaaS 和设备数量付费。",
      "希望用 Cloudflare 免费额度，或一行命令在 VPS / NAS 上跑 Docker。",
      "希望把笔记交给 Claude Code、Codex、WorkBuddy 等 Agent，通过原生 MCP 与桌面端 ACP 协同读写。",
    ],
    notFitTitle: "不适合谁",
    notFit: [
      "如果默认需要 Joplin 那种端到端加密，EdgeEver 并不以 E2EE 为卖点；安全边界是「实例由你托管」。",
      "如果需要 Notion 式数据库和块工作区，请继续用 Notion 或同类工具。EdgeEver 是笔记工作区。",
      "如果只要本地文件夹、完全不要服务端，Obsidian 或纯 Markdown 目录可能更合适。",
    ],
    compareTitle: "和常见方案差在哪",
    compareIntro:
      "Joplin 是英文社区最常见的自托管印象笔记替代。EdgeEver 更接近经典三栏，并同时提供 Cloudflare 免费额度和 Docker。下表只写仓库和公开文档里能核对的事实，不比较「谁全面更好」。",
    compareHeaders: ["", "托管", "布局", "客户端", "印象笔记导入"],
    compareRows: [
      ["EdgeEver", "Cloudflare 免费额度或 Docker", "三栏笔记本", "macOS / Windows / Linux / iOS / Android / 剪藏", "已文档化的 ENEX + MCP 流程"],
      ["印象笔记", "厂商云，不可自托管", "三栏笔记本", "全平台", "—"],
      ["Joplin", "Joplin Server 或自选同步", "笔记本", "官方多端", "支持 ENEX"],
      ["Obsidian", "本地文件；官方同步收费", "文件仓库", "全平台", "社区方案"],
      ["Memos", "可自托管", "时间流动卡片", "偏 Web", "不是同一条迁移路径"],
    ],
    pathsTitle: "接下来怎么做",
    paths: [
      {
        title: "Cloudflare 自托管",
        summary: "推荐给不想维护服务器的个人用户。个人规模大约可放 15 万条短笔记和 5 万张图片。",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "查看 Cloudflare 部署",
      },
      {
        title: "Docker 自托管",
        summary: "同一套应用，用一行命令装到 VPS、NAS 或家庭服务器，存储可按需扩展。",
        href: "/docker-deploy",
        cta: "查看 Docker 部署",
      },
      {
        title: "第三方笔记迁移",
        summary: "用原生一键导入或 EdgeEver MCP 迁移笔记本树、附件与时间戳，支持印象笔记、Obsidian、Joplin、Notion 等。",
        href: "/blog/note-migration-guide",
        cta: "查看迁移指南",
      },
    ],
    faqTitle: "常见问题",
    faqs: [
      {
        question: "什么是自托管印象笔记替代方案？",
        answer:
          "指你可以自己部署、数据留在自己账号或硬件上的笔记应用，交互上接近印象笔记的笔记本和三栏工作区。EdgeEver 按这个目标来做，并补上开源、MCP 与 Cloudflare / Docker 部署。",
      },
      {
        question: "可以用 Docker 跑吗？",
        answer:
          "可以。官方提供一行安装脚本和完整 Docker 指南，支持 amd64 / arm64，以及本地存储或 S3 兼容对象存储。Cloudflare 与 Docker 跑的是同一套应用。",
      },
      {
        question: "能导入印象笔记吗？",
        answer:
          "可以。文档化的流程使用 ENEX、evernote-backup 和 MCP 导入脚本，保留创建/修改时间与嵌套笔记本。导入后请抽查带图片的笔记。",
      },
      {
        question: "Cloudflare 个人使用真的免费吗？",
        answer:
          "可以运行在 Cloudflare 免费额度内，无需另买服务器。额度会随 Cloudflare 政策变化；超出后再升级或改用 Docker。",
      },
      {
        question: "有 iOS 和 Android 客户端吗？",
        answer:
          "有。Android 在 Google Play，iOS 在 App Store。iOS 目前需要非中国大陆 Apple ID。另有 Chrome / Edge / Firefox 剪藏扩展。",
      },
      {
        question: "EdgeEver 和印象笔记是什么关系？",
        answer:
          "没有关联、没有赞助。EdgeEver 只是开源替代方案，迁移指南只处理用户自己拥有的数据。印象笔记和 Evernote 是其权利人的商标。",
      },
    ],
  },
  "en-US": {
    eyebrow: "Self-hosted notes",
    title: "A self-hosted Evernote alternative with Docker and Cloudflare",
    description:
      "EdgeEver is an open-source, AI-native notes workspace with the classic Evernote three-pane layout. Run it on Cloudflare's free tier, or install the same app with Docker on a VPS, NAS, or home server.",
    lead: [
      "EdgeEver is for people who still want a reliable, open, self-hosted personal knowledge base. The stack is open source. Notes live in SQLite you control, with a REST API, MCP, and a documented Evernote ENEX migration path.",
      "It is not a social timeline and not a folder of local Markdown files. The workspace stays close to classic Evernote: notebook tree, note list, editor.",
    ],
    fitTitle: "Who it is for",
    fit: [
      "You want Evernote-style notebooks, not a timeline or a file vault.",
      "You want to self-host instead of paying a notes SaaS or hitting device caps.",
      "You want Cloudflare's free tier, or a one-line Docker install on a VPS or NAS.",
      "You want coding agents such as Claude Code, Codex, or WorkBuddy to read and organize notes through native MCP & ACP.",
    ],
    notFitTitle: "Who it is not for",
    notFit: [
      "If you need default end-to-end encryption like Joplin, EdgeEver does not advertise E2EE. The boundary is that you host the instance.",
      "If you need Notion-style databases and block workspaces, stay on Notion or a Notion-like app. EdgeEver is a notes workspace.",
      "If you only want local files and no server, Obsidian or a Markdown folder may fit better.",
    ],
    compareTitle: "How it differs from common options",
    compareIntro:
      "Joplin is the usual self-hosted Evernote alternative in English search results. EdgeEver is closer to the classic three-pane notes app, and it ships both Cloudflare free-tier hosting and Docker. The table only records facts that can be checked in this repository or in those products' public docs. It is not a ranking of which tool is better overall.",
    compareHeaders: ["", "Hosting", "Layout", "Clients", "Evernote import"],
    compareRows: [
      ["EdgeEver", "Cloudflare free tier or Docker", "Three-pane notebooks", "macOS / Windows / Linux / iOS / Android / clipper", "Documented ENEX + MCP flow"],
      ["Evernote", "Vendor cloud, not self-hosted", "Three-pane notebooks", "All major platforms", "—"],
      ["Joplin", "Joplin Server or your sync target", "Notebooks", "Official apps", "ENEX supported"],
      ["Obsidian", "Local files; official sync is paid", "File vault", "All major platforms", "Community tools"],
      ["Memos", "Self-hostable", "Timeline cards", "Web-first", "Not this migration path"],
    ],
    pathsTitle: "What to do next",
    paths: [
      {
        title: "Self-host on Cloudflare",
        summary: "The default for personal use if you do not want to run a server. A personal library typically fits about 150,000 short notes and 50,000 images.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Open the Cloudflare guide",
      },
      {
        title: "Self-host with Docker",
        summary: "The same application, installed with one command on a VPS, NAS, or home server. Storage scales with your disk or S3-compatible bucket.",
        href: "/docker-deploy",
        cta: "Open the Docker guide",
      },
      {
        title: "Migrate from Third-Party Notes",
        summary: "Use native one-click import or EdgeEver MCP to preserve notebook trees, attachments, and timestamps from Evernote, Obsidian, Joplin, Notion, and more.",
        href: "/blog/note-migration-guide",
        cta: "Open the migration guide",
      },
    ],
    faqTitle: "FAQ",
    faqs: [
      {
        question: "What is a self-hosted Evernote alternative?",
        answer:
          "A notes app you deploy yourself, with data in your account or on your hardware, and a workflow close to Evernote notebooks and the three-pane workspace. EdgeEver is built for that, plus open source, MCP, and Cloudflare or Docker hosting.",
      },
      {
        question: "Can I run it with Docker?",
        answer:
          "Yes. There is a one-line installer and a full Docker guide for amd64 and arm64, with local files or S3-compatible object storage. Cloudflare and Docker run the same application.",
      },
      {
        question: "Can I import Evernote notes?",
        answer:
          "Yes. The documented flow uses ENEX, evernote-backup, and an MCP import script. It preserves created/updated timestamps and nested notebooks. Spot-check notes with images after import.",
      },
      {
        question: "Is Cloudflare actually free for personal use?",
        answer:
          "A personal deployment can run within Cloudflare's free quotas, with no extra server to rent. Quotas follow Cloudflare's current limits; move to a paid plan or Docker if you outgrow them.",
      },
      {
        question: "Are there iOS and Android apps?",
        answer:
          "Yes. Android is on Google Play and iOS is on the App Store. The iOS app currently requires an Apple ID from outside mainland China. Web Clipper extensions are on Chrome, Edge, and Firefox.",
      },
      {
        question: "Is EdgeEver affiliated with Evernote?",
        answer:
          "No. EdgeEver is an independent open-source alternative. Migration guides only cover data you already own. Evernote is a trademark of its respective owner.",
      },
    ],
  },
  ja: {
    eyebrow: "セルフホストのノート",
    title: "Docker と Cloudflare で動く、セルフホストの Evernote 代替",
    description:
      "EdgeEver はオープンソースで AI ネイティブなノート作業領域です。Evernote の三ペインを残し、Cloudflare 無料枠か、VPS / NAS / 自宅サーバーの Docker で同じアプリを動かせます。",
    lead: [
      "長く Evernote を使い、信頼できて開かれていて、自分で置ける個人知識ベースが欲しい人向けです。スタックはオープンソース。ノートは自分で制御する SQLite にあり、REST API、MCP、文書化された ENEX 移行があります。",
      "タイムライン型の断片ノートでも、ローカル Markdown フォルダでもありません。ノートブックツリー、ノート一覧、編集エリアという古典的な三ペインです。",
    ],
    fitTitle: "向いている人",
    fit: [
      "タイムラインやファイル倉庫ではなく、Evernote 型のノートブックが欲しい。",
      "ノート SaaS や端末数の課金をやめ、自分でホストしたい。",
      "Cloudflare 無料枠か、VPS / NAS への Docker 一行インストールが欲しい。",
      "Claude Code や Codex、WorkBuddy などの Agent に、ネイティブ MCP や ACP でノートを連携させたい。",
    ],
    notFitTitle: "向いていない人",
    notFit: [
      "Joplin のような既定のエンドツーエンド暗号が必要なら、EdgeEver は E2EE を売りにしていません。境界は「インスタンスを自分でホストする」ことです。",
      "Notion 型のデータベースとブロック作業領域が必要なら、Notion か同類を続けてください。EdgeEver はノート作業領域です。",
      "サーバーなしのローカルフォルダだけでよければ、Obsidian や Markdown ディレクトリの方が合うことがあります。",
    ],
    compareTitle: "よくある選択肢との違い",
    compareIntro:
      "英語圏の検索では Joplin が定番の自前 Evernote 代替です。EdgeEver は古典的な三ペインに近く、Cloudflare 無料枠と Docker の両方を出しています。表はリポジトリと公開ドキュメントで確認できる事実だけです。総合ランキングではありません。",
    compareHeaders: ["", "ホスト", "レイアウト", "クライアント", "Evernote 取り込み"],
    compareRows: [
      ["EdgeEver", "Cloudflare 無料枠または Docker", "三ペインのノートブック", "macOS / Windows / Linux / iOS / Android / Clipper", "文書化された ENEX + MCP"],
      ["Evernote", "ベンダークラウド、自前不可", "三ペインのノートブック", "主要プラットフォーム", "—"],
      ["Joplin", "Joplin Server または任意の同期", "ノートブック", "公式マルチ端", "ENEX 対応"],
      ["Obsidian", "ローカルファイル。公式同期は有料", "ファイル倉庫", "主要プラットフォーム", "コミュニティ手段"],
      ["Memos", "自前運用可", "タイムラインのカード", "Web 中心", "同じ移行経路ではない"],
    ],
    pathsTitle: "次にすること",
    paths: [
      {
        title: "Cloudflare で自前運用",
        summary: "サーバーを持ちたくない個人向け。個人規模なら短いノート約 15 万、画像約 5 万が目安。",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Cloudflare 導入を見る",
      },
      {
        title: "Docker で自前運用",
        summary: "同じアプリを、VPS、NAS、自宅サーバーへ一行で入れられます。保存先はディスクや S3 互換バケットで伸ばせます。",
        href: "/docker-deploy",
        cta: "Docker 導入を見る",
      },
      {
        title: "サードパーティ製ノートの移行",
        summary: "ネイティブのワンクリックインポートまたは EdgeEver MCP を使い、Evernote、Obsidian、Joplin、Notion などの階層、添付、タイムスタンプを残します。",
        href: "/blog/note-migration-guide",
        cta: "移行ガイドを見る",
      },
    ],
    faqTitle: "よくある質問",
    faqs: [
      {
        question: "セルフホストの Evernote 代替とは何ですか？",
        answer:
          "自分で導入し、データは自分のアカウントか機材に置き、Evernote のノートブックと三ペインに近い作業領域を持つノートアプリです。EdgeEver はそのために作り、オープンソース、MCP、Cloudflare / Docker を足しています。",
      },
      {
        question: "Docker で動かせますか？",
        answer:
          "できます。一行インストーラと、amd64 / arm64、ローカル保存または S3 互換オブジェクトストレージの Docker ガイドがあります。Cloudflare と Docker は同じアプリです。",
      },
      {
        question: "Evernote を取り込めますか？",
        answer:
          "できます。文書化された流れは ENEX、evernote-backup、MCP 取り込みスクリプトです。作成・更新時刻と入れ子ノートブックを残します。画像付きノートは取り込み後に抜き取り確認してください。",
      },
      {
        question: "Cloudflare の個人利用は本当に無料ですか？",
        answer:
          "Cloudflare の無料枠内で動かせ、サーバーを別途借りる必要はありません。枠は Cloudflare の方針に従います。足りなくなったら有料プランか Docker へ移せます。",
      },
      {
        question: "iOS と Android アプリはありますか？",
        answer:
          "あります。Android は Google Play、iOS は App Store です。iOS は現時点で中国本土以外の Apple ID が必要です。Chrome / Edge / Firefox の Clipper もあります。",
      },
      {
        question: "EdgeEver と Evernote の関係は？",
        answer:
          "提携も後援もありません。EdgeEver は独立したオープンソースの代替です。移行ガイドは、すでに自分で持っているデータだけを扱います。Evernote は権利者の商標です。",
      },
    ],
  },
  pl: {
    eyebrow: "Samodzielnie hostowane notatki",
    title: "Samodzielnie hostowana alternatywa dla Evernote z Dockerem i Cloudflare",
    description:
      "EdgeEver to otwartoźródłowy, natywnie wspierający AI obszar roboczy do notatek z klasycznym trzypanelowym układem Evernote. Uruchom go w darmowym planie Cloudflare albo zainstaluj tę samą aplikację w Dockerze na VPS, NAS lub domowym serwerze.",
    lead: [
      "EdgeEver jest dla osób, które wciąż chcą niezawodnej, otwartej, samodzielnie hostowanej osobistej bazy wiedzy. Cały stos jest otwartoźródłowy. Notatki są przechowywane w kontrolowanej przez Ciebie bazie SQLite, z REST API, MCP i udokumentowaną ścieżką migracji ENEX z Evernote.",
      "To nie jest społecznościowa oś czasu ani folder lokalnych plików Markdown. Obszar roboczy pozostaje bliski klasycznemu Evernote: drzewo notatników, lista notatek, edytor.",
    ],
    fitTitle: "Dla kogo",
    fit: [
      "Chcesz notatników w stylu Evernote, a nie osi czasu czy magazynu plików.",
      "Chcesz hostować samodzielnie zamiast płacić za SaaS do notatek lub trafiać na limity urządzeń.",
      "Chcesz korzystać z darmowego planu Cloudflare albo zainstalować Dockera jedną linią na VPS lub NAS.",
      "Chcesz, by agenci programistyczni, tacy jak Claude Code, Codex czy WorkBuddy, czytali i porządkowali notatki przez natywne MCP i ACP.",
    ],
    notFitTitle: "Dla kogo nie",
    notFit: [
      "Jeśli potrzebujesz domyślnego szyfrowania end-to-end jak w Joplin – EdgeEver nie reklamuje E2EE. Granicą bezpieczeństwa jest to, że sam hostujesz instancję.",
      "Jeśli potrzebujesz baz danych i bloków w stylu Notion, zostań przy Notion lub podobnej aplikacji. EdgeEver to obszar roboczy do notatek.",
      "Jeśli chcesz tylko lokalnych plików bez serwera, lepiej sprawdzi się Obsidian lub folder z plikami Markdown.",
    ],
    compareTitle: "Czym różni się od popularnych opcji",
    compareIntro:
      "W anglojęzycznych wynikach wyszukiwania typową samodzielnie hostowaną alternatywą dla Evernote jest Joplin. EdgeEver jest bliższy klasycznej trzypanelowej aplikacji do notatek i oferuje zarówno hosting w darmowym planie Cloudflare, jak i Dockera. Tabela zawiera wyłącznie fakty, które można sprawdzić w tym repozytorium lub w publicznej dokumentacji tych produktów. Nie jest to ranking, które narzędzie jest ogólnie lepsze.",
    compareHeaders: ["", "Hosting", "Układ", "Klienty", "Import z Evernote"],
    compareRows: [
      ["EdgeEver", "Darmowy plan Cloudflare lub Docker", "Notatniki w trzech panelach", "macOS / Windows / Linux / iOS / Android / Clipper", "Udokumentowany proces ENEX + MCP"],
      ["Evernote", "Chmura dostawcy, bez samodzielnego hostingu", "Notatniki w trzech panelach", "Wszystkie główne platformy", "—"],
      ["Joplin", "Joplin Server lub wybrany cel synchronizacji", "Notatniki", "Oficjalne aplikacje", "Obsługa ENEX"],
      ["Obsidian", "Pliki lokalne; oficjalna synchronizacja jest płatna", "Magazyn plików", "Wszystkie główne platformy", "Narzędzia społeczności"],
      ["Memos", "Możliwy samodzielny hosting", "Karty na osi czasu", "Głównie web", "Nie ta ścieżka migracji"],
    ],
    pathsTitle: "Co dalej",
    paths: [
      {
        title: "Samodzielny hosting w Cloudflare",
        summary: "Domyślny wybór do użytku osobistego, jeśli nie chcesz utrzymywać serwera. Osobista biblioteka zwykle mieści ok. 150 000 krótkich notatek i 50 000 obrazów.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Otwórz poradnik Cloudflare",
      },
      {
        title: "Samodzielny hosting z Dockerem",
        summary: "Ta sama aplikacja instalowana jednym poleceniem na VPS, NAS lub domowym serwerze. Magazyn rośnie razem z dyskiem lub zasobnikiem zgodnym z S3.",
        href: "/docker-deploy",
        cta: "Otwórz poradnik Dockera",
      },
      {
        title: "Migracja z innych aplikacji",
        summary: "Użyj natywnego importu jednym kliknięciem lub EdgeEver MCP, aby zachować hierarchię notatników, załączniki i znaczniki czasu z Evernote, Obsidian, Joplin, Notion i innych.",
        href: "/blog/note-migration-guide",
        cta: "Otwórz poradnik migracji",
      },
    ],
    faqTitle: "Najczęstsze pytania",
    faqs: [
      {
        question: "Czym jest samodzielnie hostowana alternatywa dla Evernote?",
        answer:
          "To aplikacja do notatek, którą wdrażasz samodzielnie, z danymi na Twoim koncie lub sprzęcie i sposobem pracy bliskim notatnikom i trzypanelowemu obszarowi roboczemu Evernote. EdgeEver powstał właśnie w tym celu, a do tego jest otwartoźródłowy, obsługuje MCP i hosting w Cloudflare lub Dockerze.",
      },
      {
        question: "Czy mogę uruchomić go w Dockerze?",
        answer:
          "Tak. Dostępny jest instalator w jednej linii i pełny poradnik Dockera dla amd64 i arm64, z plikami lokalnymi lub magazynem obiektów zgodnym z S3. Cloudflare i Docker uruchamiają tę samą aplikację.",
      },
      {
        question: "Czy mogę zaimportować notatki z Evernote?",
        answer:
          "Tak. Udokumentowany proces wykorzystuje ENEX, evernote-backup i skrypt importu MCP. Zachowuje daty utworzenia i aktualizacji oraz zagnieżdżone notatniki. Po imporcie wyrywkowo sprawdź notatki z obrazami.",
      },
      {
        question: "Czy Cloudflare naprawdę jest darmowy do użytku osobistego?",
        answer:
          "Osobiste wdrożenie może działać w ramach darmowych limitów Cloudflare, bez wynajmowania dodatkowego serwera. Limity zależą od aktualnych zasad Cloudflare; jeśli przestaną wystarczać, przejdź na płatny plan lub Dockera.",
      },
      {
        question: "Czy są aplikacje na iOS i Androida?",
        answer:
          "Tak. Aplikacja na Androida jest w Google Play, a na iOS w App Store. Aplikacja na iOS wymaga obecnie Apple ID spoza Chin kontynentalnych. Rozszerzenia Web Clipper są dostępne dla Chrome, Edge i Firefox.",
      },
      {
        question: "Czy EdgeEver jest powiązany z Evernote?",
        answer:
          "Nie. EdgeEver to niezależna, otwartoźródłowa alternatywa. Poradniki migracji dotyczą wyłącznie danych, które już do Ciebie należą. Evernote jest znakiem towarowym swojego właściciela.",
      },
    ],
  },
  "zh-TW": {
    eyebrow: "自託管筆記",
    title: "自託管 Evernote 替代方案：Cloudflare 或 Docker",
    description:
      "EdgeEver 是開源、原生支援 AI 的自託管筆記工作區。保留 Evernote 式三欄佈局，可在 Cloudflare 免費額度內運行，或用同一套應用在 VPS、NAS、家用伺服器上 Docker 部署。",
    lead: [
      "EdgeEver 面向長期使用 Evernote、只想要一個可靠、開放、可自己部署的個人知識庫的人。整棧開源，資料在你控制的 SQLite 裡，並提供 REST API、MCP 與 ENEX 遷移路徑。",
      "它不是又一個時間流動的碎片筆記，也不是本地 Markdown 倉庫。互動上接近經典三欄：筆記本樹、筆記列表、編輯區。",
    ],
    fitTitle: "適合誰",
    fit: [
      "習慣 Evernote 三欄，而不是時間流動或純檔案倉庫。",
      "希望自託管，不想再為筆記 SaaS 和裝置數量付費。",
      "希望用 Cloudflare 免費額度，或一行指令在 VPS / NAS 上跑 Docker。",
      "希望把筆記交給 Claude Code、Codex、WorkBuddy 等 Agent，透過原生 MCP 與桌面端 ACP 協同讀寫。",
    ],
    notFitTitle: "不適合誰",
    notFit: [
      "如果預設需要 Joplin 那種端對端加密，EdgeEver 並不以 E2EE 為賣點；安全邊界是「實例由你託管」。",
      "如果需要 Notion 式資料庫和區塊工作區，請繼續用 Notion 或同類工具。EdgeEver 是筆記工作區。",
      "如果只要本機資料夾、完全不要伺服端，Obsidian 或純 Markdown 目錄可能更合適。",
    ],
    compareTitle: "和常見方案差在哪",
    compareIntro:
      "Joplin 是英文社群最常見的自託管 Evernote 替代。EdgeEver 更接近經典三欄，並同時提供 Cloudflare 免費額度和 Docker。下表只寫倉庫和公開文件裡能核對的事實，不比較「誰全面更好」。",
    compareHeaders: ["", "託管", "佈局", "客戶端", "Evernote 匯入"],
    compareRows: [
      ["EdgeEver", "Cloudflare 免費額度或 Docker", "三欄筆記本", "macOS / Windows / Linux / iOS / Android / 剪藏", "已文件化的 ENEX + MCP 流程"],
      ["Evernote", "廠商雲，不可自託管", "三欄筆記本", "全平台", "—"],
      ["Joplin", "Joplin Server 或自選同步", "筆記本", "官方多端", "支援 ENEX"],
      ["Obsidian", "本地檔案；官方同步收費", "檔案倉庫", "全平台", "社群方案"],
      ["Memos", "可自託管", "時間流動卡片", "偏 Web", "不是同一條遷移路徑"],
    ],
    pathsTitle: "接下來怎麼做",
    paths: [
      {
        title: "Cloudflare 自託管",
        summary: "推薦給不想維護伺服器的個人使用者。個人規模大約可放 15 萬則短筆記和 5 萬張圖片。",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "查看 Cloudflare 部署",
      },
      {
        title: "Docker 自託管",
        summary: "同一套應用，用一行指令裝到 VPS、NAS 或家用伺服器，儲存可按需擴展。",
        href: "/docker-deploy",
        cta: "查看 Docker 部署",
      },
      {
        title: "第三方筆記遷移",
        summary: "用原生一鍵匯入或 EdgeEver MCP 遷移筆記本樹、附件與時間戳記，支援 Evernote、Obsidian、Joplin、Notion 等。",
        href: "/blog/note-migration-guide",
        cta: "查看遷移指南",
      },
    ],
    faqTitle: "常見問題",
    faqs: [
      {
        question: "什麼是自託管 Evernote 替代方案？",
        answer:
          "指你可以自己部署、資料留在自己帳號或硬體上的筆記應用，互動上接近 Evernote 的筆記本和三欄工作區。EdgeEver 按這個目標來做，並補上開源、MCP 與 Cloudflare / Docker 部署。",
      },
      {
        question: "可以用 Docker 跑嗎？",
        answer:
          "可以。官方提供一行安裝指令碼和完整 Docker 指南，支援 amd64 / arm64，以及本地儲存或 S3 相容物件儲存。Cloudflare 與 Docker 跑的是同一套應用。",
      },
      {
        question: "能匯入 Evernote 嗎？",
        answer:
          "可以。已文件化的路徑包括 ENEX 檔案、evernote-backup 和 MCP 匯入指令碼，保留建立/修改時間與巢狀筆記本。有圖片附件的筆記建議匯入後抽檢驗證。",
      },
      {
        question: "Cloudflare 部署個人使用真的免費嗎？",
        answer:
          "EdgeEver 可在 Cloudflare 官方免費額度內運行，無需額外購買雲端伺服器。額度上限取決於 Cloudflare 政策；若超出額度可平滑切換至付費方案或 Docker 自託管。",
      },
      {
        question: "有 iOS 和 Android 客戶端嗎？",
        answer:
          "有。Android 客戶端已上架 Google Play，iOS 原生客戶端已上架 App Store（目前需非中國大陸 Apple ID 下載）。同時提供 Chrome / Edge / Firefox 剪藏外掛與桌面端。",
      },
      {
        question: "EdgeEver 與 Evernote 有官方關係嗎？",
        answer:
          "沒有任何官方關聯或授權。EdgeEver 是獨立的開源替代方案，遷移指南僅涉及使用者合法持有的筆記資料匯出與格式轉換。Evernote 是其所屬公司的註冊商標。",
      },
    ],
  },
  es: {
    eyebrow: "Notas autoalojadas",
    title: "Alternativa autoalojada a Evernote con Docker y Cloudflare",
    description:
      "EdgeEver es un espacio de trabajo de notas de código abierto con soporte nativo de IA y el clásico diseño de tres paneles de Evernote. Ejecútalo en el plan gratuito de Cloudflare o despliega la misma aplicación en Docker sobre VPS, NAS o servidor privado.",
    lead: [
      "EdgeEver está pensado para quienes buscan una base de conocimiento personal fiable, abierta y que puedan alojar por sí mismos. Todo el stack es de código abierto. Tus notas residen en una base SQLite bajo tu control, con API REST, MCP y ruta documentada de migración ENEX desde Evernote.",
      "No es un muro de notas efímeras ni una carpeta local de archivos Markdown. Mantiene la experiencia de trabajo clásica: árbol de libretas, lista de notas y editor.",
    ],
    fitTitle: "Para quién es",
    fit: [
      "Prefieres la estructura de libretas estilo Evernote antes que muros cronológicos o almacenes de archivos.",
      "Quieres autoalojar tus notas sin pagar suscripciones SaaS ni topar con límites de dispositivos.",
      "Buscas aprovechar el plan gratuito de Cloudflare o desplegar con un solo comando Docker en VPS/NAS.",
      "Quieres que agentes de IA como Claude Code, Codex o WorkBuddy lean y organicen notas mediante MCP y ACP nativos.",
    ],
    notFitTitle: "Para quién no es",
    notFit: [
      "Si necesitas cifrado de extremo a extremo por defecto como en Joplin: EdgeEver no se promociona por E2EE, la frontera de seguridad es «tú alojas la instancia».",
      "Si buscas bases de datos y bloques modulares estilo Notion, es mejor seguir con Notion. EdgeEver es un espacio de trabajo de notas.",
      "Si solo buscas archivos locales sin servidor, Obsidian o una carpeta Markdown pueden ser más adecuados.",
    ],
    compareTitle: "En qué se diferencia de otras opciones",
    compareIntro:
      "En las búsquedas en inglés, Joplin es la alternativa autoalojada habitual a Evernote. EdgeEver se acerca más al clásico diseño de tres paneles y ofrece tanto despliegue gratuito en Cloudflare como en Docker. La tabla refleja únicamente hechos verificables en el repositorio y la documentación oficial.",
    compareHeaders: ["", "Alojamiento", "Diseño", "Clientes", "Importación de Evernote"],
    compareRows: [
      ["EdgeEver", "Plan gratuito Cloudflare o Docker", "Libretas en tres paneles", "macOS / Windows / Linux / iOS / Android / Clipper", "Proceso documentado ENEX + MCP"],
      ["Evernote", "Nube propietaria, no autoalojable", "Libretas en tres paneles", "Principales plataformas", "—"],
      ["Joplin", "Joplin Server o sincronización propia", "Libretas", "Apps oficiales", "Compatible con ENEX"],
      ["Obsidian", "Archivos locales; sync oficial de pago", "Bóveda de archivos", "Principales plataformas", "Herramientas comunitarias"],
      ["Memos", "Autoalojable", "Tarjetas en línea de tiempo", "Principalmente Web", "Ruta de migración diferente"],
    ],
    pathsTitle: "Siguientes pasos",
    paths: [
      {
        title: "Autoalojamiento en Cloudflare",
        summary: "La opción recomendada si no deseas mantener servidores. Capacidad para unas 150.000 notas cortas y 50.000 imágenes.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Ver guía de Cloudflare",
      },
      {
        title: "Autoalojamiento con Docker",
        summary: "La misma aplicación instalada con una sola línea en VPS, NAS o servidor doméstico, con almacenamiento ampliable en disco o S3.",
        href: "/docker-deploy",
        cta: "Ver guía de Docker",
      },
      {
        title: "Migración desde otras notas",
        summary: "Usa la importación nativa en un clic o EdgeEver MCP para conservar libretas, adjuntos y fechas desde Evernote, Obsidian, Joplin, Notion y más.",
        href: "/blog/note-migration-guide",
        cta: "Ver guía de migración",
      },
    ],
    faqTitle: "Preguntas frecuentes",
    faqs: [
      {
        question: "¿Qué es una alternativa autoalojada a Evernote?",
        answer:
          "Es una aplicación de notas que despliegas tú mismo, donde los datos quedan en tu propia cuenta o equipo, con una experiencia similar a las libretas y el espacio de tres paneles de Evernote. EdgeEver se diseñó para ese fin, añadiendo código abierto, MCP y opciones Cloudflare/Docker.",
      },
      {
        question: "¿Se puede ejecutar con Docker?",
        answer:
          "Sí. Hay un instalador de una sola línea y una guía completa para arquitecturas amd64 y arm64, con almacenamiento local o buckets compatibles con S3. Cloudflare y Docker ejecutan exactamente la misma aplicación.",
      },
      {
        question: "¿Puedo importar mis notas de Evernote?",
        answer:
          "Sí. El procedimiento documentado utiliza archivos ENEX, evernote-backup y scripts MCP, preservando fechas de creación, modificación y jerarquías de libretas. Se recomienda verificar las notas con imágenes tras la importación.",
      },
      {
        question: "¿El despliegue en Cloudflare es realmente gratuito para uso personal?",
        answer:
          "La instalación personal puede funcionar dentro de los límites gratuitos de Cloudflare sin contratar servidores. Los límites se rigen por la política de Cloudflare; si se superan, se puede pasar al plan de pago o a Docker.",
      },
      {
        question: "¿Existen aplicaciones para iOS y Android?",
        answer:
          "Sí. La aplicación de Android está en Google Play y la de iOS en App Store (requiere un Apple ID de fuera de China continental). También hay extensiones Web Clipper para Chrome, Edge y Firefox.",
      },
      {
        question: "¿EdgeEver está afiliado a Evernote?",
        answer:
          "No. EdgeEver es una alternativa independiente de código abierto. Las guías de migración solo gestionan los datos que ya te pertenecen. Evernote es una marca comercial de su respectivo titular.",
      },
    ],
  },
  de: {
    eyebrow: "Selbst gehostete Notizen",
    title: "Selbst gehostete Evernote-Alternative mit Docker & Cloudflare",
    description:
      "EdgeEver ist ein quelloffener, KI-nativer Notizarbeitsbereich mit dem klassischen Drei-Spalten-Layout von Evernote. Läuft im kostenlosen Cloudflare-Tarif oder mit derselben Anwendung via Docker auf VPS, NAS und Homeservern.",
    lead: [
      "EdgeEver richtet sich an alle, die eine zuverlässige, offene und selbst gehostete persönliche Wissensbasis suchen. Der gesamte Stack ist Open Source. Ihre Notizen liegen in einer von Ihnen kontrollierten SQLite-Datenbank, mit REST-API, MCP und dokumentierter ENEX-Migration aus Evernote.",
      "Es ist weder ein Social-Timeline-Feed noch ein reiner lokaler Markdown-Ordner. Der Arbeitsbereich bleibt dem klassischen Evernote treu: Notizbuchbaum, Notizliste und Editor.",
    ],
    fitTitle: "Für wen es gedacht ist",
    fit: [
      "Sie bevorzugen Notizbücher im Evernote-Stil anstelle von Timeline-Karten oder Datei-Tresoren.",
      "Sie möchten selbst hosten, statt für Notiz-SaaS und Gerätelimits zu bezahlen.",
      "Sie möchten den kostenlosen Cloudflare-Tarif nutzen oder Docker mit einem Befehl auf VPS/NAS installieren.",
      "Sie möchten, dass KI-Agenten wie Claude Code, Codex oder WorkBuddy Notizen über natives MCP und ACP lesen und ordnen.",
    ],
    notFitTitle: "Für wen es nicht gedacht ist",
    notFit: [
      "Wenn Sie standardmäßig Ende-zu-Ende-Verschlüsselung wie bei Joplin benötigen: EdgeEver bewirbt kein E2EE; die Sicherheitsgrenze lautet «Sie betreiben die Instanz selbst».",
      "Wenn Sie blockbasierte Datenbanken im Notion-Stil suchen, bleiben Sie bitte bei Notion. EdgeEver ist ein Notizarbeitsbereich.",
      "Wenn Sie ausschließlich lokale Dateien ohne Server wünschen, ist Obsidian oder ein Markdown-Ordner passender.",
    ],
    compareTitle: "Unterschiede zu bekannten Alternativen",
    compareIntro:
      "In englischen Suchergebnissen ist Joplin die gängigste selbst gehostete Evernote-Alternative. EdgeEver orientiert sich näher am klassischen Drei-Spalten-Workflow und bietet sowohl kostenloses Cloudflare-Hosting als auch Docker. Die Tabelle basiert auf überprüfbaren Fakten aus den jeweiligen Repositories und Dokumentationen.",
    compareHeaders: ["", "Hosting", "Layout", "Clients", "Evernote-Import"],
    compareRows: [
      ["EdgeEver", "Kostenloser Cloudflare-Tarif oder Docker", "Drei-Spalten-Notizbücher", "macOS / Windows / Linux / iOS / Android / Clipper", "Dokumentierter ENEX + MCP Workflow"],
      ["Evernote", "Hersteller-Cloud, kein Self-Hosting", "Drei-Spalten-Notizbücher", "Alle Hauptplattformen", "—"],
      ["Joplin", "Joplin Server oder eigene Sync-Ziele", "Notizbücher", "Offizielle Apps", "Unterstützt ENEX"],
      ["Obsidian", "Lokale Dateien; offizieller Sync kostenpflichtig", "Datei-Tresor", "Alle Hauptplattformen", "Community-Lösungen"],
      ["Memos", "Selbst hostbar", "Timeline-Karten", "Hauptsächlich Web", "Anderer Migrationspfad"],
    ],
    pathsTitle: "Nächste Schritte",
    paths: [
      {
        title: "Selbsthosting auf Cloudflare",
        summary: "Empfohlen für Einzelpersonen ohne Serverwartungsaufwand. Platz für ca. 150.000 kurze Notizen und 50.000 Bilder.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Cloudflare-Leitfaden lesen",
      },
      {
        title: "Selbsthosting mit Docker",
        summary: "Dieselbe Anwendung mit einem einzigen Befehl auf VPS, NAS oder Homeservern installieren, mit Speichererweiterung auf Festplatte oder S3.",
        href: "/docker-deploy",
        cta: "Docker-Leitfaden lesen",
      },
      {
        title: "Migration von anderen Notiz-Apps",
        summary: "Nativer 1-Klick-Import oder EdgeEver MCP zur Übernahme von Notizbuchhierarchien, Anhängen und Zeitstempeln aus Evernote, Obsidian, Joplin und Notion.",
        href: "/blog/note-migration-guide",
        cta: "Migrationsleitfaden lesen",
      },
    ],
    faqTitle: "Häufig gestellte Fragen",
    faqs: [
      {
        question: "Was ist eine selbst gehostete Evernote-Alternative?",
        answer:
          "Eine Notiz-App, die Sie selbst bereitstellen und deren Daten in Ihrem Konto oder auf eigener Hardware verbleiben, mit Notizbüchern und dem klassischen Drei-Spalten-Workflow. EdgeEver wurde genau dafür geschaffen und bietet Open Source, MCP sowie Cloudflare/Docker-Hosting.",
      },
      {
        question: "Kann ich EdgeEver mit Docker betreiben?",
        answer:
          "Ja. Es gibt ein 1-Zeilen-Installationsskript und eine ausführliche Docker-Anleitung für amd64 und arm64 mit lokalem Speicher oder S3-kompatiblem Objektspeicher. Cloudflare und Docker führen dieselbe Anwendung aus.",
      },
      {
        question: "Kann ich meine Notizen aus Evernote importieren?",
        answer:
          "Ja. Der dokumentierte Ablauf nutzt ENEX-Dateien, evernote-backup und MCP-Importschripte und übernimmt Erstellungs-/Änderungsdaten sowie verschachtelte Notizbücher. Notizen mit Bildern sollten stichprobenartig geprüft werden.",
      },
      {
        question: "Ist Cloudflare für die persönliche Nutzung wirklich kostenlos?",
        answer:
          "Für persönliche Nutzung reicht der offizielle kostenlose Cloudflare-Tarif aus, ohne dass Server gemietet werden müssen. Die Grenzen richten sich nach den Richtlinien von Cloudflare; bei Mehrbedarf kann auf Docker gewechselt werden.",
      },
      {
        question: "Gibt es Apps für iOS und Android?",
        answer:
          "Ja. Die Android-App ist auf Google Play verfügbar, die iOS-App im App Store (erfordert derzeit eine Apple-ID außerhalb Festlandchinas). Zudem gibt es Web Clipper für Chrome, Edge und Firefox.",
      },
      {
        question: "Besteht eine Verbindung zwischen EdgeEver und Evernote?",
        answer:
          "Nein. EdgeEver ist eine unabhängige Open-Source-Alternative. Die Migrationsleitfäden beziehen sich nur auf Daten, die Ihnen bereits gehören. Evernote ist eine Marke des jeweiligen Eigentümers.",
      },
    ],
  },
  fr: {
    eyebrow: "Notes auto-hébergées",
    title: "Alternative auto-hébergée à Evernote avec Docker & Cloudflare",
    description:
      "EdgeEver est un espace de travail de notes open source, natif IA et reprenant la disposition classique à trois volets d'Evernote. Déployez-le gratuitement sur Cloudflare ou sur VPS, NAS et serveur domestique avec Docker.",
    lead: [
      "EdgeEver s'adresse à ceux qui recherchent une base de connaissances personnelle fiable, ouverte et auto-hébergée. L'ensemble de la pile est open source. Vos notes sont conservées dans une base SQLite sous votre contrôle, avec API REST, MCP et migration documentée ENEX depuis Evernote.",
      "Ce n'est ni un fil d'actualité chronologique ni un simple dossier local de fichiers Markdown. Il préserve la productivité classique : arborescence de carnets, liste de notes et éditeur.",
    ],
    fitTitle: "À qui s'adresse EdgeEver",
    fit: [
      "Vous préférez la structure de carnets d'Evernote aux flux chronologiques ou aux dossiers de fichiers.",
      "Vous souhaitez auto-héberger vos notes sans payer d'abonnements SaaS ni subir de limites d'appareils.",
      "Vous voulez profiter du forfait gratuit de Cloudflare ou installer Docker en une seule commande sur un VPS/NAS.",
      "Vous souhaitez que des agents IA tels que Claude Code, Codex ou WorkBuddy lisent et organisent vos notes via MCP et ACP natifs.",
    ],
    notFitTitle: "À qui cela ne convient pas",
    notFit: [
      "Si vous exigez par défaut un chiffrement de bout en bout comme dans Joplin : EdgeEver ne met pas en avant le E2EE ; la frontière de sécurité est « vous hébergez votre propre instance ».",
      "Si vous recherchez des bases de données relationnelles et des blocs à la Notion, restez sur Notion. EdgeEver est un espace dédié aux notes.",
      "Si vous ne souhaitez aucun serveur et uniquement des fichiers locaux, Obsidian ou un répertoire Markdown sera plus adapté.",
    ],
    compareTitle: "En quoi EdgeEver se distingue-t-il",
    compareIntro:
      "Dans les résultats anglophones, Joplin est l'alternative auto-hébergée la plus courante à Evernote. EdgeEver reste plus fidèle au flux classique à trois volets et propose à la fois l'hébergement gratuit sur Cloudflare et Docker. Le tableau récapitule uniquement des faits vérifiables sur les dépôts et la documentation officielle.",
    compareHeaders: ["", "Hébergement", "Disposition", "Clients", "Import Evernote"],
    compareRows: [
      ["EdgeEver", "Forfait gratuit Cloudflare ou Docker", "Carnets à trois volets", "macOS / Windows / Linux / iOS / Android / Clipper", "Procédure documentée ENEX + MCP"],
      ["Evernote", "Cloud propriétaire, non auto-hébergeable", "Carnets à trois volets", "Toutes plateformes principales", "—"],
      ["Joplin", "Joplin Server ou synchronisation personnalisée", "Carnets", "Applications officielles", "Prend en charge ENEX"],
      ["Obsidian", "Fichiers locaux ; synchronisation officielle payante", "Coffre de fichiers", "Toutes plateformes principales", "Outils communautaires"],
      ["Memos", "Auto-hébergeable", "Cartes chronologiques", "Principalement Web", "Parcours de migration différent"],
    ],
    pathsTitle: "Étapes suivantes",
    paths: [
      {
        title: "Auto-hébergement Cloudflare",
        summary: "Le choix recommandé pour les particuliers sans serveur à gérer. Capacité d'environ 150 000 notes courtes et 50 000 images.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Consulter le guide Cloudflare",
      },
      {
        title: "Auto-hébergement avec Docker",
        summary: "La même application installée en une seule commande sur VPS, NAS ou serveur domestique, avec stockage extensible sur disque ou S3.",
        href: "/docker-deploy",
        cta: "Consulter le guide Docker",
      },
      {
        title: "Migration depuis d'autres applications",
        summary: "Import natif en un clic ou EdgeEver MCP pour conserver carnets, pièces jointes et horodatages depuis Evernote, Obsidian, Joplin et Notion.",
        href: "/blog/note-migration-guide",
        cta: "Consulter le guide de migration",
      },
    ],
    faqTitle: "Foire aux questions",
    faqs: [
      {
        question: "Qu'est-ce qu'une alternative auto-hébergée à Evernote ?",
        answer:
          "Une application de notes que vous déployez vous-même, avec des données hébergées sur votre compte ou votre matériel, et une expérience proche des carnets et des trois volets d'Evernote. EdgeEver a été conçu dans cet objectif, en y ajoutant l'open source, le support MCP et le déploiement Cloudflare/Docker.",
      },
      {
        question: "Puis-je l'exécuter avec Docker ?",
        answer:
          "Oui. Un installateur en une ligne et un guide Docker complet sont disponibles pour amd64 et arm64, avec stockage local ou compatible S3. Cloudflare et Docker exécutent exactement la même application.",
      },
      {
        question: "Puis-je importer mes notes Evernote ?",
        answer:
          "Oui. La méthode documentée utilise des fichiers ENEX, evernote-backup et des scripts MCP, tout en préservant les dates de création/modification et l'imbrication des carnets. Une vérification d'échantillons avec images est conseillée après l'import.",
      },
      {
        question: "L'hébergement Cloudflare est-il réellement gratuit pour un usage personnel ?",
        answer:
          "Une utilisation personnelle peut tout à fait fonctionner dans les quotas gratuits officiels de Cloudflare, sans louer de serveur. Les quotas dépendent de la politique de Cloudflare ; en cas de besoin, vous pouvez basculer sur Docker.",
      },
      {
        question: "Existe-t-il des applications iOS et Android ?",
        answer:
          "Oui. L'application Android est sur Google Play et l'application iOS sur l'App Store (nécessite actuellement un identifiant Apple hors Chine continentale). Des extensions Web Clipper existent aussi pour Chrome, Edge et Firefox.",
      },
      {
        question: "EdgeEver est-il affilié à Evernote ?",
        answer:
          "Non. EdgeEver est une alternative indépendante et open source. Les guides de migration ne s'appliquent qu'aux données qui vous appartiennent déjà. Evernote est une marque déposée de son propriétaire respectif.",
      },
    ],
  },
  ru: {
    eyebrow: "Self-hosted заметки",
    title: "Self-hosted альтернатива Evernote на Docker и Cloudflare",
    description:
      "EdgeEver — это рабочее пространство для заметок с открытым исходным кодом, нативной поддержкой ИИ и классическим трехпанельным интерфейсом Evernote. Запустите его в бесплатном тарифе Cloudflare или разверните то же приложение в Docker на VPS, NAS или домашнем сервере.",
    lead: [
      "EdgeEver создан для тех, кто ищет надежную, открытую и полностью подконтрольную личную базу знаний. Весь стек открыт. Заметки хранятся в вашей собственной базе SQLite с доступом по REST API, MCP и документированным переносом ENEX из Evernote.",
      "Это не социальная лента и не просто папка с файлами Markdown. Интерфейс повторяет проверенную продуктивность Evernote: дерево блокнотов, список заметок и редактор.",
    ],
    fitTitle: "Кому подходит",
    fit: [
      "Вам нужна структура блокнотов в стиле Evernote, а не таймлайны или хранилища файлов.",
      "Вы хотите автономный хостинг без абонентской платы за SaaS и ограничений на число устройств.",
      "Вы хотите использовать бесплатный лимит Cloudflare или запустить Docker одной командой на VPS/NAS.",
      "Вы хотите, чтобы ИИ-агенты (Claude Code, Codex, WorkBuddy) читали и систематизировали заметки через нативный MCP и десктопный ACP.",
    ],
    notFitTitle: "Кому не подходит",
    notFit: [
      "Если вам по умолчанию требуется сквозное шифрование, как в Joplin: EdgeEver не заявляет E2EE; граница безопасности в том, что инстанс развернут вами.",
      "Если вам нужны реляционные базы данных и блоки в стиле Notion: лучше остаться на Notion. EdgeEver — это пространство заметок.",
      "Если вам нужны только локальные файлы без сервера: Obsidian или папка с Markdown подойдут лучше.",
    ],
    compareTitle: "Чем отличается от аналогов",
    compareIntro:
      "В англоязычных материалах Joplin часто называют основной self-hosted альтернативой Evernote. EdgeEver ближе к классическому трехпанельному интерфейсу и поддерживает как бесплатный Cloudflare, так и Docker. В таблице приведены проверяемые факты из документаций, а не субъективные рейтинги.",
    compareHeaders: ["", "Хостинг", "Интерфейс", "Клиенты", "Импорт из Evernote"],
    compareRows: [
      ["EdgeEver", "Бесплатный Cloudflare или Docker", "Трехпанельные блокноты", "macOS / Windows / Linux / iOS / Android / Clipper", "Документированный процесс ENEX + MCP"],
      ["Evernote", "Облако вендора, без self-hosting", "Трехпанельные блокноты", "Все ключевые платформы", "—"],
      ["Joplin", "Joplin Server или свой синхросервер", "Блокноты", "Официальные клиенты", "Поддержка ENEX"],
      ["Obsidian", "Локальные файлы; платная официальная синхронизация", "Хранилище файлов", "Все ключевые платформы", "Инструменты сообщества"],
      ["Memos", "Доступен self-hosting", "Карточки в ленте", "Преимущественно Web", "Другой сценарий миграции"],
    ],
    pathsTitle: "Что дальше",
    paths: [
      {
        title: "Self-hosting на Cloudflare",
        summary: "Рекомендуемый выбор для личного использования без поддержки серверов. Вмещает около 150 000 коротких заметок и 50 000 картинок.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Открыть руководство по Cloudflare",
      },
      {
        title: "Self-hosting в Docker",
        summary: "То же приложение разворачивается одной командой на VPS, NAS или сервере дома с расширением на диске или в S3.",
        href: "/docker-deploy",
        cta: "Открыть руководство по Docker",
      },
      {
        title: "Миграция из других сервисов",
        summary: "Используйте нативный импорт в один клик или EdgeEver MCP для переноса структуры блокнотов, вложений и дат из Evernote, Obsidian, Joplin и Notion.",
        href: "/blog/note-migration-guide",
        cta: "Открыть руководство по миграции",
      },
    ],
    faqTitle: "Часто задаваемые вопросы",
    faqs: [
      {
        question: "Что такое self-hosted альтернатива Evernote?",
        answer:
          "Это приложение заметок, которое вы разворачиваете самостоятельно, где данные остаются на вашем оборудовании или в вашем аккаунте, а организация напоминает блокноты и 3-панельный интерфейс Evernote. EdgeEver создан для этого с открытым кодом, MCP и деплоем на Cloudflare/Docker.",
      },
      {
        question: "Можно ли запустить в Docker?",
        answer:
          "Да. Доступен установщик в одну команду и подробная инструкция для amd64 и arm64 с локальным диском или S3-хранилищем. Cloudflare и Docker запускают одно и то же приложение.",
      },
      {
        question: "Можно ли импортировать заметки из Evernote?",
        answer:
          "Да. Документированный процесс использует ENEX, evernote-backup и MCP-скрипты переноса с сохранением дат создания, правок и вложенных блокнотов. После импорта проверьте заметки с картинками.",
      },
      {
        question: "Cloudflare действительно бесплатен для личного использования?",
        answer:
          "Личный инстанс может работать в рамках бесплатных лимитов Cloudflare без аренды серверов. Лимиты зависят от политики Cloudflare; при превышении можно перейти на платный тариф или Docker.",
      },
      {
        question: "Есть ли мобильные клиенты для iOS и Android?",
        answer:
          "Да. Клиент Android есть в Google Play, а iOS — в App Store (на данный момент требуется Apple ID за пределами материкового Китая). Также есть Web Clipper для Chrome, Edge и Firefox.",
      },
      {
        question: "Связан ли EdgeEver с компанией Evernote?",
        answer:
          "Нет. EdgeEver — независимая альтернатива с открытым исходным кодом. Руководства по переносу касаются исключительно данных, которыми вы уже владеете. Evernote является товарным знаком правообладателя.",
      },
    ],
  },
} as const;
