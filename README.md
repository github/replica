<p align="center">
  <img src=".github/assets/replica-readme-banner.png" alt="Replica" width="1200">
</p>

# Replica: An open-source AI prototyping tool

Turn ideas into interactive prototypes using your own design system. Replica is an open-source, AI-powered prototyping tool created by GitHub Design for designers, product managers, and engineers.

Designers define the guidance using your team's components, patterns, and documentation. Anyone on the product team can then use natural language in the GitHub Copilot app to create and refine prototypes that reflect how your product works. You can start locally without a server, domain, or Replica Hub.

## What can you do with Replica?

- **Prototype with your design system:** Use your existing components, patterns, and approved guidance to shape AI-generated prototypes.
- **Turn ideas into interactive experiences:** Describe what you want to explore, then see, test, and refine the result beside your Copilot conversation.
- **Collaborate and gather feedback:** Publish prototypes to an optional Replica Hub hosted by your organization, where teammates can explore them and leave comments.
- **Adapt Replica to your team:** Customize the open-source tooling and guidance to fit your product and workflows.

## See Replica in action

https://github.com/user-attachments/assets/36547180-aca9-43cc-8931-b538f0883885

<details>
<summary>Demo video music credits</summary>

*Music: [“Electrodoodle”](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1200079) by Kevin MacLeod ([incompetech.com](http://incompetech.com/)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Excerpted, level-adjusted and faded for this video.*

</details>

[Watch the Replica introduction on YouTube](https://www.youtube.com/watch?v=J2Z28CwIfsA).

## Get started with Replica

You don't need to set up everything at once. Start with the guide that matches your next step: trying Replica locally, setting up hosting, or joining your team's existing repository and Hub.

| Your goal | Start here |
| --- | --- |
| Start or continue prototyping locally | [Create your first local prototype](docs/local-prototyping.md). Use the starter or an existing prototype repository, add team guidance, and build something useful. No Hub required. |
| Set up hosting and comments for your team | [Set up shared hosting and team feedback](docs/prototype-environment.md). Check hosting needs early, build with your team's design guidance, and connect Hub when it is ready. |
| Join a team with a repository and Hub already in use | [Join your team's Replica environment](docs/getting-started.md). Use its existing setup to create, publish, and review a prototype. |

If hosting is blocked, you can work locally and connect the same repository later.

### What you need

**Local prototyping** uses the [GitHub Copilot app](https://github.com/features/ai/github-app), Git, and Node.js with npm on macOS or Linux. Each walkthrough covers installation and the repository's requirements.

**Hosted publishing and comments** also need a Linux server, a dedicated domain with wildcard DNS and HTTPS, network access, and GitHub permissions and approvals. The hosting guide starts with these checks.

### Copilot requirements

- **App and sign-in:** the documented canvas workflow uses the GitHub Copilot app and requires GitHub sign-in.
- **Model access:** use GitHub-hosted models with a Copilot plan, or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models) without a Copilot plan.
- **Your own provider:** this option is in public preview and subject to change. The provider's costs and terms apply.
- **Viewing and review:** viewing a finished prototype or reviewing it in Hub does not require a Copilot subscription.

## What's included

| Part | What it does |
| --- | --- |
| **Starters** | Ready-made apps to build your prototype from, with shared skills for Copilot. |
| **Replica plugin** | Adds the Replica canvas to Copilot, showing your running prototype beside your conversation. |
| **Replica Hub (optional)** | Hosts published prototypes so your team can try them and leave comments. |
| **GitHub build action** | Builds prototypes for publishing to Hub. It is not needed for local prototyping. |

For a new repository, choose a starter:

- **Minimal:** A small example app to adapt to your own design system.
- **CoreAI Sandbox:** An app with an existing navigation layout and prebuilt interface elements, such as buttons and menus, from Microsoft's CoreAI design system.

Agents creating or adapting repositories should follow [prototype repository setup](docs/prototype-repository-setup.md).

## Data and privacy

Your organization operates its Hub and controls its configuration. Hub records publishing and review activity in its own database and retains those activity events for 90 days. Exporting them to Segment, Mixpanel, or a custom HTTPS endpoint requires configuration by a repository administrator. Replica does not automatically send those activity records to GitHub.

These activity events do not track offline work, local editing, or interactions inside prototype previews. GitHub services and your selected AI provider have their own data handling and terms. Using a self-hosted Hub does not mean that no data leaves your organization.

See [Hub analytics](hub/docs/analytics.md), [security](hub/docs/security.md), and [backups and retention](hub/docs/backups-and-restore.md) for details.

## Support and contributions

Replica is under active development and maintained by GitHub staff. See [Support](SUPPORT.md) for help and questions, or [report a bug](https://github.com/github/replica/issues). Support is limited to the resources described in the support policy.

Tried Replica? [Share your experience](https://survey.alchemer.com/s3/9055055/Replica-feedback).

Contributions are welcome. Read [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

**Report security vulnerabilities privately**, not through public issues or discussions. Follow the [security reporting instructions](SECURITY.md).

## License

This project is licensed under the MIT open source license. See [LICENSE](LICENSE) for the full terms. Bundled fonts use the SIL Open Font License; see [NOTICE](NOTICE.md).

---

_Created by GitHub Design and Microsoft CoreAI Design_
