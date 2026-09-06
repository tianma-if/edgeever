import { describe, expect, test } from "bun:test";
import {
  AiGenerateSchema,
  MAX_AI_TEXT_ATTACHMENT_BYTES,
  getBase64DecodedByteLength,
} from "./index.ts";

describe("AI attachment request schema", () => {
  test("accepts an attachment-only request and reports its decoded size", () => {
    const base64Data = Buffer.from("meeting notes", "utf8").toString("base64");
    expect(getBase64DecodedByteLength(base64Data)).toBe(13);
    expect(AiGenerateSchema.parse({
      action: "custom",
      title: "",
      contentMarkdown: "",
      instruction: "Summarize the attached file.",
      attachments: [{ filename: "notes.txt", mediaType: "text/plain", base64Data }],
    }).attachments).toHaveLength(1);
  });

  test("rejects malformed base64, unsupported media, and oversized text", () => {
    const request = {
      action: "summarize",
      title: "Note",
      contentMarkdown: "Body",
    };
    expect(AiGenerateSchema.safeParse({
      ...request,
      attachments: [{ filename: "bad.txt", mediaType: "text/plain", base64Data: "not base64" }],
    }).success).toBe(false);
    expect(AiGenerateSchema.safeParse({
      ...request,
      attachments: [{ filename: "archive.zip", mediaType: "application/zip", base64Data: "eA==" }],
    }).success).toBe(false);
    expect(AiGenerateSchema.safeParse({
      ...request,
      attachments: [{
        filename: "large.txt",
        mediaType: "text/plain",
        base64Data: Buffer.alloc(MAX_AI_TEXT_ATTACHMENT_BYTES + 1).toString("base64"),
      }],
    }).success).toBe(false);
  });
});
