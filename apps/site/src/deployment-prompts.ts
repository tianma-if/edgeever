export const deploymentPrompts = {
  "en-US": `Deploy EdgeEver online:
1. Fork https://github.com/tianma-if/edgeever.
2. Import the Fork into Cloudflare Workers & Pages.
3. Create D1 \`edgeever\` and R2 \`edgeever-resources\`, set the
   \`EDGE_EVER_AUTH_PASSWORD\` Worker Secret, and configure the production \`main\` build.
4. Start the first build and verify \`/api/health\`, \`/api/openapi.json\`, and login.
5. Enable and manually run the GitHub Actions workflow named \`Update deployed EdgeEver\`
   once so the Fork can automatically receive the latest EdgeEver features and fixes.`,
  "zh-CN": `请在线完成 EdgeEver 部署：
1. Fork https://github.com/tianma-if/edgeever。
2. 将这个 Fork 导入 Cloudflare Workers & Pages。
3. 创建 D1 \`edgeever\` 与 R2 \`edgeever-resources\`，设置
   \`EDGE_EVER_AUTH_PASSWORD\` Worker Secret，并配置生产环境 \`main\` 构建。
4. 启动首次构建，验证 \`/api/health\`、\`/api/openapi.json\` 和登录。
5. 启用并手动运行一次名为 \`Update deployed EdgeEver\` 的 GitHub Actions 工作流，
   以便后续自动同步更新，持续获得 EdgeEver 最新的产品特性和问题修复。`,
} as const;

export const manualDeploymentCopy = {
  "en-US": {
    intro: "Complete setup in 5 simple web steps:",
    steps: [
      {
        title: "Fork the Repository",
        body: "Click Fork at the top right of GitHub to fork EdgeEver into your personal account.",
      },
      {
        title: "Enable Actions",
        body: "Open the Fork's Actions tab and click I understand my workflows, go ahead and enable them so the GitHub Actions workflow named Update deployed EdgeEver can run automatically, keeping you up to date with the latest EdgeEver features and fixes.",
      },
      {
        title: "Import into Cloudflare",
        body: "Log into the Cloudflare Dashboard, navigate to Workers & Pages, and choose to import your Fork repository.",
      },
      {
        title: "Create Resources & Credentials",
        body: "Create D1 edgeever and R2 edgeever-resources, then set the Worker Secret EDGE_EVER_AUTH_PASSWORD as your admin password. The deploy command creates the bindings; do not edit Fork files.",
      },
      {
        title: "Build & Verify",
        body: "Start the first build after importing the repository. Once complete, visit /api/health to verify a 200 response before logging in.",
      },
    ],
  },
  "zh-CN": {
    intro: "仅需在网页端完成 5 步极简配置：",
    steps: [
      {
        title: "Fork 仓库",
        body: "在 GitHub 点击右上角 Fork，将项目 Fork 到您的个人账户下。",
      },
      {
        title: "启用 Actions",
        body: "进入 Fork 的 Actions 标签页，点击 I understand my workflows, go ahead and enable them，确保名为 Update deployed EdgeEver 的 GitHub Actions 工作流能够自动运行，从而持续获得 EdgeEver 最新的产品特性和问题修复。",
      },
      {
        title: "导入 Cloudflare",
        body: "登录 Cloudflare 控制台，进入 Workers & Pages，选择导入该 Fork 仓库。",
      },
      {
        title: "创建资源与登录凭据",
        body: "创建 D1 edgeever 与 R2 edgeever-resources，并添加 Worker Secret EDGE_EVER_AUTH_PASSWORD 作为管理员登录密码。binding 由部署命令生成，不要修改 Fork 中的文件。",
      },
      {
        title: "启动构建与验证",
        body: "导入仓库后直接启动首次构建。部署完成后访问 /api/health，确认返回 200 即可开始使用。",
      },
    ],
  },
} as const;
