import { useState } from "react"

import { Button, FormControl, Heading, Stack, Text, TextInput } from "@primer/react-brand"

import { ReplicaLogo } from "@components/replica-logo"

import type { SignInPageProps } from "./types"
import "./styles.css"

export function SignInPage({
  configured,
  loading,
  user,
  error,
  onSignIn,
  onSignOut,
  onBootstrap,
  onRecovery,
}: SignInPageProps) {
  const [bootstrapSecret, setBootstrapSecret] = useState("")
  const [recoverySecret, setRecoverySecret] = useState("")
  return (
    <main className="sign-in-page">
      <Stack direction="vertical" gap="normal" alignItems="center">
        <ReplicaLogo />
        <Heading as="h1" size="3">
          Replica Hub
        </Heading>
        {user ? (
          <>
            <Text as="p">
              Signed in as <strong>{user.displayName ?? user.username}</strong>
              {user.username ? ` (@${user.username})` : ""}.
            </Text>
            <Button type="button" variant="subtle" disabled={loading} onClick={onSignOut}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Text as="p">
              Sign in with GitHub to create a Hub session. Repository access is authorized
              separately.
            </Text>
            <Button
              type="button"
              variant="primary"
              disabled={loading || !configured}
              onClick={onSignIn}
            >
              Sign in with GitHub
            </Button>
            {!configured && (
              <Text as="p">GitHub sign-in has not been configured for this Hub.</Text>
            )}
            {configured ? (
              <div className="sign-in-page__enrollment">
                <details>
                  <summary>Enroll the first administrator</summary>
                  <FormControl>
                    <FormControl.Label>Bootstrap secret</FormControl.Label>
                    <TextInput
                      type="password"
                      value={bootstrapSecret}
                      disabled={loading}
                      onChange={(event) => setBootstrapSecret(event.target.value)}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading || !bootstrapSecret}
                    onClick={() => onBootstrap(bootstrapSecret)}
                  >
                    Continue enrollment
                  </Button>
                </details>
                <details>
                  <summary>Recover administration</summary>
                  <FormControl>
                    <FormControl.Label>Recovery secret</FormControl.Label>
                    <TextInput
                      type="password"
                      value={recoverySecret}
                      disabled={loading}
                      onChange={(event) => setRecoverySecret(event.target.value)}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading || !recoverySecret}
                    onClick={() => onRecovery(recoverySecret)}
                  >
                    Continue recovery
                  </Button>
                </details>
              </div>
            ) : null}
          </>
        )}
        {error && (
          <Text as="p" className="sign-in-page__error" role="alert">
            {error}
          </Text>
        )}
      </Stack>
    </main>
  )
}
