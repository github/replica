import { data } from "react-router"

import type { ProductActionResult } from "../../product-contracts"
import { ApiContractError } from "../../requests/api-contract-error"
import { ApiRequestError } from "../../requests/api-request-error"

export function productActionError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return data<ProductActionResult>(
      { saved: false, error: error.message },
      { status: error.status >= 400 && error.status <= 599 ? error.status : 503 },
    )
  }
  if (error instanceof ApiContractError) {
    return data<ProductActionResult>(
      {
        saved: false,
        error: "The API response was invalid. The mock change could not be confirmed.",
      },
      { status: 502 },
    )
  }
  throw error
}
