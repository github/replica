export interface LogTraversal {
  ancestors: WeakSet<object>
  entries: number
  sensitiveKeyPattern: RegExp
}
