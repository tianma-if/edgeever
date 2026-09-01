export const deploymentPrompts = {
  "en-US": `Deploy EdgeEver online:
1. Fork https://github.com/tianma-if/edgeever.
2. Create D1 \`edgeever\` and R2 \`edgeever-resources\` in Cloudflare.
3. Import the Fork into Cloudflare Workers & Pages and use \`main\` as the production
   branch.
4. Add a Worker Secret named \`EDGE_EVER_AUTH_PASSWORD\`, using a password chosen by the
   user as its value. Prefer a strong password of at least 32 characters that is unique
   to this instance.
5. Start the first build, verify \`/api/health\` and \`/api/openapi.json\`, then verify login
   with username \`admin\` and the configured password.
6. Enable and manually run the GitHub Actions workflow named \`Update deployed EdgeEver\`
   once so the Fork can automatically receive the latest EdgeEver features and fixes.`,
  "zh-CN": `请在线完成 EdgeEver 部署：
1. Fork https://github.com/tianma-if/edgeever。
2. 在 Cloudflare 中创建 D1 \`edgeever\` 与 R2 \`edgeever-resources\`。
3. 将这个 Fork 导入 Cloudflare Workers & Pages，并将 \`main\` 设为生产分支。
4. 添加一个名为 \`EDGE_EVER_AUTH_PASSWORD\` 的 Worker Secret，值为用户自行设置的
   管理员登录密码，建议使用至少 32 个字符且仅用于此实例的强密码。
5. 启动首次构建，验证 \`/api/health\`、\`/api/openapi.json\`，并使用用户名 \`admin\`
   和配置的密码验证登录。
6. 启用并手动运行一次名为 \`Update deployed EdgeEver\` 的 GitHub Actions 工作流，
   以便后续自动同步更新，持续获得 EdgeEver 最新的产品特性和问题修复。`,
} as const;

export const manualDeploymentCopy = {
  "en-US": {
    intro: "Complete setup in 6 web steps:",
    steps: [
      {
        title: "Fork the Repository",
        body: "Click Fork at the top right of GitHub to fork EdgeEver into your personal account.",
      },
      {
        title: "Create Cloudflare Resources",
        body: "Create D1 edgeever and R2 edgeever-resources.",
      },
      {
        title: "Import & Configure the Project",
        body: "Import the Fork into Cloudflare Workers & Pages and use main as the production branch. The deploy command creates the bindings; do not edit Fork files.",
      },
      {
        title: "Set the Administrator Password",
        body: "Add a Worker Secret named EDGE_EVER_AUTH_PASSWORD and set its value to your chosen administrator login password. Prefer a strong password of at least 32 characters that is unique to this instance.",
      },
      {
        title: "Build & Verify",
        body: "Start the initial build. Once deployed, confirm /api/health returns 200, then verify login with username admin and the configured password.",
      },
      {
        title: "Enable Automatic Updates",
        body: "Open the Fork's Actions tab, click I understand my workflows, go ahead and enable them, then manually run Update deployed EdgeEver once so the Fork can automatically receive future EdgeEver features and fixes.",
      },
    ],
  },
  "zh-CN": {
    intro: "仅需在网页端完成 6 步配置：",
    steps: [
      {
        title: "Fork 仓库",
        body: "在 GitHub 点击右上角 Fork，将项目 Fork 到您的个人账户下。",
      },
      {
        title: "创建 Cloudflare 资源",
        body: "创建 D1 edgeever 与 R2 edgeever-resources。",
      },
      {
        title: "导入并配置项目",
        body: "在 Cloudflare Workers & Pages 中导入该 Fork，并将 main 设为生产分支。binding 由部署命令生成，不要修改 Fork 中的文件。",
      },
      {
        title: "设置管理员密码",
        body: "添加一个名为 EDGE_EVER_AUTH_PASSWORD 的 Worker Secret，并将其值设为您要使用的管理员登录密码。建议使用至少 32 个字符且仅用于此实例的强密码。",
      },
      {
        title: "首次构建与验证",
        body: "启动首次构建。部署完成后访问 /api/health，确认返回 200，并使用用户名 admin 和配置的密码验证登录。",
      },
      {
        title: "启用自动更新",
        body: "进入 Fork 的 Actions 标签页，点击 I understand my workflows, go ahead and enable them，然后手动运行一次 Update deployed EdgeEver，确保后续能够自动获得 EdgeEver 的最新功能与修复。",
      },
    ],
  },
} as const;
