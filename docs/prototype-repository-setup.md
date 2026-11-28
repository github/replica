# Set up a prototype repository

Use this guide when someone points an agent at `github/replica` and asks it to set up a prototyping repository. The first milestone is an independent starter app with a verified local preview. Product guidance, reference components, and a shared team baseline are separate milestones. Publishing and comments are not available in the [new Hub](../hub/README.md) yet.

This guide uses the existing installer and starter workflows. It does not change `/setup-skills`, which drafts the full shared context library on plain setup.

## 1. Resolve the target and requested outcome

Reuse the repository name, destination, references, and decisions already supplied. Ask only for missing information needed for the next action.

| Target | Next action |
| --- | --- |
| New local repository | Choose a new directory outside the Replica checkout, then follow step 2. |
| Existing local or GitHub repository | Inspect its instructions, files, Git state, and remote before proposing changes. If it already uses Replica, continue from its current setup state. |
| Existing empty directory or repository | Explain that the installer requires a new destination. Propose creating the starter in a separate directory and reviewing how to integrate it into the intended repository. Get approval before transferring files or changing repository configuration. |
| Existing repository with another app | Agree whether to adapt that app or create a separate prototype repository before installing anything. Preserve existing files and history. |

A local repository needs no GitHub credentials or Hub. If the user also requests a GitHub repository, resolve its owner and visibility before creating it. Follow the host's authorization rules for repository creation, commits, and pushes; local setup alone does not authorize them.

When a reference app is supplied, retain it for the guidance and component work in step 4. A request to create the repository does not require a design-system questionnaire before copying the starter.

## 2. Create the independent starter

Use Bash and Git for creation. On native Windows, use Git Bash from the full [Git for Windows](https://gitforwindows.org/) installation. In the GitHub Copilot app, choose **This computer** for a native Windows session, not a WSL environment. Git on `PATH` does not mean Git Bash is available. If Git Bash is missing, report that prerequisite instead of switching environments or installing it without approval.

To use the starter from a local Replica checkout, run this from the checkout root in Bash (Git Bash on Windows):

```bash
bash scripts/create-prototype-repo.sh "../my prototype"
```

To use the published starter without cloning Replica, download the installer. To try changes that are not published yet, use the checkout command above. The download needs `curl`, `tar`, and a writable current directory. Use the `curl` and `tar` that come with Git Bash on Windows.

```bash
curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
```

Read the downloaded script before running it:

```bash
bash ./install-starter.sh "./my prototype"
```

If the agent is in PowerShell or another shell that cannot run the Bash script, locate `bin\bash.exe` under the actual Git for Windows installation and invoke that executable directly. Do not use a bare `bash` or `bash.exe` from `PATH`; it may point to a different shell or WSL. For example, in PowerShell:

```powershell
$gitBash = 'C:\Program Files\Git\bin\bash.exe' # Use your verified Git for Windows path.
if (-not (Test-Path -LiteralPath $gitBash -PathType Leaf)) {
    throw 'Locate Git for Windows bin\bash.exe, or install Git for Windows with Git Bash.'
}
& $gitBash 'scripts/create-prototype-repo.sh' '..\my prototype'
```

Keep the script path and destination as separate arguments. For the reviewed download, pass `'./install-starter.sh'` and `'.\my prototype'` instead. If the script starts and returns an error, report the error. Do not retry it in another shell.

Choose a destination that does not exist and whose parent directory exists. Both commands create an independent Git repository with one local commit on `main` and no remote. The commit gives Copilot a starting point for a worktree. If Git cannot make the commit, check your configured Git name, email, signing, or hooks and retry. Setup copies no Replica history, requires no GitHub credentials, and publishes nothing. Creation does not require or install Node.js or app dependencies. This does not change the [Linux requirements for local Hub Builds](../hub/docs/development.md#build-local-prototype-repositories).

Before asking the user to accept the copied repository's Copilot app configuration, review `.github/github-app.yml` and the startup details in the copied `README.md`. Explain that session startup can install Copilot CLI globally when missing, install or enable the Replica plugin, and will run `npm ci`.

Open the new directory as a local folder in the Copilot app, then start a fresh session there. The app can create a worktree from the initial commit. Do not clone again. The session in the Replica checkout cannot discover the copied local skills.

Before ending the originating session, provide a paste-ready kickoff message headed **Prompt 1: Continue prototype repository setup**. Tell the user to paste it into the fresh session; a new session does not inherit the previous conversation. Include the user's goal, repository path, supplied references, requested milestone, settled decisions and approvals, completed actions, blockers, and next step. For Windows, include which shell ran creation and whether Copilot Startup was checked.

The kickoff must tell the new session to follow the copied repository's `AGENTS.md` and resume this guide at step 3. Include the [absolute guide URL](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md#3-verify-the-existing-app-locally), since this guide is not copied into the starter. If that version is not yet available at the URL, include steps 3 through 5 inline instead. The new session reuses settled answers and checks which actions and approvals remain applicable.

## 3. Verify the existing app locally

Check `node --version` against `engines.node` in the copied `package.json`. Reuse a compatible installed runtime. On macOS or Linux, obtain approval before installing Node.js, nodenv, or node-build, or changing shell configuration.

The fresh session does not receive the setup output, so ask the user to inspect it and report any failures before repeating setup. Copilot Startup uses the app's own command runner. On native Windows, successful creation or a terminal `npm ci` does not verify Startup. Dependency installation success does not prove that the current session loaded the canvas.

Follow the copied README's **Connect the Replica canvas** and **Canvas preflight** sections for plugin activation and recovery. Complete that preflight before starting a preview. Use its **Run it** commands, reuse an existing responsive server when appropriate, and open the actual printed URL. Verify that the included app renders; a successful dependency install or HTTP response alone is not a rendered check.

This milestone checks the existing starter page without building product UI. Report a missing runtime, unavailable canvas, or failed preview with its specific recovery step. Hub connection is not required for local preview.

## 4. Continue only to the requested milestone

| Requested outcome | Continue with |
| --- | --- |
| Local starter and preview | Report the verified state and stop. No guidance authoring or Hub setup is needed just to inspect the included app. |
| Product or design-system setup | Run the new repository's `/setup-skills` with the supplied sources. Reuse prior answers. Follow its source intake, installation approval, draft review, and separate activation steps. |
| Reference-based starting UI | Complete the applicable guidance setup, then use the local `create-prototype` skill to build the requested shell or page. Establish whether components come from an installable package, permitted source reuse, or newly authored components. Verify the rendered result against the authorized reference. |
| Shared team baseline | Complete the applicable guidance setup, [prepare useful starting pages](prototype-environment.md#3-prepare-useful-starting-pages), and review them together. Then [share the baseline on GitHub](#share-the-baseline-on-github). |
| Try Learnings alone (local learning mode) | Needs a local Replica checkout, because the learning package is not published. Run `npm ci` in its `packages/learning`, then run `node <replica-checkout>/packages/learning/bin/replica-learning.mjs setup` in the prototype checkout. It doesn't need a GitHub repository. Give the user the printed command to restart Copilot CLI; the first chat it saves asks them for consent in a form. See [Connect an agent](../packages/learning/README.md#connect-an-agent). |
| Hosted publishing and comments | Explain that the new Hub cannot publish prototypes or accept comments yet. Its protected Azure installation workflow does not add these product features. Do not infer setup steps from old releases. Local previews and a shared repository remain available. |

Guidance drafts are not active guidance. Installed tokens or packages are not proof that reference components are usable or that a shell resembles the reference. Keep those outcomes distinct.

### Share the baseline on GitHub

After reviewing the starter files, guidance, and starting pages, use the intended empty GitHub repository or create one with the agreed owner and visibility. Connect it as a remote named `origin`, commit any reviewed changes, and push the intended default branch only when authorized. For an existing shared repository, follow its contribution process to merge the reviewed changes instead of replacing its remote or history. Ask an engineer for help with these Git steps if needed.

Verify the repository's actual default branch contains the intended baseline before calling it ready for teammates. A local preview is not evidence of a published Hub Build.

## 5. Report what is ready

Finish with a short status summary based on observed results. Distinguish **verified**, **blocked**, **not checked**, and **not requested** rather than saying only "setup complete."

Cover the runtime and dependencies, current-session canvas availability, rendered preview and URL, guidance activation, reference components or shell, default-branch baseline, and Hub publishing only as applicable. Name the next blocker and its recovery action. Preserve this summary across a required session handoff.
