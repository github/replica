// @vitest-environment node
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import { expect, it } from "vitest"

const cwd = fileURLToPath(new URL(".", import.meta.url))

it("accepts ordinary typed React source without requiring a design system", async () => {
  const eslint = new ESLint({ cwd })
  const [result] = await eslint.lintText(
    `import { useState } from "react"
export function Counter() {
  const [count, setCount] = useState<number>(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
`,
    { filePath: "src/lint-contract.tsx" },
  )
  expect(result.messages).toEqual([])
})

it("reports unused TypeScript bindings and conditional React hooks as lint errors", async () => {
  const eslint = new ESLint({ cwd })
  const [result] = await eslint.lintText(
    `
      import { useState } from "react"
      export function Counter({ enabled }: { enabled: boolean }) {
        const unused: number = 1
        if (enabled) {
          const [count] = useState(0)
          return <span>{count}</span>
        }
        return null
      }
    `,
    { filePath: "src/lint-contract.tsx" },
  )
  const errors = result.messages.filter((message) => message.severity === 2)
  expect(errors.map((message) => message.ruleId)).toEqual(
    expect.arrayContaining(["@typescript-eslint/no-unused-vars", "react-hooks/rules-of-hooks"]),
  )
  expect(errors.every((message) => !message.fatal)).toBe(true)
})

it("enforces GitHub's recommended, browser, and React rules", async () => {
  const eslint = new ESLint({ cwd })
  const [result] = await eslint.lintText(
    `
      export function load() {
        return Promise.resolve(1).then((value) => value + 1)
      }
      export function replaceContent(element: HTMLElement) {
        element.innerHTML = "<b>Updated</b>"
      }
      export function Icon() {
        return <svg />
      }
    `,
    { filePath: "src/lint-contract.tsx" },
  )
  const errors = result.messages.filter((message) => message.severity === 2)
  expect(errors.map((message) => message.ruleId)).toEqual(
    expect.arrayContaining([
      "github/no-then",
      "github/no-inner-html",
      "github/a11y-svg-has-accessible-name",
    ]),
  )
  expect(errors.every((message) => !message.fatal)).toBe(true)
})
