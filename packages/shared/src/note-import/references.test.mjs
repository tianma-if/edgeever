import { expect, test } from "bun:test";
import { findImportReferences, rewriteImportMarkdown } from "./references";

const cases = [
  ["nested labels", "[section [outer [inner]]](file.txt)", ["file.txt"]],
  ["blockquote label", "> [two\r\n> lines](file.txt)", ["file.txt"]],
  ["list label", "- [two\n  lines](file.txt)", ["file.txt"]],
  ["blockquote image", "> ![two\n> lines](image.png)", ["image.png"]],
  ["container reference", "> [one][my\n> label]\n>\n> [my label]: file.txt", ["file.txt"]],
  ["full, collapsed and shortcut uses", "[one][id]\n\n![two][ID]\n\n[id][]\n\n[id]\n\n[id]: <image name.png> \"title\"\n[unused]: missing.png", ["image name.png"]],
  ["unused definition", "[missing]\n\n[unused]: hidden.png", []],
  ["empty inline destination", "[id]()\n\n[id]: unused.png", []],
  ["empty first definition", "[id]\n\n[id]: <>\n[id]: ignored.png", []],
  ["first definition wins", "[id]\n\n[id]: first.txt\n[id]: second.txt", ["first.txt"]],
  ["escaped reference", "[\\*]\n\n[\\*]: escaped.txt", ["escaped.txt"]],
  ["URI escapes and entities", "[named](file%20name.txt#one\\)two&amp;three)", ["file%20name.txt#one)two&three"]],
  ["inert Markdown", "`![code](missing.png)`\n\n```md\n![code](missing.png)\n```\n\n    ![code](missing.png)\n\n<div>\n![html](missing.png)\n</div>\n\n\\![[escaped.png]]", []],
  ["Wiki in a title", '[x](real.svg "![[not-an-embed.svg]]")', ["real.svg"]],
  ["Wiki in a URL", "[x](https://example.com/![[not-an-embed.svg]])", ["https://example.com/![[not-an-embed.svg]]"]],
  ["Wiki in an autolink", "<https://example.com/![[not-an-embed.svg]]>", ["https://example.com/![[not-an-embed.svg]]"]],
  ["Wiki in a bare GFM URL", "https://example.com/![[not-an-embed.svg]]", []],
  ["GFM task marker", "- [x] checkbox\n\n[x]: unused.png", []],
];
for (const [name, source, hrefs] of cases) test(`destination spans preserve ${name}`, () => {
  expect(findImportReferences(source).map(ref => ref.href)).toEqual(hrefs);
});

test("target edits retain container prefixes and multiline labels", () => {
  const source = '> [two\r\n> lines](file.txt "title")';
  const refs = findImportReferences(source).map(ref => ({ ...ref, resourceKey: "file" }));
  expect(rewriteImportMarkdown(source, refs, { file: "/resource" })).toBe('> [two\r\n> lines](/resource "title")');
});
