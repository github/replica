# Identity provider decoupling demo

This local branch demonstrates how Hub can identify a user independently from GitHub repository access. It is intended for team discussion and video recording, not deployment or merge.

## Architecture

```mermaid
flowchart LR
  Browser --> Choice[Explicit sign-in choice]
  Choice --> GitHub[GitHub sign-in adapter]
  Choice --> OIDC[Local OIDC demo adapter]
  GitHub --> Session[Provider-neutral Hub user and session]
  OIDC --> Session
  Session --> Capability{Repository provider}
  Capability -->|github + GitHub identity| Repositories[GitHub permission checks]
  Capability -->|none or no GitHub identity| Unavailable[Repository features unavailable]
  Secrets[Database or environment credential provider] --> GitHub
  Secrets --> Repositories
```

The boundaries are:

- **Sign-in provider:** proves who the user is and returns a stable provider name, subject, login, name, and avatar.
- **Repository provider:** decides whether repository-dependent capabilities exist and performs current permission checks.
- **Credential provider:** reads or encrypts GitHub App and OAuth secrets. It is infrastructure configuration, not a user identity.
- **Hub session:** stores the provider-neutral user and session. Generic session and revocation routes do not depend on the selected sign-in adapter.

Provider-specific routes stay under `/api/auth/github` and `/api/auth/oidc-demo`. Session routes remain `/api/session`. Hub does not automatically fall back between adapters.

## Run the local demo

Install dependencies and prepare PostgreSQL as described in [Development](development.md). Start the demo with:

```sh
HUB_DEMO_MODE=true \
HUB_SIGN_IN_PROVIDERS=github,oidc-demo \
HUB_REPOSITORY_PROVIDER=github \
HUB_ORIGIN=http://127.0.0.1:5173 \
npm run dev:api
```

Start the frontend separately with `npm run dev`. Configure `DATABASE_URL`, `HUB_CREDENTIAL_PROVIDER`, `HUB_CREDENTIAL_KEY`, and `HUB_BOOTSTRAP_SECRET` as described in [Identity](identity.md).

For an OIDC-only recording without GitHub credentials, set:

```sh
HUB_DEMO_MODE=true
HUB_SIGN_IN_PROVIDERS=oidc-demo
HUB_REPOSITORY_PROVIDER=none
HUB_CREDENTIAL_PROVIDER=none
```

The server accepts this combination without a bootstrap secret because neither enabled capability needs GitHub credentials.

## GitHub App flow

1. The user chooses **Sign in with GitHub** and reviews the `github` sign-in adapter and `github` repository provider.
2. Hub starts the existing one-use, same-browser GitHub OAuth and PKCE flow.
3. GitHub identifies the user. For an ordinary sign-in, Hub also proves access to at least one repository in the configured App installation.
4. Hub creates a provider-neutral user and session.
5. Repository requests mint a short-lived installation token and check the signed-in GitHub account's current permission.

Submitted credentials are format-checked and the App key and installation are validated before activation. The client secret is proven when the first OAuth exchange succeeds; this branch does not add a pending-credential database model.

## OIDC demo flow

1. The user chooses **Sign in with OIDC** and reviews the `oidc-demo` adapter.
2. A clearly labeled local form simulates trusted claims from an OIDC issuer.
3. Hub saves an `oidc-demo` user and creates the same Hub session shape used by GitHub.
4. If no repository provider is configured, the UI shows repository features as unavailable. If the GitHub repository provider exists, the UI explains that this OIDC session still needs a linked GitHub identity.

The demo adapter performs no discovery, redirect, token validation, nonce validation, JWKS verification, issuer validation, or claims mapping. The server rejects it unless `HUB_DEMO_MODE=true`. A production OIDC adapter must implement those controls behind the same sign-in boundary.

## Video script

1. Open the onboarding page and point out the two explicit sign-in choices.
2. Open the GitHub option and show its separate sign-in adapter, repository provider, and configuration status.
3. Return to provider selection and open the OIDC option.
4. Call out the demo-only warning, submit the synthetic identity, and show the provider-neutral Hub user and session.
5. Show that Hub onboarding succeeded while GitHub repository capabilities remain unavailable or require a linked GitHub identity.
6. End the session, then repeat with the GitHub App flow when local App credentials are configured.
7. Explain that generic session and revocation behavior stays shared while provider-specific routes and credentials remain isolated.

## Deliberate demo limits

- The OIDC adapter trusts local form fields and must never be enabled outside explicit demo mode.
- The rate limiter is process-local. Production needs a shared store and deployment-specific trusted proxy rules.
- GitHub credential activation validates the App key and installation before saving, but OAuth client-secret proof completes only during user authorization.
- OIDC-to-GitHub account linking is not implemented. The capability gate makes that missing relationship visible instead of granting or inventing access.
- The demo adds no cloud SDK, OIDC discovery library, JWKS dependency, hosted publishing, or deployment workflow.
