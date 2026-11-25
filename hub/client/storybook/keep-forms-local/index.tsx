import type { Decorator } from "@storybook/react-vite"

export function keepFormsLocal(Story: Parameters<Decorator>[0]) {
  return (
    <div style={{ display: "contents" }} onSubmitCapture={(event) => event.preventDefault()}>
      <Story />
    </div>
  )
}
