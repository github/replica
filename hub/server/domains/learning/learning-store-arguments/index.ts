export function learningStoreArguments(store: {
  directory: string
  repositoryScope: string
  repositoryId: string
}) {
  if (!/^github\.com\/repositories\/[1-9][0-9]*$/.test(store.repositoryScope)) {
    throw new Error("The repository learning scope must contain a GitHub repository ID.")
  }
  return [
    "--dir",
    store.directory,
    "--repository",
    store.repositoryScope,
    "--legacy-repository",
    `github.com/repositories/${store.repositoryId}`,
  ]
}
