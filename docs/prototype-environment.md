# Set up shared hosting and team feedback

Set up Replica so your team can build prototypes with its design system, share them, and collect feedback. This guide walks you through each step, from checking hosting requirements to publishing your first prototype.

- **Trying Replica locally?** Follow [Create your first local prototype](local-prototyping.md).
- **Joining an existing setup?** Follow [Join your team's Replica environment](getting-started.md) if your team has a connected repository and Hub.

Build and test prototypes in your local development environment, then publish them to Hub for your team to review and comment on. Your organization sets up and manages the server for Hub, rather than using a service hosted by GitHub.

The setup follows this sequence:

1. Confirm the server, dedicated domain, network access, and GitHub permissions needed for Hub.
2. Set up your prototype repository with your team's design-system guidance and build a working prototype locally while hosting is arranged.
3. Once Hub is running and connected to the repository, publish that prototype and collect comments from your team.

You can handle setup yourself or work with your infrastructure and GitHub administrators. The linked guides provide technical details for each step.

## 1. Check readiness before you start

Before setting up Hub, confirm what is available, what needs approval, and who will handle any remaining setup.

- **A server for Hub.** Confirm that the server runs Linux, supports Docker and Docker Compose, keeps data between restarts, and has backups. It must be allowed to download Replica and connect to GitHub. See the [server requirements](../hub/docs/deployment.md#requirements) and [network requirements](../hub/docs/deployment.md#outbound-network-access).
- **A dedicated domain.** Reserve an entire domain for Hub and its previews, with no unrelated apps using it. Confirm that you can configure DNS and HTTPS for Hub and its wildcard preview addresses. See [why a subdomain on a shared domain is not enough](../hub/docs/deployment.md#choose-an-isolated-domain).
- **GitHub permissions.** Determine whether your organization can install Replica's private [GitHub App](../hub/docs/github-app-setup.md#setup) and run its [build workflow](../hub/docs/github-actions-builds.md). The App must be created under your organization. Check any restrictions on actions and downloads.
- **Approval and ongoing support.** Check whether your organization needs to approve Hub, Copilot, the Replica plugin, or the AI service your team uses. Agree who will look after Hub, its passwords and access keys, and its backups.

Use sample data for prototypes. Do not include passwords or access keys from live systems, or real customer data.

**Ready to continue:** you have identified the hosting requirements and any approvals needed. You can start the local work below while hosting is arranged, as long as you have approval to use Copilot and the local tools.

### If hosting is blocked

You can keep working while hosting is arranged:

- **Build locally:** Follow steps 2 through 4 below, and prepare starting pages in step 9 if useful.
- **Share reviewed source:** Once you have an approved GitHub repository, follow [Share the reviewed starting version](#share-the-reviewed-starting-version) in step 6. Stop before the GitHub App and build setup, which need Hub.
- **Resume hosted setup:** Once the hosting requirements are in place, continue at step 5 with the same project.

> **Note:** If GitHub approvals are also pending, keep working locally. Sharing source does not require the build workflow, but publishing to Hub does.

## 2. Connect a prototype repository

**You can start prototyping even if Hub is not ready.** Set up your team's repository and design-system guidance in your local development environment while hosting is arranged. You'll connect to Hub later to publish prototypes and collect comments.

You'll use the **Replica canvas**, a panel in the GitHub Copilot app that shows your running prototype beside your conversation. It is included in the Replica plugin.

If you have already completed some setup, continue from there:

| What is ready | Continue at |
| --- | --- |
| A Replica repository | Open it in Copilot and continue at **Install the Replica plugin if needed** below. Do not copy the starter again. |
| The app works in the canvas | Step 3. |
| A local prototype with approved guidance | Step 5 once hosting requirements are in place, or step 6 if Hub is already running. Keep your existing work. |

### Prepare your local development environment

Check that your local development environment has:

- **The [GitHub Copilot app](https://github.com/features/ai/github-app)**, installed and signed in.
- **[Git](https://git-scm.com/)**, with `user.name` and `user.email` configured for the installer's initial local commit.
- **[Node.js](https://nodejs.org/) and npm**, with a Node.js version matching `engines.node` in your repository's `package.json`, or the selected app's `package.json` in the [starter catalog](../starters/catalog.tsv) for a new repository. npm comes with Node.js.
- **Bash, curl, and tar**, for downloading and running the starter installer.
- **macOS or Linux**, the supported systems for local canvas previews.
- **`lsof`**, which the canvas uses to find running local servers.

Reuse compatible installations and install missing tools through your organization's approved process.

> **Note:** The starter installer does not install Node.js or change your shell configuration.

Copilot requires GitHub sign-in, but creating the local starter does not require GitHub repository access. You can use a Copilot plan or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models).

### Create a starter if you need one

A starter is a ready-made app to build your prototype from. Choose **Minimal** for a small example app to adapt to your own design system, or **CoreAI Sandbox** for an app with an existing layout and Microsoft's CoreAI design system.

The installer creates a new folder for it, named `my-prototype` in the example below. Choose a name that is not already in use.

The new folder is an independent local Git repository with the copied files saved in an initial commit on `main`. The installer does not create a GitHub repository, set a remote, or publish anything.

> **Before accepting Copilot setup:** Session setup can install Copilot's command-line tool, the Replica plugin, and project dependencies.

1. In a terminal, go to the directory where you want the new folder created, then download the installer:

   ```sh
   curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
   ```

2. Review the installer, then list the available apps:

   ```sh
   bash install-starter.sh --list
   ```

3. Choose an app from the [starter catalog](../starters/catalog.tsv):

   | Starter | Choose it when |
   | --- | --- |
   | **Minimal** (`minimal`) | You want a small example app to adapt to your own design system. |
   | **CoreAI Sandbox** (`coreai`) | You want an existing navigation layout and prebuilt interface elements, such as buttons and menus, from Microsoft's CoreAI design system. |

4. Run the installer with your choice and new folder name. This example selects Minimal; replace `minimal` with your chosen catalog ID:

   ```sh
   bash install-starter.sh --starter minimal my-prototype
   ```

5. In Copilot, choose **Sessions → + → Open folder** and open the new folder.
6. Before accepting its setup settings, review `.github/github-app.yml` and the copied `REPLICA.md`.
7. Start a fresh session in the new repository so Copilot can find its included skills. If another session created the folder, give the new session a summary of completed setup, the chosen app, and what you want to build.

> **If creation fails:** Resolve the reported Git identity, signing, or hook error before retrying. The installer uses your existing Git configuration without changing it and removes an incomplete destination if the initial commit fails.

The app's README explains its examples and run commands. The shared [Replica workflow guide](../starters/shared/REPLICA.md) and [troubleshooting guide](../starters/shared/SETUP.md) are copied into every repository.

### Install the Replica plugin if needed

If the Replica plugin appears under **Customize → Installed**, continue at **Open the app in the canvas** below.

The Replica starter installs the plugin during session setup. It checks for Copilot CLI and installs it if missing.

- **If starter setup failed:** Check the session setup output, resolve the reported dependency or plugin error, then run `node scripts/setup-replica-plugin.mjs` from the repository folder to retry plugin setup.
- **If your repository has no setup script:** Use the manual installation steps below.

> **Before installing manually:** These commands install Replica from its default branch. If your organization requires a specific version or source, use its installation instructions instead.

For manual installation:

1. Check that `copilot` is available in your terminal with `copilot --version`. If it is not found, follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).
2. Add Replica's plugin marketplace if you haven't already:

   ```sh
   copilot plugin marketplace add github/replica
   ```

3. Install the Replica plugin:

   ```sh
   copilot plugin install replica-prototype@replica
   ```

### Open the app in the canvas

With the plugin installed, enable the canvas and try the app before making changes:

1. In Copilot, open **Customize → Installed**.
2. Enable both the Replica plugin and its canvas extension. They are separate switches.
3. Start a fresh session after installation or enablement.
4. Choose **+ → Canvas → Replica prototype**. Keep only one copy of the Replica canvas enabled.

Ask Copilot:

```text
Run this repository's app locally and show it in the Replica canvas.
Use the run commands in its README and the URL printed by the server.
Do not change the app, connect to Hub, or publish anything yet.
```

Once Copilot starts the app:

1. In the canvas, choose **Connect** beside your app's server. If none is running, choose **Start dev server**.
2. Once the page appears, try its navigation and any included interactions.

> **Note:** Installing dependencies or completing `/setup-skills` does not confirm that the preview works.

**If setup fails:**

- **Installation failure:** Use the error and recovery instructions in the terminal or session setup output.
- **Policy or permission error:** Resolve it through your organization's approval process rather than bypassing it.
- **Missing canvas:** Confirm both switches are enabled and start a fresh session after changing them.
- **Preview error:** Ask Copilot to investigate using the repository's README, `REPLICA.md`, and `SETUP.md` where present before continuing.

**Ready to continue:** the app works in your canvas. You have not connected to Hub or published anything.

## 3. Add your product and design-system guidance

Give Copilot the information it needs to build prototypes that follow your team's product and design system.

Review the selected app's supplied guidance first. Preserve its skills and active context. If the repository already uses your team's approved guidance, continue to step 4. You do not need to create it again.

Otherwise:

1. Run `/setup-skills` in your prototype session.
2. Share approved sources: product documentation, design-system guidance, and any component packages your team uses.
3. Review the drafts using your team's usual approval process and request any corrections.
4. Once the drafts are reviewed, give Copilot separate approval to apply them.
5. Ask Copilot to confirm which guidance is now in use.

Copilot drafts instructions from those sources and asks permission before installing packages.

**If setup fails:** Resolve package installation or build errors before continuing.

> **Note:** You do not need to connect Hub to complete this step.

## 4. Build a useful first prototype

Choose a small task your team wants to explore. Ask Copilot to build it using the approved guidance and sample data. For example:

```text
Build a searchable project list using our approved design-system guidance.
Use sample data. Include an empty result state and a way to clear the search.
Show it in the Replica canvas.
Before editing, check that the reviewed app and guidance are committed.
If guidance or starting pages changed after setup, ask for my approval
to save those changes in a local commit before creating the prototype branch.
Use a separate branch for this prototype. Leave the default branch unchanged.
Ask for approval before making any commits. Do not push or publish anything.
```

The prompt asks Copilot to preserve a reusable starting version before experimenting:

- **New starter:** The installer has already saved the copied files in an initial local commit. Approve a separate commit for any reviewed guidance or starting-page changes before experimenting. Neither local commit uploads or publishes anything.
- **Existing team repository:** Use its usual review process for changes to the shared starting point.

Try the interactions and confirm that the prototype uses your team's components.

**Ready to continue:** you have a working prototype that follows your team's guidance. If hosting is still being arranged, you can keep working here and prepare starting pages. Continue below when the server, domain, and required hosting approvals are ready.

## 5. Deploy the hub

If Hub is already running, reuse it and continue at step 6. You do not need to deploy another Hub.

Deployment can happen alongside steps 2 through 4. Follow the [Hub deployment guide](../hub/docs/deployment.md) on the Hub server, or share it with the person handling deployment.

**Keep the deployment settings safe:**

- Store the private settings file (`.env`) securely and never add it to a Git repository.
- Do not run `./replica init` again on an existing installation.
- Keep the original security keys. New keys cannot read the saved GitHub connection details.

Using the released installation package, not the developer setup:

1. Download and check the installation files, create Hub's settings, set up DNS and HTTPS, and start Hub as described in the deployment guide.
2. Keep the Hub web address and the setup code printed during installation for step 6.
3. Check the [web forwarding settings](../hub/docs/deployment.md#client-ip-addresses-and-trusted-proxies) and arrange [backups and recovery](../hub/docs/backups-and-restore.md) before the wider team joins.
4. Open the setup page at your Hub address, such as `https://hub.example.com/setup`.

> **Note:** The `./replica init` command creates settings; it does not complete deployment.

**If the setup page does not open:** Run `./replica logs` on the Hub server and follow the [startup troubleshooting instructions](../hub/docs/deployment.md#troubleshoot-startup).

**Ready to continue:** the setup page opens, and DNS and HTTPS are configured for both Hub and its previews. Publishing is not tested yet.

## 6. Connect GitHub and enable builds

With Hub running, connect the repository and enable its build workflow. If Hub already shows a successful Build for the repository's reviewed default branch, continue at step 7.

### Share the reviewed starting version

If the reviewed app and approved guidance are already on GitHub's default branch, reuse that version and continue at **Connect the repository to the GitHub App** below.

1. If your project is not on GitHub yet, agree which organization will own the repository and whether it should be private or public.
2. Give prototype authors write access and reviewers read access.
3. Ask Copilot to connect the agreed GitHub repository and upload the saved starting version to its intended default branch. Approve any repository creation, commits, and uploads before they proceed.

> **Note:** Keep your prototype on its own branch. For an existing shared repository, use its usual review process; do not replace its files, remote, or history.

### Connect the repository to the GitHub App

**Access rules:**

- Keep the App private and organization-owned. An App created under a personal account would only let that person sign in.
- Before connecting a public repository, review [who will be able to access its reviews](../hub/docs/authentication-and-repository-authorization.md#app-ownership-and-repository-visibility).
- Creating the App does not automatically make anyone a Hub administrator.

1. Check the [prototype requirements](../hub/docs/github-actions-builds.md#prototype-requirements) before connecting the repository.
2. Connect the repository using the path for your Hub:

   | Hub setup | Action |
   | --- | --- |
   | New Hub | Open `/setup` and enter the setup code from step 5. Follow the [GitHub App setup instructions](../hub/docs/github-app-setup.md#setup) to create a private App owned by your organization and install it on the prototype repository. |
   | Existing Hub | Reuse its GitHub App and include this repository in the App's installation on GitHub. If it is already included, no installation change is needed. Do not repeat initial setup. |

3. If Hub does not have an administrator yet, have the person who will look after it [register as a Hub administrator](../hub/docs/security-audit.md#enroll-an-operator).

### Enable the build workflow

The workflow prepares your app for publishing. Hub downloads the result and calls each prepared version a **Build**.

1. Sign in to Hub with a GitHub account that has write access to the repository.
2. Check the workflow's status:

   | Workflow status | Action |
   | --- | --- |
   | Already installed | Check its latest default-branch Build rather than installing it again. If it needs updating, follow the [workflow installation instructions](../hub/docs/github-actions-builds.md#install-the-repository-workflow). |
   | Not installed | Open the repository in Hub and choose **Open installation pull request**. Review and merge it using your team's usual review process and the workflow installation instructions. |

3. Wait for the workflow to finish and for Hub to download the result.

**If the workflow fails or a download is denied:** Investigate the displayed error before continuing.

**Ready to continue:** Hub shows a successful Build for the repository's default branch. A successful GitHub workflow alone is not enough.

## 7. Connect your canvas to Hub

1. Install [GitHub CLI](https://cli.github.com/) on your computer if needed, then sign in with an account that can access the repository.
2. [Save your team's Hub address](../starters/shared/REPLICA.md#connect-to-hub) in the repository's `.github/replica.json`. Keep any existing settings.
3. Review and merge the change into the default branch so teammates can use it too.
4. Open your prototype session and its canvas. If the app is not running, ask Copilot to start it and show it in the canvas.
5. Choose **Connect to the hub** and enter your team's Hub URL if asked.
6. In the browser, check the Hub address, repository, and approval code. Approve only if they match what the canvas shows.

> **Note:** Copilot sign-in does not sign you in to GitHub CLI. Saving the Hub address does not grant access; each person must approve their own connection.

**If the connection is wrong or fails:**

- **Wrong Hub:** Follow the [Hub switching instructions](../hub/docs/prototype-canvas.md#repository-hub-discovery).
- **Approval problem:** See [connection approval](../hub/docs/prototype-canvas.md#pairing-and-review).

**Ready to continue:** you can use the app in the canvas and have approved its connection to your team's Hub. Connecting does not publish anything.

## 8. Publish your prototype and exchange feedback

Before publishing:

1. Open your prototype session.
2. Ask Copilot to confirm that you are on the prototype's branch, not the default branch, and that it includes `.github/workflows/replica.yml` from step 6.
3. If the workflow is missing, ask Copilot to preserve your local prototype work and, with your approval, fetch and merge the reviewed default-branch changes into this branch. Resolve any conflicts before continuing.
4. Check the result in the canvas.

Then publish and exchange feedback:

1. Choose **Publish** and approve saving and uploading your prototype changes.
2. Wait until the canvas says **Published**. A completed upload alone does not mean Hub is ready to show it.
3. Open **Share prototype**, copy the **Internal prototype link**, and send it to your teammate.
4. Ask them to sign in, open the prototype, and leave a comment. They need at least read access to the repository.
5. Check that you can read their comment in your connected canvas.

If publishing or comments do not work, investigate the displayed error. You can continue prototyping locally while resolving it.

Use the internal link for this first review. Public sharing is off by default and should stay off unless your organization decides to enable it. See [share links](../hub/docs/share-links.md).

**Ready to continue:** your teammate can open the published prototype and leave a comment, and you can read that comment in the canvas.

## 9. Prepare useful starting pages

Starting pages help teammates try common product ideas. For example, you might offer a list, a detail page, and an empty state. Hub already offers **Default**, which opens your app's main page.

1. Create a few starting pages using sample data, or review and reuse pages you already have.
2. Add them to `.github/replica.json` using the [template instructions](../hub/docs/github-actions-builds.md#uploaded-artifact). Keep the Hub address you added earlier in that file.
3. Review the guidance and pages together.
4. Have the approved changes merged into the default branch using your team's usual review process.
5. Wait for the updated Build to appear in Hub, then check that the **Templates** list shows the starting pages you expect.

> **Note:** You can prepare the pages before Hub is ready. Check their appearance in the Templates list once Hub is running.

**Ready to continue:** your team's shared version has approved guidance and working starting pages. New prototypes can use that version without changing it.

## 10. Invite the team

1. Ask someone who did not help with setup to follow [Join your team's Replica environment](getting-started.md).
2. Check that they can create a prototype using the approved guidance, publish it, and exchange feedback.
3. Share the setup details with the team:

   | Detail | What to include |
   | --- | --- |
   | Getting started | Repository link, Hub URL, and joining guide. |
   | Tooling | Any required tool or plugin versions. |
   | Support | Who to ask about the design guidance, starting pages, and Hub. |

> **Note:** Teammates should use your existing repository and Hub, not install another starter or set up another server.

## 11. Maintain the shared environment

The people looking after the shared environment handle ongoing maintenance. Each prototype user does not need to repeat these tasks.

- **Guidance and pages:** Keep them up to date and review changes before adding them to the default branch for everyone to use.
- **Hub operation:** Follow the [maintenance instructions](../hub/docs/deployment.md#operate-the-deployment) to check that it is working, investigate problems, and install updates.
- **Recovery:** Keep the existing security keys and saved data when updating, maintain the agreed backups, and confirm who will restore Hub if something goes wrong.
- **Access:** Review who has access. If your organization enables public sharing, also review shared links and their expiration dates.
