import type { MemoTemplate } from "@edgeever/shared";

export type MobileCreateMemoSeed = {
  title: string;
  contentMarkdown: string;
  tagsText: string;
};

export type MobileSelectableTemplate = {
  id: string;
  name: string;
  description: string;
  title: string;
  contentMarkdown: string;
  tags: string[];
};

export const toMobileSelectableTemplate = (
  template: MemoTemplate,
): MobileSelectableTemplate => {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    title: template.title ?? template.name,
    contentMarkdown: template.contentMarkdown,
    tags: template.tags,
  };
};

export const mobileTemplateToCreateSeed = (template: MobileSelectableTemplate): MobileCreateMemoSeed => ({
  title: template.title,
  contentMarkdown: template.contentMarkdown,
  tagsText: template.tags.join(", "),
});

export const createMemoSeedHasContent = (seed: Pick<MobileCreateMemoSeed, "title" | "contentMarkdown" | "tagsText">) =>
  Boolean(seed.title.trim() || seed.contentMarkdown.trim() || seed.tagsText.trim());
