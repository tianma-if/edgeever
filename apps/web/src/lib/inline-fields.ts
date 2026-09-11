export type InlineFieldLanguage = "en" | "zh" | "ru";

export type InlineFieldMatch = {
  from: number;
  to: number;
  key: string;
  value: string;
};

const FIELD_LABELS: Record<string, Record<InlineFieldLanguage, string>> = {
  due: { en: "Due", zh: "截止", ru: "Срок" },
  scheduled: { en: "Scheduled", zh: "计划", ru: "Запланировано" },
  start: { en: "Start", zh: "开始", ru: "Начало" },
  completion: { en: "Done", zh: "完成", ru: "Выполнено" },
  created: { en: "Created", zh: "创建", ru: "Создано" },
  cancelled: { en: "Cancelled", zh: "取消", ru: "Отменено" },
  priority: { en: "Priority", zh: "优先级", ru: "Приоритет" },
  repeat: { en: "Repeat", zh: "重复", ru: "Повтор" },
  id: { en: "ID", zh: "ID", ru: "ID" },
  dependsOn: { en: "Depends", zh: "依赖", ru: "Зависит" },
  onCompletion: { en: "On completion", zh: "完成后", ru: "По завершении" },
};

const PRIORITY_VALUES: Record<string, Record<InlineFieldLanguage, string>> = {
  highest: { en: "Highest", zh: "最高", ru: "Наивысший" },
  high: { en: "High", zh: "高", ru: "Высокий" },
  medium: { en: "Medium", zh: "中", ru: "Средний" },
  low: { en: "Low", zh: "低", ru: "Низкий" },
  lowest: { en: "Lowest", zh: "最低", ru: "Наинизший" },
};

export const INLINE_FIELD_PATTERN = /\[([A-Za-z][A-Za-z0-9_-]*)::\s*([^\]]+?)\]/g;

export const languageFromLocale = (locale: string): InlineFieldLanguage => {
  const normalized = locale.toLowerCase();

  if (normalized.startsWith("zh")) {
    return "zh";
  }

  if (normalized.startsWith("ru")) {
    return "ru";
  }

  return "en";
};

export const findInlineFields = (text: string): InlineFieldMatch[] => {
  const fields: InlineFieldMatch[] = [];
  const pattern = new RegExp(INLINE_FIELD_PATTERN.source, "g");
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    fields.push({
      from: match.index,
      to: match.index + match[0].length,
      key: match[1],
      value: match[2].trim(),
    });
  }
  return fields;
};

export const formatInlineFieldChip = (key: string, value: string, language: InlineFieldLanguage) => {
  const label = FIELD_LABELS[key]?.[language] ?? key;
  const displayValue = key === "priority"
    ? (PRIORITY_VALUES[value.toLowerCase()]?.[language] ?? value)
    : value;
  return `${label} ${displayValue}`;
};

export const rangesOverlap = (from: number, to: number, width: number) => {
  return from <= width && to >= 0;
};
