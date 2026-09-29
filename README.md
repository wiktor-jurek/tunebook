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

## Smart tune emojis

Saving a tune assigns an emoji using the English [Potion base 8M / Model2Vec embedding model](https://huggingface.co/minishlab/potion-base-8M), through the pinned MIT-licensed [`@yarflam/potion-base-8m`](https://gitlab.com/Yarflam/potion-base-8m) JavaScript package. Its approximately 30 MB of weights ship in the dependency, including the Docker/standalone build. No API key, external inference service, native ML runtime, or runtime model download is needed; titles stay on the server.

The model embeds [emojilib](https://github.com/muan/emojilib) emoji descriptions once per server process, then embeds each new tune title and ranks the descriptions by cosine similarity. Keyword and related-word hints supplement that ranking to keep literal title matches reliable. Matching normalizes punctuation, accents, and plurals; weak matches fall back to 🎵. Examples: Calliope House → 🏠, A Tailor I Am → 👔, Father O’Flynn → 👴, The Hag at the Churn → 🧙‍♀️. Semantic matches also cover concepts absent from the keyword dataset, such as Seamstress → 🪡, Stallion → 🐎, and Tempest → ⛈️. Model2Vec pools learned token embeddings; it is not a contextual LLM and can misread ambiguous names or non-English titles.

The `tune_emoji_suggestions` table caches one default per The Session **tune ID**, shared by all settings and users. The first search uses the earliest catalog setting’s title; subsequent saves and placements reuse the cached result, including fallback results. PostgreSQL locks prevent concurrent first saves from running the matcher more than once. Existing saved tunes get their suggestions lazily when opened. The cache records the matcher version and survives deletion of a user’s saved copy. Defaults from an older matcher version refresh once when next read, preserving every personal override. Failed inference rolls back without caching a result, so a later request can retry. No new database migration is required for the embedding upgrade.

Click a tune’s icon in Tunes, its score page, or an owned tunebook to override it. **Use suggested icon** removes the override. Overrides belong to a saved setting in your library and follow that copy into all your tunebooks and sets; they do not change the shared default, another setting, or anyone else’s saved copy. Shared views show the owner’s icons without editing controls. Saving a shared copy preserves its custom icon, while a setting you already saved keeps your own choice. `emoji-regex` validates single Unicode emoji, including flags, skin tones, and joined sequences. Analytics records `tune_icon_changed` with `outcome` and suggested/custom `source`, without recording the title or emoji.

`npm test` runs semantic retrieval checks against the bundled real model without network access. Run `npm run test:emojis` for PostgreSQL cache, concurrency, version upgrades, ownership, reset, shared-copy, and legacy-data checks in a temporary schema.

## Sets

Create a set inside a tunebook with **Group tunes into a set**. Select at least two individual tunes and arrange its playing order. The default name joins their titles with ** / **, for example **Calliope House / Father O’Flynn**, and follows later changes to the playing order or membership across every linked tunebook. Enter a custom name to override it, or choose **Use tune names** to return to automatic naming. Generated names keep every full title; custom names allow up to 80 characters. Existing set names are preserved by the migration, and private copies of shared sets retain their naming mode. The contents list and scores show the group together, and it appears in **My sets**. My sets lists and edits existing sets; new sets start inside tunebooks.

Use **Add set** to reuse one in another tunebook. It inserts the tunes as a group and absorbs any existing individual entries for those tunes. Move a set as one item, or reorder tunes within it. Membership, name, and internal order are shared across all linked tunebooks. **Ungroup** keeps the tunes in that book as individual entries; removing a set from a book leaves it available in My sets. Deleting a set ungroups its tunes in every linked book without deleting the saved tunes.

Shared books display the same set headings and order. Saving a shared book makes private copies of its sets and tunes. The database stores reusable set identities, ordered memberships, and tunebook placements separately; `getOftenPlayedWith` counts distinct sets containing each pair of catalog tunes, so reusing a set in several books does not inflate the count.

## Often played in a session

Each tunebook has an **Often played** repertoire. The owner can star a tune in the contents or beside its score, then use **Often played** to filter the contents and scores. Guests and shared-book viewers see the same stars and can use the filter.

Stars belong to the tunebook and The Session tune ID, so alternate settings and repeated placements share the same status inside that book. Reusing a tune or set in another book does not carry its stars over. Grouping, ungrouping, and reordering preserve them; removing and later re-adding a tune restores its status for that session. Saving a whole shared book copies its repertoire into an independent book. Saving an individual tune does not create a personal favourite.

The `book_popular_tunes` table stores these shared markers and removes them when the book is deleted. Run `npm run db:migrate` locally; production applies the migration at startup. Run `npm run test:popularity` for PostgreSQL checks of session isolation, alternate settings, shared views, ownership, grouping, concurrency, and copies.

## Practice and ability

Each saved tune has a quiet four-bar ability indicator. Click it in Tunes, a score, or an owned tunebook to choose a manual level, return to **From speed**, or reset progress. The four levels are **Unlearned** (no recorded speed), **Learning** (50–99%), **Learned** (100–124%), and **Mastered** (125–150%). Manual levels can be set without recording a speed and take precedence over speed-derived levels.

While practising, set the tempo slider and choose **Can play at …%** to confirm that speed. Merely adjusting the slider or listening does not record ability. The app keeps your highest confirmed percentage; slowing down to practise does not erase that achievement. Recording speed preserves a manual level until you choose From speed. Reset clears both the speed and override. Percentages scale the score's normal tempo (its ABC tempo, or the default used by the player), rather than representing a universal BPM or session pace. Saving progress does not stop ongoing playback.

Progress is private and stored in `tune_practice` per user and The Session **tune ID**, so all your settings of the tune share it. It survives deletion of a saved setting and is removed with the account. Shared views use the signed-in viewer's own progress; guests see no practice indicators or totals. Saving a shared book does not copy the owner's ability. Practice edits require an owned saved setting.

Tunebooks, set headings, and My sets show **N of M playable** and a percentage. Playable means Learned or Mastered, including manual overrides. Counts use distinct tune IDs, so repeated placements and alternate settings do not inflate progress. Hover a summary for the full level breakdown. Analytics records `tune_practice_updated` with only `source` (tempo, level, reset) and `outcome`, without the tune, speed, or ability level.

Run `npm run test:practice` for PostgreSQL confirmation, concurrency, ownership, shared-view privacy, private-copy, reset, and aggregation checks in a temporary schema. Production applies the practice migration at startup; run `npm run db:migrate` locally.

## Sharing tunebooks

Open a tunebook and choose **Share** to add viewers by email or set general access to **Anyone with the link**. Email shares appear under **Shared with me** after the recipient signs in with that verified email, including accounts created after the invitation. Invitations use the same SMTP configuration as account emails. If delivery fails, access is still granted and the dialog prompts you to send the link yourself.

Link sharing lets visitors read scores, play tunes, and print without signing in. Shared books are view-only; signed-in viewers can save individual tunes or a private copy of the book into their own library. Owners can remove email access or return general access to **Restricted** at any time. Removing an email grant does not block a viewer while anyone-with-the-link access remains enabled, and previously saved copies remain in their recipients’ libraries.

Run `npm run db:migrate` when updating an existing local database. Production containers apply the sharing migration on startup.

## Content and sounds

Imported settings retain their source link and contributor. The app displays attribution to The Session and its [database license](https://github.com/adactio/TheSession-data/blob/main/LICENSE.md). Check that license before redistributing a catalog export or changing how tune data is used.

abcjs generates audio using General MIDI soundfonts. The whistle-like preset uses a recorder sound; it is an approximation. The [FluidR3_GM soundfont](https://github.com/gleitz/midi-js-soundfonts) is available under CC BY 3.0 and is provided by its authors. Internet access is required for instrument samples unless a compatible soundfont is hosted locally and configured in the player.

## Analytics

Production pages load the Umami tracker from `https://analytics.jurek.dev/script.js` for website `48e712da-7618-450e-8c2f-88ba9f613eb7`. Tracking is restricted to `libresession.com` and `www.libresession.com`, honors Do Not Track and Umami’s `umami.disabled` local-storage opt-out, and stays disabled during development. Pageviews are sent once on initial load and on client-side pathname changes, including browser back/forward navigation. Automatic tracking is disabled so every pageview and event uses a sanitized URL and title: book/tune IDs become `:id`, queries and fragments are omitted, and external referrers contain only their origin. Events never include emails, names, passwords, tokens, search text, notation, or tune/book/set titles. No user identification is sent.

The event schema is in `src/lib/analytics.ts`. Mutation events have an `outcome` of `success` or `error`; use **success** when measuring completed actions. Other properties contain fixed categories, counts, or instrument/tempo values.

| Flow | Events and useful properties |
| --- | --- |
| Authentication | `auth_submitted`, `auth_completed` (`mode`, `outcome`), `google_sign_in_started`, `google_sign_in_failed`, `signed_out`. Signup success means the verification email step was reached; Google start means a redirect was requested. |
| Tune discovery | `tune_lookup` (`source`: url/title, `result_count`, `outcome`), `tune_saved`, `tune_deleted`, `tune_added_to_book`, `tune_removed_from_book`. Saving an already-saved setting counts as a successful save action. |
| Library | `tunebook_created/renamed/moved/deleted`, `folder_created/renamed/moved/deleted`, `tunebook_icon_changed`. |
| Sets | `set_created/updated/deleted` (tune/book counts), `set_added_to_book`, `book_entry_changed` (`kind`, `action`), `set_tune_reordered` (`direction`). |
| Sharing | `tunebook_opened` (`access`: owner/viewer, `signed_in`, tune/set counts), `share_dialog_opened`, `book_shared_by_email` (`delivery`: sent/warning), `book_share_removed`, `book_visibility_changed` (`visibility`), `book_link_copied`, `shared_tune_saved`, `shared_book_saved`, `guest_save_sign_in` (`kind`). |
| Playing and reading | `playback_started` (`instrument`, `tempo`), `playback_paused/completed/failed/restarted`, `playback_sound_changed`, `playback_tempo_changed`, `playback_seeked`, `notation_opened`, `tune_source_opened`, `scores_toggled`, `contents_navigated`, `print_requested`, `preferences_saved`. Playback starts count actual starts, excluding automatic restarts after seeking or changing sound/tempo. Print records a request, not confirmed printing. |

Events that happen before the tracker loads are queued in memory (up to 50). A blocked or unavailable tracker never blocks an app action. To verify production, open Libresession with tracking allowed, check the request to `analytics.jurek.dev/api/send`, and inspect Events in Umami. Suggested funnels: `auth_submitted` → successful `auth_completed` → successful `tune_saved` → successful `tunebook_created` → successful `set_created`; and `tunebook_opened` with viewer access → `guest_save_sign_in` → successful `shared_book_saved`.

## Checks

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Run `npm run test:sharing` for PostgreSQL sharing tests and `npm run test:sets` for migration, grouping, reuse, ordering, ownership, private copies, and tune relationships. Those tests use a temporary schema in `TEST_DATABASE_URL` (or `DATABASE_URL` from `.env`) and remove it afterward; the database role needs permission to create schemas. The server runs migrations automatically in the production container; local development runs them explicitly.

## Commits and releases

Commits use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `feat: add a feature`, `fix: correct a bug`, or `docs: clarify setup`. Use `feat!:` or a `BREAKING CHANGE:` footer for an incompatible change. Run `npm run hooks:install` once per clone to enable the local commit message check; pull requests to `main` are checked in GitHub Actions too.

[Release Please](https://github.com/googleapis/release-please-action) runs on pushes to `main`. It opens a release pull request from conventional commits and creates a GitHub release and tag when that pull request is merged. The starting version is recorded in `.release-please-manifest.json`; it updates `package.json`, `package-lock.json`, and `CHANGELOG.md` as releases are prepared. No package is published to npm.

After pushing this repository to GitHub, enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General. The workflow uses `GITHUB_TOKEN` by default. If CI must run on Release Please's own pull requests, add a repository secret named `RELEASE_PLEASE_TOKEN` with permission to create pull requests and releases; GitHub does not trigger other workflows for pull requests created with `GITHUB_TOKEN`.
