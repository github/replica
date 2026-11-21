export function createBuildPreviewPath(
  repositoryId: bigint | string | null,
  workflowRunId: bigint | string | null,
): string | null {
  if (
    repositoryId === null ||
    workflowRunId === null ||
    !/^[1-9]\d*$/.test(String(repositoryId)) ||
    !/^[1-9]\d*$/.test(String(workflowRunId))
  )
    return null
  return `/previews/github/${repositoryId}/${workflowRunId}/`
}
