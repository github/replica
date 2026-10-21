# Set up a prototype repository

Use this guide when someone points an agent at `github/replica` and asks it to set up a prototyping repository. The first milestone is an independent starter app with a verified local preview. Product guidance, reference components, a shared team baseline, and Hub publishing are separate milestones.

Choose a starter at creation time. Each app keeps its own routing, dependencies, examples and design-system guidance. Selection does not switch the design system of an existing app.

## 1. Resolve the target and requested outcome

Reuse the repository name, destination, starter choice, references, and decisions already supplied. Ask only for missing information needed for the next action.

| Target | Next action |
| --- | --- |
| New local repository | Choose a new directory outside the Replica checkout, then follow step 2. |
| Existing local or GitHub repository | Inspect its instructions, files, Git state, and remote before proposing changes. If it already uses Replica, continue from its current setup state. |
| Existing empty directory or repository | Explain that the installer requires a new destination. Propose creating the starter in a separate directory and reviewing how to integrate it into the intended repository. Get approval before transferring files or changing repository configuration. |
| Existing repository with another app | Agree whether to adapt that app or create a separate prototype repository before installing anything. Preserve existing files and history. |

A local repository needs no GitHub credentials or Hub. If the user also requests a GitHub repository, resolve its owner and visibility before creating it. Follow the host's authorization rules for repository creation, commits, and pushes; local setup alone does not authorize them.

When a reference app is supplied, retain it for the guidance and component work in step 4. A request to create the repository does not require a design-system questionnaire before copying the starter.

## 2. Choose and create the independent starter

Read the current [starter catalog](../starters/catalog.tsv) or run the installer's `--list`. Reuse an explicit choice from the conversation. Otherwise show the available names and descriptions and ask the user which app to start with. Do not infer selection from a passing design-system reference. A reference can instead be an input for later customization.

The catalog currently offers `minimal` and `coreai`. Commands without `--starter` select Minimal for compatibility; agents should resolve the user's choice before creation. New catalog entries use the same commands.

Without a local Replica checkout, download the installer:

```sh
curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
```

Read the downloaded script before running it. Use a destination that does not exist and whose parent directory exists:

```sh
bash install-starter.sh --list
bash install-starter.sh --starter coreai my-prototype
```

From a local Replica checkout, use the checked-out script instead:

```sh
bash scripts/create-prototype-repo.sh --list
bash scripts/create-prototype-repo.sh --starter coreai ../my-prototype
```

Replace `coreai` with the chosen catalog ID. Both paths use the same creation implementation and assemble shared Replica tooling with only the selected app. They create an independent, uncommitted Git repository with no remote, require no GitHub credentials and publish nothing. The installer requires Bash, curl, tar and Git for download, or Bash and Git from a checkout. It does not require or install Node.js for copying, and it does not install app dependencies.

Before asking the user to accept the copied repository's Copilot app configuration, review `.github/github-app.yml` and the startup details in the copied `REPLICA.md`. Explain that session startup can install Copilot CLI globally when missing, install or enable the Replica plugin, and will run `npm ci`.

Add the new directory to the Copilot app using **Projects → + → Local folder or repository**, then start a fresh session there. The session in the Replica checkout cannot discover the copied local skills.

Before ending the originating session, provide a paste-ready kickoff message headed **Prompt 1: Continue prototype repository setup**. Tell the user to paste it into the fresh session; a new session does not inherit the previous conversation. Include the user's goal, repository path, chosen starter ID and name, supplied references, requested milestone, settled decisions and approvals, completed actions, blockers, and next step.

The kickoff must tell the new session to follow the copied repository's `AGENTS.md` and resume this guide at step 3. Include the [absolute guide URL](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md#3-verify-the-existing-app-locally), since this guide is not copied into the starter. If that version is not yet available at the URL, include steps 3 through 5 inline instead. The new session reuses settled answers and checks which actions and approvals remain applicable.

## 3. Verify the existing app locally

Check `node --version` against `engines.node` in the copied `package.json`. Reuse a compatible installed runtime. On macOS or Linux, obtain approval before installing Node.js, nodenv, or node-build, or changing shell configuration.

The fresh session does not receive the setup output, so ask the user to inspect it and report any failures before repeating setup. Dependency installation success does not prove that the current session loaded the canvas.

Follow the copied `REPLICA.md` for canvas activation and preflight. Complete that preflight before starting a preview. Discover the selected app's run commands in its README and package scripts; do not assume another starter's headings, router or port. Reuse an existing responsive server only after confirming that it serves the intended app, and open the actual printed URL. Verify that the included app renders; a successful dependency install or HTTP response alone is not a rendered check.

This milestone checks the existing starter page without building product UI. Report a missing runtime, unavailable canvas, or failed preview with its specific recovery step. Hub connection is not required for local preview.

## 4. Continue only to the requested milestone

| Requested outcome | Continue with |
| --- | --- |
| Local starter and preview | Report the verified state and stop. No guidance authoring or Hub setup is needed just to inspect the included app. |
| Product or design-system setup | Preserve the app's supplied skills and active context. Run `/setup-skills` when guidance must be added or changed, reusing prior answers. Follow source intake, installation approval, draft review and separate activation steps. |
| Reference-based starting UI | Use supplied active guidance where it applies; offer setup only for missing task-required context. Use the local `create-prototype` skill and the selected app's conventions to build the requested shell or page. Establish the permitted component sources and verify the rendered result against the authorized reference. |
| Shared team baseline | Complete the applicable guidance setup, [prepare useful starting pages](prototype-environment.md#3-prepare-useful-starting-pages), and review them together. Then [share the baseline on GitHub](#share-the-baseline-on-github). |
| Hosted publishing and comments | First [share the reviewed baseline on GitHub and verify it on the actual default branch](#share-the-baseline-on-github), then follow [deploy the hub](prototype-environment.md#4-deploy-the-hub) and the remaining environment setup steps, or connect to an existing team Hub. |

Guidance drafts are not active guidance. Installed tokens or packages are not proof that reference components are usable or that a shell resembles the reference. Keep those outcomes distinct.

### Share the baseline on GitHub

After reviewing the starter files, guidance, and starting pages, use the intended empty GitHub repository or create one with the agreed owner and visibility. Connect it as a remote named `origin`, make the initial commit, and push the intended default branch only when authorized. For an existing shared repository, follow its contribution process to merge the reviewed changes instead of replacing its remote or history. Ask an engineer for help with these Git steps if needed.

Verify the repository's actual default branch contains the intended baseline before calling it ready for teammates or continuing to Hub repository connection. A local preview is not evidence of a published Hub Build.

## 5. Report what is ready

Finish with a short status summary based on observed results. Distinguish **verified**, **blocked**, **not checked**, and **not requested** rather than saying only "setup complete."

Cover the runtime and dependencies, current-session canvas availability, rendered preview and URL, guidance activation, reference components or shell, default-branch baseline, and Hub publishing only as applicable. Name the next blocker and its recovery action. Preserve this summary across a required session handoff.
