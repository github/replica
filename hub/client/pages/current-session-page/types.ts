export interface CurrentSessionPageData {
  heading: string
  description: string
  notice: string | null
  roleLabel: string
  administratorLabel?: string
  administratorPath?: string | null
  signOutLabel: string
  signOutPath: string
}
