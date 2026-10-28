# Join your team's Replica environment

Create an interactive prototype with GitHub Copilot, publish it to Replica Hub, and collect feedback from your team. This guide helps you join your organization's prototyping environment and create your first shared prototype.

* Starting on your own? Follow [Create your first local prototype](local-prototyping.md), which needs no Hub.
* Setting up hosting for your organization? Follow [Set up shared hosting and team feedback](prototype-environment.md).

Publishing and team comments need an organization-hosted Hub, a connected GitHub repository, and the repository's Replica build workflow.

## 1. Download the GitHub Copilot app

Local canvas previews require macOS or Linux.

1. Download the [GitHub Copilot app](https://github.com/features/ai/github-app), install it, and follow its sign-in instructions.
2. Check that the following tools are installed:

   | Tool | Requirement |
   | --- | --- |
   | [Git](https://git-scm.com/) | Required for the prototype repository. |
   | [Node.js](https://nodejs.org/) and [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) | Use the Node.js version required by your team's repository. npm comes with Node.js. |
   | `lsof` | Required on the machine running the canvas extension to find local servers. Install it with your system's package manager if missing. |
   | [GitHub CLI](https://cli.github.com/) | Required for the canvas's branch and publishing checks. |

3. In a terminal, check your GitHub CLI sign-in:

   ```sh
   gh auth status --hostname github.com
   ```

4. If you are not signed in, run `gh auth login --hostname github.com` and follow the prompts. Use an account with access to the prototype repository.

> **Note:** Copilot sign-in and Hub browser approval do not replace GitHub CLI sign-in. The canvas's **Start dev server** action is supported only on macOS and Linux.

## 2. Set up your prototyping repository

Your organization should have a shared prototyping environment: a GitHub repository with your product's components and design guidance, connected to your team's Replica Hub. A designer, design-system maintainer, or engineer may already have set this up.

Before adding the repository, get these details from your team:

- The prototype repository's GitHub URL.
- The Hub URL.
- Repository write access, which you need to publish prototypes.

Add the repository to the Copilot app:

1. In the sidebar, click **+** beside **Sessions**.
2. Choose **Add GitHub repository**.
3. Find and select the repository your team gave you.
4. Once it appears under **Sessions**, click **+** beside that repository to start a new session.

If the repository is missing or access is denied, ask its maintainer to check your GitHub access. See [connecting a repository in Copilot](https://docs.github.com/en/copilot/get-started/quickstart-copilot-app#connecting-a-repository-or-folder) for app setup help.

**No shared environment yet?** Use the [hosted setup walkthrough](prototype-environment.md) to check hosting needs, add your team's guidance, and build a prototype while hosting is arranged. Connect Hub when it is ready, then publish and invite teammates.

## 3. Install and enable the canvas

The Replica prototype canvas shows your local preview beside the Copilot conversation and adds publishing, sharing, commenting, and prototype controls.

### Install the plugin if needed

If the plugin appears under **Customize → Installed**, continue at **Enable the plugin and canvas** below.

Repositories using the current Replica starter setup script install the plugin automatically. That setup:

- Installs Copilot CLI globally with `npm install -g @github/copilot` if `copilot` is missing.
- Installs the Replica plugin.
- Runs `npm ci` even if CLI or plugin setup fails.

> **Note:** Automatic setup needs npm and a writable global installation directory. It does not use sudo or change your shell configuration. Successful dependency installation does not mean the canvas is ready.

**If automatic setup failed:** Check the app's setup output and resolve the reported error. Follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) if CLI is unavailable, then rerun `node scripts/setup-replica-plugin.mjs` in repositories that have it.

For repositories without the setup script, ask Copilot to install the plugin or run these steps in a terminal with Copilot CLI available:

1. If Copilot CLI is unavailable, follow the [installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).
2. Add the marketplace if you haven't already:

   ```sh
   copilot plugin marketplace add github/replica
   ```

3. Install the plugin:

   ```sh
   copilot plugin install replica-prototype@replica
   ```

### Enable the plugin and canvas

1. In the Copilot app sidebar, open **Customize → Installed**.
2. Enable the `replica-prototype` plugin.
3. Enable its `replica-prototype` canvas extension. Both switches must be enabled.
4. Start a fresh session in the Copilot app.
5. Select **+ → Canvas → Replica prototype**.

If the canvas is missing, check that installation completed and that you started a new session after installing it.

## 4. Create a prototype

1. Start a new prototype by clicking **+** next to your prototype repository. Give each prototype its own session.
2. Before editing, ask Copilot to confirm that the session uses a new prototype branch, not the repository's default branch.
3. Describe the change you want and let Copilot build it. You can use the example below.

### Example prompt: Create a searchable project list

```text
Help a teammate find a project in a list. Use our approved design-system
guidance and sample data. Add search, an empty result message, and a way
to clear the search. Keep this separate from our live product.
```

The Replica canvas should open automatically and show your prototype.

- **Server listed:** Choose **Connect** beside your prototype's server.
- **No running server:** Choose **Start dev server**.
- **Startup fails:** Ask Copilot to explain the error before changing anything.

## 5. Connect to the Hub

Now it is time to connect to the hub to publish and share your prototype.

1. In the Replica canvas, open **Edit details** and select **Connect to the Hub**.
2. Enter your team's Hub URL if prompted, then continue to browser approval.
3. Sign in with the GitHub account that has access to the prototype repository.
4. Check the Hub address, repository, and approval code. Approve only when the browser shows the same code as the canvas.
5. Return to the canvas after approval.

> **Note:** Connecting does not push or publish anything. You can keep working locally by default.

**If the connection fails:** Check the Hub URL and repository access with your team. An expired or revoked connection needs browser approval again. See [canvas connection guidance](../hub/docs/prototype-canvas.md#pairing-and-review).

Administrators can follow [Hub and repository setup](prototype-environment.md#5-deploy-the-hub).

## 6. Publish your prototype

Publishing sends your prototype branch to GitHub, where the workflow builds it. Hub imports the result and adds it to the **Prototype** page in your organization's Hub. Local changes are not visible to reviewers until you publish them.

1. Choose **Publish** in the canvas. Copilot will publish your work.
2. Wait until the canvas shows **Published**.
3. Use **Edit details** to give the prototype a useful name and short description.

> **Note:** A completed push or successful GitHub workflow is not enough. Hub must also import the successful Build for your current version.

After making more changes, choose **Publish changes** to share the new version.

**If publication fails:**

- Read the displayed error and open **View workflow run** when available.
- Ask Copilot to investigate that failure before retrying.
- If the build workflow is missing, ask your repository maintainer to follow [workflow installation](../hub/docs/github-actions-builds.md#install-the-repository-workflow).

## 7. Share and comment

### Share with teammates

1. Choose **Share prototype**, the link icon beside the publishing button.
2. Copy the **Internal prototype link** and send it to your teammates.

Internal links require GitHub sign-in and repository read access. They let teammates try the published prototype and add comments.

### Leave feedback

1. Open the prototype in Hub.
2. Choose **Add a comment**, then select an element or highlight a region.
3. Use the comment-count button to find conversations, reply, and resolve or reopen them.

> **Note:** Conversations remain available across published versions. You can also read and reply to comments in the connected canvas. Starting an anchored comment there requires the local checkout's commit to match the published Build.

You can ask Copilot to review the comments before making changes:

### Prompt 2: Review feedback before changing the prototype

```text
Read the unresolved comments for this prototype. Summarize the feedback and suggest the next change.
Do not reply to or resolve comments yet.
```

### Share outside the repository

For people without repository access, **Public share links** may be available:

- Public sharing is off by default. A Hub administrator must enable it, and you need permission to manage links.
- Anyone with an active public link can view its selected Build without signing in.
- The link does not include team review conversations or let anonymous visitors comment.

To create a public link:

1. Check the prototype's content before sharing it.
2. Open **Share prototype**, enter a label, and choose an expiration.
3. Select **Create share link** and copy the resulting URL.
4. Delete the link when it is no longer needed.

> **Note:** Each public link stays on its selected Build. Publishing a newer version does not update that link. See [share-link guidance](../hub/docs/share-links.md) for permissions and limits.

## 8. Add controls

Controls let you change prototype scenarios without asking Copilot to edit code each time. For example, switch between empty and populated states or change the number of items. They live in Replica's panel, separate from the controls someone would use in your product.

Run `/prototype-controls` in your prototype session, or describe the variations you need:

### Prompt 3: Add scenario controls

```text
Add a control to switch this project list between
empty and populated states, and a slider to change the item count.
Wire them to the rendered sample data. Keep these controls in Replica's
panel rather than adding settings to the product UI.
```

After Copilot adds the definitions:

1. Reload the preview page and open **Controls**, the sliders icon in the canvas toolbar.
2. Change each setting and check that the prototype responds. Use **Reset all controls** to restore the defaults.
3. Publish the changes to make them available in Hub previews too.
4. To share a particular scenario, select **Include current control settings** on the canvas sharing page before copying the internal or public link.

> **Note:** Controls work locally without Hub. Publish any new control definitions before sharing a scenario; a link cannot add controls missing from its Build.

**If a control is disabled or reports an error:** Ask Copilot to investigate the displayed reason rather than assuming the change took effect. The [shared Controls guide](../starters/shared/REPLICA.md#prototype-controls) covers authoring and recovery.
