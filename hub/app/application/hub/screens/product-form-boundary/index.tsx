import type { ComponentProps, ReactNode } from "react"
import { useSubmit } from "react-router"

import { FlowFormBoundary } from "../../form-boundary"

import "./styles.css"

type Props = ComponentProps<typeof FlowFormBoundary> & { feedback?: ReactNode }

export function ProductFormBoundary({ children, feedback, ...props }: Props) {
  const submit = useSubmit()
  return (
    <div className="hub-product-flow">
      <FlowFormBoundary
        {...props}
        onSubmit={(input) => {
          if (input.get("_action") === "/session" && input.get("_method") === "delete") {
            void submit({ intent: "sign-out" }, { method: "post", action: "/session" })
            return
          }
          props.onSubmit(input)
        }}
      >
        {feedback ? <div className="hub-product-flow__result">{feedback}</div> : null}
        <div className="hub-product-flow__workspace">{children}</div>
      </FlowFormBoundary>
    </div>
  )
}
