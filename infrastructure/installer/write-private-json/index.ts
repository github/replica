import { writePrivateFile } from "../private-files/index.ts"

export async function writePrivateJson(
  path: string,
  value: unknown,
  options?: { exclusive?: boolean },
): Promise<void> {
  await writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`, options)
}
