import { describe, expect, test } from "bun:test";
import { mapMemoTemplateRow } from "./template-routes.ts";

const row = {
  id: "template_1",
  name: "Weekly review",
  description: "Review template",
  title: "Week 1",
  content_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
  content_markdown: "# Week 1",
  tags_json: '["review","weekly"]',
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T01:00:00.000Z",
};

describe("template route mapping", () => {
  test("maps storage rows into the public template contract", () => {
    expect(mapMemoTemplateRow(row)).toEqual({
      id: "template_1",
      name: "Weekly review",
      description: "Review template",
      title: "Week 1",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMarkdown: "# Week 1",
      tags: ["review", "weekly"],
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z",
    });
  });

  test("fails closed to an empty document for damaged stored JSON", () => {
    expect(mapMemoTemplateRow({ ...row, content_json: "damaged" }).contentJson).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});
