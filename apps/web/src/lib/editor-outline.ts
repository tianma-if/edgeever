export type OutlineItem = {
  level: number;
  pos: number;
  text: string;
};

export type OutlineTreeItem = OutlineItem & {
  children: OutlineTreeItem[];
};

export const buildOutlineTree = (items: OutlineItem[]): OutlineTreeItem[] => {
  const roots: OutlineTreeItem[] = [];
  const ancestors: OutlineTreeItem[] = [];

  for (const item of items) {
    const treeItem: OutlineTreeItem = { ...item, children: [] };

    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.level >= item.level) {
      ancestors.pop();
    }

    const parent = ancestors[ancestors.length - 1];
    if (parent) {
      parent.children.push(treeItem);
    } else {
      roots.push(treeItem);
    }

    ancestors.push(treeItem);
  }

  return roots;
};
