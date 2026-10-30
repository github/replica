import { Button, FormControl, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { GithubAppPageData } from "./types"
import "./styles.css"

/** Confirms deployment changes with empty, write-only credential fields. */
export function GithubAppPage({ data }: { data: GithubAppPageData }) {
  const form = data.form

  return (
    <HubAdministrationPage data={data}>
      {data.identity ? <Text as="p">{data.identity}</Text> : null}
      {data.installation ? <Text as="p">{data.installation}</Text> : null}
      {data.paragraphs.map((paragraph) => (
        <Text as="p" key={paragraph}>
          {paragraph}
        </Text>
      ))}
      {data.busyLabel ? <HubAlert variant="warning" title={data.busyLabel} /> : null}

      {data.links.length ? (
        <div className="hub-administration-page__actions">
          {data.links.map((link) => (
            <Button as="a" href={link.path} variant="secondary" key={link.path}>
              {link.label}
            </Button>
          ))}
        </div>
      ) : null}

      {form ? (
        <>
          <Text as="p">{data.verification}</Text>
          {form.blockedLabel ? <HubAlert variant="warning" title={form.blockedLabel} /> : null}

          <form
            action={form.action}
            method="post"
            encType={form.credentials ? "multipart/form-data" : undefined}
            autoComplete="off"
            className="github-app-page__form"
          >
            {form.method !== "post" ? (
              <input type="hidden" name="_method" value={form.method} />
            ) : null}
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <input type="hidden" name="configuration_id" value={data.configurationId ?? ""} />
            <input type="hidden" name="expected_version" value={data.version ?? ""} />
            {form.operation ? (
              <input type="hidden" name="operation" value={form.operation} />
            ) : null}

            {form.credentials ? (
              <>
                <FormControl id="github-app-client-secret" required fullWidth>
                  <FormControl.Label>{form.credentials.secretLabel}</FormControl.Label>
                  <TextInput
                    type="password"
                    name="client_secret"
                    autoComplete="new-password"
                    maxLength={4096}
                    required
                    disabled={form.disabled}
                    aria-describedby="github-app-credential-limits"
                    fullWidth
                  />
                </FormControl>
                <label className="github-app-page__field">
                  <span>{form.credentials.keyLabel}</span>
                  <input
                    type="file"
                    name="private_key"
                    accept=".pem"
                    required
                    disabled={form.disabled}
                    aria-describedby="github-app-credential-limits"
                  />
                </label>
                <Text as="p" id="github-app-credential-limits">
                  {form.credentials.limits}
                </Text>
              </>
            ) : null}

            {form.confirmationPhraseLabel ? (
              <FormControl id="github-app-reset-confirmation" required fullWidth>
                <FormControl.Label>{form.confirmationPhraseLabel}</FormControl.Label>
                <TextInput
                  type="text"
                  name="confirmation"
                  pattern="delete local GitHub App configuration"
                  required
                  disabled={form.disabled}
                  fullWidth
                />
              </FormControl>
            ) : null}
            <label className="github-app-page__confirmation">
              <input type="checkbox" name="confirmed" value="1" required disabled={form.disabled} />
              <span>{form.confirmLabel}</span>
            </label>

            <div className="hub-administration-page__actions">
              <Button type="submit" variant="primary" disabled={form.disabled}>
                {form.submitLabel}
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </HubAdministrationPage>
  )
}
