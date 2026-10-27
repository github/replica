# Create your first local prototype

This guide walks you through running a prototype locally, adding your team's design-system guidance, and building a useful first prototype. You can start from the Replica starter or use a prototype repository your team already maintains.

You'll use the **Replica canvas**, a panel in the GitHub Copilot app that shows your running prototype beside your conversation. It is included in the Replica plugin. Step 3 below covers installing the plugin if needed and enabling the canvas.

**You can prototype locally without Hub, Docker, a domain, or a GitHub repository.** You can also use a team repository already configured for local development while hosting is being arranged. Publishing and shared review comments need Hub, but local work does not.

For a quick trial, stop after the app works in the canvas in step 4. Continue through steps 5 and 6 to build with your team's guidance.

- **Joining an existing setup?** Follow [Join your team's Replica environment](getting-started.md) if your team has a connected repository and Hub.
- **Setting up hosting?** Follow [Set up shared hosting and team feedback](prototype-environment.md).

## 1. Prepare your local development environment

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

## 2. Create or open your prototype repository

With your local development environment ready, the next step is to open a prototype repository in Copilot. You can create one from the Replica starter or use a repository your team has already set up for local prototyping.

If you already have a Replica repository, use **Open an existing repository** below. You do not need to copy the starter files or start again.

### Create a repository from the starter

The installer creates a new folder for your prototype, named `my-prototype` in the example below. Choose a name that is not already in use.

The new folder is an independent local Git repository with the copied files saved in an initial commit on `main`. The installer does not create a GitHub repository, set a remote, or publish anything.

> **Before accepting Copilot setup:** Session startup can install Copilot CLI globally if missing, install or enable the Replica plugin, and install app dependencies with `npm ci`.

1. In a terminal, go to the directory where you want the new folder created, then download the installer:

   ```sh
   curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
   ```

2. Review the installer, then list the available apps:

   ```sh
   bash install-starter.sh --list
   ```

3. Choose an app from the [starter catalog](../starters/catalog.tsv):

   | App | Starting point |
   | --- | --- |
   | **Minimal** (`minimal`) | A small React app with TanStack Router and no component library. |
   | **CoreAI Sandbox** (`coreai`) | A React Router app with CoreAI components and a Foundry-style shell. |

4. Run the installer with your choice and new folder name. This example selects Minimal; replace `minimal` with your chosen catalog ID:

   ```sh
   bash install-starter.sh --starter minimal my-prototype
   ```

5. In Copilot, choose **Sessions → + → Open folder** and open the new folder.
6. Before accepting its repository configuration, review `.github/github-app.yml` and the copied `REPLICA.md`.
7. Start a fresh session in the new repository so Copilot can discover its included skills. If another session created the folder, give the new session a summary of completed setup, the chosen app, and what you want to build.

> **If creation fails:** Resolve the reported Git identity, signing, or hook error before retrying. The installer uses your existing Git configuration without changing it and removes an incomplete destination if the initial commit fails.

The app's README explains its examples and run commands. The shared [Replica workflow guide](../starters/shared/REPLICA.md) and [troubleshooting guide](../starters/shared/SETUP.md) are copied into every repository.

Continue at step 3.

### Open an existing repository

1. Choose the repository from **Projects** in Copilot. If it is not listed, add it using one of these options:

   | Repository location | Choose |
   | --- | --- |
   | A local copy | **Projects → + → Local folder or repository** |
   | Your team's repository on GitHub | **Projects → + → Add GitHub repository** |

2. Start a session in that repository and review any setup configuration before accepting it.
3. If the repository does not already use Replica, ask Copilot to inspect its instructions, app, and Git state before changing it. Agree whether to adapt the existing app or create a separate starter repository. Preserve the existing files, remote, and history.

**Ready to continue:** the repository is open in Copilot. Opening it does not push changes or publish a prototype.

Continue at step 3.

## 3. Enable the Replica canvas

With your repository open in Copilot, the next step is to enable the Replica canvas so you can preview the app beside your conversation.

Check the session setup output for dependency or plugin failures. Successful dependency installation does not mean the canvas is enabled.

### Install the plugin if needed

If the Replica plugin appears under **Customize → Installed**, continue at [Activate the plugin and canvas](#activate-the-plugin-and-canvas) below.

The Replica starter installs the plugin during session setup. It checks for Copilot CLI and installs it if missing.

- **If starter setup failed:** Resolve the reported error, then run `node scripts/setup-replica-plugin.mjs` from the repository folder to retry plugin setup.
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

### Activate the plugin and canvas

1. In the sidebar, open **Customize → Installed**.
2. Enable both the `replica-prototype` plugin and its canvas extension. They are separate switches.
3. Start a fresh session after installation or enablement.
4. Open **+ → Canvas → Replica prototype**. Keep only one copy of the Replica canvas enabled.

**If setup fails:**

- **Installation failure:** Use the error and recovery instructions in the terminal or session setup output.
- **Policy or permission error:** Resolve it through your organization's approval process rather than bypassing it.
- **Missing canvas:** Confirm both switches are enabled and start a fresh session after changing them.

**Ready to continue:** the Replica canvas opens in your current session. You do not need to connect it to Hub.

## 4. Run the app in the canvas

With the canvas enabled, try the starter app or your team's existing prototype before making changes. The goal is to see it running and confirm that you can use it.

Ask Copilot:

```text
Run this repository's app locally and show it in the Replica canvas.
Use the run commands in its README and the URL printed by the server.
Do not change the app, connect to Hub, or publish anything yet.
```

Once Copilot starts the app:

1. In the canvas, choose **Connect** beside your app's server. If none is running, choose **Start dev server**.
2. Once the page appears, try its navigation and any included interactions.

> **Note:** Check the preview itself rather than relying on a setup success message.

If the page does not appear or reports an error, ask Copilot to investigate using the repository's README, `REPLICA.md`, and `SETUP.md` where present before continuing.

**Ready to continue:** the app works in the canvas. This is enough for a quick trial. Continue below to add team guidance and build a prototype.

## 5. Add your team's guidance

Now that you can try the app, give Copilot the information it needs to build prototypes that follow your team's product and design system.

Review the selected app's supplied guidance first. Preserve its skills and active context. If the repository already uses your team's approved guidance, continue to step 6. You do not need to create it again.

Otherwise:

1. Run `/setup-skills` in your Copilot conversation.
2. Provide approved sources: product documentation, design-system documentation, and any component or token packages your team uses.
3. Review the drafts using your team's usual approval process and request any corrections.
4. Once the drafts are reviewed, give Copilot separate approval to apply them.
5. Ask Copilot to confirm which guidance is now in use.

Copilot checks those sources and drafts instructions for building prototypes. It asks for permission before installing any packages.

**If setup fails:** Resolve package installation or app errors before continuing.

> **Note:** Without approved guidance, you can still explore the starter, but you have not yet checked whether Replica follows your team's design system.

**Ready to continue:** the reviewed guidance is in use and the app still runs. The next step is to try that guidance in a prototype.

## 6. Build one useful prototype

With the app running and your team's guidance in place, choose one small task you want to explore. Describe what someone should be able to do, then ask Copilot to build it. For example:

```text
Build a searchable project list using our approved design-system guidance
and sample data. Include an empty result state and a way to clear the search.
Keep it separate from our live product. Show it in the Replica canvas.
Before editing, check that the reviewed app and guidance are committed.
If guidance or starting pages changed after setup, ask for my approval
to save those changes in a local commit before creating the prototype branch.
Use a separate branch for this prototype. Leave the default branch unchanged.
Ask for approval before making any commits. Do not push or publish anything.
```

The prompt asks Copilot to preserve a reusable starting version before experimenting:

- **New starter:** The installer has already saved the copied files in an initial local commit. Approve a separate commit for any reviewed guidance or starting-page changes before experimenting. Neither local commit uploads or publishes anything.
- **Existing team repository:** Use its usual review process for changes to the shared starting point.

Try the result in the canvas:

1. Test the interactions. For the example above, search for a project, try a search with no results, and clear the search.
2. Check that the prototype uses your team's intended components and patterns.
3. Ask Copilot to revise anything that does not match.

Use sample data throughout. Keep production credentials and real customer data out of the prototype.

**Ready to continue:** you have a useful local prototype using your team's approved guidance, kept separate from the saved starting version. It has not been published to Hub.

## Continue when you are ready to share

Keep this repository and the work completed above. You can share a team starting point through GitHub without Hub, or add hosted publishing and comments later.

### Share a team starting point without Hub

1. Review the app, active guidance, and any starting pages your team will reuse.
2. Confirm the GitHub owner, repository visibility, and access before creating a repository or pushing files.
3. Share the reviewed starting version using the appropriate path below.

- **New GitHub repository:** Authorize Copilot to create it or connect an agreed empty repository as `origin`, then push the saved starting version on the intended default branch. Approve any further local commits separately.
- **Existing shared repository:** Use its contribution process to merge the reviewed changes. Preserve its files, remote, and history.

Keep prototype-specific work on its separate branch.

**Ready to share:** the repository's actual default branch on GitHub contains the reviewed app and active guidance. Teammates with repository access can use it locally, even while hosting or Actions approval is pending. This does not publish a Hub preview or enable shared review comments.

### Add hosted publishing and comments

Choose where to continue based on what is ready:

| What is ready | Continue at |
| --- | --- |
| Hub shows a successful Build for the repository's reviewed default branch | [Step 7: Connect your canvas to Hub](prototype-environment.md#7-connect-your-canvas-to-hub). |
| Hub exists, but the repository connection or build workflow needs setup | [Step 6: Connect GitHub and enable builds](prototype-environment.md#6-connect-github-and-enable-builds). Reuse the existing Hub and GitHub App. |
| Hosting is not set up | Check the [hosting requirements](prototype-environment.md#1-check-readiness-before-you-start), then continue at [step 5: Deploy the hub](prototype-environment.md#5-deploy-the-hub) once they are in place. |

The repository setup, guidance, and local prototype are already complete. Do not repeat them.

Within hosted step 6, skip completed work:

- **Starting version already shared on GitHub:** Continue at [Connect the repository to the GitHub App](prototype-environment.md#connect-the-repository-to-the-github-app).
- **App already includes the repository:** Continue at [Enable the build workflow](prototype-environment.md#enable-the-build-workflow).
