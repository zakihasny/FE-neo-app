FE NEO App - Static Deployment Artifact

Upload the ZIP contents directly to NEO Static Web. index.html must remain at the deployment root.

Visual system: BGN Web Design System v1.3.22 from https://ds.biznetgio.com/skills.md. Runtime CSS consumes the canonical generated BGN token export in assets/tokens.css. The official Biznet Gio wordmark and mark SVG files are used without modification.

Files:
- index.html: database summary
- query.html: read-only PostgreSQL query console
- input.html: asynchronous employee input form
- assets/styles.css: shared visual styles
- assets/app.js: API integration and page behavior
- assets/config.js: runtime API base URL
- assets/tokens.css: canonical BGN generated token CSS
- skills.md: official BGN implementation guideline
- design-tokens/: canonical BGN token source and CSS export

Default API path: /api/

For a separate API domain, edit assets/config.js before deployment. The API must allow the deployed Static Web origin through CORS. No NEO DB or NEO Queue credential belongs in this package.
