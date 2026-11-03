import { describe, expect, test } from "bun:test";
import { noteProseStyleCssVariables } from "@edgeever/shared";
import { resolveStoredNoteProseStylePreference } from "./note-prose-style-preference.ts";

describe("independent body rhythm preferences", () => {
  test("all heading styles use the same body defaults without migration", () => {
    for (const headingStyle of ["default", "bar", "numbered"]) {
      const preference = resolveStoredNoteProseStylePreference(JSON.stringify({ headingStyle }));
      expect(preference.paragraphSpacing).toBe(8);
      expect(preference.textAlign).toBe("left");
      expect(preference.letterSpacing).toBe("default");
      expect(noteProseStyleCssVariables(preference)).toEqual({
        "--editor-paragraph-spacing": "8px",
        "--editor-body-text-align": "left",
        "--editor-body-letter-spacing": "-0.005em",
      });
    }
  });

  test("round trips supported choices independently from headings", () => {
    for (const paragraphSpacing of [8, 12, 16]) {
      for (const textAlign of ["left", "justify"]) {
        for (const letterSpacing of ["default", "0.5px", "1px"]) {
          const values = { paragraphSpacing, textAlign, letterSpacing, headingStyle: "numbered" };
          const preference = resolveStoredNoteProseStylePreference(JSON.stringify(values));
          expect(preference).toMatchObject(values);
          expect(noteProseStyleCssVariables(preference)["--editor-paragraph-spacing"]).toBe(`${paragraphSpacing}px`);
        }
      }
    }
  });

  test("invalid values fall back to body defaults", () => {
    const preference = resolveStoredNoteProseStylePreference(JSON.stringify({
      paragraphSpacing: -1, textAlign: "center", letterSpacing: "99px",
    }));
    expect(preference.paragraphSpacing).toBe(8);
    expect(preference.textAlign).toBe("left");
    expect(preference.letterSpacing).toBe("default");
  });
});
