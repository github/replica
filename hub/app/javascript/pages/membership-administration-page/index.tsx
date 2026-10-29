import { useState } from "react"

import { Button, FormControl, Heading, Select, Stack, Text, TextInput } from "@primer/react-brand"

import type { MembershipAdministrationPageProps } from "./types"
import "./styles.css"

export function MembershipAdministrationPage({
  memberships,
  invitations,
  hasMoreMemberships,
  hasMoreInvitations,
  loading,
  error,
  onInvite,
  onChange,
  onRevokeInvitation,
  onLoadMoreMemberships,
  onLoadMoreInvitations,
  onSignOut,
}: MembershipAdministrationPageProps) {
  const [provider, setProvider] = useState("github")
  const [issuer, setIssuer] = useState("https://github.com")
  const [subject, setSubject] = useState("")
  const [role, setRole] = useState<"member" | "administrator">("member")

  return (
    <main className="membership-administration-page">
      <header className="membership-administration-page__header">
        <div>
          <Heading as="h1" size="4">
            Hub membership
          </Heading>
          <Text as="p">
            Hub admission and installation roles are independent of repository access.
          </Text>
        </div>
        <Button type="button" variant="subtle" disabled={loading} onClick={onSignOut}>
          Sign out
        </Button>
      </header>

      {error ? (
        <Text as="p" className="membership-administration-page__error" role="alert">
          {error}
        </Text>
      ) : null}

      <section>
        <Heading as="h2" size="6">
          Invite a provider identity
        </Heading>
        <form
          className="membership-administration-page__form"
          onSubmit={(event) => {
            event.preventDefault()
            onInvite({ provider, issuer, subject, role })
          }}
        >
          <FormControl>
            <FormControl.Label>Provider</FormControl.Label>
            <TextInput
              value={provider}
              maxLength={64}
              required
              disabled={loading}
              onChange={(event) => setProvider(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Issuer</FormControl.Label>
            <TextInput
              type="url"
              value={issuer}
              maxLength={500}
              required
              disabled={loading}
              onChange={(event) => setIssuer(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Immutable subject</FormControl.Label>
            <TextInput
              value={subject}
              maxLength={500}
              required
              disabled={loading}
              onChange={(event) => setSubject(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Role</FormControl.Label>
            <Select
              value={role}
              disabled={loading}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <Select.Option value="member">Member</Select.Option>
              <Select.Option value="administrator">Administrator</Select.Option>
            </Select>
          </FormControl>
          <Button type="submit" variant="primary" disabled={loading || !subject.trim()}>
            Create invitation
          </Button>
        </form>
      </section>

      <section>
        <Heading as="h2" size="6">
          Memberships
        </Heading>
        <ul className="membership-administration-page__list">
          {memberships.map((membership) => {
            const identity = membership.user.externalIdentities[0]
            return (
              <li key={membership.id}>
                <Stack direction="vertical" gap="condensed">
                  <strong>
                    {membership.user.displayName ??
                      identity?.username ??
                      identity?.subject ??
                      membership.user.id}
                  </strong>
                  <Text as="span" size="100">
                    {identity
                      ? `${identity.provider} · ${identity.issuer} · ${identity.subject}`
                      : "No external identity"}
                  </Text>
                  <Text as="span">
                    {membership.role} · {membership.status}
                  </Text>
                  {membership.status !== "removed" ? (
                    <div className="membership-administration-page__actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={loading}
                        onClick={() =>
                          onChange(membership.id, {
                            role: membership.role === "administrator" ? "member" : "administrator",
                          })
                        }
                      >
                        Make {membership.role === "administrator" ? "member" : "administrator"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={loading}
                        onClick={() =>
                          onChange(membership.id, {
                            status: membership.status === "suspended" ? "active" : "suspended",
                          })
                        }
                      >
                        {membership.status === "suspended" ? "Restore" : "Suspend"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="membership-administration-page__danger"
                        disabled={loading}
                        onClick={() => {
                          if (window.confirm("Remove this membership and revoke its sessions?")) {
                            onChange(membership.id, { status: "removed" })
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </Stack>
              </li>
            )
          })}
        </ul>
        {hasMoreMemberships ? (
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onLoadMoreMemberships}
          >
            Load more memberships
          </Button>
        ) : null}
      </section>

      <section>
        <Heading as="h2" size="6">
          Invitations
        </Heading>
        <ul className="membership-administration-page__list">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <strong>{invitation.subject}</strong>
              <Text as="p" size="100">
                {invitation.provider} · {invitation.issuer} · {invitation.role}
              </Text>
              {!invitation.consumedAt && !invitation.revokedAt ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => onRevokeInvitation(invitation.id)}
                >
                  Revoke invitation
                </Button>
              ) : (
                <Text as="p">{invitation.consumedAt ? "Activated" : "Revoked"}</Text>
              )}
            </li>
          ))}
        </ul>
        {hasMoreInvitations ? (
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onLoadMoreInvitations}
          >
            Load more invitations
          </Button>
        ) : null}
      </section>
    </main>
  )
}
