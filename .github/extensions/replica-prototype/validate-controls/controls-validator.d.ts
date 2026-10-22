declare module "*/assets/controls-validator.mjs" {
  export type ControlsValidationIssue = { path: string; message: string }

  export class ControlsValidationError extends Error {
    issues: ControlsValidationIssue[]
    constructor(issues: ControlsValidationIssue[])
  }

  export function validateControlsDocument(document: unknown): unknown
}
