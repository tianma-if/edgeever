// Appearance is a viewing preference, not a change to the saved artwork.
// An explicit artwork theme (including custom colors) takes precedence.
export const infographicPreviewSyntax = (syntax: string, dark: boolean) => {
  if (!dark || !syntax.trim() || /^\s*theme(?:\s|$)/m.test(syntax)) return syntax;
  const lines = syntax.split("\n");
  lines.splice(1, 0, "theme dark");
  return lines.join("\n");
};

export const infographicUsesDarkSheet = (syntax: string) => /^\s*theme dark\s*$/m.test(syntax);
