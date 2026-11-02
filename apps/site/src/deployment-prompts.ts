export const deploymentPrompts = {
  "en-US": `Deploy EdgeEver entirely through GitHub and Cloudflare:
1. Fork https://github.com/tianma-if/edgeever.
2. Create D1 \`edgeever\` and R2 \`edgeever-resources\` in Cloudflare.
3. In Workers & Pages, select "Start with Hello World!" and create a Worker named \`edgeever\`.
4. Add the user's chosen password as the runtime Secret \`EDGE_EVER_AUTH_PASSWORD\`
   under Settings → Variables and Secrets, and deploy the Secret (preferably at least
   32 characters). The username defaults to \`admin\`.
5. Only after the Secret is deployed, open this Worker's Settings → Builds → Connect
   and connect the Fork's \`main\` branch.
6. In Settings → Builds → API token, select or create the Cloudflare API token used for deployment, with D1 read/edit permission for the target account.
7. In the Fork's GitHub repository, open Actions → Update deployed EdgeEver, enable the workflow if prompted, and select Run workflow on \`main\`. After confirming in Cloudflare that the corresponding build succeeded and deployment completed, verify \`/api/health\` and \`/api/openapi.json\`, then log in with the administrator
   username and password.
   This workflow will automatically sync future stable releases and fixes.`,
  "zh-CN": `请全程通过 GitHub 和 Cloudflare 在线部署 EdgeEver：
1. Fork https://github.com/tianma-if/edgeever。
2. 在 Cloudflare 中创建 D1 \`edgeever\` 与 R2 \`edgeever-resources\`。
3. 在 Workers & Pages 中选择「Start with Hello World!」，创建名为 \`edgeever\` 的 Worker。
4. 在该 Worker 的 Settings → Variables and Secrets 中添加运行时 Secret
   \`EDGE_EVER_AUTH_PASSWORD\`，值为用户指定的登录密码（建议至少 32 个字符），并点击 Deploy。
   管理员用户名默认为 \`admin\`。
5. 确认 Secret 已部署后，在该 Worker 的 Settings → Builds → Connect 中连接 Fork 的
   \`main\` 分支。
6. 在 Settings → Builds → API token 中选择或创建用于部署的
   Cloudflare API Token，并确保它具备目标账户的 D1 读取和编辑权限。
7. 在 Fork 的 GitHub 仓库中进入 Actions → Update deployed EdgeEver，按提示启用工作流，
   选择 \`main\` 分支并点击 Run workflow。在 Cloudflare 确认对应构建成功、部署完成后，验证 \`/api/health\` 和 \`/api/openapi.json\`，
   再用管理员用户名和密码验证登录。
   后续由该工作流自动同步正式版本，持续获得功能更新和问题修复。`,
} as const;

export const manualDeploymentCopy = {
  "en-US": {
    "intro": "Complete the following 7 web steps strictly in order:",
    "steps": [
      {
        "title": "Fork the Repository",
        "body": "Click Fork at the top right of GitHub to fork EdgeEver into your personal account."
      },
      {
        "title": "Create Cloudflare Resources",
        "body": "Create D1 edgeever and R2 edgeever-resources."
      },
      {
        "title": "Create the Worker",
        "body": "In Cloudflare Workers & Pages, select Create application → Start with Hello World!, name the Worker edgeever, and deploy it. This creates a placeholder; EdgeEver is deployed in Step 7."
      },
      {
        "title": "Set the Administrator Password",
        "body": "Under the Worker’s Settings → Variables and Secrets, add EDGE_EVER_AUTH_PASSWORD as type Secret and click Deploy. Its value is your chosen login password, preferably at least 32 characters. Complete this before connecting the Fork."
      },
      {
        "title": "Connect the Fork",
        "body": "In the existing Worker’s Settings → Builds → Connect, select the Fork and production branch main."
      },
      {
        "title": "Configure Deployment Permissions",
        "body": "In Settings → Builds → API token, select or create the Cloudflare API token used for deployment, with D1 read/edit permission for the target account."
      },
      {
        "title": "Build & Verify",
        "body": "In the Fork's GitHub repository, open Actions → Update deployed EdgeEver, enable the workflow if prompted, and select Run workflow on main. After confirming in Cloudflare that the corresponding build succeeded and deployment completed, confirm /api/health returns 200 and verify login. This workflow will automatically sync future stable releases and fixes."
      }
    ]
  },
  "zh-CN": {
    "intro": "请严格按以下顺序，在网页端完成 7 步配置：",
    "steps": [
      {
        "title": "Fork 仓库",
        "body": "在 GitHub 点击右上角 Fork，将项目 Fork 到您的个人账户下。"
      },
      {
        "title": "创建 Cloudflare 资源",
        "body": "创建 D1 edgeever 与 R2 edgeever-resources。"
      },
      {
        "title": "创建 Worker",
        "body": "在 Cloudflare Workers & Pages 中选择 Create application → Start with Hello World!，命名为 edgeever 并部署。此时是占位服务，第 7 步才部署 EdgeEver。"
      },
      {
        "title": "设置管理员密码",
        "body": "在该 Worker 的 Settings → Variables and Secrets 中，选择 Secret 类型，添加 EDGE_EVER_AUTH_PASSWORD 并点击 Deploy。值为您指定的登录密码，建议至少 32 个字符。完成后再连接 Fork。"
      },
      {
        "title": "连接 Fork",
        "body": "在已有 Worker 的 Settings → Builds → Connect 中选择 Fork 和生产分支 main。"
      },
      {
        "title": "配置部署权限",
        "body": "在 Settings → Builds → API token 中选择或创建用于部署的 Cloudflare API Token，并确保它具备目标账户的 D1 读取和编辑权限。"
      },
      {
        "title": "构建并验证",
        "body": "在 Fork 的 GitHub 仓库中进入 Actions → Update deployed EdgeEver，按提示启用工作流， 选择 main 分支并点击 Run workflow。在 Cloudflare 确认对应构建成功、部署完成后，确认 /api/health 返回 200，并验证登录。后续由该工作流自动同步正式版本，持续获得功能更新和问题修复。"
      }
    ]
  }
} as const;
