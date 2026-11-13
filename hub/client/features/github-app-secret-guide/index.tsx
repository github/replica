import { Heading, Text } from "@primer/react-brand"

import { CopyableCodeBlock } from "@components/copyable-code-block"
import { HubSegmentedControl } from "@components/hub-segmented-control"

import type { GithubAppSecretTarget } from "./types"

import "./styles.css"

type Props = {
  target: GithubAppSecretTarget
  onTargetChange: (target: GithubAppSecretTarget) => void
}

const targetOptions = [
  { label: "Deployed Hub (Key Vault)", value: "key-vault" },
  { label: "Local development (.env)", value: "local" },
] as const

const values = [
  { github: "App ID", vault: null, variable: "GITHUB_APP_ID" },
  { github: "Client ID", vault: null, variable: "GITHUB_CLIENT_ID" },
  { github: "Installation ID", vault: null, variable: "GITHUB_APP_INSTALLATION_ID" },
  { github: "Client secret", vault: "github-client-secret", variable: "GITHUB_CLIENT_SECRET" },
  {
    github: "Private key (.pem)",
    vault: "github-app-private-key",
    variable: "GITHUB_APP_PRIVATE_KEY_BASE64",
  },
  { github: "Webhook secret", vault: "github-webhook-secret", variable: "GITHUB_WEBHOOK_SECRET" },
] as const

const keyVaultCommands = `VAULT=YOUR-VAULT
umask 077
az keyvault secret set --vault-name "$VAULT" --name github-client-secret --file client-secret.txt --query id --output tsv
base64 < private-key.pem | tr -d '\\n' > private-key.pem.base64
az keyvault secret set --vault-name "$VAULT" --name github-app-private-key --file private-key.pem.base64 --query id --output tsv
az keyvault secret set --vault-name "$VAULT" --name github-webhook-secret --file webhook-secret.txt --query id --output tsv`

const terraformValues = `hub_application_origin    = "https://YOUR-HUB-HOST"
github_app_id              = "YOUR_APP_ID"
github_client_id           = "YOUR_CLIENT_ID"
github_app_installation_id = "YOUR_INSTALLATION_ID"
github_provider_revision   = 1
runtime_secret_references = {
  GITHUB_CLIENT_SECRET          = { key_vault_id = "...", secret_id = "https://YOUR-VAULT.vault.azure.net/secrets/github-client-secret/VERSION" }
  GITHUB_APP_PRIVATE_KEY_BASE64 = { key_vault_id = "...", secret_id = "https://YOUR-VAULT.vault.azure.net/secrets/github-app-private-key/VERSION" }
  GITHUB_WEBHOOK_SECRET         = { key_vault_id = "...", secret_id = "https://YOUR-VAULT.vault.azure.net/secrets/github-webhook-secret/VERSION" }
}`

const localCommand = "npm run env:init -- --private-key ~/Downloads/your-app.private-key.pem"

/** Shows where each GitHub App value is stored without ever handling a secret value. */
export function GithubAppSecretGuide({ target, onTargetChange }: Props) {
  return (
    <section className="setup-section" aria-labelledby="github-app-secret-heading">
      <Heading as="h2" size="5" id="github-app-secret-heading">
        2. Store the App&apos;s values
      </Heading>
      <Text as="p" size="100">
        Hub never accepts GitHub App secrets in the browser. Store them where the server reads its
        configuration, then restart or redeploy it.
      </Text>
      <HubSegmentedControl
        aria-label="Where this Hub reads its configuration"
        options={targetOptions}
        value={target}
        onChange={onTargetChange}
        fullWidth
        size="small"
      />

      <div className="github-app-values">
        <table>
          <caption>Where each GitHub App value goes</caption>
          <thead>
            <tr>
              <th scope="col">GitHub value</th>
              <th scope="col">{target === "key-vault" ? "Key Vault secret" : "Storage"}</th>
              <th scope="col">Environment variable</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value) => (
              <tr key={value.variable}>
                <th scope="row">{value.github}</th>
                <td>
                  {target === "local" ? (
                    ".env"
                  ) : value.vault ? (
                    <code>{value.vault}</code>
                  ) : (
                    "Terraform variable"
                  )}
                </td>
                <td>
                  <code>{value.variable}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target === "key-vault" ? (
        <>
          <Text as="p" size="100">
            Work in a new private directory so these commands do not overwrite existing files. Run{" "}
            <code>umask 077</code> before saving secrets to files, then store them in Key Vault and
            delete the local files. Generate the webhook secret with{" "}
            <code>openssl rand -hex 32 | tr -d &apos;\n&apos; &gt; webhook-secret.txt</code> and
            enter the same value in the App&apos;s webhook settings. The commands print versioned
            secret IDs, not secret values.
          </Text>
          <CopyableCodeBlock
            code={keyVaultCommands}
            label="Store GitHub App secrets in Key Vault"
          />
          <Text as="p" size="100">
            Add the identifiers and versioned secret references to your Terraform variables, then
            run the serialized Hub release. Merge these references with the existing shared
            authentication secrets in <code>runtime_secret_references</code>. Use revision 1 for a
            new App; increase the existing revision for changes.
          </Text>
          <CopyableCodeBlock code={terraformValues} label="Terraform variables" />
        </>
      ) : (
        <>
          <Text as="p" size="100">
            From the <code>hub</code> directory, run the helper. It encodes the private key and adds
            missing local values to <code>.env</code> without replacing existing values. Generate a
            webhook secret with <code>openssl rand -hex 32</code> and use the same value in GitHub
            and <code>.env</code>. Add the remaining GitHub values, then restart{" "}
            <code>npm run dev:api</code>.
          </Text>
          <CopyableCodeBlock code={localCommand} label="Write local GitHub App settings" />
        </>
      )}

      <Heading as="h3" size="6">
        Rotating a secret
      </Heading>
      <ol className="github-app-rotation">
        <li>Generate a new client secret or private key on GitHub. Keep the old one for now.</li>
        <li>
          {target === "key-vault"
            ? "Store it as a new Key Vault version, update its versioned reference, increase github_provider_revision, and run the serialized Hub release."
            : "Replace the value in .env, increase GITHUB_PROVIDER_REVISION, and restart."}
        </li>
        <li>
          Run Test connection below and sign in with GitHub, then delete the old secret or key on
          GitHub.
        </li>
      </ol>
    </section>
  )
}
