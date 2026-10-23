# Set up shared hosting and team feedback

Set up Replica so your team can build prototypes with its design system, share them, and collect feedback. This guide walks you through each step, from checking hosting requirements to publishing your first prototype.

If you only want to try Replica locally, follow [Create your first local prototype](local-prototyping.md). If your team already has a connected repository and Hub, follow [Join your team's Replica environment](getting-started.md).

Build and test prototypes in your local development environment, then publish them to Hub for your team to review and comment on. Your organization sets up and manages the server for Hub, rather than using a service hosted by GitHub.

Confirm the server, dedicated domain, network access, and GitHub permissions needed for Hub. While hosting is arranged, set up your prototype repository with your team's design-system guidance and build a working prototype locally. Once Hub is running and connected to the repository, publish that prototype and collect comments from your team.

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

You can build your prototype locally while hosting is being arranged. Follow steps 2 through 4 below, and prepare starting pages in step 9 if useful. Once the hosting requirements are in place, continue at step 5 with the same project.

If GitHub approvals are also pending, keep working locally. You can share your code once you have an approved repository, even if the build workflow is still awaiting approval. You'll need the workflow approved and working before you can publish to Hub.

To share the reviewed code while hosting is pending, follow [Share the reviewed starting version](#share-the-reviewed-starting-version) in step 6. Stop before the GitHub App and build setup, which need Hub.

## 2. Connect a prototype repository

**You can start prototyping even if Hub is not ready.** Set up your team's repository and design-system guidance in your local development environment while hosting is arranged. You'll connect to Hub later to publish prototypes and collect comments.

You'll use the **Replica canvas**, a panel in the GitHub Copilot app that shows your running prototype beside your conversation. It is included in the Replica plugin.

If you already have a Replica repository, open it in Copilot and continue at **Install the Replica plugin if needed** below. You don't need to copy the starter files or start again. If the app already works in the canvas, go to step 3.

If you already built a local prototype with approved guidance, keep that work and continue at step 5 once the hosting requirements are in place. If Hub is already running, continue at step 6 instead.

### Prepare your local development environment

If you don't already have the [GitHub Copilot app](https://github.com/features/ai/github-app), install it and sign in. You also need [Git](https://git-scm.com/), [Node.js](https://nodejs.org/), and npm. Use a Node.js version matching `engines.node` in your repository's `package.json`, or [the starter's package.json](../starter/package.json) for a new repository. Reuse a compatible installation.

The Replica canvas supports local previews on macOS and Linux. It uses `lsof` to find running local servers. Install missing tools through your organization's approved process. The starter installer does not install Node.js or change your shell configuration.

Copilot requires GitHub sign-in, but creating the local starter does not require GitHub repository access. You can use a Copilot plan or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models).

### Create a starter if you need one

The starter provides a working app to build on. The installer creates a new folder for it, named `my-prototype` in the example below. Choose a name that is not already in use.

In a terminal, go to the directory where you want the new folder created, then download the installer:

```sh
curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
```

Review the installer, then run it with a name for your new project folder:

```sh
bash install-starter.sh my-prototype
```

This creates `my-prototype` as an independent local Git repository. It does not create a GitHub repository, commit files, or publish anything.

In Copilot, choose **Projects → + → Local folder or repository** and add the new folder. Before accepting its setup settings, review `.github/github-app.yml` and the copied README. Setup can install Copilot's command-line tool, the Replica plugin, and project dependencies.

Start a fresh session in the new repository so Copilot can find its included skills. If another session created the folder, give the new session a summary of completed setup and what you want to build.

### Install the Replica plugin if needed

If the Replica plugin appears under **Customize → Installed**, continue at **Open the app in the canvas** below.

The Replica starter installs the plugin during session setup. It checks for Copilot CLI and installs it if missing. Check the session setup output for dependency or plugin failures. If setup failed, resolve the reported error, then run `node scripts/setup-replica-plugin.mjs` from the repository folder to retry plugin setup.

For repositories without that setup script, use the manual plugin commands below. These require the `copilot` command in your terminal. Check with `copilot --version`; if the command is not found, follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) before continuing.

These commands install Replica from its default branch. If your organization requires a specific version or source, use its installation instructions instead.

First, add Replica's plugin marketplace if you haven't already:

```sh
copilot plugin marketplace add github/replica
```

Then install the Replica plugin:

```sh
copilot plugin install replica-prototype@replica
```

### Open the app in the canvas

With the plugin installed, enable the canvas and try the app before making changes. In Copilot, open **Customize → Installed** and enable both the Replica plugin and its canvas extension. They are separate switches.

Start a fresh session after installation or enablement, then choose **+ → Canvas → Replica prototype**. Keep only one copy of the Replica canvas enabled.

Ask Copilot:

```text
Run this repository's app locally and show it in the Replica canvas.
Use the run commands in its README and the URL printed by the server.
Do not change the app, connect to Hub, or publish anything yet.
```

If the canvas lists running servers, choose **Connect** beside your app's server. If none is running, choose **Start dev server**. Once the page appears, try its navigation and any included interactions. Installing dependencies or completing `/setup-skills` does not confirm that the preview works.

If installation fails, use the error and recovery instructions in the terminal or session setup output. Resolve policy or permission errors through your organization's approval process rather than bypassing them. If the canvas is missing, confirm both switches are enabled and start a fresh session after changing them. For preview errors, ask Copilot to investigate using the repository's README and, where present, `SETUP.md` before continuing.

**Ready to continue:** the app works in your canvas. You have not connected to Hub or published anything.

## 3. Add your product and design-system guidance

Give Copilot the information it needs to build prototypes that follow your team's product and design system.

If the repository already uses your team's approved guidance, review what is in place and continue to step 4. You do not need to create it again.

Otherwise, run `/setup-skills` in your prototype session. Share approved product documentation, design-system guidance, and any component packages your team uses.

Copilot drafts instructions from those sources and asks permission before installing packages. Review the drafts using your team's usual approval process and request any corrections. Once the drafts are reviewed, give Copilot separate approval to apply them. Ask it to confirm which guidance is now in use.

You do not need to connect Hub to complete this step. Resolve any package installation or build errors before continuing.

## 4. Build a useful first prototype

Choose a small task your team wants to explore. Ask Copilot to build it using the approved guidance and sample data. For example:

```text
Build a searchable project list using our approved design-system guidance.
Use sample data. Include an empty result state and a way to clear the search.
Show it in the Replica canvas.
Before editing, check that the reviewed app and guidance are committed.
If this is a new repository with no commits, ask for my approval to save
that starting version in a local commit on its initial branch.
Use a separate branch for this prototype. Leave the default branch unchanged.
Ask for approval before making any commits. Do not push or publish anything.
```

The prompt asks Copilot to preserve a reusable starting version before experimenting. A new starter needs its first local commit before a separate prototype branch can keep those versions apart. Copilot must ask for your approval to make that commit; it does not upload or publish anything. For an existing team repository, use its usual review process for changes to the shared starting point.

Try the interactions and confirm that the prototype uses your team's components.

**Ready to continue:** you have a working prototype that follows your team's guidance. If hosting is still being arranged, you can keep working here and prepare starting pages. Continue below when the server, domain, and required hosting approvals are ready.

## 5. Deploy the hub

If Hub is already running, reuse it and continue at step 6. You do not need to deploy another Hub.

Follow the [Hub deployment guide](../hub/docs/deployment.md) on the Hub server, or share it with the person handling deployment. This can happen alongside steps 2 through 4. Use the released installation package, not the developer setup.

Deployment includes downloading and checking the installation files, creating Hub's settings, setting up DNS and HTTPS, and starting Hub. The `./replica init` command creates settings; it does not complete all these steps.

Keep the Hub web address and the setup code printed during installation for step 6. Store the private settings file (`.env`) securely and never add it to a Git repository. Do not run `./replica init` again on an existing installation. Keep the original security keys; new keys cannot read the saved GitHub connection details.

Check the [web forwarding settings](../hub/docs/deployment.md#client-ip-addresses-and-trusted-proxies) and arrange [backups and recovery](../hub/docs/backups-and-restore.md) before the wider team joins.

Open the setup page at your Hub address, such as `https://hub.example.com/setup`. If it does not open, run `./replica logs` on the Hub server and follow the [startup troubleshooting instructions](../hub/docs/deployment.md#troubleshoot-startup).

**Ready to continue:** the setup page opens, and DNS and HTTPS are configured for both Hub and its previews. Publishing is not tested yet.

## 6. Connect GitHub and enable builds

With Hub running, connect the repository and enable its build workflow. If Hub already shows a successful Build for the repository's reviewed default branch, continue at step 7.

### Share the reviewed starting version

If your project is not on GitHub yet, agree which organization will own the repository and whether it should be private or public. Give prototype authors write access and reviewers read access.

If the reviewed app and approved guidance are already on GitHub's default branch, reuse that version and continue at **Connect the repository to the GitHub App** below.

Otherwise, ask Copilot to connect the agreed GitHub repository and upload the saved starting version to its intended default branch. Approve any repository creation, commits, and uploads before they proceed. Keep your prototype on its own branch. For an existing shared repository, use its usual review process; do not replace its files, remote, or history.

### Connect the repository to the GitHub App

Check the [prototype requirements](../hub/docs/github-actions-builds.md#prototype-requirements) before connecting the repository.

For a new Hub, open its `/setup` page and enter the setup code from step 5. Follow the [GitHub App setup instructions](../hub/docs/github-app-setup.md#setup) to create a private App owned by your organization and install it on the prototype repository.

For an existing Hub, reuse its GitHub App and include this repository in the App's installation on GitHub. If the repository is already included, no installation change is needed. Do not repeat Hub's initial setup.

Do not create the App under a personal account for a team environment: only that person would be able to sign in. Keep the App private. Before connecting a public repository, review [who will be able to access its reviews](../hub/docs/authentication-and-repository-authorization.md#app-ownership-and-repository-visibility).

If Hub does not have an administrator yet, the person who will look after it must [register as a Hub administrator](../hub/docs/security-audit.md#enroll-an-operator). Creating the App does not give them that role automatically.

### Enable the build workflow

Sign in to Hub with a GitHub account that has write access to the repository. If the Replica build workflow is already installed, check its latest default-branch Build instead of installing it again. If it needs updating, follow the [workflow installation instructions](../hub/docs/github-actions-builds.md#install-the-repository-workflow).

If the workflow is not installed, open the repository in Hub and choose **Open installation pull request**. This proposes a GitHub Actions workflow that prepares your app for publishing. Review and merge it using your team's usual review process and the workflow installation instructions above.

Wait for the workflow to finish and for Hub to download the result. Hub calls each prepared version a **Build**. If the workflow fails or a download is denied, investigate the displayed error.

**Ready to continue:** Hub shows a successful Build for the repository's default branch. A successful GitHub workflow alone is not enough.

## 7. Connect your canvas to Hub

Install [GitHub CLI](https://cli.github.com/) on your computer if needed. Sign in with an account that can access the repository. Copilot sign-in does not sign you in to GitHub CLI.

[Save your team's Hub address in the repository](../starter/README.md#connect-to-hub), in `.github/replica.json`. Keep any existing settings in that file. Review and merge the change into the default branch so teammates can use it too.

Saving the address does not grant access. Each person must still approve their own connection to Hub.

Open your prototype session and its canvas. If the app is not running, ask Copilot to start it and show it in the canvas.

Choose **Connect to the hub** and enter your team's Hub URL if asked. In the browser, check the Hub address, repository, and approval code. Approve only if they match what the canvas shows.

If the canvas points to a different Hub, follow the [Hub switching instructions](../hub/docs/prototype-canvas.md#repository-hub-discovery). For approval problems, see [connection approval](../hub/docs/prototype-canvas.md#pairing-and-review).

**Ready to continue:** you can use the app in the canvas and have approved its connection to your team's Hub. Connecting does not publish anything.

## 8. Publish your prototype and exchange feedback

Share the prototype you built with your team's guidance:

1. Open your prototype session. Ask Copilot to confirm that you are on the prototype's branch, not the default branch, and that it includes `.github/workflows/replica.yml` from step 6. If the workflow is missing, ask Copilot to preserve your local prototype work and, with your approval, fetch and merge the reviewed default-branch changes into this branch. Resolve any conflicts before continuing. Check the result in the canvas.
2. Choose **Publish** and approve saving and uploading your prototype changes. Wait until the canvas says **Published**. A completed upload alone does not mean Hub is ready to show it.
3. Open **Share prototype**, copy the **Internal prototype link**, and send it to your teammate.
4. Ask them to sign in, open the prototype, and leave a comment. They need at least read access to the repository.
5. Check that you can read their comment in your connected canvas.

If publishing or comments do not work, investigate the displayed error. You can continue prototyping locally while resolving it.

Use the internal link for this first review. Public sharing is off by default and should stay off unless your organization decides to enable it. See [share links](../hub/docs/share-links.md).

**Ready to continue:** your teammate can open the published prototype and leave a comment, and you can read that comment in the canvas.

## 9. Prepare useful starting pages

Create a few pages your teammates can use as starting points. For example, a list, a detail page, and an empty state might help them try common product ideas. Use sample data.

You can prepare these pages before Hub is ready. If you already have them, review and reuse them rather than creating them again.

Hub already offers **Default**, which opens your app's main page. To offer other starting pages, add them to `.github/replica.json` using the [template instructions](../hub/docs/github-actions-builds.md#uploaded-artifact). Keep the Hub address you added earlier in that file.

Review the guidance and pages together. Have the approved changes merged into the default branch using your team's usual review process. Wait for the updated Build to appear in Hub, then check that the **Templates** list shows the starting pages you expect.

**Ready to continue:** your team's shared version has approved guidance and working starting pages. New prototypes can use that version without changing it.

## 10. Invite the team

Ask someone who did not help with setup to follow [Join your team's Replica environment](getting-started.md). Check that they can create a prototype using the approved guidance, publish it, and exchange feedback.

Share the repository link, Hub URL, and joining guide with the team. Include any required tool or plugin versions. Tell them who to ask about the design guidance, starting pages, and Hub itself.

They should use your existing repository and Hub, not install another starter or set up another server.

## 11. Maintain the shared environment

Keep the guidance and starting pages up to date. Review changes before adding them to the default branch for everyone to use.

The person running Hub should follow the [maintenance instructions](../hub/docs/deployment.md#operate-the-deployment) to check that it is working, investigate problems, and install updates. Keep the existing security keys and saved data when updating, and maintain the agreed backups.

Review who has access and who will restore Hub if something goes wrong. If your organization enables public sharing, also review shared links and their expiration dates. The people looking after Hub handle these tasks; each prototype author does not need to repeat them.
