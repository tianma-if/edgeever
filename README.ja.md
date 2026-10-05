<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="EdgeEver のロゴ" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>オープンソース、AI ネイティブ、Cloudflare 無料枠 / Docker で自前運用できる Evernote 代替ノート</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="GitHub Stars" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="GitHub Forks" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Docker Pulls" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Featured｜HelloGitHub" /></a>
    <a href="#スポンサーと支援"><img src="https://img.shields.io/badge/Sponsor-EdgeEver-ea4aaa?logo=github-sponsors" alt="スポンサーと支援" /></a>
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.md">English</a> | <b>日本語</b>
  </p>
  <p>
    <a href="https://t.me/+wwUx1BYLrIdiZjY1"><img src="assets/readme/community/telegram.svg" alt="Telegram" width="16" height="16" align="absmiddle" /> Telegram グループ</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 オンラインデモ</a> &nbsp;|&nbsp;
    <a href="#クライアントのダウンロード">📱 ダウンロード</a> &nbsp;|&nbsp;
    <a href="docs/best-practices.md">✨ 活用シーンとショーケース</a>
  </p>
</div>



EdgeEver は、オープンソースのノートと知識ベースの作業領域です。Evernote の三ペインを残しつつ、データを自分で持ち、AI Agent と連携できます。

> 💡 **サーバーレス、ずっと無料**
> EdgeEver は Cloudflare の無料枠内で動かせ、サーバーを借りたり保守したりする必要はありません。VPS、NAS、自宅サーバーを使いたい場合は、同じアプリを Docker で導入できます。

> ⭐ EdgeEver が役に立ったら、Star をお願いします。発見のきっかけになります。

## なぜ EdgeEver か

長年 **Evernote** を使ってきた人が欲しいのは、**信頼でき、開かれていて、速い**個人知識ベースです。よくある代替には、それぞれ代償があります。

* **Evernote**：広告と余分な機能で重くなり、書き出しが煩雑で、無料枠は狭く、AI / MCP は有料プランです。
* **Obsidian**：ファイルは開いていますが、コアはクローズドです。公式同期は有料、第三者同期は手間がかかります。フラットなローカルファイル走査に依存するため、ノートが数千・数万件に増えたりプラグインを重ねると起動や検索がもたつきます。画像と添付をノートと一緒に置くと保管庫が膨らみ、モバイル同期が遅く、削除後に添付が残りやすいです。気軽な取り込みには重いことがあります。
* **Memos などのタイムライン型**：簡潔ですが、三ペインの整理作業とはレイアウトが違います。
* **思源ノート（SiYuan）などのブロック型知識ベース**：高機能でオープンソースのセルフホストに対応していますが、徹底した「ブロック（Block）」構造により日常的な気軽なメモや流れるような文章作成には心理的負荷がやや高くなります。また、サーバー費用ゼロの Serverless 運用形態がなく、マルチデバイス同期は公式の有料サブスクリプション、または S3/WebDAV 同期機能を有料でアンロックして自前ストレージを用意する必要があります。

**EdgeEver はその隙間を埋めます。** 同期と自前運用を含めてスタック全体がオープンソースです。使い慣れた三ペインを残し、1万件のノートを抱えて常駐しても軽快でなめらか、ネイティブな AI Agent と無料で始められる導入もあります。

> 💡 **おすすめの使い方：**
> どの端末でも着想を取り込み、三ペインで深く整理します。ネイティブな MCP と ACP により、外部 Agent によるノートの検索・整理ができるほか、デスクトップ版ではマシン上のローカル AI Agent とも深く協調できます。体裁付きコピーでどこへでも出せます。データは自分のインスタンスに置き、本当に自分の第二の脳を持てます。

## オンラインデモ

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

公開デモは毎日 3:00（中国標準時）にリセットされ、サンプルノートが戻ります。非公開の内容は置かないでください。

## クライアントのダウンロード

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="macOS 向け EdgeEver をダウンロード" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="Windows 向け EdgeEver をダウンロード" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="Linux x86_64 AppImage Preview をダウンロード" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=ja"><img src="assets/readme/platforms/google-play.svg" alt="Google Play から Android 向け EdgeEver をダウンロード" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/jp/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="App Store から iOS 向け EdgeEver をダウンロード" width="40" height="40" /></a>
</p>

> iOS アプリは、中国本土以外の Apple ID が必要です。

## ✨ 活用シーンとショーケース

マルチチャネルでの情報収集からビジュアル表現、チーム連携まで、EdgeEver は摩擦のないエンドツーエンドのワークフローを提供します：

- 💬 **全方位のクリッピングと蓄積**：macOS 版での[微信チャット履歴の一括取り込み](docs/best-practices.md#1-one-click-wechat-chat-history-archiving)；ブラウザ拡張による[小紅書ギャラリー](docs/best-practices.md#2-one-click-xiaohongshu-red-note-clipping)、[X (Twitter) 投稿と引用](docs/best-practices.md#3-one-click-x-twitter-post--quote-clipping)、[知乎の回答](docs/best-practices.md#4-one-click-zhihu-answer--column-article-clipping)、[Reddit ディスカッション](docs/best-practices.md#5-one-click-reddit-discussion-post-clipping)、[GitHub リポジトリ](docs/best-practices.md#8-one-click-github-repository-metadata-clipping) のワンクリック保存；スマホからの[画像](docs/best-practices.md#9-one-click-mobile-image-sharing-to-notes) や [微信記事](docs/best-practices.md#10-one-click-wechat-article-clipping-on-mobile) の直接共有。
- 🚀 **インテリジェントなビジュアル表現**：AI アシスタントへの指示だけで、編集可能な[マインドマップ・フローチャート・アーキテクチャ図](docs/best-practices.md#11-ai-conversational-generation-of-mind-maps-flowcharts--architecture-diagrams) や美しい[タイムラインインフォグラフィック](docs/best-practices.md#12-ai-powered-generation-of-professional-infographics) をその場で生成。
- 📊 **多次元データベースとオンライン集計**：プロンプトから[コンテンツ企画・人事名簿の多次元テーブル](docs/best-practices.md#13-instant-multi-dimensional-database-table-generation-via-ai-prompt) を構築し、ワンクリックで[一般公開の回答フォーム](docs/best-practices.md#14-one-click-public-online-form-collection-from-database-tables) を発行。
- ✍️ **クリエイター向けワンクリック配信**：[インライン CSS を保持した微信公式アカウントへのコピー](docs/best-practices.md#6-one-click-note-copy-to-wechat-official-account--blogs) や、AI RSS 日報からの[高解像度ポスター画像書き出し](docs/best-practices.md#7-ai-rss-daily-digest--elegant-image-poster-sharing) に対応。

👉 全 14 の実機スクリーンショットと解説を見る：**[完全な活用シーンとショーケースガイド](docs/best-practices.md)**

## 機能

- **導入方法を選べる**：Cloudflare の無料 Serverless、または VPS / NAS / 自宅サーバーの Docker。Cloudflare の無料保存の目安では、個人なら短いノート約 15 万、画像約 5 万。Docker の保存は必要に応じて伸ばせ、ノート数百万件と大きな画像庫にも足ります。
- **開かれたデータ、囲い込みなし**：標準 SQLite、REST API、MCP、CLI。知識は透明に保存され、特定アプリに縛られません。
- **欠損のない ZIP バックアップ**：Markdown、Front Matter、入れ子フォルダ、相対パスの添付、版履歴をまとめて書き出し、どこでも復元できます。
- **ネイティブな AI Agent 連携**：内蔵の MCP（Model Context Protocol）により、外部 AI Agent がノートを直接読み、整理できます。同時にデスクトップ版は ACP（Agent Client Protocol）により、このマシンで動作する AI Agent（Codex、Antigravity、Claude Code、WorkBuddy など）を直接呼び出して協調執筆が可能です。
- **自分の AI モデル**：OpenAI、Anthropic、Gemini 互換やサードパーティのリレーを接続して内蔵 Agent を駆動し、コンパニオンサイドバーやエディタ内で全文・選択範囲の要約、要点抽出、校正、翻訳、続きの執筆が行えます。
- **プラグイン API**： [Plugin API](docs/plugin-development.md) で拡張できます。
- **台数制限のない同期**：商用の端末数上限はありません。Web、PWA、ブラウザ経由で PC、タブレット、モバイルを同期します。
- **クラシックな三ペインとフォーカスモード**：ノートブックツリー、ノート一覧、広い編集領域。デスクトップではフォーカスモードもあります。
- **軽く、長く使えるデスクトップ**：ノートを切り替えても古い画像や本文をメモリに残さず、バックグラウンドに置いたあとも応答を保ちます。
- **入れ子ノートブック**：階層の深さに上限はありません。
- **ニュースレターとブログ向けの体裁付きコピー**：Markdown をインライン CSS のリッチテキストへ変換し、Substack、Medium、WordPress、ニュースレターへそのまま貼れます。
- **双方向エディタ**：デスクトップではリッチテキストと Markdown ソースを切り替えられます。
- **1 件のノート書き出し**：Markdown、HTML、PDF に書き出せます。
- **Mermaid の描画**：フローチャート、シーケンス、マインドマップをノート内で描画し、Markdown とリッチテキストの両方で編集可能なソースを残します。
- **視覚的な図のノート**：外部ツールを使わずに、ノート内でマインドマップ、フローチャート、アーキテクチャ図を直感的に作成・編集。構造化 IR により、内蔵アシスタントや外部 AI Agent が一言の指示で図を生成・編集でき、スマート自動レイアウト、マルチデバイス同期、ベクター書き出しにも対応。詳しくは [visual diagram notes design](docs/visual-diagram-notes.md) を参照。
- **版履歴**：過去の版を見て、戻せます。
- **公開共有**：ノートを公開し、いつでも止められます。必要なら共有リンクに自動生成のアクセスパスワードを付けられます。
- **微信公式アカウント記事の取り込み**：スマホから微信公式アカウントの記事を EdgeEver に共有すると、本文を取り出して編集できるノートにします。
- **微信チャット履歴の取り込み**：macOS 版では、微信でチャット履歴を「他のアプリへ転送 → EdgeEver」するだけで、会話全体を構造化ノートとして一括取り込めます。発言者、タイムライン、引用返信、絵文字を保持し、画像は自動で埋め込まれ、動画やファイルは添付ファイルに変換されます。[ベストプラクティスはこちら](docs/best-practices.md)。
- **クライアント側の画像圧縮**：アップロード前に WebP 圧縮し、よくある画像で 50%〜90% 小さくします。サーバー追加料金はかかりません。
- **汎用添付**：PDF、Office、zip、音声、動画をノートに付けてプレビューできます。分割アップロードとストリーミングで最大 1 GiB まで扱えます。
- **一括操作と並び替え**：複数ノートの結合や移動、ノートブックのドラッグ並べ替え。
- **オフライン下書きとキュー**：オフラインでも書け、復帰後に自動同期します。
- **総当たりログイン対策**：サーバー側でアカウントと IP の失敗を数え、冷却します。
- **複数アカウントの分離**：1 インスタンスで複数ユーザーをホストし、作業領域を分けます。
- **必要な場所すべて**：Web、[Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile&hl=ja)、[macOS](https://github.com/tianma-if/edgeever/releases)、[Windows](https://github.com/tianma-if/edgeever/releases/latest)、[Linux](https://github.com/tianma-if/edgeever/releases/latest)、[iOS](https://apps.apple.com/jp/app/edgeever/id6792625631)。Web Clipper は [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)、[Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)、[Firefox](https://addons.mozilla.org/ja/firefox/addon/edgeever-web-clipper/) に対応しています。

## 導入

Cloudflare が、サーバーを持たない導入の推奨です。VPS、NAS、自宅サーバーなら Docker も使えます。

Cloudflare のオンライン導入は、次のいずれかです。

### 方法 A: AI Agent で導入（推奨）

次のプロンプトを AI Agent（Codex、Claude、Cursor、WorkBuddy、Antigravity、OpenClaw、Hermes Agent など）へそのまま送ってください。実行中に GitHub や Cloudflare へのアクセスが求められたら、権限を確認して認可してください。

```text
GitHub と Cloudflare のオンライン操作だけで EdgeEver を導入してください:
1. Fork https://github.com/tianma-if/edgeever.
2. Cloudflare で D1 `edgeever` と R2 `edgeever-resources` を作成します。
3. Workers & Pages で Fork の `main` ブランチから `edgeever` という名前の Worker を作成します。
   リポジトリのルートを使い、Cloudflare Workers Builds の既定のデプロイコマンドを維持します。
   その API トークンに D1 の読み取り・編集権限があることを確認して Save and Deploy を選択します。
4. Worker の作成後、ユーザーが指定したパスワードを実行時 Secret
   `EDGE_EVER_AUTH_PASSWORD` に設定します
   （32 文字以上を推奨）。管理者ユーザー名の既定値は `admin` です。別の名前を指定された場合は、
   次のビルド前に Workers Builds 変数 `EDGE_EVER_AUTH_USERNAME` を設定します。
5. 再度ビルドし、`/api/health` と `/api/openapi.json` を確認してから、
   その管理者ユーザー名とパスワードでログインできることを確認します。
6. GitHub Actions の `Update deployed EdgeEver` を有効にし、一度手動実行して、
   Fork が今後の安定版と修正を自動で受け取れるようにします。
```

> 詳細な要件: [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md)。

### 方法 B: 手動のオンライン導入

ウェブ上の 6 手順で完了します。

1. **リポジトリを Fork**：GitHub 右上の **Fork** で、EdgeEver を自分のアカウントへ Fork します。
2. **Cloudflare リソースを作成**：D1 `edgeever` と R2 `edgeever-resources` を作ります。
3. **プロジェクトを取り込み、設定**：Cloudflare **Workers & Pages** で Fork の `main` ブランチから `edgeever` という名前の Worker を作成します。リポジトリのルートと、Cloudflare 上で実行される Workers Builds の既定のデプロイコマンドを使い、API トークンの D1 読み取り・編集権限を確認します。binding はデプロイコマンドが作るため、Fork 内のファイルは編集しないでください。
4. **管理者パスワードを準備**：管理者ログイン用パスワードを用意します。32 文字以上を推奨します。Worker 作成後、実行時 Secret `EDGE_EVER_AUTH_PASSWORD` に保存します。
5. **ビルドと確認**：Save and Deploy で Worker が作成され、ビルドが始まります。管理者 Secret がないため失敗した場合は、手順 4 の実行時 Secret を追加して再試行します。管理者ユーザー名の既定値は `admin` です。別の名前を使う場合は、再試行前に Workers Builds 変数 `EDGE_EVER_AUTH_USERNAME` を設定します。導入後に `/api/health` が `200` を返すことを確認し、設定した管理者ユーザー名とパスワードでログインします。
6. **自動更新を有効化**：Fork の **Actions** タブで **I understand my workflows, go ahead and enable them** を押し、**Update deployed EdgeEver** を一度手動実行して、今後の安定版と修正を自動で受け取れるようにします。

> 📖 手順と設定の詳細は [Online Deployment Guide](docs/deploy-cloudflare-button.md) を見てください。

> 💡 **ドメインとアクセス**：デプロイ完了後は、Cloudflare から自動で割り当てられる `*.workers.dev` ドメインでそのまま利用できるほか、Worker の **Settings → Domains & Routes** で独自のカスタムドメインを紐付けることもできます。

> 💡 **Cloudflare R2 の有効化**：Cloudflare R2 にはノート用途で足りる [無料保存枠](https://developers.cloudflare.com/r2/pricing/#free-tier) がありますが、先に R2 のサブスクリプションを有効にし、支払い方法を登録する必要があります。Cloudflare は [公式に](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) UnionPay、Visa、Mastercard などのカードと、PayPal、Apple Pay、Google Pay などを受け付けます。

### 方法 C: VPS または NAS で Docker

GitHub ホストのインストーラと公式 GHCR イメージを使います。

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

このコマンドは最新イメージを引き、管理者パスワードを生成し、Docker Compose で EdgeEver を起動します。

手動導入と設定は [Docker deployment guide](docs/deploy-docker.md) を見てください。

インストール後は既定で毎日自動更新されます。手動で更新する場合は、導入先のサーバーで `~/edgeever/update.sh` を実行してください。

---

## 複数アカウント

導入後、1 インスタンスで複数アカウントのログインができます。

インスタンス管理者は **プロフィール** -> **ユーザーアカウント** でメンバーの作成、無効化、パスワードリセットができます。メンバーごとにノートブック、ノート、添付、ゴミ箱、インポート / エクスポート、MCP トークンが分離されます。

## ブラウザ Web Clipper

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="Google Chrome 向け EdgeEver Web Clipper を入れる" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="Microsoft Edge 向け EdgeEver Web Clipper を入れる" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/ja/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="Firefox 向け EdgeEver Web Clipper を入れる" width="36" height="36" /></a>
</p>

- **スマートな本文抽出**：Web ページの本文を自動抽出し、クリーンな Markdown に変換。元記事の URL とクリップ日時を保持します。
- **選択テキストと画像のクリップ**：テキストを選択するか画像を右クリックして、ページ全体を保存することなく直接ノートとして保存できます。
- **SNS・コミュニティの高精度クリップ**：X（旧 Twitter）、小紅書（RED）、知乎（Zhihu）、Reddit、GitHub にネイティブ対応。ワンクリックで送信。
- **セルフホストへのプライベート直接通信**：クリップした内容は個人の EdgeEver インスタンスに直接送信され、第三者の中継サーバーを経由しません。

## コミュニティとフィードバック

- 不具合、機能要望、導入の問題: [GitHub Issues](https://github.com/tianma-if/edgeever/issues)
- コード貢献: [Contribution Guide](CONTRIBUTING.md) を読んでください。Fork を EdgeEver の導入にも使う場合、その `main` は導入専用にしてください。同期、開発、Pull Request は公式 `upstream/main` から切った別ブランチで行い、導入用 `main` では開発も Sync fork もしないでください。

### Telegram コミュニティ

EdgeEver の使い方、AI Agent の実例、費用対効果の高い / 無料の AI 資源、自動化の流れを話す場です。

👉 [EdgeEver の Telegram グループに参加](https://t.me/+wwUx1BYLrIdiZjY1)

## プラグインとテーマ

Web とデスクトップは機能プラグインとカスタムテーマに対応し、公式マーケット、GitHub、Manifest URL から手軽に導入でき、作業領域を通じて同期されます。開発者は `@edgeever/plugin-api` で拡張できます。詳細は [plugin development guide](docs/plugin-development.md) と [marketplace submission policy](docs/plugin-marketplace-policy.md) を参照してください。

## 技術スタック

- Bun workspace の monorepo。Web、API、公式サイト、共有型パッケージ。
- フロントエンド: Vite、React、React Router、TanStack Query、Tailwind CSS、shadcn/ui、Radix UI。
- エディタ: TipTap / ProseMirror と Markdown。PWA は vite-plugin-pwa、Workbox、Dexie。
- Android アプリ: `apps/mobile` の Expo + React Native。SQLite のローカル保存と差分同期。
- iOS アプリ: `apps/ios` のネイティブ SwiftUI（iOS 17+）。同梱の TipTap EditorBundle、GRDB のローカルミラー / outbox、Android に揃えたシェル。
- ネイティブデスクトップ: Electron + Rust sidecar。横断プラットフォームの操作感と、速いローカルデータ。SQLite でオフライン編集、復帰後の差分同期、ローカルバックアップ。
- Web Clipper: Manifest V3、Mozilla Readability、Turndown。Chrome、Microsoft Edge、Firefox。
- バックエンド: Hono / Zod の業務アプリ 1 式。REST API と Remote MCP。Cloudflare は Workers / D1 / R2、Docker は Bun / SQLite / ローカルファイルまたは S3。
- 公式サイト: `apps/site` の Astro 静的サイト。Cloudflare Pages に出せます。

## クイックスタート

```sh
bun install
bun run dev
```

ローカル開発は自動ログインします。新しいデータベースの初期アカウントは `owner` / `edgeever-local-dev` です。ログイン画面を試すときはログアウトしてください。

## リポジトリ構成

```text
apps/web          Vite + React フロントエンド、PWA、オフライン下書き、同期キュー
apps/extension    Chrome/Edge/Firefox Manifest V3 Web Clipper
apps/api          Cloudflare Worker + Hono API、MCP
apps/mobile       Expo + React Native の Android アプリ
apps/ios          ネイティブ SwiftUI の iOS アプリ（TipTap EditorBundle、GRDB）
apps/desktop      Electron のデスクトップシェル、preload、ネイティブ梱包
apps/site         Astro の公式サイト。独立して導入できます
packages/client   Web とモバイルで共有する API クライアント
packages/shared   共有型、Zod、TipTap / Markdown 変換
crates/desktop-sidecar
                   ローカル SQLite、オフラインデータ、バックアップ、リソースの Rust sidecar
scripts           Wrangler ラッパ、パスワード hash、CLI、MCP stdio、Evernote ENEX 取り込み
migrations        D1/SQLite 共用の、追加のみの migration
docs              アーキテクチャ、移行、導入の文書
.github/workflows Web、モバイル、iOS、デスクトップ梱包、導入、Release の CI
wrangler.toml     Cloudflare Workers、Assets、D1、R2 の設定
```

## 内容の形式

EdgeEver はノート本文を 3 つの形で持ちます。

```text
content_json      TipTap/ProseMirror 文書。エディタの正本
content_markdown  API、Agent、取り込み、書き出し
content_text      検索、要約、索引
```

**プロフィール** -> **インポートとエクスポート** から EdgeEver ZIP を書き出し、または取り込めます。`notes/` は Markdown として読め、持ち出せます。構造化データは EdgeEver インスタンス間の完全復元に使います。取り込みは関係ない対象データを残し、同じ EdgeEver ID の記録は上書きします。

## MCP

**プロフィール** -> **API / MCP** で API トークンを作成し、ワンクリックで Remote MCP 設定をコピーすることで、Claude Code、Cursor、Antigravity、OpenClaw などの AI Agent がアカウント権限の範囲内で知識ベースを安全に管理できます。テキストノート、図のノート（マインドマップ、フローチャート、アーキテクチャ図）、多次元テーブルノートの完全な CRUD に対応し、Agent はノートブック階層、タグ、添付ファイル、履歴バージョン、ノートテンプレート、AI 指示の管理も行えます。

> 💡 **着想：**
> AI を知識の整理役と創作の相棒にしてください。構想をインタラクティブなマインドマップ、フローチャート、アーキテクチャ図、多次元テーブルへ瞬時に落とし込み、Agent に私有の文脈を渡せます。EdgeEver のリッチテキストと美しい体裁と組み合わせることで、AI が手伝った内容は、整った、いつでも配布できる高品質な知識資産になります。

## 画像圧縮

画像圧縮は Web クライアントがアップロード前に行い、**ノート内画像を圧縮** の設定で制御します。オンのとき、PNG、JPEG、WebP、AVIF は得があれば WebP にし、長辺を `2560px` までにします。小さくならなければ原ファイルを残します。

Worker 側の画像処理は避け、計算と画像処理枠を抑えます。REST API と MCP のアップロードは、クライアントが渡した内容を追加圧縮せず保存します。

## 高度なオブジェクトストレージ

インスタンスのオーナーは **設定 → 詳細 → OSS オブジェクトストレージ** で S3 互換ストレージを設定できます。切り替えは既存添付を移さず、影響しません。

## 移行

他のプラットフォームから EdgeEver へ移す場合は、次の短いガイドを見てください。

- **Evernote からの移行**: [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **flomo からの移行**: [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
- **Memos からの移行**: [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion からの移行**: [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Docker 導入

Docker は Cloudflare と同じフロントエンド、API、サービス、認証、MCP、migration です。コンテナは SQLite と、ローカルファイルまたは S3 互換の添付保存を使い、`amd64` と `arm64` に対応します。 [Deploy EdgeEver with Docker](docs/deploy-docker.md) と [Self-hosting and Docker architecture](docs/self-hosting-architecture.md) を見てください。

## 同期のタイミング

Web、PWA、デスクトップは、編集が 30 秒止まったあとでノートをアップロードし、表示中は 5 分ごとに遠隔の変更を見ます。フォーカスと手動更新はすぐです。`DEFERRED_MEMO_SYNC_DELAY_MS` と `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS` は [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts) で変えられます。

## スポンサーと支援

EdgeEver は無料のオープンソースプロジェクトです。クロスプラットフォームクライアント（macOS、Windows、Linux、iOS、Android）の継続的な開発、実機テスト、コード署名、複数ランタイムのエコシステム維持には、継続的な時間とリソースの投入が必要です。

- [EdgeEver を支援する](docs/sponsor.md) — WeChat Pay または Alipay による自发的な寄付
- [スポンサーとパートナー](docs/partners.md) — インフラ、開発ツール、サービス、コミュニティ連携の支援

## 謝辞

- ノート製品の設計は、[Evernote](https://evernote.com/) や [Notion](https://www.notion.com/) など成熟したノートツールの公開されている製品体験も参考にしています。関連機能は EdgeEver が独自に設計し、実装しています。
- マインドマップと視覚的な図のノートは、[XMind](https://xmind.com/) と [ProcessOn](https://www.processon.com/) の公開されている製品体験を参考にしています。関連機能は EdgeEver が独自に設計し、実装しています。

## 商標とブランド

EdgeEver の名称、ロゴ、その他のブランド表示は公式プロジェクトを区別します。Fork や改変版は EdgeEver に基づくと述べられますが、公式であるように装ったり、利用者を誤認させたりしてはなりません。オープンソースライセンスは商標権を与えません。ほかの利用は、メンテナの事前の書面による許可が必要です。

## 免責

EdgeEver は、個人とコミュニティが開発・維持する独立したオープンソースのノートアプリです。Evernote Corporation およびその関係会社と提携、認可、後援、推奨の関係はありません。

EdgeEver はセルフホスト型ソフトウェアです。公式デモを除き、メンテナはユーザー内容をホスト、管理、審査しません。インスタンスに保存または表示される内容は、その利用者または運用者の責任であり、メンテナの見解ではありません。
