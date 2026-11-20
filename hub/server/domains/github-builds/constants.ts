export const distArtifactName = "replica-build-v1"
export const screenshotArtifactName = "replica-screenshots-v1"
// Leaves room for ZIP headers around a package at the extracted-size limit.
export const maximumArtifactDownloadBytes = 160 * 1024 * 1024
// Matches the 3-day retention of the Replica Build artifacts; older ones have expired.
export const githubBuildRecoveryWindowMs = 3 * 24 * 60 * 60 * 1_000
