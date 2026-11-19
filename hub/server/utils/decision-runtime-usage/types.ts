export interface DecisionRuntimeUsage {
  connector: string
  kind: string
  quantity: number
  unit: string
  cost: number | null
  currency: string | null
  source: string
  metadata: Record<string, unknown>
}
