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
} as const;
