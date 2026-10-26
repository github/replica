# Hub identity

Hub stores GitHub credentials, users, sessions, one-use sign-in attempts, and security records in PostgreSQL. Credential providers use one GitHub App installation.

## Credential providers

Set `HUB_CREDENTIAL_PROVIDER` in the [environment example](../.env.example):

| Provider | Credentials |
| --- | --- |
| `database` (default) | Generate `HUB_CREDENTIAL_KEY` with `openssl rand -hex 32`. The provider encrypts credentials before storage and checks them when reading. |
| `environment` | Set every `GITHUB_*` value, including `GITHUB_INSTALLATION_ID`. This provider is read-only and ignores database credentials. |

Both providers require an App ID, installation ID, client ID, client secret, and RSA private key. IDs are positive decimal strings. The key must contain at least 2048 bits.

Keep the encryption key outside the database and back it up separately. Losing or replacing it makes saved credentials unreadable. Invalid provider settings or unreadable ciphertext cause errors; Hub never falls back to another provider. Never commit credentials.

## Saved records

Apply the committed migration with `npm run db:deploy`. See [Database](database.md) for setup and schema rules.

Domain functions bind repository queries to a client or transaction. A fixed settings row lets overlapping changes lock the same record. Credential updates, session changes, and their audit records can commit together or roll back together.

User records use permanent GitHub IDs, not names or emails. Repositories consume each sign-in attempt once. Audit reads return the latest 100 records within 90 days; later writes remove older records.
