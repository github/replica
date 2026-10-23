# Architecture

## Purpose

Replica Hub is a self-hosted Rails application where teams review and discuss prototype branches. A GitHub-backed Hub connects to repositories owned by one GitHub organization or person. Development-only local mode reads multiple local Git repositories instead.

## System map

```text
Publish a prototype:
prototype branch
  -> repository workflow
  -> build action from the Replica repository
  -> GitHub Actions artifact
  -> Replica Hub

Review a prototype:
team member
  -> GitHub sign-in and repository access check
  -> Replica Hub
       |
       +-- isolated Build preview
             |
             +-- conversations

Share a prototype:
public share link
  -> Replica Hub checks the saved link
  -> isolated share preview for one Build
```

| System              | Responsibility                                     |
| ------------------- | -------------------------------------------------- |
| GitHub              | Stores source and decides repository access        |
| GitHub Actions      | Builds and checks prototype branches               |
| Rails               | Checks access, stores data, and runs Hub workflows |
| React and Superglue | Display Hub pages                                  |
| Artifact storage    | Keeps successful Build files and screenshots       |

## Application shape

```text
browser request -> Rails checks access and loads data -> Superglue passes data -> Rails page view runs hooks -> React renders the page
```

Rails models apply product rules and save changes. React handles the Hub interface but does not decide who has access.

Rails TSX page views connect Superglue and browser workflows to typed presentation Pages. Vite discovers those views from their Rails virtual paths, while Storybook renders the same Pages with display-ready Oaken-based fixtures.

Manage prototypes checks access to the selected repository before rendering its listed prototypes. Available branches and other repository choices load independently through Superglue partial-page updates. Each request checks access again, shares an installation token, and runs at most four independent GitHub calls at a time. Database and cache writes stay on the request thread. If a branch comparison fails, Hub stops starting new comparisons, retains completed successes for retries, and reports the failure. Registration still checks permission, branch existence, and authorship afresh.

Prototype JavaScript runs at a separate preview address. Hub cookies and credentials never reach that address. A small preview bridge connects conversations to selected elements and highlighted regions.

[Prototype controls](preview-serving.md#prototype-controls) use a separate controls-only bridge on the same authorized Build origins. Each Build serves its own versioned `controls.replica.json`; Hub and the Copilot plugin supply one shared injected engine and bindings adapter. Overrides stay in prototype URLs, not server state or private capability-bearing addresses. Screenshot capture uses the same adapter and retained defaults.

Hub owns the shared engine, static schema, validator and bindings adapter under [`app/javascript/utils/prototype-controls/`](../app/javascript/utils/prototype-controls/). The Copilot plugin, Hub bridge and screenshot adapter reuse this source. The generated validator includes its runtime helpers, so Build validation does not install Hub dependencies.

Builds do not change after Hub stores them successfully. Conversations belong to a Prototype branch and remember the Build where they began. The reserved `replica/install-workflow` branch belongs only to Hub's workflow installation or update pull request and never becomes a Prototype.

[Templates](gallery.md#templates) reuses that Build and preview pipeline for the connected repository's default branch. Hub reads the optional manifest from the same immutable artifact store as its screenshots and preview, without a second template database. Internal unregistered branch records own its Builds, but never offer prototype registration, review, canvas metadata, shares, or prototype publication analytics. Default opens `/`; declared templates open their own local destinations. Each detail can start a new prototype from the current default branch through Copilot. Local repositories use the same composer to copy the brief and branch instructions without an app handoff.

[Repository activity events](analytics.md) record successful Hub-observed transitions in the primary database for 90 days. Configured repository destinations have a primary-database outbox; Solid Queue sends selected events to fixed provider endpoints or guarded custom public HTTPS endpoints and recovers missed queue work. Custom delivery rows are bound to a destination revision so a changed recipient cannot silently inherit an old backlog.

Share links expose one successful Build without GitHub sign-in. The public request uses only saved Hub data and never opens repository pages or review conversations.

A Hub administrator can [connect Copilot](copilot.md) with a token the person who runs Hub provides in `REPLICA_COPILOT_TOKEN`, or with one-hour tokens that Hub's GitHub App creates and Copilot bills to the App's organization. Hub never stores a token and passes it only to `replica-learning`, a Node.js command from [`packages/learning/`](../../packages/learning/) that Hub runs with an allowlisted environment and a timeout. [Learnings](learnings.md) runs that command in a background job: it imports a repository's review comments into the repository's own learning store, asks Copilot to label them, and consolidates the labels into suggestions for repository administrators.

[Development-only local mode](local-development.md) replaces GitHub sign-in and discovery with one local identity and committed branches from local repositories. It uses the same stored Build files, preview origins, and review UI, but does not change the GitHub-backed production flow.

New work extends these source, Build, preview, bridge, and review contracts instead of creating parallel versions.

The [prototype canvas](prototype-canvas.md) is a Copilot extension that frames a separately running local dev server. It reads git and workflow status and requests publishing through Copilot chat; it does not replace Hub's Build import or preview.

## Related guides

- [GitHub App setup](github-app-setup.md)
- [GitHub Actions builds](github-actions-builds.md)
- [Preview serving](preview-serving.md)
- [Review collaboration](review-collaboration.md)
- [Share links](share-links.md)
- [Security](security.md)
