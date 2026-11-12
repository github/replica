export function chunkArray<Value>(values: readonly Value[], size: number) {
  const chunks: Value[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}
