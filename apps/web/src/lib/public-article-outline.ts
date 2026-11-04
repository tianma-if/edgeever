export type PublicOutlineFlatHeading = {
  id: string;
  text: string;
  level: number;
};

export type PublicOutlineHeading = PublicOutlineFlatHeading & {
  children: PublicOutlineHeading[];
};

export const buildPublicOutlineTree = (headings: PublicOutlineFlatHeading[]): PublicOutlineHeading[] => {
  const roots: PublicOutlineHeading[] = [];
  const ancestors: PublicOutlineHeading[] = [];

  headings.forEach((heading) => {
    const item: PublicOutlineHeading = { ...heading, children: [] };
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.level >= heading.level) ancestors.pop();
    (ancestors[ancestors.length - 1]?.children ?? roots).push(item);
    ancestors.push(item);
  });

  return roots;
};

export const collectPublicOutlineParentIds = (items: PublicOutlineHeading[]): string[] => {
  const parentIds: string[] = [];
  const visit = (nodes: PublicOutlineHeading[]) => nodes.forEach((node) => {
    if (node.children.length > 0) parentIds.push(node.id);
    visit(node.children);
  });
  visit(items);
  return parentIds;
};
