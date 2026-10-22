import { capturePublishTarget, samePublishTarget } from "../publish-target/index.mjs"
import { readWorkingTreeChanges } from "../working-tree-changes/index.mjs"

export async function preparePublish(context, preferences) {
  const target = await capturePublishTarget(context)
  const changes = await readWorkingTreeChanges(context.repositoryPath)
  const remember = await preferences.read(target)
  if (!samePublishTarget(target, await capturePublishTarget(context)))
    throw Object.assign(new Error("The checkout changed while preparing to publish. Try again."), {
      statusCode: 409,
    })
  return {
    target,
    workingTree: changes.state,
    ...(changes.state === "unavailable"
      ? { workingTreeError: changes.error }
      : { changes: { files: changes.files, localSkills: changes.localSkills } }),
    remember,
  }
}
