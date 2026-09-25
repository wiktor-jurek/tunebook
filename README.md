# Tunebook

Tunebook is a simple place to collect tunes from [The Session](https://thesession.org), organise them into personal tunebooks, and build small sets to play. Save the settings you like, group tunebooks into folders, and open a book to see its scores together. It was made to give The Session's tunes a clean, personal front end without making tune organisation complicated.

Built with Next.js, PostgreSQL, Better Auth, Drizzle, and abcjs. The player shows the current note and lets you change tempo, volume, and instrument.

## Local development

Requires Node.js 24 and access to a PostgreSQL server.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`, set `DATABASE_URL` to an existing PostgreSQL database, and set `BETTER_AUTH_SECRET` to a long random value. Keep `.env` private.
3. Configure SMTP for email/password signup and password reset. Configure Google OAuth if you want Google sign-in.
4. Run `npm run db:migrate`.
5. Run `npm run catalog:sync` to populate the search catalog from The Session dump. Sync is idempotent and updates the catalog while each saved tune stays a snapshot.
6. Run `npm run dev` and visit `http://localhost:3000`.

Google’s authorized redirect URI is `http://localhost:3000/api/auth/callback/google` locally. `BETTER_AUTH_URL` must match the public application URL in production. The SMTP account must be permitted to send from `SMTP_FROM`. Email/password signup requires verification; password reset uses the same SMTP settings.

The catalog sync reads `csv/tunes.csv` from [TheSession-data](https://github.com/adactio/TheSession-data). Set `THESESSION_CSV_URL` to another compatible CSV URL if needed. It expects the dump’s `tune_id`, `setting_id`, `name`, `type`, `meter`, `mode`, `abc`, `username`, and `composer` fields. The app does not send tune content to an LLM.

## Coolify

1. Create an application from this repository with Dockerfile deployment. Use port `3000` and `/api/health` as the health URL.
2. Set runtime environment variables from `.env.example`. Set `DATABASE_URL` to a PostgreSQL database reachable from Coolify. Set `BETTER_AUTH_URL` to the exact public HTTPS URL, and register `https://YOUR_DOMAIN/api/auth/callback/google` in Google Cloud Console if using Google sign-in.
3. Ensure the Coolify host can reach the PostgreSQL server on its configured port.
4. Deploy. The container applies committed Drizzle migrations before starting Next.js.
5. Run `npm run catalog:sync` with the production `DATABASE_URL` from a trusted machine or task container. Repeat to refresh the search catalog.

The app image does not contain the full catalog. PostgreSQL stores the catalog and each user’s saved snapshots. Back up the existing PostgreSQL database using your server's backup process.

## Content and sounds

Imported settings retain their source link and contributor. The app displays attribution to The Session and its [database license](https://github.com/adactio/TheSession-data/blob/main/LICENSE.md). Check that license before redistributing a catalog export or changing how tune data is used.

abcjs generates audio using General MIDI soundfonts. The whistle-like preset uses a recorder sound; it is an approximation. The [FluidR3_GM soundfont](https://github.com/gleitz/midi-js-soundfonts) is available under CC BY 3.0 and is provided by its authors. Internet access is required for instrument samples unless a compatible soundfont is hosted locally and configured in the player.

## Checks

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. The server runs migrations automatically in the production container; local development runs them explicitly.

## Commits and releases

Commits use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `feat: add a feature`, `fix: correct a bug`, or `docs: clarify setup`. Use `feat!:` or a `BREAKING CHANGE:` footer for an incompatible change. Run `npm run hooks:install` once per clone to enable the local commit message check; pull requests to `main` are checked in GitHub Actions too.

[Release Please](https://github.com/googleapis/release-please-action) runs on pushes to `main`. It opens a release pull request from conventional commits and creates a GitHub release and tag when that pull request is merged. The starting version is recorded in `.release-please-manifest.json`; it updates `package.json`, `package-lock.json`, and `CHANGELOG.md` as releases are prepared. No package is published to npm.

After pushing this repository to GitHub, enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General. The workflow uses `GITHUB_TOKEN` by default. If CI must run on Release Please's own pull requests, add a repository secret named `RELEASE_PLEASE_TOKEN` with permission to create pull requests and releases; GitHub does not trigger other workflows for pull requests created with `GITHUB_TOKEN`.
