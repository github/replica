import { Button, Heading, Stack, Text } from "@primer/react-brand"

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
}: SignInPageProps) {
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
