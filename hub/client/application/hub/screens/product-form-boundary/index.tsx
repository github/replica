import type { ComponentProps, ReactNode } from "react"

import { FormBoundary } from "@application/hub/form-boundary"

import "./styles.css"

type Props = ComponentProps<typeof FormBoundary> & { feedback?: ReactNode }

export function ProductFormBoundary({ children, feedback, ...props }: Props) {
  return (
    <div className="hub-product-flow">
      <FormBoundary {...props}>
        {feedback ? <div className="hub-product-flow__result">{feedback}</div> : null}
        <div className="hub-product-flow__workspace">{children}</div>
      </FormBoundary>
    </div>
  )
}
