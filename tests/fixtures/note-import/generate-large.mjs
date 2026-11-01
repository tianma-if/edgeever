// Reproducible, synthetic exports only. Usage: bun <this-file> /absolute/output-dir
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ZipWriter, TextReader } from "@zip.js/zip.js/index-native.js";

const output = process.argv[2];
if (!output) throw new Error("Pass a temporary output directory.");
await mkdir(output, { recursive: true });
const GiB = 1024 ** 3;
for (const count of [1, 4]) {
  const path = join(output, `library-${count}GiB.zip`);
  const sink = Bun.file(path).writer();
  const stream = new WritableStream({ write(chunk) { sink.write(chunk); }, async close() { await sink.end(); } });
  const zip = new ZipWriter(stream, { useWebWorkers: false, level: 1 });
  const markdown = `---\ntitle: Library ${count} GiB\ncreated: 2020-01-02T03:04:05Z\nupdated: 2021-02-03T04:05:06Z\n---\n\n` + Array.from({ length: count }, (_, i) => `[Attachment ${i}](assets/${i}.bin)`).join("\n\n");
  await zip.add("Benchmark.md", new TextReader(markdown));
  for (let i = 0; i < count; i++) {
    let remaining = GiB;
    const block = new Uint8Array(64 * 1024).fill(97);
    await zip.add(`assets/${i}.bin`, new ReadableStream({ pull(controller) {
      if (!remaining) { controller.close(); return; }
      const bytes = block.subarray(0, Math.min(block.length, remaining)); remaining -= bytes.length; controller.enqueue(bytes);
    } }));
  }
  await zip.close();
  console.log(JSON.stringify({ path, logicalBytes: count * GiB, archiveBytes: Bun.file(path).size }));
}
// The digest is required by ENEX's en-media resource reference, not an extra
// integrity check. No whole attachment/base64 string is constructed.
const binaryBytes = 192 * 1024 * 1024;
const binaryBlock = Buffer.alloc(48 * 1024, 97);
const digest = createHash("md5");
for (let n = 0; n < binaryBytes; n += binaryBlock.length) digest.update(binaryBlock);
const hash = digest.digest("hex");
const path = join(output, "large-field.enex");
const writer = Bun.file(path).writer();
writer.write(`<?xml version="1.0"?><en-export><note><title>Large ENEX field</title><content><![CDATA[<en-note><en-media type="application/octet-stream" hash="${hash}"/></en-note>]]></content><created>20200102T030405Z</created><updated>20210203T040506Z</updated><resource><data encoding="base64">`);
const encoded = binaryBlock.toString("base64");
for (let n = 0; n < binaryBytes; n += binaryBlock.length) { writer.write(encoded); if (n % (1024 * 1024 * 3) === 0) await writer.flush(); }
writer.write("</data><mime>application/octet-stream</mime><resource-attributes><file-name>large.bin</file-name></resource-attributes></resource></note></en-export>");
await writer.end();
console.log(JSON.stringify({ path, logicalBytes: binaryBytes, exportBytes: Bun.file(path).size }));
