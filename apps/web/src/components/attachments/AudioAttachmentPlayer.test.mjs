import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioAttachmentPlayer } from "./AudioAttachmentPlayer.tsx";

describe("AudioAttachmentPlayer", () => {
  test("uses the native streaming player without eagerly downloading the file", () => {
    const markup = renderToStaticMarkup(createElement(AudioAttachmentPlayer, {
      src: "/api/v1/resources/audio-1/blob",
      label: "interview.flac",
      unavailableMessage: "Unavailable",
    }));

    expect(markup).toContain("<audio");
    expect(markup).toContain('preload="metadata"');
    expect(markup).toContain('src="/api/v1/resources/audio-1/blob"');
    expect(markup).toContain('aria-label="interview.flac"');
    expect(markup).toContain("data-edgeever-audio-player");
  });
});
