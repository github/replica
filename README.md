<p align="center">
  <img src=".github/assets/replica-readme-banner.png" alt="Replica" width="1200">
</p>

# Replica: An open-source prototyping tool

Replica helps your entire product team prototype with your design system. It's an open-source tool that uses AI to turn ideas into interactive prototypes, guided by your components, patterns, and documentation.

Designers create and approve the guidance. People across design, product, and engineering can then describe a change in the GitHub Copilot app, try the result, and refine it with their team and users.

Use prototypes to test assumptions and work through questions together. Your team still decides what should ship and how to build it.

Replica is MIT-licensed. You can prototype locally without a server or set up Replica Hub for hosting and commenting.

## Try Replica

Explore Replica before setting anything up.

[<img width="960" height="540" alt="Watch the Replica introduction on YouTube" src="https://github.com/user-attachments/assets/ca887541-e5b7-4634-a9e0-c6eec673b243" />](https://www.youtube.com/watch?v=J2Z28CwIfsA)

## Get started with Replica

Replica has four parts:

| Part | What it does |
| --- | --- |
| **Starters** | Create a local prototype project from your choice of app, with shared agent skills. |
| **Copilot canvas extension** | Opens your local prototype alongside your Copilot conversation. |
| **Replica Hub (optional)** | Hosts published prototypes so your team can try them and leave comments. |
| **GitHub build action** | Builds prototypes for publishing to Hub. It is not needed for local prototyping. |

**Ready to make prototypes?** Follow [Get started with Replica](docs/getting-started.md) to install the GitHub Copilot app, add your team's prototyping repository, install the canvas, and create your first prototype. It also covers connecting to Hub, publishing, sharing and commenting, and adding controls.

**Creating a prototyping repository?** Choose **Minimal**, a small React app with no component library; **CoreAI Sandbox**, a React Router app with CoreAI components and a Foundry-style shell; or **Shadcn**, a generated dashboard with shadcn/ui components, blocks and an optional preset. Point your agent at [prototype repository setup](docs/prototype-repository-setup.md) to select an app, create the repository and verify its local preview. Local prototyping needs no Hub.

**Setting up Replica for your organization?** Follow [environment setup](docs/prototype-environment.md) to add shared guidance and starting pages, deploy Hub, and connect publishing and team feedback. Your organization deploys and runs Hub on its own infrastructure. GitHub doesn't host it.

**How did setup go?** [Share your feedback](https://survey.alchemer.com/s3/9055055/Replica-feedback). It helps us make Replica easier to start.

### Copilot requirements

- **App and sign-in:** the documented canvas workflow uses the GitHub Copilot app and requires GitHub sign-in.
- **Model access:** use GitHub-hosted models with a Copilot plan, or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models) without a Copilot plan.
- **Your own provider:** this option is in public preview and subject to change. The provider's costs and terms apply.
- **Viewing and review:** viewing a finished prototype or reviewing it in Hub does not require a Copilot subscription.

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
