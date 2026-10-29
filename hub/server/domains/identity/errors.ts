export class IdentityTransactionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("The identity transaction conflicted with another database change.", options)
    this.name = "IdentityTransactionConflictError"
  }
}

export class ExternalIdentityCollisionError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The external identity could not be created because its identity mapping collided.",
      options,
    )
    this.name = "ExternalIdentityCollisionError"
  }
}

export class ProviderRevisionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("The provider revision conflicted with another provider configuration change.", options)
    this.name = "ProviderRevisionConflictError"
  }
}

export class ProviderRevisionInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderRevisionInvariantError"
  }
}

export class ProviderRevisionRollbackError extends Error {
  constructor() {
    super("The provider revision is older than the selected revision.")
    this.name = "ProviderRevisionRollbackError"
  }
}

export class ProviderRevisionDriftError extends Error {
  constructor() {
    super("The provider revision reuses a revision number with different settings.")
    this.name = "ProviderRevisionDriftError"
  }
}

export class ProviderRevisionGapError extends Error {
  constructor() {
    super("The provider revision must immediately follow the selected revision.")
    this.name = "ProviderRevisionGapError"
  }
}
