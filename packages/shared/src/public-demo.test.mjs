import { describe, expect, test } from "bun:test";
import { PUBLIC_DEMO_INSTANCE_URL, resolveInstanceUrlInput } from "./public-demo.ts";

describe("public demo instance URL", () => {
  test("maps the App Review 'demo' alias to the public instance", () => {
    expect(PUBLIC_DEMO_INSTANCE_URL).toBe("https://demo.edgeever.org");
    expect(resolveInstanceUrlInput("demo")).toBe(PUBLIC_DEMO_INSTANCE_URL);
    expect(resolveInstanceUrlInput("DEMO")).toBe(PUBLIC_DEMO_INSTANCE_URL);
    expect(resolveInstanceUrlInput(" https://demo/ ")).toBe(PUBLIC_DEMO_INSTANCE_URL);
    expect(resolveInstanceUrlInput("http://demo")).toBe(PUBLIC_DEMO_INSTANCE_URL);
  });

  test("leaves real hosts unchanged", () => {
    expect(resolveInstanceUrlInput("https://demo.edgeever.org")).toBe("https://demo.edgeever.org");
    expect(resolveInstanceUrlInput("https://notes.example.com")).toBe("https://notes.example.com");
    expect(resolveInstanceUrlInput("demo.example.com")).toBe("demo.example.com");
    expect(resolveInstanceUrlInput("")).toBe("");
  });
});
