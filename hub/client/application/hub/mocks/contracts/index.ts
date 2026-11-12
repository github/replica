import { z } from "zod"

import { mockProfiles, mockScenarios } from "./constants"

export const mockProfileSchema = z.enum(mockProfiles)
export const mockScenarioSchema = z.enum(mockScenarios)
