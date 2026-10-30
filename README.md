<p align="center">
  <img src=".github/assets/replica-readme-banner.png" alt="Replica" width="1200">
</p>

# Replica: An open-source prototyping tool

Replica helps your entire product team prototype with your design system. It's an open-source tool that uses AI to turn ideas into interactive prototypes, guided by your components, patterns, and documentation.

Designers create and approve the guidance. People across design, product, and engineering can then describe a change in the GitHub Copilot app, try the result, and refine it with their team and users.

Use prototypes to test assumptions and work through questions together. Your team still decides what should ship and how to build it.

Replica is MIT-licensed. You can prototype locally without a server. Hub is being rebuilt and does not yet provide hosted publishing, comments, or deployment.

## Try Replica

Explore Replica before setting anything up.

[<img width="960" height="540" alt="Watch the Replica introduction on YouTube" src="https://github.com/user-attachments/assets/ca887541-e5b7-4634-a9e0-c6eec673b243" />](https://www.youtube.com/watch?v=J2Z28CwIfsA)

## Get started with Replica

Replica has four parts:

| Part | What it does |
| --- | --- |
| **Starter** | Creates a local prototype project with agent skills and a working app you can adapt. |
| **Copilot canvas extension** | Opens your local prototype alongside your Copilot conversation. |
| **Replica Hub (in development)** | Starts an Express API and a routed React frontend with a local mock repository/prototype/build journey. Hosting and review features are not available yet. |
| **GitHub build action** | Builds prototype files for upload. It is not needed for local prototyping, and the new Hub cannot receive those files yet. |

**Ready to make prototypes?** Follow [Get started with Replica](docs/getting-started.md) to install the GitHub Copilot app, add your team's prototyping repository, install the canvas, and create your first local prototype with controls.

**Creating a prototyping repository?** Point your agent at [prototype repository setup](docs/prototype-repository-setup.md). It covers new and existing repositories, getting the starter running locally, and continuing with product guidance or a shared team baseline. Local prototyping needs no Hub.

**Setting up Replica for your organization?** Follow [environment setup](docs/prototype-environment.md) to add shared guidance and starting pages. Hosted publishing and review are not available yet. See [Hub architecture](hub/docs/architecture.md) for what is included and what is not.

**How did setup go?** [Share your feedback](https://survey.alchemer.com/s3/9055055/Replica-feedback). It helps us make Replica easier to start.

### Copilot requirements

- **App and sign-in:** the documented canvas workflow uses the GitHub Copilot app and requires GitHub sign-in.
- **Model access:** use GitHub-hosted models with a Copilot plan, or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models) without a Copilot plan.
- **Your own provider:** this option is in public preview and subject to change. The provider's costs and terms apply.
- **Local preview:** the starter and canvas work without a Hub connection.

## Data and privacy

Keep credentials and real customer data out of prototype repositories. GitHub services and your selected AI provider have their own data handling and terms.

The new Hub does not yet store prototype data, sign people in, or record activity. There is no deployment setup. See [Hub status](hub/README.md).

## Support and contributions

Replica is under active development and maintained by GitHub staff. See [Support](SUPPORT.md) for help and questions, or [report a bug](https://github.com/github/replica/issues). Support is limited to the resources described in the support policy.

Tried Replica? [Share your experience](https://survey.alchemer.com/s3/9055055/Replica-feedback).

Contributions are welcome. Read [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

**Report security vulnerabilities privately**, not through public issues or discussions. Follow the [security reporting instructions](SECURITY.md).

## License

This project is licensed under the MIT open source license. See [LICENSE](LICENSE) for the full terms. Bundled fonts use the SIL Open Font License; see [NOTICE](NOTICE.md).

---

_Created by GitHub Design and Microsoft CoreAI Design_
