# Get started with Replica

Create an interactive prototype with GitHub Copilot, publish it to Replica Hub, and collect feedback from your team. This guide helps you join your organization's prototyping environment and create your first shared prototype.

You can create and try prototypes locally without Hub. To create a repository rather than join an existing one, follow [prototype repository setup](prototype-repository-setup.md). Publishing and team comments need a Hub hosted by your organization, a connected GitHub repository, and the repository's Replica build workflow. Ask your team for its Hub URL and repository, or follow [environment setup](prototype-environment.md) if you are setting up shared hosting for the first time.

## 1. Download the GitHub Copilot app

Download the [GitHub Copilot app](https://github.com/features/ai/github-app), install it, and follow its sign-in instructions.

You also need [Git](https://git-scm.com/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), and [Node.js](https://nodejs.org/). Install the Node.js version required by your team's prototyping repository; npm comes with the Node.js installation, so you do not need to install it separately.

The canvas preview workflow below supports macOS and Linux. Server discovery requires `lsof` on the machine running the canvas extension; install it with your system's package manager if it is missing. **Start dev server** is supported only on macOS and Linux.

Install [GitHub CLI](https://cli.github.com/) for the canvas's branch and publishing checks. In a terminal, check your GitHub sign-in:

```sh
gh auth status --hostname github.com
```

If you are not signed in, run `gh auth login --hostname github.com` and follow the prompts. Use an account with access to the prototype repository. Copilot sign-in and Hub browser approval do not replace this GitHub CLI sign-in.

## 2. Set up your prototyping repository

Your organization should have a shared prototyping environment: a GitHub repository with your product's components and design guidance, connected to your team's Replica Hub. A designer, design-system maintainer, or engineer may already have set this up.

Ask your team for the prototype repository's GitHub URL, the Hub URL, and access. You need repository write access to publish prototypes.

Add the repository to the Copilot app:

1. In the sidebar, click **+** beside **Projects**.
2. Choose **Add GitHub repository**.
3. Find and select the repository your team gave you.
4. Once it appears under **Projects**, click **+** beside that repository to start a new session.

If the repository is missing or access is denied, ask its maintainer to check your GitHub access. See [connecting a repository in Copilot](https://docs.github.com/en/copilot/get-started/quickstart-copilot-app#connecting-a-repository-or-folder) for app setup help.

**Setting up the environment for your organization?** Follow [Set up and configure your prototype environment](prototype-environment.md) instead. It covers creating the repository, adding design-system guidance, deploying Hub with Docker, and connecting builds before inviting teammates.

## 3. Install and enable the canvas

The Replica prototype canvas shows your local preview beside the Copilot conversation and adds publishing, sharing, commenting, and prototype controls.

Ask your agent to install the plugin and provide the following commands to the agent:

```sh
copilot plugin marketplace add github/replica
copilot plugin install replica-prototype@replica
```

You can also run this manually in a terminal with Copilot CLI available.

Repositories using the current Replica starter setup script automatically run `npm install -g @github/copilot` if `copilot` is missing, then install the Replica plugin. This needs npm and a writable global installation directory. Setup does not use sudo or change your shell configuration. Dependency installation with `npm ci` still runs if CLI or plugin setup fails; this does not mean the canvas is ready. Check the app's setup output for the failure reason and recovery steps. If automatic installation fails, or your repository does not use that script, follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), then rerun `node scripts/setup-replica-plugin.mjs` in repositories that have it.

In the Copilot app sidebar, open **Customize**, then **Installed**. Find the `replica-prototype` plugin and enable it. Also find its `replica-prototype` canvas and enable that extension; both the plugin and extension must be enabled.

Start a fresh session in the Copilot app, then select **+ → Canvas → Replica prototype**.

If the canvas is missing, check that installation completed and that you started a new session after installing it.

## 4. Create a prototype

Start a new prototype by clicking **+** button next to your prototype repository. Each prototpye should get it's own session.
Describe the change you want and let copilot work for a couple minutes.

### Example prompt: Create a searchable project list

```text
Help a teammate find a project in a list. Use our approved design-system
guidance and sample data. Add search, an empty result message, and a way
to clear the search. Keep this separate from our live product.
```

The replica canvas should open automatically and show your prototype. If it lists running servers, choose **Connect** beside your prototype's server.
If none is running, choose **Start dev server**. If startup fails, ask Copilot to explain the error before changing anything.

## 5. Connect to the Hub

Now it is time to connect to the hub to publish and share your prototype.

In the Replica canvas, open **Edit details** and select **Connect to the Hub**. Enter your team's Hub URL if prompted, then continue to browser approval.

Sign in with the GitHub account that has access to the prototype repository. Check the Hub address, repository, and approval code.
Approve only when the browser shows the same code as the canvas.

Return to the canvas after approval. Connecting does not push or publish anything, and you can keep working locally by default.

If the connection fails, check the Hub URL and repository access with your team. An expired or revoked connection needs browser approval again. See [canvas connection guidance](../hub/docs/prototype-canvas.md#pairing-and-review) for more detail.

Administrators can follow [Hub and repository setup](prototype-environment.md#4-deploy-the-hub).

## 6. Publish your prototype

Publishing sends your prototype branch to GitHub, it gets build and added to the **Prototype** page in your organisations' Hub. Local changes are not visible to reviewers until you publish them.

To publihs your prototype, choose **Publish** in the canvas. Copilot will publish your work.

Wait until the canvas shows **Published**. A completed push or successful GitHub workflow is not enough: the Hub must also import the successful Build for your current version.

Use **Edit details** to give the prototype a useful name and short description. After making more changes, choose **Publish changes** to share the new version.

If publication fails, read the displayed error and open **View workflow run** when available. Ask Copilot to investigate that failure before retrying. If the build workflow is missing, ask your repository maintainer to follow [workflow installation](../hub/docs/github-actions-builds.md#install-the-repository-workflow).

## 7. Share and comment

Choose **Share prototype**, the link icon beside the publishing button. The **Internal prototype link** is useful to share your prototype with your teammates.

Internal links require GitHub sign-in and repository read access. They let teammates try the published prototype and add comments.

To leave feedback, open the prototype in Hub, choose **Add a comment**, and select an element or highlight a region. Use the comment-count button to find conversations, reply, and resolve or reopen them. Conversations remain available across published versions.

You can also read and reply to coments in the connected canvas. Starting an anchored comment there requires the local checkout's commit to match the published Build.

You can even ask your agent to review the comments people left on your prototype.

### Prompt 2: Review feedback before changing the prototype

```text
Read the unresolved comments for this prototype. Summarize the feedback and suggest the next change.
Do not reply to or resolve comments yet.
```

For people without repository access, **Public share links** may be available. Public sharing is off by default and requires a Hub administrator to enable it and permission to manage links. Anyone with an active public link can view its selected Build without signing in, the link does not include team review conversations or let anonymous visitors comment.

Check the prototype's content before creating a public link from the **Share prototype** page. Enter a label, choose an expiration, and select **Create share link**. Copy the resulting URL and delete the link when it is no longer needed. Each public link stays on its selected Build: publishing a newer version does not update that link. See [share-link guidance](../hub/docs/share-links.md) for permissions and limits.

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

After Copilot adds the definitions, reload the preview page and open **Controls**, the sliders icon in the canvas toolbar. Change each setting and check that the prototype responds. **Reset all controls** restores the defaults.

Controls work locally without the Hub. Publish the changes to make them available in Hub previews too. To share a particular scenario, select **Include current control settings** on the canvas sharing page before copying the internal or public link. Publish any new control definitions first, a link cannot add controls missing from its Build.

The [shared Controls guide](../starter-common/REPLICA.md#prototype-controls) covers authoring and recovery. If a control is disabled or reports an error, ask Copilot to investigate the displayed reason rather than assuming the change took effect.
