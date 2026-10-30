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

export class ExternalIdentityTupleTooLargeError extends Error {
  constructor() {
    super("The external identity tuple exceeds the 2000-byte UTF-8 index limit.")
    this.name = "ExternalIdentityTupleTooLargeError"
  }
}

export class ExternalIdentityTupleUnicodeError extends Error {
  constructor() {
    super("The external identity tuple contains invalid Unicode.")
    this.name = "ExternalIdentityTupleUnicodeError"
  }
}

export class ProviderRevisionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("The provider revision conflicted with another provider configuration change.", options)
    this.name = "ProviderRevisionConflictError"
  }
}

export class ProviderConfigurationValidationError extends Error {
  constructor(options?: ErrorOptions) {
    super("The provider configuration did not pass provider validation.", options)
    this.name = "ProviderConfigurationValidationError"
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
    super("The provider revision reuses a revision number with different validated configuration.")
    this.name = "ProviderRevisionDriftError"
  }
}

export class ProviderRevisionGapError extends Error {
  constructor() {
    super("The provider revision must immediately follow the selected revision.")
    this.name = "ProviderRevisionGapError"
  }
}
