import { sqliteTextHex } from "./table-query-sql";

type HexPattern = [
  prefix: string,
  suffix: string,
  anchor: string,
  offset: number,
  width: number,
];
function describePattern(pattern: string): HexPattern {
  let width = 0,
    anchor = "",
    offset = 0,
    at = 0,
    anchorAt = 0;
  for (const token of pattern.match(/\[[^\]]+\]|[0-9A-F]+/g)!) {
    if (token[0] === "[") width++;
    else {
      if (token.length > anchor.length) {
        anchor = token;
        offset = width;
        anchorAt = at;
      }
      width += token.length;
    }
    at += token.length;
  }
  // instr checks the full literal anchor. Only its boundary classes need GLOB,
  // keeping each pattern below D1's 50-byte limit even for long needles.
  return [
    pattern.slice(0, anchorAt),
    pattern.slice(anchorAt + anchor.length),
    anchor,
    offset,
    width,
  ];
}
function boundaryPatterns(needle: string) {
  const first = needle.charCodeAt(0),
    last = needle.charCodeAt(needle.length - 1);
  const leading = first >= 0xdc00 && first <= 0xdfff,
    trailing = last >= 0xd800 && last <= 0xdbff;
  if (!leading && !trailing) return [];
  const middle = sqliteTextHex(
    needle.slice(leading ? 1 : 0, trailing ? -1 : undefined),
  );
  const low = first - 0xdc00;
  // The target comes from SQLite JSON UTF-8/WTF-8. A low unit can match
  // any valid pair's low half; a high unit can match its 1,024 code points.
  const lowPair =
    "F[0-4][8-B][0-F][8-B]" +
    (low >> 6).toString(16).toUpperCase() +
    (0x80 + (low & 63)).toString(16).toUpperCase();
  const highPair = trailing
    ? sqliteTextHex(
        String.fromCodePoint(0x10000 + ((last - 0xd800) << 10)),
      ).slice(0, 5) + "[0-F][8-B][0-F]"
    : "";
  const starts = leading ? [sqliteTextHex(needle[0]), lowPair] : [""];
  const ends = trailing
    ? [sqliteTextHex(needle[needle.length - 1]), highPair]
    : [""];
  const patterns: HexPattern[] = [];
  for (let a = 0; a < starts.length; a++)
    for (let b = 0; b < ends.length; b++) {
      // The all-literal combination is already covered by instr.
      if (a || b) patterns.push(describePattern(starts[a] + middle + ends[b]));
    }
  return patterns;
}

/** Preserve String.includes code-unit boundaries without changing normal queries. */
export function tableContainsSql(
  source: string,
  needle: string,
  expected: string,
  bind: (value: unknown) => string,
) {
  const normal = `instr(${source},${expected})>0`,
    patterns = boundaryPatterns(needle);
  if (!patterns.length) return normal;
  const parameter = bind(JSON.stringify(patterns));
  return `CASE WHEN ${normal} THEN 1 ELSE EXISTS(
  WITH RECURSIVE
  source AS MATERIALIZED(SELECT hex(${source}) AS bytes),
  patterns AS MATERIALIZED(SELECT key AS id,json_extract(value,'$[0]') AS prefix,json_extract(value,'$[1]') AS suffix,
   json_extract(value,'$[2]') AS anchor,json_extract(value,'$[3]') AS offset,json_extract(value,'$[4]') AS width FROM json_each(${parameter})),
  positions(id,at) AS (
   SELECT p.id,instr(s.bytes,p.anchor) FROM patterns p CROSS JOIN source s
   UNION ALL
   SELECT p.id,CASE WHEN instr(substr(s.bytes,c.at+1),p.anchor)=0 THEN 0 ELSE c.at+instr(substr(s.bytes,c.at+1),p.anchor) END
   FROM positions c JOIN patterns p ON p.id=c.id CROSS JOIN source s
   WHERE c.at>0 AND c.at-p.offset+p.width<=length(s.bytes)
  )
  SELECT 1 FROM positions c JOIN patterns p ON p.id=c.id CROSS JOIN source s
  WHERE c.at>0 AND c.at-p.offset>=1 AND (c.at-p.offset)%2=1
   AND substr(s.bytes,c.at-p.offset,p.offset) GLOB p.prefix
   AND substr(s.bytes,c.at+length(p.anchor),p.width-p.offset-length(p.anchor)) GLOB p.suffix
 ) END`;
}
