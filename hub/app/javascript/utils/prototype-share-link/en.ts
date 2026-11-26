export const prototypeLinkCopy = {
  build: (number: number) => `Build ${number}`,
  copyBuildNumber: (number: number) => `Copy link to Build ${number}`,
  copiedBuild: (number: number) => `Link to Build ${number} copied`,
  menuCopyError: "Could not copy the link. Open the Build and copy its address.",
} as const
