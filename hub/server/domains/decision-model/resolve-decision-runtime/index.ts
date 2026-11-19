import type { DecisionModelDependencies } from "../types.ts"

export function resolveDecisionRuntime(
  dependencies: Pick<DecisionModelDependencies, "runtime" | "runtimeForRepository">,
  repositoryId: string,
) {
  const runtime = dependencies.runtimeForRepository?.(repositoryId) ?? dependencies.runtime
  if (!runtime) throw new Error("A decision runtime is required.")
  return runtime
}
