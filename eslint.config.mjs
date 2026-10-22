import hubConfig from "./hub/eslint.config.ts"

export default hubConfig.map((config) =>
  config.files?.some((pattern) => pattern.startsWith("../.github/extensions/replica-prototype/"))
    ? {
        ...config,
        files: config.files.map((pattern) =>
          pattern.startsWith("../") ? pattern.slice(3) : `hub/${pattern}`,
        ),
      }
    : config,
)
