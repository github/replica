export interface Installation {
  name: string
  owner: string
  subscription_id: string
  resource_group: string
  app_name: string
  setup_job_name: string
  storage_account: string
  release_container: string
  release_blob: string
  app_created: boolean
  url: string
}

export interface DeploymentPlan {
  variables: Record<string, { value: string }>
  resource_changes?: { change: { actions: string[] } }[]
}

export interface Revision {
  name: string
  properties: { active: boolean }
}

export interface JobExecution {
  name: string
  properties: { status: string }
}

export interface ContainerApp {
  properties: { latestRevisionName: string; latestReadyRevisionName?: string }
}
