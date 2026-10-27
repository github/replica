# Set up a prototype repository

Copilot uses this guide to create a repository from the Replica starter or continue setup in an existing repository on your behalf. **The numbered steps below are instructions for Copilot.** They cover repository checks, your approvals, local preview, and the handoff to a fresh session.

The first goal is to verify that the starter app, or the app in the existing repository, runs locally in the Replica canvas. Copilot then continues with the product guidance, starting pages, or publishing you requested. **Local prototyping does not need Hub or a GitHub repository.**

Choose a starter at creation time. Each app keeps its own routing, dependencies, examples, and design-system guidance. Selection does not switch the design system of an existing app.

For a walkthrough you can follow yourself, use [Create your first local prototype](local-prototyping.md) or [Set up shared hosting and team feedback](prototype-environment.md). Those guides contain the setup steps; this page is not an additional step you need to complete.

## 1. Confirm the repository and goal

Use the repository name, destination, starter choice, references, and decisions already supplied. Ask only for information needed to take the next step.

If the user requests hosted publishing, identify the [hosting requirements](prototype-environment.md#1-check-readiness-before-you-start) early. Hosting can be arranged alongside local work.

| Starting point | Next step |
| --- | --- |
| New local repository | Choose a new folder outside the Replica checkout, then follow step 2. |
| Existing Replica repository | Inspect its instructions, files, Git state, and remote. Continue from its current setup state rather than installing the starter again. |
| Existing empty folder or repository | The installer needs a destination that does not exist. Propose creating the starter in a separate folder, then agree how to integrate it. Get approval before transferring files or changing repository configuration. |
| Existing repository with another app | Inspect its instructions, files, Git state, and remote. Agree whether to adapt the app or create a separate prototype repository before installing anything. If adapting it, preserve its files and history and use its setup instructions rather than copying the starter over it. |

A local repository needs no GitHub credentials or Hub. Explain that starter creation includes an initial local commit. If the user also requests a GitHub repository, confirm its owner and visibility before creating it. Follow the host's authorization rules for remote repository creation, further commits, and pushes. Local setup alone does not authorize publication.

Keep supplied reference apps and design-system sources for step 4. Creating the starter does not require product or design-system intake first.

## 2. Choose and create the independent starter

Read the current [starter catalog](../starters/catalog.tsv) or run the installer's `--list`. Reuse an explicit choice from the conversation. Otherwise show the available names and descriptions and ask the user which app to start with. Do not infer selection from a passing design-system reference. A reference can instead be an input for later customization.

The catalog currently offers `minimal` and `coreai`. Commands without `--starter` select Minimal for compatibility; agents should resolve the user's choice before creation. New catalog entries use the same commands.

Create the starter only when a new repository is needed, using the destination agreed in step 1. When continuing with an existing app, preserve it and continue at step 3.

Download the installer:

```sh
curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
```

Review the installer, then run it with a new project folder name. The destination must not exist, and its parent folder must exist:

```sh
bash install-starter.sh --list
bash install-starter.sh --starter coreai my-prototype
```

If working from a local Replica checkout, use its script instead of downloading the installer:

```sh
bash scripts/create-prototype-repo.sh --list
bash scripts/create-prototype-repo.sh --starter coreai ../my-prototype
```

Replace `coreai` with the chosen catalog ID. Both paths use the same creation implementation and assemble shared Replica tooling with only the selected app:

- They create an independent Git repository with all copied files in an initial commit on `main`, no remote, and nothing published. This gives worktrees and branch-based tools a starting commit.
- Downloaded installation requires Bash, curl, tar, and Git. Creation from a checkout requires Bash and Git.
- Copying requires no GitHub credentials or Node.js. The installer does not install Node.js or app dependencies.

Git must have an author identity configured through `user.name` and `user.email` or its standard environment variables. The installer uses the existing Git configuration without changing it.

**If creation fails:** The installer reports staging or commit errors and removes the incomplete destination. Resolve identity, signing, or hook failures before retrying.

Before the user accepts the new project's Copilot configuration, review `.github/github-app.yml` and the startup details in the copied `REPLICA.md`. Explain that session startup can install Copilot CLI globally if missing, install or enable the Replica plugin, and run `npm ci`.

### Continue in a fresh session

Ask the user to open the repository folder in Copilot using **Sessions → + → Open folder**, then start a fresh session there. A session in the Replica checkout cannot discover the new repository's local skills.

Before ending the original session, provide a message the user can paste into the new one, headed **Prompt 1: Continue prototype repository setup**. The new session does not inherit the conversation. Include:

- The user's goal and requested outcome.
- The project path, chosen starter ID and name, and supplied references.
- Decisions and approvals already given.
- Completed work, blockers, and the next step.

Tell the new session to follow the project's `AGENTS.md` and continue at [step 3 of this guide](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md#3-verify-the-existing-app-locally). Use the absolute URL because this guide is not copied into the starter. If the current instructions are not yet available at that URL, include steps 3 through 5 in the message.

The new session should reuse settled answers and check which approvals still apply.

## 3. Verify the existing app locally

Check `node --version` against `engines.node` in the project's `package.json`. Reuse a compatible installation. On macOS or Linux, get approval before installing Node.js, nodenv, or node-build, or changing shell configuration.

The fresh session does not receive the previous setup output. Ask the user to report startup failures before repeating setup. Successful dependency installation does not confirm that the canvas is available in the current session.

1. Follow the copied `REPLICA.md` for canvas activation and preflight. Complete those checks before starting the preview.
2. Discover the selected app's run commands in its README and package scripts. Do not assume another starter's headings, router, or port.
3. Reuse a responsive server only after confirming it serves the intended app. Open the actual URL printed by the server.

For an adapted app without `REPLICA.md`, use the [shared canvas setup instructions](../starters/shared/REPLICA.md#connect-the-replica-canvas) alongside the app's own run commands. Preserve its existing instructions.

Verify that the existing app renders without building new product UI. A successful dependency install or HTTP response is not enough. If Node.js, the canvas, or the preview is unavailable, report the specific problem and recovery step. Hub is not required.

## 4. Continue only to the requested milestone

For a local starter trial, report what works and stop after step 3. Product guidance and Hub setup are not required to try the included app.

For the outcomes below, complete only the work needed for the user's request.

### Add product and design-system guidance

Preserve the app's supplied skills and active context. Run the project's `/setup-skills` when product or design-system guidance must be added or changed, using the supplied sources and prior answers. Follow its source intake, package installation approvals, draft review, and separate activation steps. Plain setup drafts all documents in the shared context library unless the user requests a narrower scope.

Report whether guidance is drafted, reviewed, or active. Drafting does not activate it.

### Build from a reference

Use supplied active guidance where it applies and complete setup only for missing task-required context. Then use the project's `create-prototype` skill and the selected app's conventions to build the requested page or app layout. Confirm whether components will come from an installable package, permitted source reuse, or new code.

Verify the rendered result against the authorized reference. Installing tokens or packages does not confirm that the intended components work or that the page matches the reference.

### Prepare a shared team starting point

Complete the relevant guidance setup and build the requested starting pages. A list, detail page, and empty state are possible starting points. Review the pages and guidance together before sharing them.

Continue with **Share the baseline on GitHub** below. This makes the reviewed app, guidance, and pages available to teammates without requiring Hub. Hub templates can be configured later as part of hosted setup.

### Share the baseline on GitHub

1. Review the starter files, active guidance, and starting pages.
2. With authorization, commit any customizations after the installer's initial commit.
3. Use the intended empty GitHub repository or create one with the agreed owner and visibility.
4. With authorization, connect it as `origin` and push the intended default branch.

For an existing shared repository, follow its contribution process to merge the reviewed changes. Preserve its files, remote, and history.

Verify that the repository's actual default branch contains the reviewed app, active guidance, and starting pages before reporting that it is ready for teammates. This is a shared source repository, not a published Hub Build.

### Add hosted publishing and comments

Reuse this repository and its approved guidance to build a useful prototype. Publishing is not a prerequisite for guidance setup or local prototyping.

Once the hosting requirements are in place, continue with [step 5: Deploy the hub](prototype-environment.md#5-deploy-the-hub). The remaining hosted steps cover the GitHub connection, build workflow, canvas connection, publishing, and feedback. There is no need to repeat the repository setup above.

If the team already has Hub, continue with the existing environment's [GitHub and build setup](prototype-environment.md#6-connect-github-and-enable-builds) instead of deploying another Hub. Skip work already completed.

## 5. Report what is ready

Finish with a short summary of observed results. Use **verified**, **blocked**, **not checked**, and **not requested** to distinguish what works from what remains.

Cover only the relevant outcomes: Node.js and dependencies, canvas availability in the current session, rendered preview and URL, guidance activation, reference components or pages, the shared default branch, and Hub publishing.

Name any blocker and its recovery action. Include this summary in a required session handoff so the next session can continue without repeating completed work.
