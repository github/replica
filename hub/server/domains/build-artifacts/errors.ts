/** A Build package that can never become valid by retrying the import. */
export class BuildPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BuildPackageError"
  }
}
