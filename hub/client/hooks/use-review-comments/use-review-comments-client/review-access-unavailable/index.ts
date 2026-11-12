/** Detects responses that require removing protected review data. */
export function reviewAccessUnavailable(response: Response) {
  return (
    response.redirected ||
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 503
  )
}
