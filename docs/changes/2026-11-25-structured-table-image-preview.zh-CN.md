# 多维表格图片预览：封面与缩略图改为缩放后的预览图

## 问题与目标

看板上鼠标悬停卡片要等零点几秒阴影才出现。定位到的原因不是动画本身，而是封面直接把原图当缩略图用：用户上传的一张海报是 `2560×27421` 的 PNG（20.3 MB），卡片只显示 `238×96`，浏览器仍要为它解码出约 280 MB 的位图；卡片又用 `transition`（等价 `all`）配合 `hover:shadow-md`，每次悬停重绘都要重新合成这块巨大图层，于是 hover 变成几十到上百毫秒的长任务。网格里的附件单元格（32px 缩略图）和画册封面有同样的问题。

目标：让卡片与缩略图只绘制按显示尺寸解码的小图，同时保持原图点击打开、复制、下载的行为不变；并让新上传的图片按工作区既有偏好压缩，避免继续存 20 MB 原图。

## 允许的变更与验收

- 新增 `apps/web/src/lib/image-preview.ts`：按 `resourceId@宽度` 缓存预览。用 `fetch(credentials: "include")` 取原始 blob，再以 `createImageBitmap(blob, { resizeWidth })` **在解码阶段就缩放**（不会先分配全尺寸位图），`canvas.toBlob("image/webp", 0.82)` 产出预览 blob URL；`svg`/`gif`/`apng`/`avif` 直接返回原 blob（保住动画与矢量），目标最大边长 640，超高图再用 `resizeHeight` 兜底。内存缓存 + 进行中请求去重，`peekImagePreview` 同步命中、`loadImagePreview` 返回 Promise。
- 新增 `apps/web/src/components/table/ResourceImage.tsx`：未就绪时渲染同尺寸的 `bg-muted/60` 占位（不产生布局抖动），就绪后渲染 `loading="lazy" decoding="async"` 的 `<img>`，`data-testid` 分别为 `resource-image-placeholder` / `resource-image`。
- 接入点：`AttachmentCell` 的 32px 缩略图（宽度桶 96）、看板卡片封面（400）、画册封面（480）。原图的 `href`（点击打开、复制链接、下载）保持不变。
- 绘制成本：看板卡片与画册卡片的 `transition` 收窄为 `transition-shadow duration-150`，看板卡片再加 `contain: paint`，避免悬停时对整卡（含封面图层）做全属性动画。
- 上传侧：`AttachmentCell` 上传图片时遵循工作区的「图片压缩」偏好（`readImageCompressionPreference()`），压缩后才 `uploadMemoResource`，与编辑器上传路径一致；关闭偏好时仍上传原图。

## 保持不变

没有改服务端存储、`?w=` 缩略图接口与 `resources` 表结构；原图仍是唯一的持久化对象，预览只是浏览器端派生；桌面端 `edgeever-resource://` 映射未改动（桌面端仍走本地原图）；非图片附件、非图片 MIME 类型完全不受影响。

## 完成核对

同一份用户数据（`2560×27421` PNG 封面）用 Playwright + CDP 实测：

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| 封面解码尺寸 | `2560×27421` | `400×4285`（blob URL） |
| 悬停期间长任务 | `[147, 136]` / `[183, 122]` ms | 无 |
| 悬停到阴影开始变化 | 数百 ms（长任务阻塞） | `53 ms` |
| 进入看板到封面就绪 | — | `454 ms` |
| JS 堆 | `100 MB` | `90 MB` |

- 新增单测 `apps/web/src/lib/image-preview.test.mjs`（5 条：去重、宽度分桶、动图/矢量直通、读取失败返回 null、空 id 不缓存）。
- 新增 E2E `tests/e2e/structured-table-image-preview.spec.ts`：上传真实 PNG 后，网格缩略图与看板封面的 `src` 均为 `blob:`，且 `naturalWidth ≤ 640`，占位全部消失。
- `bun run typecheck`、`bun run lint`（0 warnings / 0 errors）通过；结构化表格既有 E2E 全量回归通过。
- 未覆盖：Cloudflare Images 绑定开启时的服务端 `?w=` 分支（本地无 `env.IMAGES`，实测回退原图）、桌面端资源协议上的预览缩放、移动端 Base 只读视图。
