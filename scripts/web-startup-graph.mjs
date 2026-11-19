import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import ts from "typescript";

/** Follow actual ESM dependencies; removing preload hints cannot conceal eager code. */
export const readWebStartupGraph = (distDirectory, entryFiles) => {
  const root = resolve(distDirectory);
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const entries = entryFiles ?? [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/g)].map(match => match[1]);
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    const name = relative(root, file);
    if (name.startsWith("..")) throw new Error(`Startup module escapes build directory: ${name}`);
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.text);
      if (/\.(?:m?js)$/.test(target)) visit(target);
    }
  };
  for (const entry of entries) visit(resolve(root, entry.replace(/^\.?\//, "")));
  return {
    initialJavaScriptBytes: [...visited].reduce((total, file) => total + statSync(file).size, 0),
    initialJavaScriptFiles: [...visited].map(file => relative(root, file)).sort(),
  };
};
