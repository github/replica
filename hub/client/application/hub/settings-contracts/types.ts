import type { z } from "zod"

import type {
  analyticsDestinationSchema,
  canvasGrantSchema,
  learningRecordSchema,
  learningRunSchema,
  settingsAuditEventSchema,
  settingsCandidateResponseSchema,
  settingsMutationResponseSchema,
  settingsOperationSchema,
  settingsPublicResponseSchema,
  settingsQuerySchema,
  settingsWorkspaceResponseSchema,
} from "."

export type SettingsQuery = z.infer<typeof settingsQuerySchema>
export type SettingsOperation = z.infer<typeof settingsOperationSchema>
export type SettingsPublicResponse = z.infer<typeof settingsPublicResponseSchema>
export type SettingsWorkspaceResponse = z.infer<typeof settingsWorkspaceResponseSchema>
export type SettingsMutationResponse = z.infer<typeof settingsMutationResponseSchema>
export type SettingsCandidateResponse = z.infer<typeof settingsCandidateResponseSchema>
export type AnalyticsDestinationRecord = z.infer<typeof analyticsDestinationSchema>
export type CanvasGrantRecord = z.infer<typeof canvasGrantSchema>
export type LearningRecord = z.infer<typeof learningRecordSchema>
export type LearningRunRecord = z.infer<typeof learningRunSchema>
export type SettingsAuditEvent = z.infer<typeof settingsAuditEventSchema>
export type SettingsActionResult =
  { saved: true; notice: string; revision: number } | { saved: false; error: string }

export type SettingsSection =
  | "analytics"
  | "canvas"
  | "canvas-approval"
  | "copilot"
  | "authorize"
  | "github"
  | "github-setup"
  | "github-register"
  | "github-installed"
  | "admin-confirmation"
  | "enrollment"
  | "admins"
  | "learnings"
  | "notifications"
  | "audit"
  | "sessions"
  | "welcome"
