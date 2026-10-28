# GitHub App setup

Each self-hosted Hub connects one GitHub App and one installation. Create a private organization-owned App through the manifest flow, or manually connect an independently registered App to an explicitly approved installation. Installing the App on prototype repositories lets Hub discover branches, follow GitHub Actions, and check each reviewer's access.

```text
team opens /setup on its self-hosted Hub
  -> team creates an App through the manifest or configures it manually
  -> team installs the App on prototype repositories or approves an existing installation
  -> Hub verifies the installation
  -> team members sign in with GitHub
```

## Configuration

For a Compose installation, `./replica init` creates the required settings and prints the bootstrap secret as the **setup code**. Do not generate another configuration for an existing database. For other platforms, supply equivalent environment settings before opening `/setup`:

```text
REPLICA_HUB_ORIGIN=https://hub.example.com
REPLICA_BOOTSTRAP_SECRET=<long random secret>
REPLICA_DATABASE_ENCRYPTION_PRIMARY_KEY=<random secret>
REPLICA_DATABASE_ENCRYPTION_DETERMINISTIC_KEY=<random secret>
REPLICA_DATABASE_ENCRYPTION_KEY_DERIVATION_SALT=<random secret>
```

For contributor environments that need encryption values, generate them inside the devcontainer:

```sh
bin/devcontainer exec bin/rails db:encryption:init
```

Copy each generated value to Replica Hub's matching environment variable:

| Rails output          | Environment variable                              |
| --------------------- | ------------------------------------------------- |
| `primary_key`         | `REPLICA_DATABASE_ENCRYPTION_PRIMARY_KEY`         |
| `deterministic_key`   | `REPLICA_DATABASE_ENCRYPTION_DETERMINISTIC_KEY`   |
| `key_derivation_salt` | `REPLICA_DATABASE_ENCRYPTION_KEY_DERIVATION_SALT` |

Rails mentions credentials in its output, but Replica Hub reads these values from environment variables. Generate a different set for each environment and keep using the same set for an existing database.

Production requires HTTPS. Keep the bootstrap and encryption secrets outside the database and back them up separately. Rotate encrypted records before changing encryption keys, or Hub will no longer be able to read the stored App credentials.

Hub uses the reviewed Action pin shipped in `config/build_action_releases` by default. When releasing an updated `actions/build`, maintainers move the old pin's SHA to a new line below the first line and put the new full Action reference on the first line. Hub recognizes those older released pins when checking workflows for updates. A repository writer then reviews the generated workflow through an installation or update pull request. Self-built Hubs need no Git history or extra build step.

To use a different Action repository, set `REPLICA_BUILD_ACTION` to its `owner/repo/actions/build@COMMIT_SHA` reference. Update that value only when releasing a changed Action; Hub treats a different pin in an installed workflow as an update. The repository operator is responsible for reviewing and pinning that Action commit.

To develop against GitHub, start Hub with `REPLICA_LOCAL_MODE=0 bin/devcontainer dev`. It uses `http://replica.localhost:19500`, so setup and sign-in work without a public tunnel.

## Manifest setup

Create the App under your GitHub organization so your team can sign in. A private App under your personal account allows only you to sign in.

With a private organization App, connecting a public repository lets every organization member read its Hub reviews, not just its contributors. Keep the App private. See [App ownership and repository visibility](authentication-and-repository-authorization.md#app-ownership-and-repository-visibility) before choosing repositories or changing visibility.

1. Start Hub with its original bootstrap secret and verify its public HTTPS address.
2. Open `/setup`, enter the setup code and target organization's exact login, then choose **Continue**. Leave the organization blank only for a personal, single-person Hub.
3. On the next page, choose **Create the App on GitHub**.
4. Review the App registration in GitHub and install it only on approved prototype repositories.
5. Complete the returns to Hub in the same browser. Hub confirms that the installation belongs to the selected owner before saving it.

The setup request expires after 15 minutes and can be used once.

If a GitHub administrator must register or approve the App, have that person start a fresh `/setup` flow in their own browser. Provide the Hub origin, target organization, approved repositories, and requested permissions for advance review. Share the bootstrap secret only through an approved secret channel: it also protects operator enrollment. Do not forward an in-progress callback URL, registration URL, or browser cookie, or send `.env` and encryption keys. Manifest registration sends generated credentials directly back to Hub; the administrator should not email them.

After setup, enroll the person administering Hub at `/operator/enrollment` using the bootstrap secret and a fresh GitHub sign-in. App creation does not automatically designate its owner or the first signed-in person as a Hub operator. Existing configured deployments use the same route without resetting their App. See [Security audit](security-audit.md#enroll-an-operator).

The App requests:

| Permission           | Used to                                                  |
| -------------------- | -------------------------------------------------------- |
| Administration: read | Check repository access                                  |
| Actions: read        | Follow workflows and download their artifacts            |
| Contents: write      | Discover branches and create the installation branch     |
| Pull requests: write | Open a reviewable workflow installation pull request     |
| Workflows: write     | Add `.github/workflows/replica.yml` to that pull request |

An upgraded Hub does not automatically grant these write permissions to an existing App installation. The App owner must open the App's **Permissions & events** settings, grant read and write access for Contents, Pull requests, and Workflows, then save the change. Each installation owner must approve the new permissions before Hub can open workflow installation pull requests. Existing repository discovery and review access continues with the previously approved permissions.

Production usually receives GitHub notifications for pushes, workflows, and installation changes. Both environments also poll GitHub so Hub can recover missed changes; local development relies on polling because it has no public tunnel.

## Manual creation and connection

Use this flow when manifest registration is unavailable or you already administer an App installed in another account. The App registration owner and installation account may differ. You need the deployment bootstrap secret, permission to manage the App's settings and credentials, and an installation approved by someone authorized in the target account. Hub does not require organization-settings access from the person connecting an already approved installation, and it cannot bypass GitHub's installation or authorization policies.

On an existing deployment, back up its database and retain its `.env`, storage, and encryption secrets before upgrading. The migration preserves configured manifest connections and their ownership-transfer behavior. Manual connection is initial setup only: it does not overwrite an existing Hub App configuration. Do not edit database owner fields or run a separate bootstrap script.

Use an image that includes the manual flow and the owner-identity behavior your App needs. Instructions in a source branch do not establish that an older published release contains it; use [manual updates](manual-updates.md) or a [reviewed source build](source-image-builds.md) when necessary.

### Prepare the App in GitHub

Replace `https://hub.example.com` with your Hub's public origin everywhere. Open the intended account's **Settings -> Developer settings -> GitHub Apps**, then create an App or select the existing one. An organization administrator may need to register or approve it.

| GitHub field | Value |
| --- | --- |
| GitHub App name | A unique name chosen by your administrator |
| Homepage URL | `https://hub.example.com` |
| Callback URL / OAuth Redirect URI | `https://hub.example.com/auth/github/callback` |
| Setup URL | Blank; `/setup/install` belongs to the manifest flow |
| Webhook URL | `https://hub.example.com/github/webhooks` |
| Webhook Active | Enabled |
| Webhook SSL verification | Enabled |
| Request user authorization during installation | Unchecked |
| Redirect on update, Device Flow, callback wildcard matching | Leave disabled unless separately required and reviewed |
| User authorization token expiration | Enabled |

Under **Permissions & events**, grant the repository permissions in the [permission table](#manifest-setup). Subscribe to **Push** and **Workflow run**, then save. GitHub also delivers installation lifecycle and installation-repository changes. Existing installation owners must approve increased permissions separately.

Check **Where can this GitHub App be installed?** and who may authorize it. A private personal App does not support team sign-in. Cross-account installation may require public visibility. A public App does not publish private repositories, but broadens who can authorize it: anyone who can read a connected public repository could read its Hub reviews. See [App visibility](authentication-and-repository-authorization.md#public-apps).

Choose **Install App**, select the intended account, and use **Only select repositories** for the approved prototype repositories, or inspect the existing installation. Complete any GitHub-required approval. Do not uninstall/reinstall just to locate its ID; that changes the installation identity.

### Collect the correct credentials

GitHub layouts differ: client secrets and private keys may be on **Credentials** rather than **General**. If those controls are missing, confirm you administer the App itself, not just its installation.

| Value | Where it comes from |
| --- | --- |
| Setup code / bootstrap secret | Original VM initialization or the deployment secret manager; used at `/setup`, not as an App credential |
| App ID | Numeric **App ID** in the App's settings |
| Client ID | **Client ID** in those same App settings; not the App ID |
| Client secret | GitHub's **Client secrets -> Generate a new client secret**, or a securely retained existing secret |
| PEM private key | **Private keys -> Generate a private key**; upload the downloaded file |
| Webhook secret | A separate long random secret generated through your approved secret-management tool and set identically in GitHub and Hub |
| Installation ID | Numeric part of the selected installation settings URL after `/installations/`; not the App ID |

Configure the webhook secret in GitHub before importing. GitHub does not reveal an existing webhook secret for copying. If it is unknown, coordinate an intentional replacement with every affected integration; do not use the setup code as a substitute.

Keep the client/webhook secrets and PEM in approved secret storage. Client and webhook secrets are limited to 4 KiB each; the PEM is limited to 16 KiB. Never put them in Git, chat, links, screenshots, or command-line arguments.

### Connect from Hub

Have the prepared credentials ready before authorizing; setup authorization lasts 15 minutes.

1. Open `/setup`, enter the original setup code, and choose **Continue**.
2. On the next page, choose the plain-text **Create manually or connect an existing App** link beneath **Create the App on GitHub**. The organization field is for manifest creation, not manual import. `/setup/manual` also works in the same authorized browser session.
3. Enter the App ID, Client ID, client secret, matching webhook secret, and installation ID. Upload the PEM file.
4. Confirm the account and repository selection in GitHub, read Hub's approval statement, and choose **Verify and connect this installation**.

Hub authenticates the App, checks its App/client identity and actual owner, checks the exact active installation, and reads its repositories before saving atomically. A valid managed-user registration owner can have underscores in its login. The registration owner need not be the organization receiving the installation. Failure saves no configuration and requires credentials to be re-entered. Hub does not change GitHub settings automatically.

### Verify the connection

Enroll a Hub operator at `/operator/enrollment`, then verify an intended user's ordinary GitHub sign-in. Private-key verification does **not** validate the OAuth client secret or user authorization eligibility. Check that only selected repositories are discoverable, read-only users cannot perform write operations, and a user without repository access is denied.

In the App's **Advanced** settings, inspect a supported webhook delivery after an authorized test-branch push. Confirm successful delivery and a real Build with its screenshot and embedded preview. Successful import does not verify webhook-secret agreement or reachability. Keep public sharing disabled unless deliberately approved.

For a Compose deployment, run diagnosis on the VM:

```sh
cd "$HOME/replica-hub" &&
env -u REPLICA_IMAGE docker compose exec -T hub bin/rails replica:github:diagnose
```

Use `replica:github:poll` in place of `replica:github:diagnose` to synchronize immediately. Diagnosis checks App/installation reachability, not end-user sign-in or webhook delivery.

### Troubleshoot manual connection

| Symptom | Next check |
| --- | --- |
| No manual link on the setup-code screen | Enter the code and choose Continue first; inspect the next page |
| `/setup/manual` returns 404 | Reauthorize at `/setup` in the same browser; check whether setup is already complete and whether the image includes the route |
| Form returns 422 | Read the message at the top of the long form before retrying |
| Generic credential/installation failure | Check actual IDs, PEM, active installation, permission approval, deployed revision, and GitHub API reachability |
| Upload appears as `(binary)` in browser network tools | Expected multipart file upload; do not convert the PEM |
| Import succeeds but sign-in fails | Check callback URL, client secret, and who GitHub permits to authorize the App |
| Import succeeds but webhooks fail | Check Active, URL, TLS, matching webhook secret, subscriptions, and GitHub delivery result |

Do not export a HAR or share the raw form payload; it contains the secrets and key. Hub-to-GitHub calls are not visible in the browser's form trace. An HTTP 200 from GitHub's API root proves network/TLS reachability, not App authentication. Do not reset a configured App or replace encryption keys to diagnose these failures.

### Installation and credential lifecycle

Webhook URL, secret, permissions, and credentials belong to the App, not an installation. Do not reuse an App whose webhook already serves another integration unless you have separately arranged compatible delivery. Hub's normal webhook rotation changes the App-wide webhook configuration and affects every installation; connecting an existing App does not isolate those settings.

Manual connections pin the installation ID and immutable installation account. Polling never follows the registration owner to a different installation. Events from other installations cannot enroll them or change this connection. Suspension or confirmed removal marks repositories unavailable without deleting Builds or reviews. Reinstallation with a new ID requires a new deliberate connection; there is no automatic replacement or in-place installation-switch operation in this version. Resetting local App configuration to reconnect has the documented session and canvas revocation effects below, so back up and review those effects first.

For GitHub Enterprise Server, register the App on that same instance and configure `REPLICA_GITHUB_URL=https://HOSTNAME` and `REPLICA_GITHUB_API_URL=https://HOSTNAME/api/v3` before starting Hub. Set `REPLICA_GITHUB_API_VERSION` to a REST API version supported by that instance. GitHub must reach Hub for webhooks, and Hub must reach GitHub for API and OAuth requests. This connection flow does not add enterprise-owned App registrations, multiple GitHub hosts, or multiple installations to one Hub, and does not establish compatibility with every GHES release.

## App ownership transfers

Hub detects an ownership transfer by asking GitHub for the configured App's current owner. This uses the existing App credentials, not organization audit-log access. Hub accepts the response only for the same App ID, updates the owner and App slug, and records the transfer in its security audit.

An App transfer can uninstall the App. Hub marks the previous installation and its repositories unavailable without deleting Builds, files, reviews, users, or administrator roles. Existing browser Sessions and canvas grants are retained, but they do not bypass repository checks while the installation is unavailable. Hub does not promise uninterrupted repository access during a transfer.

For manifest-created connections, the new owner installs the same App in their own account and selects its repositories. These connections retain the requirement that the installation belongs to the App owner's account. Hub stores the installation account separately so delayed removal notices for the previous account cannot remove a replacement installation.

For manually connected, pinned installations, Hub updates verified App ownership metadata but checks the approved installation independently. It never adopts an installation in the new owner's account. If the pinned installation no longer exists, access remains unavailable until deliberate reconnection.

For manifest connections, installation notifications and the existing five-minute Build checks restore repository access after GitHub confirms the replacement installation. This also recovers a transfer completed before upgrading Hub, or one whose notifications were missed. Run `replica:github:poll` to check immediately. Transient GitHub failures do not count as proof that an installation was removed; failed jobs remain visible in the queue and a later check retries.

Branch and workflow results remain bound to the owner and installation that started the poll or webhook processing. If a transfer replaces that installation before a result is saved, Hub rejects the old work even when the same repository is already available again.

The **GitHub App** administration page shows installation state and instructions when installation is needed. `replica:github:diagnose` reports an owner awaiting synchronization or an installation that is no longer present without changing the saved configuration. If diagnosis cannot reach GitHub, it reports failure instead. No console edits, credential replacement, or local reset are needed for an ordinary ownership transfer.

## Routine App administration

An existing Hub administrator opens **GitHub App** from the deployment security audit, or `/github_app`. For example, choose **Replace App credentials**, supply replacements from the same App's GitHub settings, confirm, and save. Every App mutation requires current persisted administrator permission, deliberate confirmation, and GitHub verification of the same browser Session within the last five minutes. If verification is needed, Hub continues the confirmed operation after it succeeds, rechecking permissions and the App's saved version. The role does not grant repository access.

An unchanged installation poll refreshes its checked time without invalidating an open confirmation. A change to installation, credentials, or webhook state still requires a new confirmation.

Hub encrypts the App's client secret, private key, and webhook secrets in the database. Credential fields start empty. Enter a new client secret (at most 4 KiB) and upload a PEM private key (at most 16 KiB) over HTTPS. Hub never prefills, exports, logs, or sends saved secrets to browsers. During verification, submitted replacements are temporarily encrypted in the challenge record and removed before the continuation attempt. Continuation passes the saved key bytes directly to credential validation in memory without creating another upload file. A validation error requires entering replacements again.

The candidate private key must authenticate as the saved App ID and owner ID/type. This check **does not verify the OAuth client secret**. Hub reports credentials saved, not sign-in repaired. Confirm a successful GitHub sign-in before retiring the old credentials at GitHub. Replacement invalidates pending OAuth/enrollment checks and fresh proof on Sessions and canvas grants, but retains live Sessions and canvas connections.

For webhook rotation, Hub generates the replacement and sends it directly to GitHub using the App's credentials and configured Hub webhook URL. The page never displays either secret. Both secrets remain accepted during overlap. If GitHub fails, times out, or the update is interrupted, **Retry saved webhook update** sends the same replacement, not a third secret. An active attempt blocks overlapping App mutations; after its five-minute lease expires, an explicit retry is possible. Expiry does not automatically send anything.

Only after GitHub confirms the update can an administrator separately confirm **Stop accepting the old secret**. Delayed old-secret deliveries then fail signature validation. No automatic timeout ends overlap. Upgraded deployments with an existing previous secret first retry the saved replacement because the old schema did not retain remote confirmation.

Stopping overlap rejects an old-secret delivery if Hub has not yet completed its final secret check. It does not recall work that Hub has already authenticated.

### Local reset

An administrator chooses **Reset local GitHub App?**, reviews the sign-out and data effects, types `delete local GitHub App configuration`, and confirms access to the deployment bootstrap secret and the ability to create/install a replacement App. The same browser's fresh proof is required. Hub refuses reset if the bootstrap secret is not configured, the confirmed App changed, or a webhook attempt is active.

Reset deletes the local App configuration, signs out all browser Sessions, revokes canvas connections, discards pending pairings/enrollment/fresh-authorization proofs, and marks repositories unavailable. It retains users and administrator roles, Builds/files/reviews, shares, analytics, webhook-delivery records, audit history, and queue history. Already-sent work cannot be undone; an in-flight import may retain its files without restoring access. Stale App synchronization cannot reactivate repositories. A live-notification failure does not undo database credential revocation and is reported explicitly.

The remote GitHub App and installation are unchanged: reset does not uninstall, delete, or revoke credentials at GitHub. Retained public links are unavailable while the App/repository is inactive and may resume only if the same repository is installed again and the existing sharing policy permits them. Reset does not enable sharing, change its policy revision, or restore permanently revoked links. Reset itself is **not permanent public-link revocation**.

After reset, a server owner uses the unchanged bootstrap-protected `/setup` flow to configure a replacement App. Existing administrators retain their role by immutable GitHub identity and can sign in again after setup. Canvas connections require new approval. App creation does not designate another administrator.

## Emergency same-App credential recovery

When broken OAuth or stored App credentials prevent routine administration, a server owner runs the sole emergency App-maintenance task, `replica:github:recover_credentials`. It repairs credentials for the **existing App only**; there is no reset, alternate-App, webhook, role, or force mode.

Prepare the new client secret and private key in protected server-local regular files using the deployment's existing secret-delivery mechanism, outside Git/checkouts. Each file must be owned by the executing user (or read by root), with no group/other permissions. Symlinks and special files are rejected. The limits are the same as the browser form. The task does not deploy keys or change file permissions.

With privileged Rails host access, supply paths and the exact confirmation:

```sh
bin/devcontainer exec env \
  REPLICA_CONFIRM_APP_RECOVERY='replace credentials for the existing GitHub App' \
  REPLICA_GITHUB_CLIENT_SECRET_FILE=/run/secrets/replacement-client-secret \
  REPLICA_GITHUB_PRIVATE_KEY_FILE=/run/secrets/replacement-private-key.pem \
  bin/rails replica:github:recover_credentials
```

These are paths inside the execution environment, not plaintext credentials on the command line. The task requires the existing configuration, database encryption keys, correct protected inputs, candidate-key verification of the same App/owner, and no active webhook attempt. It does **not** require the bootstrap secret, working old credentials, OAuth, an administrator Session, or browser-issued CLI authorization proof.

Recovery retains App/installation identity, users/admin roles, live Sessions/connections, pending pairings, repositories, Builds/reviews/files, shares, analytics, webhook overlap, audits and jobs. It invalidates pending OAuth/enrollment/fresh challenges and stored fresh-proof timestamps. It changes nothing at GitHub. Success is audited atomically as an anonymous command, without paths, secrets, raw errors, or browser attribution.

If input, identity verification, GitHub, state, persistence, or audit fails, credentials are not replaced. An incorrect client secret can still be saved because candidate-key authentication cannot verify it: check ordinary GitHub sign-in, then use this same command again with corrected input if needed. Retire old credentials separately at GitHub after sign-in succeeds.

This task cannot restore a deleted remote App, lost encryption keys, a corrupted database, or a GitHub outage. See [Backups and restore](backups-and-restore.md) for data/key recovery. Removing routine tasks does not remove server-owner Rails-console or database authority.

## Diagnostics and synchronization

| Command | Purpose |
| --- | --- |
| `replica:github:diagnose` | Read App/installation health without printing secrets; does not verify the OAuth client secret |
| `replica:github:poll` | Synchronize installation/repository state and discover Builds; this mutates Hub data |
| `replica:github:recover_credentials` | Confirmed emergency credential repair for the same existing App |

Run tasks through `bin/devcontainer exec bin/rails`. The old `reset`, `rotate_credentials`, `rotate_webhook_secret`, and `finish_webhook_rotation` tasks have no aliases or browser-proof replacements. Routine App maintenance belongs in the administrator UI. “One emergency mutation path” refers to App credential/configuration maintenance; it does not remove repository synchronization, background jobs, bootstrap setup, backup restoration, or host-owner DB authority.
