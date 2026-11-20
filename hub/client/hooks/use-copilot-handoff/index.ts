import { useRef, useState } from "react"

export function useCopilotHandoff(authorize: (() => Promise<boolean | "copy">) | undefined) {
  const checking = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function prepare(openDialog: () => void, offerCopy?: () => void) {
    if (!authorize) {
      openDialog()
      return
    }
    if (checking.current) return
    checking.current = true
    setPending(true)
    setError(null)
    try {
      const permission = await authorize()
      if (permission === true) openDialog()
      else if (permission === "copy" && offerCopy) offerCopy()
      else setError("You do not have permission to create a prototype in this repository.")
    } catch {
      setError("Hub could not check repository access. Try again.")
    } finally {
      checking.current = false
      setPending(false)
    }
  }

  return { prepare, pending, error }
}
