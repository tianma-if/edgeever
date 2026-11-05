import React from "react";
import { createRoot } from "react-dom/client";
import { MermaidViewer } from "/src/components/MermaidViewer.tsx";
import { renderThemedMermaidSvg } from "/src/lib/mermaid-renderer.ts";
import { normalizeMermaidSvgForViewer } from "/src/lib/mermaid-svg.ts";
import { MERMAID_THEME_PALETTES } from "/src/components/ThemeProvider.tsx";
import demoSeed from "../../../apps/api/src/demo-seed-data.ts?raw";

const readDemoSource = (heading) => {
  const start = demoSeed.indexOf("flowchart", demoSeed.indexOf(heading));
  return demoSeed.slice(start).split("\\`\\`\\`")[0].trim();
};

const reportedSource = `---
config:
  layout: dagre
---
flowchart LR
  subgraph Ansible_Work[Ansible 工作模式]
      direction LR
      ADHOC[命令行模式 Ad-Hoc<br>临时、单次操作]
      PLAYBOOK[剧本模式 Playbook<br>复杂、批量自动化]
  end
  subgraph Module_Test[基础模块测试]
      M1[命令与软件管理]
      M2[文件与服务操作]
      M3[系统配置与安全]
  end
  subgraph WP_Deploy[WordPress 剧本部署实战]
      S1[环境准备与初始化]
      S2[底层服务 NFS / LNMP / DB]
      S3[前端负载均衡与 SSL]
      S4[项目代码发布]
  end
  ADHOC --> Module_Test
  PLAYBOOK --> WP_Deploy`;

const esbSource = `flowchart LR
  A[上游应用] -->|统一请求| B[ESB 企业服务总线]
  B -->|协议转换| C[微服务 A]
  B -->|协议转换| D[微服务 B]
  B -->|协议转换| E[微服务 C]`;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const parser = new DOMParser();
const cases = [
  { name: "Reported diagram, light", source: reportedSource, theme: "zinc-light", label: "临时、单次操作" },
  { name: "Reported diagram, dark", source: reportedSource, theme: "zinc-dark", label: "临时、单次操作" },
  { name: "Self-closing breaks", source: reportedSource.replaceAll("<br>", "<br/>"), theme: "zinc-light", label: "临时、单次操作" },
  { name: "Basic flowchart", source: "flowchart LR\nA[开始] --> B[结束]", theme: "zinc-light", label: "开始" },
  { name: "Demo architecture (Chinese)", source: readDemoSource("## 2. 全景架构与生态联动"), theme: "zinc-light", label: "全端客户端" },
  { name: "Demo architecture (English)", source: readDemoSource("## 2. Architectural Overview & Ecosystem"), theme: "zinc-dark", label: "Cross-platform clients" },
  { name: "Chinese subgraph edge alignment", source: "flowchart LR\nsubgraph 日志开启建议\nA[生产环境] -->|不开启| B[查询日志]\nC[开发测试] -->|按需开启| B\nE[审计场景] -->|按需开启| B\nend", theme: "zinc-light", label: "日志开启建议" },
  { name: "HTML entities and formatting", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 240 80"><foreignObject width="240" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="color:rgb(20, 30, 40)"><b>中文 &amp; English</b><br>第二行&nbsp;标签</div></foreignObject></svg>', label: "第二行\u00a0标签" },
];

try {
  for (const item of cases) {
    const original = item.svg ?? await renderThemedMermaidSvg(item.source, {
      theme: item.theme, palette: MERMAID_THEME_PALETTES[item.theme], font: "sans-serif", padding: 24,
    });
    if (item === cases[0]) {
      const viewer = createRoot(document.querySelector("#viewer"));
      const renderViewer = (open) => viewer.render(React.createElement(MermaidViewer, {
        open, svg: original, fallbackBackgroundColor: "#ffffff",
        closeLabel: "Close", resetZoomLabel: "Reset zoom", viewerLabel: "Reported diagram",
        zoomInLabel: "Zoom in", zoomOutLabel: "Zoom out", onClose: () => renderViewer(false),
      }));
      renderViewer(false);
      document.querySelector("#open-viewer").disabled = false;
      document.querySelector("#open-viewer").onclick = () => renderViewer(true);
    }
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = item.name;
    section.append(heading);
    document.querySelector("#cases").append(section);
    const normalized = normalizeMermaidSvgForViewer(original);
    const parsed = parser.parseFromString(normalized, "image/svg+xml");
    assert(!parsed.querySelector("parsererror"), `${item.name}: invalid XML`);
    const root = parsed.documentElement;
    assert(root.namespaceURI === "http://www.w3.org/2000/svg", `${item.name}: SVG namespace`);
    assert(root.textContent.includes(item.label), `${item.name}: missing label`);
    for (const br of root.querySelectorAll("foreignObject br")) {
      assert(br.namespaceURI === "http://www.w3.org/1999/xhtml", `${item.name}: XHTML namespace`);
    }
    if (item.svg) {
      assert(root.querySelector("b")?.textContent === "中文 & English", "Lost formatting or entities");
      assert(root.querySelector("div")?.getAttribute("style") === "color:rgb(20, 30, 40)", "Lost label style");
    }
    const viewBox = root.getAttribute("viewBox").trim().split(/[\s,]+/).map(Number);
    assert(Number(root.getAttribute("width")) === viewBox[2], `${item.name}: width`);
    assert(Number(root.getAttribute("height")) === viewBox[3], `${item.name}: height`);
    const url = URL.createObjectURL(new Blob([normalized], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.alt = item.name;
    section.style.background = item.theme ? MERMAID_THEME_PALETTES[item.theme].bg : "white";
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(`${item.name}: image failed to load`));
        image.src = url;
        section.append(image);
      });
      assert(image.naturalWidth > 0 && image.naturalHeight > 0, `${item.name}: empty image`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  for (const zoom of [1, 0.9, 1.1, 1.25]) {
    const previousZoom = document.body.style.zoom;
    const preview = document.createElement("div");
    document.body.style.zoom = String(zoom);
    try {
      preview.innerHTML = await renderThemedMermaidSvg(esbSource, {
        palette: MERMAID_THEME_PALETTES["zinc-light"],
        font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
      });
      document.querySelector("#cases").append(preview);
      const labels = [...preview.querySelectorAll("foreignObject")];
      assert(labels.some((box) => box.textContent === "ESB 企业服务总线"), `Missing ESB label at zoom ${zoom}`);
      for (const box of labels) {
        const range = document.createRange();
        range.selectNodeContents(box.firstElementChild);
        const textBounds = range.getBoundingClientRect();
        const labelBounds = box.getBoundingClientRect();
        assert(textBounds.width > 0 && textBounds.right <= labelBounds.right + 0.5,
          `Clipped label "${box.textContent}" at zoom ${zoom}`);
      }
    } finally {
      preview.remove();
      document.body.style.zoom = previousZoom;
    }
  }
  const invalid = "<p>Not an SVG</p>";
  assert(normalizeMermaidSvgForViewer(invalid) === invalid, "Non-SVG input changed");
  document.querySelector("#result").textContent = `${cases.length} cases passed: XML, namespaces, labels, dimensions, Blob image loading and scaled label bounds`;
  document.querySelector("#result").dataset.state = "passed";
} catch (error) {
  document.querySelector("#result").textContent = String(error);
  document.querySelector("#result").dataset.state = "failed";
}
