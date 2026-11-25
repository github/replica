export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settled) => {
    resolve = settled
  })
  return { promise, resolve }
}
