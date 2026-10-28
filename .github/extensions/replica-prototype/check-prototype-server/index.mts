export type PrototypeServerStatus = { available: true } | { available: false; message: string }

export async function checkPrototypeServer(
  prototypeUrl: string,
  request = globalThis.fetch,
): Promise<PrototypeServerStatus> {
  try {
    const response = await request(prototypeUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    })
    await response.body?.cancel()
    // HTTP errors can be useful dev-server diagnostics; only a failed connection needs setup.
    return { available: true }
  } catch (error) {
    return {
      available: false,
      message: `Prototype server unavailable. Start it again or choose another server. ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
