import type { CompanionMemory } from "@edgeever/shared";
import type { TFunction } from "i18next";

export function companionMemoryText(memory: CompanionMemory, t: TFunction): string {
  if (memory.kind === "inferred" && memory.ruleKey && memory.scopeNotebookName) {
    try {
      const [kind, , tag] = JSON.parse(memory.ruleKey);
      if ((kind === "move" || kind === "tag") && typeof tag === "string") {
        return t(`companion.learning.rule.${kind}`, { tag, notebook: memory.scopeNotebookName });
      }
    } catch { /* Imported or older records retain their original text. */ }
  }
  return memory.content;
}
