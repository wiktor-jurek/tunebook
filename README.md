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

The SMTP defaults in `.env.example` use Purelymail at `smtp.purelymail.com:465` with TLS, authenticating and sending as `hello@libresession.com`. Fill in `SMTP_PASSWORD` with that mailbox’s password in your private `.env` or deployment environment, then restart the app.

The catalog sync reads `csv/tunes.csv` from [TheSession-data](https://github.com/adactio/TheSession-data). Set `THESESSION_CSV_URL` to another compatible CSV URL if needed. It expects the dump’s `tune_id`, `setting_id`, `name`, `type`, `meter`, `mode`, `abc`, `username`, and `composer` fields. The app does not send tune content to an LLM.

## Coolify

1. Create an application from this repository with Dockerfile deployment. Use port `3000` and `/api/health` as the health URL.
2. Set runtime environment variables from `.env.example`. Set `DATABASE_URL` to a PostgreSQL database reachable from Coolify. Set `BETTER_AUTH_URL` to the exact public HTTPS URL, and register `https://YOUR_DOMAIN/api/auth/callback/google` in Google Cloud Console if using Google sign-in.
3. Ensure the Coolify host can reach the PostgreSQL server on its configured port.
4. Deploy. The container applies committed Drizzle migrations before starting Next.js.
5. Run `npm run catalog:sync` with the production `DATABASE_URL` from a trusted machine or task container. Repeat to refresh the search catalog.

The app image does not contain the full catalog. PostgreSQL stores the catalog and each user’s saved snapshots. Back up the existing PostgreSQL database using your server's backup process.

## Sharing tunebooks

Open a tunebook and choose **Share** to add viewers by email or set general access to **Anyone with the link**. Email shares appear under **Shared with me** after the recipient signs in with that verified email, including accounts created after the invitation. Invitations use the same SMTP configuration as account emails. If delivery fails, access is still granted and the dialog prompts you to send the link yourself.

Link sharing lets visitors read scores, play tunes, and print without signing in. Shared books are view-only; signed-in viewers can save individual tunes or a private copy of the book into their own library. Owners can remove email access or return general access to **Restricted** at any time. Removing an email grant does not block a viewer while anyone-with-the-link access remains enabled, and previously saved copies remain in their recipients’ libraries.

Run `npm run db:migrate` when updating an existing local database. Production containers apply the sharing migration on startup.

## Content and sounds

Imported settings retain their source link and contributor. The app displays attribution to The Session and its [database license](https://github.com/adactio/TheSession-data/blob/main/LICENSE.md). Check that license before redistributing a catalog export or changing how tune data is used.

abcjs generates audio using General MIDI soundfonts. The whistle-like preset uses a recorder sound; it is an approximation. The [FluidR3_GM soundfont](https://github.com/gleitz/midi-js-soundfonts) is available under CC BY 3.0 and is provided by its authors. Internet access is required for instrument samples unless a compatible soundfont is hosted locally and configured in the player.

## Checks

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Run `npm run test:sharing` for PostgreSQL integration tests covering invitations, public access, revocation, owner-only mutations, and saving copies. Those tests use a temporary schema in `TEST_DATABASE_URL` (or `DATABASE_URL` from `.env`) and remove it afterward; the database role needs permission to create schemas. The server runs migrations automatically in the production container; local development runs them explicitly.

## Commits and releases

Commits use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `feat: add a feature`, `fix: correct a bug`, or `docs: clarify setup`. Use `feat!:` or a `BREAKING CHANGE:` footer for an incompatible change. Run `npm run hooks:install` once per clone to enable the local commit message check; pull requests to `main` are checked in GitHub Actions too.

[Release Please](https://github.com/googleapis/release-please-action) runs on pushes to `main`. It opens a release pull request from conventional commits and creates a GitHub release and tag when that pull request is merged. The starting version is recorded in `.release-please-manifest.json`; it updates `package.json`, `package-lock.json`, and `CHANGELOG.md` as releases are prepared. No package is published to npm.

After pushing this repository to GitHub, enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General. The workflow uses `GITHUB_TOKEN` by default. If CI must run on Release Please's own pull requests, add a repository secret named `RELEASE_PLEASE_TOKEN` with permission to create pull requests and releases; GitHub does not trigger other workflows for pull requests created with `GITHUB_TOKEN`.
