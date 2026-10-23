# Set up and configure your prototype environment

Give your organization a shared repository for prototypes with its own components and design guidance.

This guide covers the starter repository, design-system guidance, starting pages, and handoff to your team. Hub is being rebuilt. Deployment, repository connections, publishing, hosted previews, and team comments are not available yet. See [Hub status](../hub/README.md) and [architecture](../hub/docs/architecture.md).

For a local prototype without a shared team baseline, use [prototype repository setup](prototype-repository-setup.md).

## Who should be involved

A designer or design-system maintainer leads the guidance and starting pages. An engineer helps connect packages and get the local app working. A repository maintainer grants the team access.

The person preparing the repository needs the [GitHub Copilot app](https://github.com/features/ai/github-app), [Git](https://git-scm.com/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), and [Node.js](https://nodejs.org/). Use a Node.js version matching `engines.node` in [starter/package.json](../starter/package.json). Reuse an existing compatible installation, or arrange an approved installation with an engineer. The starter does not install these tools.

Authors using the canvas preview workflow need macOS or Linux, with `lsof` available on the machine running the extension for server discovery. Install `lsof` with the system's package manager if needed. The canvas's **Start dev server** action supports only macOS and Linux.

## 1. Create the team's prototype repository

Follow steps 1 through 3 of [prototype repository setup](prototype-repository-setup.md) to create an independent starter, open a fresh Copilot session, and verify its local preview. Then return here to prepare the team's guidance and starting pages.

Use a GitHub repository in your organization for the shared baseline. Give authors the access they need to contribute. Keep production credentials and real customer data out of it.

## 2. Add your product and design-system guidance

Run `/setup-skills` in the new repository. Provide the product documentation, design-system documentation, and component or token packages your team wants Copilot to follow. Use only sources your organization permits you to access.

Copilot checks the sources, offers any needed package installations for your approval, and drafts guidance. Designers and design-system maintainers should review the drafts for accuracy and approve their activation. Drafting guidance does not activate it automatically.

Try a small change using the approved guidance. Confirm that Copilot uses the intended components and patterns, not just similar-looking replacements. Have an engineer resolve package or build problems before the repository becomes your team's starting point.

The [starter guide](../starter/README.md) explains the included app and skills. The [setup and troubleshooting guide](../starter/SETUP.md) covers technical canvas integration and installation errors.

## 3. Prepare useful starting pages

Add a small set of representative pages with sample data, such as a list, a detail page, and an empty state. Choose pages that help teammates explore common product questions.

Review the pages and guidance together, then follow [share the baseline on GitHub](prototype-repository-setup.md#share-the-baseline-on-github) to create or use the intended organization repository, connect `origin`, and commit and push the reviewed baseline when authorized. For an existing shared repository, merge through its contribution process. Verify the actual default branch contains the baseline before inviting the team.

## 4. Connect the local prototype canvas

Install the Replica prototype plugin through Copilot CLI using the [canvas installation instructions](../.github/extensions/replica-prototype/README.md#install). Keep only one copy of the canvas enabled in a session.

Start a fresh prototype session, open the canvas, and connect its local preview. A Hub connection is not needed. The extension may still display Hub connection or publishing controls; the new Hub does not support them yet.

## 5. Try the local flow before inviting the team

Ask one prototype author to follow [Get started with Replica](getting-started.md), beginning with adding your shared repository to the Copilot app. They should be able to start a session, make a change on a new branch, connect the local canvas, and use prototype controls.

Give your team the repository's GitHub URL, required local tools and setup commands, any approved canvas version, and the getting started guide. Name the people who maintain the guidance and starting pages. Teammates should reuse this environment rather than repeat the starter installation.

## 6. Maintain the shared environment

Keep product guidance and starting pages current on the repository's default branch. Review and approve guidance changes before asking authors to use them.

Do not configure Hub hosting, sign-in, or storage from old release instructions. Those choices are not decided for the new Hub.
