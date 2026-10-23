# Hub development

Use npm and a Node.js version supported by `engines.node` in `hub/package.json`. Run these commands from `hub/`:

```sh
npm ci
npm run dev:api
```

In a second terminal, also from `hub/`, start Vite:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the frontend and forwards `/api` requests to Express at <http://127.0.0.1:3001>. `GET /api/health` returns JSON; other API routes have not been built. Both servers accept connections only from this machine. Stop each with Ctrl+C.

The API reads an optional `PORT` environment variable, defaulting to 3001. If you change it, update the local Vite proxy target to match. No environment file, credentials, database, or external service is required.

## Build the app

```sh
npm run build
npm start
```

The build produces `dist/client/` and `dist/server/`. `npm start` runs only the compiled API. In a separate terminal, `npm run preview` serves the built frontend for local inspection. Production frontend hosting, API routing, and deployment are not configured.

Use `npm run storybook` to view the existing components and pages at <http://localhost:6006>. They use sample data, not the new API.

See [Testing and operations](testing-and-operations.md) for checks and [Architecture](architecture.md) for what works and what still needs to be built.
