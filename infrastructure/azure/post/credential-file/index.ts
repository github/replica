import { lstat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createPrivateKey } from "node:crypto"

import { InputValidationError } from "../../../installer/config/fields/index.ts"
import { readPrivateFile } from "../../../installer/private-files/index.ts"

export async function readPostCredentialFile(
  input: string,
  kind: "GITHUB_CLIENT_SECRET" | "GITHUB_APP_PRIVATE_KEY_BASE64" | "GITHUB_WEBHOOK_SECRET",
) {
  let value = input.trim()
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  if (quoted) value = value.slice(1, -1)
  value = value.replace(/\\([ ()'"\[\]#&;])/g, "$1")
  if (value === "~") value = homedir()
  else if (value.startsWith("~/")) value = join(homedir(), value.slice(2))
  if (!value || /[\u0000-\u001f\u007f]/.test(value))
    throw new InputValidationError(
      "Enter a credential-file path, not credential text. Surrounding whitespace and matching quotes are optional.",
    )
  const path = resolve(value)
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const fileFix = `Use a current-user-owned regular file with chmod 600 ${quote(path)} inside a private directory with chmod 700 ${quote(dirname(path))}. Symlinks and hardlinks are not accepted.`
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      throw new InputValidationError(`This path is not a standalone regular file. ${fileFix}`)
    if (metadata.uid !== process.getuid?.())
      throw new InputValidationError(
        `The file is owned by UID ${metadata.uid}, not the current user. Ask its owner to provide a current-user-owned private copy. ${fileFix}`,
      )
    if ((metadata.mode & 0o077) !== 0)
      throw new InputValidationError(
        `The file mode is ${(metadata.mode & 0o777).toString(8)}; group/other access is not allowed. ${fileFix}`,
      )
    const parent = await lstat(dirname(path))
    if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0)
      throw new InputValidationError(
        `The containing directory must be current-user-owned and private; its current mode is ${(parent.mode & 0o777).toString(8)}. ${fileFix}`,
      )
    if (metadata.size > 32_768)
      throw new InputValidationError(
        "The credential file exceeds 32 KiB. Choose the individual client secret, webhook secret, or RSA PEM file, not a bundle.",
      )
    const content = (await readPrivateFile(path, { createDirectory: false }))?.trim()
    if (!content)
      throw new InputValidationError(
        "The credential file is empty or its directory is missing. Save the required credential, then recheck.",
      )
    if (kind === "GITHUB_CLIENT_SECRET" && !/^\S{1,2000}$/.test(content))
      throw new InputValidationError(
        "The client-secret file must contain only the nonempty GitHub App client secret, at most 2000 characters and without whitespace.",
      )
    if (kind === "GITHUB_WEBHOOK_SECRET" && (content.length < 20 || content.length > 2_000))
      throw new InputValidationError(
        "The webhook-secret file must contain 20-2000 characters matching the secret entered in GitHub.",
      )
    if (kind === "GITHUB_APP_PRIVATE_KEY_BASE64") {
      let rsa = false
      try {
        rsa = content.length <= 16_384 && createPrivateKey(content).asymmetricKeyType === "rsa"
      } catch {
        /* Invalid file content is corrected in the prompt. */
      }
      if (!rsa)
        throw new InputValidationError(
          "The private-key file must be a valid RSA PEM private key from this GitHub App, at most 16 KiB. Choose the downloaded .pem file, not its path in a text file or an EC/public key.",
        )
    }
    return {
      path,
      value:
        kind === "GITHUB_APP_PRIVATE_KEY_BASE64"
          ? Buffer.from(content).toString("base64")
          : content,
    }
  } catch (error) {
    if (error instanceof InputValidationError) throw error
    if (!(error instanceof Error)) throw error
    if ("code" in error && error.code === "ENOENT")
      throw new InputValidationError(
        `The file or its directory was not found. Check the path, create/download the file, or choose another path. ${fileFix}`,
      )
    if ("code" in error && ["EACCES", "EPERM"].includes(String(error.code)))
      throw new InputValidationError(`The file cannot be read with current permissions. ${fileFix}`)
    if (error.message.startsWith("Setup "))
      throw new InputValidationError(`${error.message} ${fileFix}`)
    throw error
  }
}
