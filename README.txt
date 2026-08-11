FE NEO App - Static Deployment Artifact

Upload the ZIP contents directly to NEO Static Web. index.html must remain at the deployment root.

Visual system: BGN Web Design System v1.3.22 from https://ds.biznetgio.com/skills.md. Runtime CSS consumes the canonical generated BGN token export in assets/tokens.css. The official Biznet Gio wordmark and mark SVG files are used without modification.

Files:
- index.html: database summary
- query.html: read-only PostgreSQL query console
- input.html: asynchronous employee input form
- assets/styles.css: shared visual styles
- assets/app.js: API integration and page behavior
- assets/config.js: public runtime API base URL; never place database or NATS credentials here
- assets/tokens.css: canonical BGN generated token CSS
- .env.example: backend environment variable contract for NEO DB and NEO Queue
- .gitignore: prevents local environment credentials from being committed
- skills.md: official BGN implementation guideline
- design-tokens/: canonical BGN token source and CSS export

Default API path: /api/

For a separate API domain, edit assets/config.js before deployment. The API must allow the deployed Static Web origin through CORS. No NEO DB or NEO Queue credential belongs in this package.

Backend environment variables:
- DATABASE_URL=postgresql://<username>:<password>@<neo-db-host>:5432/<database>?sslmode=require
- NATS_URL=nats://<neo-queue-host>:4222

DATABASE_URL targets a PostgreSQL 15 NEO DB instance. NATS_URL targets the NATS endpoint used by JetStream. These variables must be configured on the backend/API or worker service, not on NEO Static Web.

Expected request flow:
Browser (FE NEO App) -> HTTPS /api/ -> backend/API -> NATS JetStream and PostgreSQL 15

The browser cannot safely open a PostgreSQL connection and must not receive database credentials. Standard NATS port 4222 is also intended for trusted services, not direct browser access. The static frontend continues to communicate only through apiBaseUrl.
