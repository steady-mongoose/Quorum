/**
 * Loads the board's TSX in the rendered More-menu test.
 * Node's type stripper does not parse JSX, and the `@/` alias is Vite's.
 */
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcRoot = path.join(root, "src");

function sourceFile(specifier) {
  const candidates = [
    specifier,
    `${specifier}.ts`,
    `${specifier}.tsx`,
    path.join(specifier, "index.ts"),
    path.join(specifier, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && !existsSync(path.join(candidate, "package.json")));
}

export async function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier) || specifier.startsWith("node:")) return nextResolve(specifier, context);
  const parentFile = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : "";
  const fromSrc = parentFile.startsWith(srcRoot);
  let file = null;
  if (specifier.startsWith("@/")) file = sourceFile(path.join(srcRoot, specifier.slice(2)));
  else if (fromSrc && specifier.startsWith(".")) file = sourceFile(path.resolve(path.dirname(parentFile), specifier));
  if (file) return { url: pathToFileURL(file).href, shortCircuit: true, format: "module" };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || (!url.endsWith(".ts") && !url.endsWith(".tsx"))) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  if (!filename.startsWith(srcRoot)) return nextLoad(url, context);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  return { format: "module", source, shortCircuit: true };
}
