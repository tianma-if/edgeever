import { describe, expect, test } from "bun:test";
import {
  buildSchemaVerificationSql,
  parseD1Rows,
  parseJsonOutput,
  parseSecretNames,
  REQUIRED_TABLES,
} from "../scripts/verify-deployment.mjs";

describe("deployment verification", () => {
  test("checks the remote schema tables required by current application code", () => {
    const sql = buildSchemaVerificationSql();
    for (const table of REQUIRED_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  test("parses Wrangler D1 JSON output", () => {
    expect(parseD1Rows(JSON.stringify([{ results: [{ name: "users" }] }]))).toEqual([{ name: "users" }]);
  });

  test("reports empty Wrangler JSON output clearly", () => {
    expect(() => parseJsonOutput("", "the remote D1 schema")).toThrow(
      "Wrangler returned no JSON while checking the remote D1 schema.",
    );
  });

  test("treats an empty D1 result as zero rows", () => {
    expect(parseD1Rows("")).toEqual([]);
  });

  test("reports unexpected Wrangler output as a parse failure", () => {
    expect(() => parseJsonOutput("Authentication error [code: 10000]", "Worker Secrets")).toThrow(
      "Wrangler returned invalid JSON while checking Worker Secrets",
    );
  });

  test("parses current and wrapped Wrangler secret output", () => {
    expect(parseSecretNames(JSON.stringify([{ name: "EDGE_EVER_AUTH_PASSWORD" }]))).toContain(
      "EDGE_EVER_AUTH_PASSWORD",
    );
    expect(parseSecretNames(JSON.stringify({ result: [{ name: "EDGE_EVER_AUTH_PASSWORD_HASH" }] }))).toContain(
      "EDGE_EVER_AUTH_PASSWORD_HASH",
    );
  });
});
