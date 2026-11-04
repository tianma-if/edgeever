import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { renderMermaidSVG } from "beautiful-mermaid";
import mermaid from "mermaid";
import { renderMermaidWithFallback } from "./mermaid-renderer";

const GANTT_SOURCE = `gantt
  dateFormat YYYY-MM-DD
  section Web
  Compatibility fallback :fallback, 2026-07-30, 1d`;

describe("Mermaid renderer fallback", () => {
  test("preserves the reported cross-subgraph links when flowchart omits its direction", () => {
    const body = `
      App[应用层] --> Proxy[数据库中间件<br>读写分离 / 分库分表]
      subgraph DB_Cluster[数据库集群]
        direction LR
        Master1[(主库 1)]
        Master2[(主库 2)]
        Slave1[(从库 1)]
        Slave2[(从库 2)]
        Master1 <-->|双主同步| Master2
        Master1 -->|主从同步| Slave1
        Master2 -->|主从同步| Slave2
      end
      Proxy -->|写请求| Master1 & Master2
      Proxy -->|读请求| Slave1 & Slave2`;

    // Isolate ELK from the partial browser globals installed by other suites.
    const result = spawnSync(process.execPath, ["--eval", `
      import assert from "node:assert/strict";
      import { renderThemedMermaidSvg } from "./mermaid-renderer";
      const body = ${JSON.stringify(body)};
      const options = { theme: "default", palette: { bg: "#fff", fg: "#000" }, font: "Inter", padding: 24 };
      const explicit = await renderThemedMermaidSvg("flowchart TD" + body, options);
      const implicit = await renderThemedMermaidSvg("\\r\\n%% diagram\\r\\nflowchart" + body, options);
      assert.equal(implicit, explicit);
      for (const target of ["Master1", "Master2", "Slave1", "Slave2"]) {
        assert(implicit.includes('data-from="Proxy" data-to="' + target + '"'));
      }
    `], { cwd: import.meta.dir, encoding: "utf8", timeout: 30_000 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("keeps the reported Chinese subgraph on the compact renderer", async () => {
    const source = `flowchart LR
      subgraph 日志开启建议
        A[生产环境] -->|不开启| B[查询日志]
        C[开发/测试/调试] -->|按需开启| B
        E[审计场景] -->|按需开启| B
      end`;
    // ELK captures the global window and temporarily replaces timers during
    // initialization. Other suites install partial browser globals, so verify
    // the real compact renderer in its own process to avoid leaking that state.
    const compactRender = spawnSync(process.execPath, ["--eval", `
      import { renderMermaidSVG } from "beautiful-mermaid";
      process.stdout.write(renderMermaidSVG(${JSON.stringify(source)}));
    `], { cwd: import.meta.dir, encoding: "utf8", timeout: 30_000 });
    expect(compactRender.status).toBe(0);
    expect(compactRender.stdout).toContain("<svg");
    let compactRenderCount = 0;
    const svg = await renderMermaidWithFallback({
      source,
      renderBeautiful: () => {
        compactRenderCount += 1;
        return compactRender.stdout;
      },
      renderOfficial: () => '<svg data-renderer="mermaid"></svg>',
    });
    expect(compactRenderCount).toBe(1);
    expect(svg).toBe(compactRender.stdout);
  });

  test("does not route a comment mentioning subgraphs to the official renderer", async () => {
    const svg = await renderMermaidWithFallback({
      source: "flowchart LR\n%% subgraph example\nA --> B",
      renderBeautiful: () => '<svg data-renderer="beautiful"></svg>',
      renderOfficial: () => { throw new Error("Unexpected official render"); },
    });
    expect(svg).toContain('data-renderer="beautiful"');
  });

  test("always uses the compact renderer when it supports the diagram", async () => {
    let officialRenderCount = 0;
    const svg = await renderMermaidWithFallback({
      renderBeautiful: () => '<svg data-renderer="beautiful"></svg>',
      renderOfficial: () => {
        officialRenderCount += 1;
        return '<svg data-renderer="mermaid"></svg>';
      },
    });

    expect(officialRenderCount).toBe(0);
    expect(svg).toContain('data-renderer="beautiful"');
  });

  test("uses the official renderer for a valid Gantt diagram unsupported by beautiful-mermaid", async () => {
    expect(await mermaid.parse(GANTT_SOURCE, { suppressErrors: true })).toBeTruthy();

    let officialRenderCount = 0;
    const svg = await renderMermaidWithFallback({
      renderBeautiful: () => renderMermaidSVG(GANTT_SOURCE),
      renderOfficial: () => {
        officialRenderCount += 1;
        return '<svg data-renderer="mermaid"></svg>';
      },
    });

    expect(officialRenderCount).toBe(1);
    expect(svg).toContain('data-renderer="mermaid"');
  });
});
