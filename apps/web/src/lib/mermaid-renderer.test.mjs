import { expect, test } from "bun:test";
import mermaid from "mermaid";

test("official Mermaid accepts an implicit flowchart direction and reads the diagram configuration", async () => {
  const source = `%%{init: {"flowchart": {"curve": "linear"}}}%%
flowchart
  A --> B`;

  expect(await mermaid.parse(source)).toMatchObject({
    diagramType: "flowchart-v2",
    config: { flowchart: { curve: "linear" } },
  });
});
