import { Button, Text } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"

export function NoRepositoryAccessPage({ login }: { login: string | null }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader
        data={{
          productName: "Replica Hub",
          heading: "You don't have access to any Replica repositories",
          description: login
            ? `You signed in as @${login}, but this Hub is connected only to repositories you can't read.`
            : "This Hub is connected only to repositories your GitHub account can't read.",
        }}
      />
      <Text as="p">
        Ask a repository owner for read access, or ask a Hub administrator to install the Replica
        App on your repository.
      </Text>
      <form action="/api/auth/github/start" method="post" className="setup__form">
        <Button type="submit" variant="primary" block>
          Try again
        </Button>
        <Button type="submit" name="switch_account" value="true" variant="secondary" block>
          Sign in as a different GitHub account
        </Button>
      </form>
      <Text as="p">
        <a href="/">Return to sign in</a>
      </Text>
    </GithubAppSetupPage>
  )
}
