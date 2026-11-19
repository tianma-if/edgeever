import { expect, test } from "bun:test";
import { readEnex } from "./evernote";

test("Evernote tasks do not change the note's title and dates", async () => {
  const enex = `<en-export><note><title>Groceries</title><created>20240115T103000Z</created><updated>20240115T104500Z</updated>`
    + `<tag>home</tag><content><![CDATA[<en-note><div>List</div></en-note>]]></content>`
    + `<task><title>Buy milk</title><created>20240115T103100Z</created><updated>20240115T103200Z</updated>`
    + `<reminder><created>20240115T103300Z</created><updated>20240115T103400Z</updated></reminder></task></note></en-export>`;
  const notes = [];
  for await (const note of readEnex((async function* () { yield new TextEncoder().encode(enex); })(), "tasks.enex")) notes.push(note);

  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ title: "Groceries", created: "20240115T103000Z", updated: "20240115T104500Z", tags: ["home"] });
  expect(notes[0].content).toContain("List");
});
