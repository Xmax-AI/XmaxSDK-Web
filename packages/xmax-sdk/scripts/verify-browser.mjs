import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(packageRoot, "dist/browser");
const modules = [];

/** Finds browser modules without including metadata or source maps. */
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path);
    } else if (entry.name.endsWith(".js")) {
      modules.push(path);
    }
  }
}

await collect(outputRoot);
assert.ok(modules.length > 1, "The browser build must retain lazy dependency chunks");
const entryPath = resolve(outputRoot, "index.js");
assert.ok(modules.includes(entryPath), "The browser entry is missing");
const trees = new Map();

for (const path of modules) {
  const text = await readFile(path, "utf8");
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  trees.set(path, tree);
  const imports = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      assert.ok(specifier && ts.isStringLiteralLike(specifier), `Computed import in ${relative(outputRoot, path)}`);
      imports.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const specifier of imports) {
    assert.ok(/^\.\.?\//.test(specifier), `External module ${specifier} in ${relative(outputRoot, path)}`);
    const dependency = resolve(dirname(path), specifier);
    assert.ok(dependency.startsWith(`${outputRoot}${sep}`), `Import escapes the distribution: ${specifier}`);
    assert.ok((await stat(dependency)).isFile(), `Missing browser dependency: ${specifier}`);
  }
}

// Check runtime exports against source rather than a potentially stale npm build.
const configPath = resolve(packageRoot, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
const sourcePath = resolve(packageRoot, "src/index.ts");
const program = ts.createProgram([sourcePath], parsed.options);
const checker = program.getTypeChecker();
const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(sourcePath));
assert.ok(moduleSymbol, "The SDK source entry must be a module");
const expected = checker.getExportsOfModule(moduleSymbol).filter(symbol => {
  if (symbol.declarations?.some(declaration => ts.isExportSpecifier(declaration) &&
    (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly))) return false;
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return Boolean(target.flags & ts.SymbolFlags.Value);
}).map(symbol => symbol.name).sort();
const actual = trees.get(entryPath).statements.flatMap(statement =>
  ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.map(element => element.name.text) : [],
).sort();
assert.deepEqual(actual, expected, "The browser build must preserve the SDK runtime exports");

assert.ok((await stat(resolve(outputRoot, "LICENSE"))).isFile());
console.log(`Verified ${modules.length} browser modules and ${actual.length} public exports; all module imports resolve inside dist/browser.`);
