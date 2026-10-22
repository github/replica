import { isAbsolute, relative, resolve } from "node:path"

import ts from "typescript"

import type { UsageIndex } from "./types"

export function analyzeUsage(root: string): UsageIndex {
  const configPath = resolve(root, "tsconfig.json")
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path))
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length) {
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
        .join("\n"),
    )
  }

  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const index: UsageIndex = { components: {}, stories: {} }
  function pathFor(file: ts.SourceFile) {
    return relative(root, file.fileName).replaceAll("\\", "/")
  }
  function isProduction(path: string) {
    return (
      /^(app\/javascript\/|app\/views\/)/.test(path) &&
      !/(^|\/)(storybook|test|tests|__tests__|fixtures|__fixtures__)(\/|$)|(^|\/)stories\.[^.]+$|\.(test|spec|stories)\.[^.]+$/.test(
        path,
      )
    )
  }
  const files = program.getSourceFiles().filter((file) => {
    const path = pathFor(file)
    return !file.isDeclarationFile && !isAbsolute(path) && !path.startsWith("../")
  })

  function declarationPath(node: ts.Node): string | undefined {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol)
    }
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    if (!declaration) return
    const path = pathFor(declaration.getSourceFile())
    return isProduction(path) ? path : undefined
  }

  function objectValue(
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
  ): ts.ObjectLiteralExpression | undefined {
    if (seen.has(expression)) return
    seen.add(expression)
    if (ts.isObjectLiteralExpression(expression)) return expression
    if (
      ts.isSatisfiesExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isParenthesizedExpression(expression)
    ) {
      return objectValue(expression.expression, seen)
    }
    if (ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return objectValue(declaration.initializer, seen)
      }
    }
  }

  for (const file of files) {
    const path = pathFor(file)
    if (isProduction(path)) index.components[path] = { consumers: [], surfaces: [] }
    if (!/(^|\/)stories\.tsx$/.test(path)) continue
    index.stories[path] = []
    for (const statement of file.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue
      const meta = objectValue(statement.expression)
      for (const property of meta?.properties ?? []) {
        if (!ts.isPropertyAssignment(property) || property.name.getText(file) !== "component")
          continue
        const value = property.initializer
        const target = declarationPath(ts.isPropertyAccessExpression(value) ? value.name : value)
        if (target) index.stories[path].push(target)
      }
    }
  }

  for (const file of files) {
    const path = pathFor(file)
    if (!isProduction(path)) continue
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName
        const target = declarationPath(ts.isPropertyAccessExpression(tag) ? tag.name : tag)
        if (target && target !== path) {
          const usage = index.components[target]
          if (usage) {
            let consumer = usage.consumers.find((consumer) => consumer.path === path)
            if (!consumer) {
              consumer = { path, lines: [] }
              usage.consumers.push(consumer)
            }
            const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
            consumer.lines.push(line)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }

  for (const [path, usage] of Object.entries(index.components)) {
    const visited = new Set([path])
    const pending = usage.consumers.map((consumer) => consumer.path)
    while (pending.length) {
      const consumer = pending.pop()!
      if (visited.has(consumer)) continue
      visited.add(consumer)
      if (/^app\/javascript\/(pages|application)\/|^app\/views\//.test(consumer)) {
        usage.surfaces.push(consumer)
      }
      pending.push(...(index.components[consumer]?.consumers.map((item) => item.path) ?? []))
    }
    usage.consumers.sort((a, b) => a.path.localeCompare(b.path))
    usage.surfaces.sort()
  }

  return index
}
