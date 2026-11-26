import type { DatabaseAdapter } from "./storage-contract";

// Preserve accepted UTF-16 values through native SQLite bindings. JSON escapes
// isolated surrogates; ordinary strings retain their existing SQL expressions.
const unpairedSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export const sqlLiteral = (value: string) =>
  value.includes("\0") || unpairedSurrogate.test(value)
    ? `json_extract(${quote(JSON.stringify([value]))},'$[0]')`
    : quote(value);
export function bindQueryValue(values: unknown[], value: unknown) {
  const escaped = typeof value === "string" && unpairedSurrogate.test(value);
  values.push(escaped ? JSON.stringify([value]) : value);
  const parameter = "?" + values.length;
  return escaped ? `json_extract(${parameter},'$[0]')` : parameter;
}

/** Parameter interpolation stays separate from SQL literals and identifiers. */
export const tableStatement =
  (db: DatabaseAdapter) =>
  (parts: TemplateStringsArray, ...values: unknown[]) => {
    const parameters: unknown[] = [];
    let sql = parts[0];
    values.forEach((value, i) => {
      sql += bindQueryValue(parameters, value) + parts[i + 1];
    });
    return db.prepare(sql).bind(...parameters);
  };

/** SQLite JSON text may contain WTF-8 surrogates that native string readers lose. */
export function sqliteTextFromHex(hex: string) {
  let result = "";
  const byte = (at: number) => parseInt(hex.slice(at, at + 2), 16);
  for (let at = 0; at < hex.length; ) {
    const first = byte(at);
    at += 2;
    if (first < 0x80) {
      result += String.fromCharCode(first);
      continue;
    }
    const remaining = first < 0xe0 ? 1 : first < 0xf0 ? 2 : 3;
    let point = first & ((1 << (6 - remaining)) - 1);
    for (let i = 0; i < remaining; i++) {
      point = (point << 6) | (byte(at) & 0x3f);
      at += 2;
    }
    result += String.fromCodePoint(point);
  }
  return result;
}

export const readStoredRecord = <T extends { record_id: string }>(
  row: T,
): T => ({ ...row, record_id: sqliteTextFromHex(row.record_id) });

/** UTF-8 plus isolated-surrogate bytes, matching SQLite JSON's text encoding. */
export function sqliteTextHex(value: string) {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const point = value.codePointAt(i)!;
    if (point > 0xffff) i++;
    const bytes =
      point < 0x80
        ? [point]
        : point < 0x800
          ? [0xc0 | (point >> 6), 0x80 | (point & 63)]
          : point < 0x10000
            ? [
                0xe0 | (point >> 12),
                0x80 | ((point >> 6) & 63),
                0x80 | (point & 63),
              ]
            : [
                0xf0 | (point >> 18),
                0x80 | ((point >> 12) & 63),
                0x80 | ((point >> 6) & 63),
                0x80 | (point & 63),
              ];
    result += bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return result.toUpperCase();
}
