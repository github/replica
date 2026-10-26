import { Button, FormControl, Heading, Text, TextInput } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import type { GithubAppSetupManualPageData } from "./types"

import "./styles.css"

/** Guides an operator through GitHub's settings before importing App credentials. */
export function GithubAppSetupManualPage({ data }: { data: GithubAppSetupManualPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />

      {data.error ? (
        <Text as="p" role="alert">
          {data.error}
        </Text>
      ) : null}

      {data.instructions.map((step, index) => (
        <section key={step.title} className="setup-manual__section">
          <Heading as="h2" size="6">
            {step.title}
          </Heading>
          <Text as="p">{step.body}</Text>
          {index === 0 || index === 1 ? (
            <dl className="setup-manual__settings">
              {(index === 0 ? data.settings : data.permissions).map((setting) => (
                <div key={setting.label}>
                  <dt>{setting.label}</dt>
                  <dd>
                    <code>{setting.value}</code>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ))}

      <form
        action={data.submitPath}
        method="post"
        encType="multipart/form-data"
        className="setup-manual__section"
      >
        <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
        {data.fields.map((field) => (
          <FormControl key={field.name} required fullWidth>
            <FormControl.Label>{field.label}</FormControl.Label>
            <TextInput
              name={field.name}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              maxLength={field.secret ? 4096 : 255}
              fullWidth
            />
            <FormControl.Hint>{field.hint}</FormControl.Hint>
          </FormControl>
        ))}
        <label className="setup-manual__section">
          <span>{data.keyLabel}</span>
          <input
            type="file"
            name="private_key"
            accept=".pem"
            required
            aria-describedby="setup-key-hint"
          />
          <span id="setup-key-hint">{data.keyHint}</span>
        </label>
        <label className="setup-manual__confirmation">
          <input type="checkbox" name="confirmed" value="1" required />
          <span>{data.confirmLabel}</span>
        </label>
        <Button type="submit" variant="primary" block>
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
