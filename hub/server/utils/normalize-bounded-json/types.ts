export type NormalizedJsonPrimitive = boolean | number | string | null
export type NormalizedJsonValue =
  NormalizedJsonPrimitive | NormalizedJsonValue[] | NormalizedJsonObject

export interface NormalizedJsonObject {
  [key: string]: NormalizedJsonValue
}

export interface NormalizeBoundedJsonLimits {
  maxArrayItems: number
  maxBytes: number
  maxDepth: number
  maxEntries: number
  maxKeyLength: number
  maxObjectFields: number
  maxStringLength: number
}
