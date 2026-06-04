# US-003: JWT Token Configuration via .env
**Epic:** Chatbot Widget — Developer Configuration
**Version:** 1.0
**Date:** 2026-06-02
**Status:** Draft

---

## User Story

**As a** developer,
**I want to** configure the JWT token via `.env` file,
**So that** I can rotate it every hour without changing source code.

---

## Background and Context

The Aeliuscase CaseController API requires a JWT Bearer token on every request. Tokens have a validity period of approximately one hour and are provisioned out-of-band (provided to the developer directly, not obtained via an OAuth flow). In MVP, token rotation is a manual developer task: the developer updates `.env` and restarts the Vite dev server. No automatic refresh is implemented at this stage.

Vite exposes any environment variable prefixed with `VITE_` to the frontend bundle via `import.meta.env`. The token is accessed at runtime via `import.meta.env.VITE_JWT_TOKEN`. This means the value is baked into the compiled bundle at build time. For production, the `.env` (or `.env.local`) file must be present at build time; for development, a dev-server restart picks up changes.

---

## Environment Variables

| Variable | Required | Description | Example Value |
|---|---|---|---|
| `VITE_JWT_TOKEN` | Yes | JWT Bearer token for CaseController API authentication. Rotated manually every ~1 hour. | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `VITE_API_BASE_URL` | Yes | Base URL of the CaseController API (no trailing slash). | `https://uatapi.aeliuscase.com` |
| `VITE_APP_BASE_URL` | Yes | Base URL of the Aeliuscase web application, used to construct case detail links. | `https://app.aeliuscase.com` |

> The `.env.example` file committed to the repository must contain these three variables with placeholder (non-secret) values so that new developers know what to configure.

---

## Acceptance Criteria

### AC1 — Token is read from VITE_JWT_TOKEN
Given the `.env` file in the project root contains `VITE_JWT_TOKEN=<token>`,
When the Vite dev server is started (or a production build is run),
Then `import.meta.env.VITE_JWT_TOKEN` resolves to the exact token string from `.env`.
And every HTTP request made to the CaseController API includes the header `Authorization: Bearer <token>`.

### AC2 — Token value is not hardcoded in source files
Given the repository source files are inspected (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.html`),
When any file containing a literal JWT string (format: three Base64-URL segments separated by `.`) is searched,
Then no such string is found in any committed file.
And the only place the token appears at runtime is injected by Vite from `.env`.

### AC3 — .env file is excluded from version control
Given the `.gitignore` file in the project root is read,
When the ignore rules are evaluated,
Then both `.env` and `.env.local` match at least one ignore rule.
And a `git status` on a repository with a populated `.env` file does not list `.env` as a tracked or staged file.

### AC4 — .env.example is committed with placeholder values
Given the `.env.example` file is read,
When each required variable is checked,
Then `VITE_JWT_TOKEN`, `VITE_API_BASE_URL`, and `VITE_APP_BASE_URL` are all present.
And the values in `.env.example` are non-secret placeholders (e.g. `VITE_JWT_TOKEN=your_jwt_token_here`).
And `.env.example` is listed as a tracked file in the repository.

### AC5 — Missing or empty VITE_JWT_TOKEN disables the widget input
Given `VITE_JWT_TOKEN` is absent from `.env` or is set to an empty string,
When the chat widget is opened in the browser,
Then the chat input field is disabled (not focusable, not submittable).
And the chat panel displays a configuration warning: "API token not configured. Contact your administrator."
And no API request is attempted.

### AC6 — Developer can rotate the token without changing source code
Given the current JWT token has expired and the developer has received a new token,
When the developer replaces the value of `VITE_JWT_TOKEN` in `.env` and restarts the Vite dev server (`npm run dev`),
Then all subsequent API requests use the new token.
And no TypeScript or JavaScript source file requires modification.

### AC7 — 401 response triggers a user-visible expiry message
Given the widget is open and `VITE_JWT_TOKEN` holds a token that the API considers expired or invalid,
When a search query is submitted and the API responds with HTTP 401 Unauthorized,
Then the chat panel displays: "Session token has expired. Please ask your administrator to update the API token in the .env file and restart the dev server."
And the input field is re-enabled so the user can retry after the token is rotated.

### AC8 — API base URL is configurable without code changes
Given the `.env` file contains `VITE_API_BASE_URL=https://uatapi.aeliuscase.com`,
When a search request is made,
Then the request URL begins with `https://uatapi.aeliuscase.com`.
When the developer changes `VITE_API_BASE_URL` to `https://prodapi.aeliuscase.com` and restarts the dev server (or rebuilds),
Then all subsequent requests target the production URL with no source code changes.

---

## Token Rotation Procedure (Developer Run-Book)

This is the manual procedure for MVP. Automatic refresh is out of scope.

1. Obtain the new JWT token from the Aeliuscase platform administrator or by re-authenticating via the existing Aeliuscase login UI.
2. Open `.env` (project root) in a text editor.
3. Replace the value of `VITE_JWT_TOKEN` with the new token.
4. Save `.env`.
5. If the Vite dev server is running, stop it (`Ctrl+C`) and restart it (`npm run dev`).
   - For a production build: run `npm run build` after updating `.env`. The new token is baked into the bundle at build time.
6. Verify: open the widget in the browser, submit a query, and confirm results are returned (no 401 error).

---

## Security Constraints

- The `.env` file must never be committed to version control.
- The JWT token is embedded in the compiled Vite bundle when `vite build` is run. This means the token is visible in the production JavaScript bundle. This is an accepted MVP trade-off. Post-MVP, a server-side proxy or token-exchange endpoint should be considered to avoid exposing the token client-side.
- Developers must not share the `.env` file via email, Slack, or any unencrypted channel.

---

## Out-of-Scope for This Story

- Automatic JWT refresh / silent token renewal — post-MVP
- OAuth 2.0 / OpenID Connect login flow — post-MVP
- Storing the token in a server-side session or cookie — post-MVP
- Environment-specific CI/CD secret injection (GitHub Actions secrets, Azure Key Vault) — post-MVP

---

## Definition of Done

- [ ] `.env.example` committed with all three required variables and placeholder values
- [ ] `.gitignore` contains `.env` and `.env.local` entries
- [ ] Unit test mocks `import.meta.env` and asserts the `Authorization` header is set correctly when `VITE_JWT_TOKEN` is non-empty
- [ ] Unit test asserts the widget input is disabled and a warning is displayed when `VITE_JWT_TOKEN` is empty or missing
- [ ] `README.md` documents the three required `.env` variables and the token rotation procedure
- [ ] Manual test: update `VITE_JWT_TOKEN` in `.env`, restart dev server, verify new token appears in the `Authorization` header in Chrome DevTools Network tab
- [ ] Manual test: set `VITE_JWT_TOKEN` to an expired token, submit a query, verify the 401 error message appears
- [ ] Verified on Chrome (latest stable) and Microsoft Edge (latest stable)
