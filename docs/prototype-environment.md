# Set up and configure your prototype environment

Give your organization a shared place to create prototypes with its own components and design guidance, publish them, and collect feedback in Replica Hub.

This guide is for the people setting up and maintaining that environment, not everyone creating a prototype. It covers the starter repository, design-system guidance, Docker deployment, GitHub connection, and handoff to your team. If your organization already has an environment, follow [Get started with Replica](getting-started.md) to join it instead.

For a local prototype repository without hosted publishing or comments, use [prototype repository setup](prototype-repository-setup.md). It does not require the server, domain, Docker, or GitHub App described below.

The linked technical guides own deployment configuration, access rules, and recovery procedures. Keep them open as you work through the steps below.

## Who should be involved

A designer or design-system maintainer leads the product guidance and starting pages. An engineer helps connect packages and get builds working. Your organization's infrastructure and GitHub administrators deploy the hub and connect repositories.

You will need a GitHub organization, permission to create a prototype repository and install a private GitHub App, and a Linux server with Docker and the Docker Compose plugin. You also need a dedicated domain, DNS access, and a hosting service or reverse proxy that can provide HTTPS for Hub and its wildcard preview addresses.

The person preparing the prototype repository needs the [GitHub Copilot app](https://github.com/features/ai/github-app), [Git](https://git-scm.com/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), and [Node.js](https://nodejs.org/). Use a Node.js version matching `engines.node` in the selected app's `package.json`. npm comes with the Node.js installation, so you do not need to install it separately. Reuse an existing compatible installation, or arrange an approved installation with an engineer. The starter does not install these tools.

Keep the two environments separate: the prototype repository runs locally on authors' computers, while the Hub container runs on your organization's server. Authors joining later do not need their own Hub or Docker installation.

Authors using the canvas preview workflow need macOS or Linux, with `lsof` available on the machine running the extension for server discovery. Install `lsof` with the system's package manager if needed. The canvas's **Start dev server** action supports only macOS and Linux.

Install [GitHub CLI](https://cli.github.com/) on the author's computer for canvas branch and publishing checks. Run `gh auth status --hostname github.com` to check authentication. If needed, run `gh auth login --hostname github.com` and sign in with an account that can access the prototype repository. Copilot sign-in and Hub approval do not replace this step.

## 1. Create the team's prototype repository

Follow steps 1 through 3 of [prototype repository setup](prototype-repository-setup.md) to choose an app from the catalog, create an independent repository, open a fresh Copilot session and verify its local preview. Then return here to prepare the team's guidance and starting pages.

Use a GitHub repository in your organization for this shared environment. Give prototype authors write access and reviewers read access. Keep production credentials and real customer data out of it. Continue below to prepare guidance and starting pages before inviting the team.

## 2. Add your product and design-system guidance

Review the selected app's supplied guidance first. Run `/setup-skills` when the team's product or design-system guidance must be added or changed. Provide the product documentation, design-system documentation, and component or token packages your team wants Copilot to follow. Use only sources your organization permits you to access.

Copilot checks the sources, offers any needed package installations for your approval, and drafts guidance. Designers and design-system maintainers should review the drafts for accuracy and approve their activation. Drafting guidance does not activate it automatically.

Try a small change using the approved guidance. Confirm that Copilot uses the intended components and patterns, not just similar-looking replacements. Have an engineer resolve package or build problems before the repository becomes your team's starting point.

The selected app's README explains its examples and commands. The shared [Replica workflow guide](../starters/shared/REPLICA.md) and [troubleshooting guide](../starters/shared/SETUP.md) are copied into every repository and cover canvas integration and installation errors.

## 3. Prepare useful starting pages

Add a small set of representative pages with sample data, such as a list, a detail page, and an empty state. Choose pages that help teammates explore common product questions.

The hub always offers **Default**, which opens the repository's root page. To offer additional templates, declare their names, descriptions, and routes in `.github/replica.json`. See [template configuration](../hub/docs/github-actions-builds.md#uploaded-artifact) for the format and limits, and [templates in the hub](../hub/docs/gallery.md#templates) for how people use them.

Review the pages and guidance together, then follow [share the baseline on GitHub](prototype-repository-setup.md#share-the-baseline-on-github) to create or use the intended organization repository, connect `origin`, and commit and push the reviewed baseline when authorized. For an existing shared repository, merge through its contribution process. Verify the actual default branch contains the baseline before continuing to Hub setup. New prototypes start from that shared version without changing it.

## 4. Deploy the hub

Your organization hosts Hub; GitHub does not host it for you. Use the published Hub image and Docker Compose bundle rather than the contributor devcontainer. The deployment runs one Hub container with its databases and Build files in a persistent Docker volume.

Reserve an entire dedicated domain for the hub and its preview subdomains. A subdomain on a domain shared with unrelated applications is not enough to isolate prototype code from those applications.

### Download and initialize the container deployment

On your Linux server, follow [Download the deployment bundle](../hub/docs/deployment.md#download-the-deployment-bundle) to select an explicit stable `hub-v*` release, download its public bundle and checksum, verify the archive, and extract it into a new deployment directory. Do not use `releases/latest` or skip checksum verification. The public release assets do not require GitHub authentication.

From the extracted deployment directory, run:

```sh
./replica init
```

Enter the public hostname you chose for Hub. Initialization downloads the configured container image, creates a private `.env` file with deployment secrets, and prints the setup code for the first GitHub App connection. Keep that code available for step 5.

Keep `.env` outside Git and preserve it for the lifetime of the deployment. Do not rerun initialization on an existing deployment: new encryption keys cannot read credentials saved with the old keys.

### Configure DNS and HTTPS

For a Hub at `hub.example.com`, create DNS records for `hub.example.com` and `*.preview.hub.example.com` pointing to the server. Configure HTTPS for both addresses and forward both to the Hub service, which listens on `127.0.0.1:3000` by default. A custom proxy must preserve the original host and HTTPS scheme.

Follow [DNS and HTTPS setup](../hub/docs/deployment.md#configure-dns-and-https) and [trusted proxy configuration](../hub/docs/deployment.md#client-ip-addresses-and-trusted-proxies) for your hosting platform. Verify client IP reporting and prevent direct access around your public proxy before relying on request limits or audit addresses.

### Start Hub and protect its data

From the same deployment directory, run:

```sh
./replica up
./replica status
```

The start command waits for the health check and prints the setup address. Open your Hub's HTTPS `/setup` page, then continue with step 5. If startup fails, use `./replica logs` and the [deployment guide](../hub/docs/deployment.md) to investigate before retrying.

Arrange consistent backups of the databases and Build files, and a separate protected backup of `.env` and encryption secrets. Follow [Backups and restore](../hub/docs/backups-and-restore.md) before inviting the wider team. A running container is not a backup.

## 5. Connect the repository and enable builds

Open `/setup` on your deployed Hub, enter the setup code printed during initialization, and follow [GitHub App setup](../hub/docs/github-app-setup.md). Create the private App under your GitHub organization and install it on the prototype repository. A private App owned by a personal account allows only that person to sign in. Keep the App private and check the intended review audience before connecting a public repository.

Enroll the person administering the hub through `/operator/enrollment`, following the [operator enrollment instructions](../hub/docs/security-audit.md#enroll-an-operator). Creating the App does not grant that role automatically.

Sign in to the hub with a GitHub account that has write access to the prototype repository. Open that repository and choose **Open installation pull request**. Review and merge the proposed `.github/workflows/replica.yml` workflow. See [repository workflow installation](../hub/docs/github-actions-builds.md#install-the-repository-workflow).

Confirm that the default branch builds successfully and the hub imports the result. The **Templates** catalog below the **Create** form should show the starting pages you prepared. If a build fails, follow its error and workflow output; a working local preview does not prove the published build will work.

## 6. Connect the Replica prototype canvas

Set your team's Hub URL in `.github/replica.json` in the prototype repository so authors do not have to enter it manually:

```json
{
  "version": 1,
  "hub": {
    "origin": "https://hub.example.com"
  }
}
```

Replace the example with your deployed Hub's HTTPS origin: the scheme and hostname, with a port if needed, but no path, query, or fragment. If the file already contains templates or other settings, add `hub.origin` without replacing those settings.

Commit the configuration and merge it into the repository's actual default branch. The canvas discovers the URL from that branch, not from unmerged prototype changes. Discovery requires GitHub CLI authenticated with access to the repository.

This configures the Hub address, not authorization. Each author must still choose **Connect to the hub** and approve the connection in their browser. An existing saved Hub selection takes precedence over repository configuration; changing the file does not silently switch an author's Hub. See the [canvas guide](../.github/extensions/replica-prototype/README.md) for discovery and switching details.

Install the Replica prototype plugin through Copilot CLI using the [canvas installation instructions](../.github/extensions/replica-prototype/README.md#install). Choose the repository's default branch or an approved release tag.

Keep only one copy of the canvas enabled in a session.

Open the canvas in a prototype session and connect its local preview. Choose **Connect to the hub**, enter your organization's hub URL if needed, and approve the connection in your browser after checking that the codes match. See [canvas connection and approval](../hub/docs/prototype-canvas.md#pairing-and-review).

## 7. Try the whole flow before inviting the team

Ask one prototype author to follow [Get started with Replica](getting-started.md), beginning with adding your shared repository to the Copilot app. They should be able to start a session, make a change on a new branch, connect the canvas, publish, and copy an internal link. Ask a reviewer to sign in, open that link, and leave a comment. Also check that the author can read that feedback in the canvas.

Use internal links for this first trial. Public sharing is off by default and needs a separate decision about who may see prototypes. Follow [Share links](../hub/docs/share-links.md) before enabling it.

Once that flow works, give your team the repository's GitHub URL, Hub URL, required local tools and setup commands, any approved canvas release, and the [getting started guide](getting-started.md). Name the people who maintain the guidance and templates and the person who operates Hub so teammates know where to ask for help. Teammates should reuse this environment, not repeat the starter installation or deploy another Hub.

## 8. Maintain the shared environment

Keep product guidance and starting pages current on the repository's default branch. Review and approve guidance changes before asking authors to use them.

On the Hub server, use `./replica status` to check health and `./replica logs` to investigate failures. Use `./replica down` to stop the service without deleting data. Updates are deliberate: follow [deployment operations](../hub/docs/deployment.md#operate-the-deployment) before running `./replica update`, and retain the existing secrets and persistent storage.

Keep public sharing off unless your organization decides to enable it. Review access, link expiration, backups, and recovery ownership as part of operating the environment, not as tasks each prototype author must configure.
