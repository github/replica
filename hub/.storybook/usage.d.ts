declare module "virtual:storybook-component-usage" {
  // Ambient modules cannot use a relative import declaration.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const index: import("./analyze-usage/types").UsageIndex
  export default index
}
