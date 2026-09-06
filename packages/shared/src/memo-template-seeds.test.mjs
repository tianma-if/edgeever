import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MEMO_TEMPLATE_SEEDS,
  defaultMemoTemplateId,
  localizeMemoTemplateSeed,
} from "./memo-template-seeds.ts";

describe("memo template seeds", () => {
  test("provides five unique editable starter templates in both supported languages", () => {
    expect(DEFAULT_MEMO_TEMPLATE_SEEDS).toHaveLength(5);
    expect(new Set(DEFAULT_MEMO_TEMPLATE_SEEDS.map((seed) => seed.key)).size).toBe(5);
    expect(localizeMemoTemplateSeed(DEFAULT_MEMO_TEMPLATE_SEEDS[0], "zh-CN").title).toBe("灵感速记");
    expect(localizeMemoTemplateSeed(DEFAULT_MEMO_TEMPLATE_SEEDS[0], "en-GB").title).toBe("Quick Spark");
  });

  test("uses workspace-scoped deterministic ids", () => {
    expect(defaultMemoTemplateId("ws_1", "meeting")).toBe("ws_1_template_meeting");
  });
});
