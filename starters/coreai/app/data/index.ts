// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Mock data types and exports for the coreai-sandbox demo application.
 * This data is used throughout the app to simulate API responses.
 */

import agentsData from './agents.json';
import homeDataJson from './home.json';
import modelsData from './models.json';
import toolsData from './tools.json';

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Status of an agent in its lifecycle.
 * - draft: Agent is being developed/configured
 * - published: Agent is available in the marketplace
 * - deployed: Agent is actively running in production
 */
export type AgentStatus = 'draft' | 'published' | 'deployed';

/**
 * Represents an AI agent with its configuration and metadata.
 */
export interface Agent {
  /** Unique identifier for the agent */
  id: string;
  /** Display name of the agent */
  name: string;
  /** Description of the agent's purpose and capabilities */
  description: string;
  /** Current lifecycle status */
  status: AgentStatus;
  /** Tags for categorization and discovery */
  tags: string[];
  /** Owner/creator of the agent */
  owner: string;
  /** ISO 8601 timestamp of creation */
  createdDate: string;
  /** ISO 8601 timestamp of last update */
  updatedDate: string;
  /** Semantic version number */
  version: string;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Category classification for tools.
 */
export type ToolCategory =
  | 'Data'
  | 'Communication'
  | 'Productivity'
  | 'Storage'
  | 'Creative'
  | 'Analysis'
  | 'Language'
  | 'Development'
  | 'Media'
  | 'Visualization'
  | 'Utility'
  | 'Integration'
  | 'Security'
  | 'Content'
  | 'Finance';

/**
 * Represents a tool/function that agents can use.
 */
export interface Tool {
  mark: string;
  initialsColor: string;
  /** Unique identifier for the tool */
  id: string;
  /** Display name of the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Category for organization */
  category: ToolCategory;
  /** Whether the tool is publicly available */
  isPublished: boolean;
}

// ============================================================================
// Model Types
// ============================================================================

/**
 * Category classification for AI models.
 */
export type ModelCategory = 'Language' | 'Multimodal' | 'Image Generation' | 'Speech' | 'Embedding';

/**
 * Represents an AI model available in the platform.
 */
export interface Model {
  mark: string;
  initialsColor: string;
  /** Unique identifier for the model */
  id: string;
  /** Display name of the model */
  name: string;
  /** Description of the model's capabilities */
  description: string;
  /** Model provider/vendor */
  provider: string;
  /** Category for organization */
  category: ModelCategory;
  /** Version identifier */
  version: string;
  /** Maximum context window size */
  contextWindow: number;
  /** Whether the model is publicly available */
  isPublished: boolean;
  /** ISO 8601 date of release */
  releaseDate: string;
}

// ============================================================================
// Home Types
// ============================================================================

export interface HomeEndpoint {
  label: string;
  value: string;
}

export type HomeModelActionIcon = 'chat' | 'model' | 'compare';

export interface HomeModelAction {
  title: string;
  description: string;
  icon: HomeModelActionIcon;
}

export interface HomeCarouselModel {
  name: string;
  publisher: string;
  mark: string;
  initialsColor: string;
}

export interface RecentWorkItem {
  name: string;
  version: string;
  type: 'Agent' | 'Model';
  lastViewed: string;
}

export interface HomeData {
  endpoints: HomeEndpoint[];
  modelActions: HomeModelAction[];
  models: HomeCarouselModel[];
  recentWork: RecentWorkItem[];
}

// ============================================================================
// Data Exports
// ============================================================================

/**
 * All agents data.
 * Type assertion ensures JSON matches Agent interface at build time.
 */
export const agents: Agent[] = agentsData as Agent[];

/**
 * All tools data.
 * Type assertion ensures JSON matches Tool interface at build time.
 */
export const tools: Tool[] = toolsData as Tool[];

/**
 * All models data.
 * Type assertion ensures JSON matches Model interface at build time.
 */
export const models: Model[] = modelsData as Model[];

/**
 * Mock content displayed on the home route.
 */
export const homeData: HomeData = homeDataJson as HomeData;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Filters agents by their status.
 */
export function filterAgentsByStatus(agentList: Agent[], status: AgentStatus): Agent[] {
  return agentList.filter((agent) => agent.status === status);
}

/**
 * Filters tools by category.
 */
export function filterToolsByCategory(toolList: Tool[], category: ToolCategory): Tool[] {
  return toolList.filter((tool) => tool.category === category);
}

/**
 * Filters tools by published status.
 */
export function filterToolsByPublished(toolList: Tool[], isPublished: boolean): Tool[] {
  return toolList.filter((tool) => tool.isPublished === isPublished);
}
