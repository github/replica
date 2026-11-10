import type { z } from "zod"

import type {
  administratorAuthorizationResponseSchema,
  administratorAuthorizationStartInputSchema,
  administratorAuthorizationStartResponseSchema,
  administratorCandidatesResponseSchema,
  administratorContinuationResponseSchema,
  administratorOperationSchema,
  administratorsResponseSchema,
  currentHubSessionSchema,
} from "."

export type AdministratorAuthorizationResponse = z.infer<
  typeof administratorAuthorizationResponseSchema
>
export type AdministratorAuthorizationStartInput = z.infer<
  typeof administratorAuthorizationStartInputSchema
>
export type AdministratorAuthorizationStartResponse = z.infer<
  typeof administratorAuthorizationStartResponseSchema
>
export type AdministratorCandidatesResponse = z.infer<typeof administratorCandidatesResponseSchema>
export type AdministratorContinuationResponse = z.infer<
  typeof administratorContinuationResponseSchema
>
export type AdministratorOperation = z.infer<typeof administratorOperationSchema>
export type AdministratorsResponse = z.infer<typeof administratorsResponseSchema>
export type CurrentHubSession = z.infer<typeof currentHubSessionSchema>
