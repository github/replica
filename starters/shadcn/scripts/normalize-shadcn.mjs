import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

function reject(reason) {
  throw new Error(`Cannot normalize shadcn Spinner: ${reason}. Review the installed registry source before updating the recipe.`)
}

function bindingsNamed(sourceFile, name, ts) {
  const kinds = new Set([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.BindingElement,
    ts.SyntaxKind.Parameter,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.ImportClause,
    ts.SyntaxKind.ImportSpecifier,
    ts.SyntaxKind.NamespaceImport,
  ])
  const bindings = []
  function visit(node) {
    if (kinds.has(node.kind) && node.name && ts.isIdentifier(node.name) && node.name.text === name) {
      bindings.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return bindings
}

function requireImportedValue(sourceFile, name, ts) {
  const bindings = bindingsNamed(sourceFile, name, ts)
  if (bindings.length !== 1) reject(`${name} must have one unshadowed import`)
  const imported = bindings[0]
  const clause = ts.isImportSpecifier(imported) ? imported.parent.parent : imported
  if (
    (!ts.isImportSpecifier(imported) && !ts.isImportClause(imported)) ||
    !ts.isImportClause(clause) || clause.isTypeOnly ||
    (ts.isImportSpecifier(imported) && imported.isTypeOnly)
  ) {
    reject(`${name} must be a value import`)
  }
}

function isStringType(node, value, ts) {
  return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) && node.literal.text === value
}

export function normalizeSpinnerSource(source, ts) {
  if (typeof source !== "string" || typeof ts?.createSourceFile !== "function") {
    reject("source text and the installed TypeScript compiler API are required")
  }
  const sourceFile = ts.createSourceFile("spinner.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (sourceFile.parseDiagnostics.length) reject("the installed source is not valid TSX")

  const bindings = bindingsNamed(sourceFile, "Spinner", ts)
  if (bindings.length !== 1 || !ts.isFunctionDeclaration(bindings[0]) || bindings[0].parent !== sourceFile) {
    reject("expected one top-level Spinner function declaration")
  }
  const spinner = bindings[0]
  if (
    !spinner.body || spinner.body.statements.length !== 1 ||
    spinner.parameters.length !== 1 || spinner.typeParameters?.length ||
    spinner.asteriskToken || spinner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    reject("expected a single-parameter Spinner with one return statement")
  }
  const statement = spinner.body.statements[0]
  if (!ts.isReturnStatement(statement) || !statement.expression) {
    reject("expected Spinner to return its icon directly")
  }
  let iconElement = statement.expression
  while (ts.isParenthesizedExpression(iconElement)) iconElement = iconElement.expression
  if (!ts.isJsxSelfClosingElement(iconElement) || !ts.isIdentifier(iconElement.tagName)) {
    reject("expected one self-closing imported icon")
  }
  const icon = iconElement.tagName.text
  requireImportedValue(sourceFile, icon, ts)
  const glyphAttributes = iconElement.attributes.properties.filter((attribute) =>
    ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === "icon",
  )
  if (glyphAttributes.length > 1) reject("expected at most one internally supplied icon attribute")
  if (glyphAttributes.length) {
    const initializer = glyphAttributes[0].initializer
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression || !ts.isIdentifier(initializer.expression)) {
      reject("expected icon={ImportedGlyph} for an internally supplied glyph")
    }
    requireImportedValue(sourceFile, initializer.expression.text, ts)
  }

  const parameter = spinner.parameters[0]
  let type = parameter.type
  if (
    parameter.dotDotDotToken || parameter.questionToken || parameter.initializer ||
    !type || !ts.isTypeReferenceNode(type)
  ) {
    reject("expected a single ComponentProps parameter type")
  }
  const omitted = ts.isIdentifier(type.typeName) && type.typeName.text === "Omit"
  if (omitted) {
    if (
      !glyphAttributes.length || type.typeArguments?.length !== 2 ||
      !isStringType(type.typeArguments[1], "icon", ts) ||
      !ts.isTypeReferenceNode(type.typeArguments[0])
    ) {
      reject("only an internally supplied icon may be omitted from Spinner props")
    }
    type = type.typeArguments[0]
  }
  if (
    !ts.isQualifiedName(type.typeName) ||
    !ts.isIdentifier(type.typeName.left) || type.typeName.left.text !== "React" ||
    type.typeName.right.text !== "ComponentProps" || type.typeArguments?.length !== 1
  ) {
    reject("expected the parameter type React.ComponentProps with one argument")
  }
  const argument = type.typeArguments[0]
  const aligned =
    ts.isTypeQueryNode(argument) && ts.isIdentifier(argument.exprName) &&
    argument.exprName.text === icon && !argument.typeArguments?.length
  if (!aligned && !isStringType(argument, "svg", ts)) {
    reject("expected the SVG argument or a type query for the returned icon")
  }
  const edits = []
  if (!aligned) {
    edits.push({ start: argument.getStart(sourceFile), end: argument.end, text: `typeof ${icon}` })
  }
  if (glyphAttributes.length && !omitted) {
    edits.push(
      { start: type.getStart(sourceFile), end: type.getStart(sourceFile), text: "Omit<" },
      { start: type.end, end: type.end, text: ', "icon">' },
    )
  }
  let normalized = source
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    normalized = `${normalized.slice(0, edit.start)}${edit.text}${normalized.slice(edit.end)}`
  }
  return {
    source: normalized,
    changed: edits.length > 0,
    icon,
  }
}

export function normalizeShadcn(cwd = process.cwd()) {
  const root = path.resolve(cwd)
  for (const relative of ["src", path.join("src", "components"), path.join("src", "components", "ui")]) {
    const stat = lstatSync(path.join(root, relative))
    if (!stat.isDirectory() || stat.isSymbolicLink()) reject(`expected a regular installed directory at ${relative}`)
  }
  const file = path.join(root, "src", "components", "ui", "spinner.tsx")
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) reject("expected a regular installed spinner.tsx file")
  const bytes = readFileSync(file)
  const source = bytes.toString("utf8")
  if (!Buffer.from(source, "utf8").equals(bytes)) reject("spinner.tsx must contain valid UTF-8")
  const require = createRequire(path.join(root, "package.json"))
  const result = normalizeSpinnerSource(source, require("typescript"))
  if (result.changed) writeFileSync(file, result.source)
  return result
}
