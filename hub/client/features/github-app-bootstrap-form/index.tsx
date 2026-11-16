import { Button, FormControl, TextInput } from "@primer/react-brand"
import { useState } from "react"
import type { SubmitEvent } from "react"

import { HubAlert } from "@components/hub-alert"

type Props = {
  error: string | null
  pending: boolean
  onSubmit: (secret: string) => void
}

/** Asks for the host bootstrap secret before setup status is disclosed. */
export function GithubAppBootstrapForm({ error, pending, onSubmit }: Props) {
  const [secret, setSecret] = useState("")

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (secret) onSubmit(secret)
  }

  return (
    <form className="setup__form" onSubmit={submit}>
      {error ? (
        <HubAlert variant="critical" title="Setup is still locked" description={error} />
      ) : null}
      <FormControl required>
        <FormControl.Label>Bootstrap secret</FormControl.Label>
        <TextInput
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          fullWidth
        />
        <FormControl.Hint>
          Use the HUB_BOOTSTRAP_SECRET value from this Hub&apos;s host configuration.
        </FormControl.Hint>
      </FormControl>
      <Button type="submit" variant="primary" disabled={pending || !secret} block>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  )
}
