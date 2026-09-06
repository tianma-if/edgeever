import type { CompanionMemory } from "@edgeever/shared";
const wordSegmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stopWords = new Set("我 你 的 了 是 在 什么 怎么 哪些 这个 那个 一个 请 吗 呢 和 与 i you the a an is are to of what how my me".split(" "));
const normalizeMemoryText = (text: string) => text.normalize("NFKC").toLowerCase();
const memoryTerms = (text: string) => {
  const terms = new Set<string>();
  for (const part of wordSegmenter.segment(normalizeMemoryText(text))) {
    if (part.isWordLike && !stopWords.has(part.segment)) terms.add(part.segment);
  }
  return terms;
};

export function selectCompanionMemories(memories: CompanionMemory[], message: string) {
  const terms = [...memoryTerms(message)].slice(0, 128);
  // Use the runtime's Unicode word segmentation; no embedding request or new
  // index. Precompute matches instead of re-tokenizing inside the comparator.
  const indexed = memories.filter(memory => !memory.state || memory.state === "active").map(memory => {
    const normalized = normalizeMemoryText(memory.content);
    return { memory, terms: terms.some(term => normalized.includes(term)) ? memoryTerms(normalized) : new Set<string>() };
  });
  const weights = new Map(terms.map(term => [term, 1 + Math.log((memories.length + 1)
    / (1 + indexed.filter(entry => entry.terms.has(term)).length))]));
  const ranked = indexed.map(entry => ({ memory: entry.memory,
    score: terms.reduce((sum, term) => sum + (entry.terms.has(term) ? weights.get(term)! : 0), 0),
  })).sort((a, b) => Number(a.memory.kind === "inferred") - Number(b.memory.kind === "inferred") || b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt)
    || (a.memory.id ?? "").localeCompare(b.memory.id ?? ""));
  // Do not fill the prompt with zero-score memories. Keep a small recent fallback
  // for messages with no lexical match; stored memories are never deleted here.
  const relevant = ranked.filter(entry => entry.score > 0);
  const selected = relevant.length ? relevant.slice(0, 8) : ranked.slice(0, 2);
  let remaining = 4000;
  return selected.map(entry => entry.memory).filter(memory => {
    if (remaining < memory.content.length) return false;
    remaining -= memory.content.length;
    return true;
  });
}

