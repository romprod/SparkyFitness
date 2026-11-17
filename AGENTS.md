# AGENTS.md

_Last updated: 2026-11-15_

This is the repo-root monorepo guide for SparkyFitness. Use it to choose the right package, understand shared repo-level rules, and find the next guide to read.

**For AI Tools & Developers:** Start with `agent-docs/README.md` (in this repo) for quick navigation to:

- `file-and-domain-reference.md` — Find any code by feature in seconds
- `testing-patterns.md` — Concrete test examples for each layer
- `architecture-permissions.md` — Permission types and RLS patterns
- Plus 5 more guides for migrations, data flow, anti-patterns, new features, and planning

Package-level guides win. For work inside a package, follow that package's `AGENTS.md` when present, otherwise its `CLAUDE.md`.

## Scope

- Start here when work begins at repo root or spans multiple packages.
- Keep root-level guidance focused on workspace layout, shared conventions, and cross-package coordination.
- Root `package.json` is tooling only (`husky`, `lint-staged`, `prettier`), not an app entrypoint.
- Run scripts from the package directory you are changing.

## Package Guides

- Repo-root alias: `CLAUDE.md` points to this file.
- Frontend: `SparkyFitnessFrontend/AGENTS.md`
- Server: `SparkyFitnessServer/AGENTS.md`
- Mobile: `SparkyFitnessMobile/AGENTS.md`
- Shared: `shared/AGENTS.md`

For `docs/` and `SparkyFitnessGarmin/`, there is no package-level `AGENTS.md`. `SparkyFitnessGarmin/` is only a handful of Python files (`main.py`, `routes.py`, `service.py`, `schemas.py`); read them directly. For `docs/`, inspect the local manifest and content layout.

## Monorepo Map

- `SparkyFitnessFrontend/` - React 19 + Vite web app.
- `SparkyFitnessServer/` - Express 5 + PostgreSQL backend API.
- `SparkyFitnessMobile/` - Expo SDK 57 / React Native 0.86 app.
- `shared/` - source-first TypeScript workspace package for `@workspace/shared` schemas, constants, and timezone/day helpers.
- `docs/` - VitePress documentation site.
- `docs/readme/` - translated copies of the root `README.md` (`README_<lang>.md`), outside the VitePress `srcDir`. The language bar at the top of `README.md` links to them; when the root README changes substantially, the translations go stale.
- `SparkyFitnessGarmin/` - standalone Python integration service outside the current `pnpm` workspace.
- `SparkyFitnessTag/` - static site behind `https://tag.sparkyfitness.com` (Cloudflare Workers static assets, deployed from this folder with `wrangler.jsonc`). It serves only Apple's `apple-app-site-association`, Android's `assetlinks.json` and a "get the app" page, so an NFC tag link (`/t/<code>`) opens the mobile app. Holds no secrets and stores no data; a new app ID, Apple team or signing key means editing the two `.well-known` files. Not a `pnpm` workspace package. Do not add a `_redirects` rule for `/t/*`: Cloudflare rejects it as a loop, and `not_found_handling: single-page-application` already serves the page.
- `docker/`, `helm/`, `.github/` - infra and deployment assets.
- `umbrel/sparkyfitness/` - Umbrel App Store package (manifest, compose, derived secrets), submitted to `getumbrel/umbrel-apps`. See `umbrel/README.md`.
- `db_schema_backup.sql` - repo-root schema snapshot kept in sync by CI (`.github/workflows/schema-backup.yml`); never hand-edit or regenerate locally.
- `docker/.env.example` - tracked env template commonly copied to repo-root `.env`.

## Workspace Notes

- `pnpm-workspace.yaml` currently lists `frontend`, `SparkyFitnessFrontend`, `shared`, `SparkyFitnessMobile`, `SparkyFitnessServer`, and `docs`.
- Only `SparkyFitnessFrontend/` exists on disk right now; treat `frontend` as a legacy workspace entry unless the task is specifically about workspace cleanup.
- `shared/` is a library package, not an app; its `pnpm run validate` runs typecheck, a hardcoded-string audit, and the Prettier check. CI runs that in a `Shared Validate` job and also re-runs the frontend, mobile, and server jobs whenever `shared/` changes, so validate shared changes from the consuming package(s), not in isolation.
- `SparkyFitnessGarmin/` is outside the current workspace. Inspect its own manifest and scripts before working there.

## Agent Efficiency (read this before searching)

Do not read or search these paths; they burn context for nothing:

- `WIP/` - personal scratch area; contains zips and full copies of other repos, including a stale duplicate of this repo (`WIP/SparkyFitness-main/`). Never read or edit anything under it.
- `SparkyFitnessMobile/ios/` and `SparkyFitnessMobile/android/` - generated native projects (`ios/` is >1 GB of Pods). Regenerate with `npx expo prebuild --clean`; edit `app.config.ts`, `plugins/`, or `targets/` instead.
- `pnpm-lock.yaml` (~1.3 MB) - never read; check `package.json` files instead.
- `db_schema_backup.sql` (~330 KB) - never read whole; grep for the one `CREATE TABLE` you need.
- `SparkyFitnessFrontend/dist/` - build output.
- `SparkyFitnessFrontend/public/locales/` except `en/` - 35 machine-synced translations. Only `en/translation.json` is ever hand-edited, and even that (~120 KB) should be grepped, not read whole.

Cheap ways to learn things:

- Database table index: read `docs/src/developer/database.md` (quick reference of all ~120 tables with one-line purpose). For detailed schema, read `shared/src/schemas/database/<Table>.zod.ts` (one small Zod file per table).
- Database security & permissions: `docs/src/developer/database-security-tiers.md` (security tier, permission type, and RLS rules for every table).
- API request/response contract: `shared/src/schemas/api/<Name>.api.zod.ts`.
- Definition of done: CI (`.github/workflows/ci-tests.yml`) runs `pnpm run validate` (which includes Knip unused export & dead code checks in frontend and mobile) plus the package's CI test script for each changed package. Run those locally before declaring work complete.

## Cross-Package Rules

- Barcode source comparison uses the shared `BarcodeLookup.api.zod.ts` contract and `barcodeNutritionPreview` helper. Web and mobile request alternatives on demand through `SparkyFitnessServer/services/barcodeLookupService.ts`; the initial lookup retains the existing local/default/fallback behavior.

- If you add or change a server migration (such as creating a new table), follow `agent-docs/new-migration-checklist.md`. In short, you MUST:
  1. Create the migration file in `SparkyFitnessServer/db/migrations/YYYYMMDDHHMMSS_description.sql`.
  2. Update the Row-Level Security (RLS) policies in `SparkyFitnessServer/db/rls_policies.sql`, and classify the new table in the `DOMAIN` map of `SparkyFitnessServer/tests/rlsPermissionMatrix.integration.test.ts` (CI fails when an RLS table is missing).
  3. **Restart the server** (`pnpm start` from `SparkyFitnessServer/`) to apply the migration. Agents ask the user to do this rather than starting it themselves. Keep one re-runnable migration file per PR, edited in place.
  4. Leave `db_schema_backup.sql` alone — after merge, CI regenerates it from the migrations and opens a sync PR that merges itself (`.github/workflows/schema-backup.yml`). Never manually edit the backup file or commit a locally generated copy.
  5. Add or update the matching Zod schema in `shared/src/schemas/database/`.
  6. Update the user-facing documentation in `docs/src/features/family-friends-sharing.md`.
  7. Update the developer documentation in `docs/src/developer/database-security-tiers.md` to classify the table as Tier 1, Tier 2, or Tier 3.
- **Heart rate zones have one source of truth:** `shared/src/utils/heartRateZones.ts` (`resolveHeartRateZones`, `heartRateZoneRange`, `computeTimeInZones`). Never re-derive max heart rate or zone floors in a package; server stored zones, training load, mobile suggested ranges and the web/mobile charts, Heart Rate reports and settings all call it (reports show the five zones, Zone 1 to 5, never fixed bpm tiers). Max heart rate is the person's own value, else Nes (211 - 0.64 x age) from date of birth, else 190. Settings never rewrite stored `exercise_entry_hr_zones` rows. iOS 27 can fill custom floors from Apple Health (`floorsFromAppleHeartRateZones`); that does not change max heart rate. A finished Apple workout's own zone group (`bucketsFromAppleWorkoutZones`) is stored as `device` zones instead of recomputing, so the chart matches Apple, including time below the first boundary.
- Prefer the shared timezone helpers from `@workspace/shared` and `SparkyFitnessServer/utils/timezoneLoader.ts` for day-string logic. Avoid `toISOString().split('T')[0]` for user-facing or business-logic dates.
- Keep `YYYY-MM-DD` values as calendar-day strings until you reach a database or external API boundary that needs UTC instants.
- Auth or API contract changes usually need a quick check in both web and mobile because they share the same backend.
- Frontend local dev proxies `/api`, `/health-data`, and `/uploads` to the server on `3010`. The `/health-data` proxy is rewritten to `/api/health-data`, while server APIs remain rooted at `/api`.
- Server runtime secrets are usually sourced from repo-root `.env`, commonly created from `docker/.env.example`. The server can also load secret files via `SparkyFitnessServer/utils/secretLoader.ts`.
- Extract shared logic on the **second** duplication ("rule of two"), not the third - duplicated logic drifts as different sessions edit each copy. Extract _behavior_, not coincidental shape. See `agent-docs/anti-patterns.md`.
- **Strict TypeScript Typing:** Never use `any` or `// eslint-disable-next-line @typescript-eslint/no-explicit-any` when creating new functions or editing existing code. When modifying existing files, proactively update legacy `any` declarations in the touched code to reflect their proper TypeScript data types, interfaces, or schemas from `@workspace/shared`. Do NOT copy legacy `any` parameter signatures forward when refactoring or extending service/repository files.
- **Library Deletes vs Diary Snapshots:** `exercise_entries` and `food_entries` are self-contained snapshots, not pointers (`exercise_id` and `food_id` are `ON DELETE SET NULL`). Deleting an exercise or food from the library (`mode: 'delete'`) preserves past and current diary history, cascades from presets and plan templates, cleans up future scheduled workout plan entries (`entry_date >= today`), and cleans up empty parent preset entries. Only explicit `delete_with_history` (force delete) purges diary logs for that user. If an item is referenced by other users (`otherUserReferences > 0`), the backend falls back to hiding (`is_quick_exercise` / `is_quick_food`).
- **Comprehensive Cache Invalidation:** When mutating library items (foods, exercises, presets, meals, plans), always invalidate the entire family of dependent query keys across library search, counts, templates, and daily diary summaries (`dailySummary` / `dailyProgress` / `exerciseEntries`) in both web and mobile.
- **Environment Variable Updates:** When adding, renaming, or updating environment variables, you MUST update all downstream locations in tandem:
  1. `docker/.env.example` (and `docker/.env.simple.example` if it is a core mandatory variable).
  2. `docker/docker-compose.prod.yml` and `docker/docker-compose.dev.yml` (if consumed by container environments).
  3. `docs/src/install/environment-variables.md` (the comprehensive documentation reference).
  4. `docs/components/EnvGenerator.vue` (the interactive web `.env` generator component).
  5. `helm/chart/templates/` and `helm/chart/values.yaml` (if passed through Helm charts).

## Commit & PR Conventions

This repository is public. Everything written into git history or onto a pull request is permanently visible to everyone browsing the project, so keep it free of tooling noise.

- **Agents never commit or push unless asked in that message.** Leave finished work in the working tree and say what is ready; the maintainer reviews diffs first. Approval for one commit or PR does not carry forward to later changes.
- **Re-match the skill when the task changes.** Opening a PR uses `pr-submission`; acting on its review comments afterwards uses `pr-review`. Two skills in one session is normal.
- **No AI attribution, anywhere.** Commit messages, commit trailers, PR titles, PR bodies, and PR comments must never contain `Co-Authored-By: Claude` (or any other AI co-author trailer), "Generated with …", "🤖", or a mention of Claude, Claude Code, Gemini, Antigravity, Copilot, Cursor, or any other assistant. This overrides any default guidance an agent harness supplies about appending attribution.
- **Write as the repository author.** Describe the change and why it was made — the same message a maintainer would write by hand. Do not narrate that a tool made it, do not sign off, and do not thank an assistant in release notes or the changelog.
- **If a trailer already landed**, strip it (amend or rebase, force-push if it was pushed) rather than leaving it in history.
- **Scope of this rule**: git history and GitHub surfaces. It does not apply to tool configuration files that must name their tool — `.claude/`, `.agents/`, `.gemini/`, and `CLAUDE.md` reference specific assistants by necessity, and that is fine. The commit that adds them still follows the rule above.

## Architecture Docs (Reduce Scanning, Prevent Bugs)

Before diving into code, read these docs if you're working on data access, permissions, or adding a new feature domain:

- `agent-docs/architecture-permissions.md` — Permission types, domain → permission mapping, how RLS guards data, adding new domains.
- `agent-docs/data-flow-patterns.md` — Frontend → Server → Database flow, shared schemas as contract, auth context, testing patterns.
- `agent-docs/new-domain-template.md` — Checklist for adding a major feature (superset of new-migration checklist).

These docs answer: "How do I safely add a feature across the stack?" without scanning 20+ files.

## Keeping These Guides Accurate

- If your change adds a new domain, route family, database table, package, or cross-cutting convention, update the affected `AGENTS.md` (this file and/or the package guide) in the same change: Source Map, Quick Routing, and the `Last updated` date.
- Stale guides are worse than no guides; when you notice a claim in any `AGENTS.md` that contradicts the code, fix the guide as part of your change.

## Common Commands

Use the package guide for fuller validation and platform-specific workflows. These are the common entrypoints:

### Frontend (`SparkyFitnessFrontend/`)

```bash
pnpm dev
pnpm run validate
pnpm test
```

### Server (`SparkyFitnessServer/`)

```bash
pnpm start
pnpm run validate
pnpm test
pnpm run test:coverage
```

### Mobile (`SparkyFitnessMobile/`)

```bash
pnpm start
pnpm run ios
pnpm run android
pnpm run validate
pnpm exec jest --watchman=false --runInBand
npx expo prebuild --clean
```

### Docs (`docs/`)

```bash
pnpm dev
pnpm run build
```

## Instance fork workflow

Owner direction on 15 November 2026 for this fork:

- Handle commits, branch review and merges within the requested work. Do not require owner PR approval.
- Feature work must stay within capabilities verified in Peptide Pitstop v1.28.1, pinned to `1caffbcfaeb4ccaccee9806a37d169e013328528`. Ask the owner before adding any feature beyond that source; architectural compatibility, permissions and tests do not authorise additional product behavior.
- Before claiming Pitstop parity, verify the actual deployed reference revision and active nonsecret UI flags. Compare complete source flows, defaults and empty/pending/error states using synthetic full-screen compositions; distinguish currently enabled screens from optional source features, approved adaptations and partial coverage. Preserve Sparky's existing theme, navigation placement, stock integrity and chart customisations. Record public-safe evidence in `instance/deployed-reference-review.md`; keep deployment credentials, private configuration and personal records outside Git.
- Use local tests and builds. Do not add or restore GitHub Actions workflows or hosted release/deployment automation.
- Deploy the server through its normal startup, including secret loading and preflight before dynamic database initialization. A standalone initializer that skips preflight is not an equivalent deployment path. Verify migrations and actual runtime/assets after startup; keep rollback images and a suitable backup for schema/data changes.
- Use Git/SSH and supported APIs. Do not operate the owner's browser for repository work.
- Keep new feature branches local for review and push only `instance/v1.12.1` after integration unless the owner explicitly requests a topic-branch push. Preserve existing remote refs.
- Keep the existing v1.12.1 instance branch and its customisations separate from upstream main until an upgrade is deliberately tested.
- Follow the technical package, schema, permissions and compatibility guidance above. The owner's current directions override upstream planning-only or owner-approval instructions for authorised work.
- Keep credentials, health records, uploads and machine-specific deployment configuration out of Git.

## Preparation records and handling metadata

The instance uses `medication_preparations` as the stable-ID current preparation projection. Initial labelled inputs remain recorded; changes use the dedicated Edit → Review → Confirm transaction with revision/review checks and an operation ID. Append immutable owner-scoped preparation and per-dose correction audits; retain these through medication, vial, preparation and dose deletion, and clean them only with account deletion. Preserve known physical draw volume, markings, timestamps, tracking day, site and notes when recalculating mass. Missing recorded physical history must not become estimated consumption. Omitted diluent and BUD fields remain unchanged; explicit null clearing follows the contract. Lot/storage and explicit BUD remain handling metadata, with no invented opened-plus-28-day default. On web, vial tools stay in Preparation & stock and logging/history in Cabinet; mobile keeps its combined tracker. A new re-preparation action, spill/priming ledger and generic stock adjustments remain outside this tranche.

## Visual syringe and recent lab comparison

D06 uses the canonical preview for syringe/pen/pump presentation and target-unit details, with device capacity and increment from the same response. Keep dose tooling in Cabinet and stock-only tooling in Preparation & stock. L02 compares the latest three explicit imported or manual panels in Labs, preserving stable marker/assay identity and Sparky units/ranges/qualifiers; ungrouped manual/FHIR-labelled results remain in marker history. Do not invent date panels, merge CRP assays or add arbitrary filters. The original matrix is an optional-design capability; Sparky retains its own theme and placement. Source API-only re-preparation and a full generic dose-revision audit remain deferred. Existing I05/D09 reconciliation must not trigger a new spill/priming or generic adjustment ledger.

## Syringe preview flow follow-up

Preserve the pinned source ad-hoc preview affordance: selected vial/device can show an empty neutral figure with an em-dash caption before a current valid result. Default selection is valid preferred syringe, otherwise first available, until the user explicitly chooses manual entry or a device. Never show stale numerical results across pending/error or dose/unit/device changes. The original scheduled form is draw-gated; do not claim universal empty rendering or unpassed design-only markers. Keep existing dose/device/calculation controls above the body map within the same card, matching source order. Never fabricate a device when the saved list is empty. A neutral no-saved-device graphic is an explicit owner-requested adaptation of the source conditional render; it must not invent capacity, configuration, device ID or a numerical calculation. This follow-up changes web/mobile presentation/state only, with no backend, schema, dependency or dose-math changes.

## Prepared medication device flow

Reusable syringe, pen and pump settings are separate from preparations. Global source devices are read-only; account-owned devices use existing medication permissions and the preferred device is owner-scoped. Keep explicit Manual for legacy injection logging, valid preferred/first automatic choice for untouched forms, and no fabricated device. Resolve prepared injection versus nasal administration from the medication route/type on the server; device choice must not change route or GLP-1 model eligibility. Nasal preparation logging requires a pump and stores no injection site. Render figures and markings from matching authoritative preview metadata, never stale manager state. Native source validation is not native binary distribution.

## Consumed medication cost report

C03/bounded C07 is implemented and source-tested. Keep the source By medication report in Medications → Costs with Spend/Per dose/Per mg and dose-cost coverage. Source 3/6/12/All windows default to 12 and affect analytics only; the existing ledger stays complete. Optional explicit `medication_pens.label_mass_mg` is separate from preparation/dose/stock mass: never infer/backfill it, and edits must not change physical records. Current label and invoice rates retrospectively recompute cost views. Preserve known zero/negative costs; mixed currencies make only the affected metric unavailable with warning, without new grouping or FX. Financial reads remain authenticated-owner-only. The selected continuation adds C04 consumable/administration estimates, C05 closed-vial unused-value estimates and monthly bounded C07 inside the same Costs report. C05 uses all-history delivered mass independently of the report window with the source ≤70% closed-vial utilisation rule. Monthly category rounding must reconcile to invoice totals without altering real net overhead. These are read-only estimates, not stock or usage ledgers. Prescription fallback/full C06, inclusive headline cost per dose, course costs, FX, A07, protocols and forecasts remain excluded; native presentation is not part of this continuation.

## Direct Diary graph and lab-help requests

These owner-authorised web extensions are separate from Pitstop feature parity. Reuse the existing chart/model for a graph-only independent Diary widget after Caffeine; preserve Cabinet functionality and gate medical requests/cached displays on authoritative active-profile identity and existing medication read permission. Lab marker help covers the full built-in catalogue with verified primary-source definitions and accessible hover/focus/tap controls; custom/unknown names need an honest fallback. Do not infer explanations from names, interpret values or add diagnoses/ranges/treatment guidance. This work is frontend-only unless a concrete backend requirement is reviewed. Frontend-only release must retain the old web/compose and prove server container/image/runtime and migration ledger unchanged; it requires no server restart, migration or new patient-data backup.

The same explicit web release includes recorded REM/deep sleep in Sleep History & Analytics and CSV, with one CSV export control. Use existing nullable stage-second data; do not infer/backfill stages. Preserve known zero, unknown-session/day semantics, known-day averages and existing total/source/timezone behaviour. No backend migration/restart or new patient-data backup is warranted for these frontend-only requests.

## Opt-in protocol history

P05/P06 adds explicit website medication courses/revisions in existing Cabinet schedule/titration flows. Never infer legacy course or dose links. Managed future dues require explicit reviewed handoff of selected legacy rules only; preserve unrelated rules and prior actual history. Keep source material-revision/phase/lifecycle semantics, immutable superseded records and no paused-gap backfill. Older native reminders cover bounded legacy schedules only, not new courses. That P05/P06 tranche excludes P02 ramps, P03 stacks, forecasts and prescriptions; the later selected I06 scope is recorded below. Additive migration/RLS and real concurrency/ownership tests are release gates. After managed handoff, rollback must retain guard-aware backend behavior and new history tables/links. Dependencies/fonts and the PDF hydration/timing fixes stay unchanged.

Managed plans feed the website checklist; this tranche does not add a timed website medication-notification transport. Existing native apps do not schedule these plans until they are updated.

## Inventory forecasts and reorder defaults

I06 selected coverage is implemented and source-tested on the deployed P05/P06 base; exact App/image/live evidence remains a separate release record. Forecasts belong in Preparation & stock; owner reorder defaults belong in Settings (14 lead days and 3 buffer days, with zero valid). Project all effective authored managed demand through a separate read-only phase cursor; pending and projected slots advance it once without changing actuals, Today or course history. Faithfully evaluable legacy fixed schedules remain supported; eligible PRN or unevaluable titration demand is unknown, while already-capped historical rules do not create future uncertainty.

Use the calculated-draw/listPens order: in-use first, expiry ascending with nulls last, then creation descending. Apply the same real-device draw rounding and blocking guards as logging. A plan's explicitly selected device must not silently fall back after deletion; only a named saved-preferred-device assumption may supply a fallback. Never fabricate U100, a 28-day BUD or future weekly course restarts beyond committed bounds. BUD is a recorded date or recorded interval anchored to actual preparation. Known legacy in-use stock with canonical balance and explicit BUD remains eligible.

Unknown demand always prevents an exact forecast. Additional unknown/unmodelled stock prevents exact depletion and urgency, but known stock may prove finite-course or bounded-horizon coverage when it serves all known demand. Keep these qualifications visible rather than implying total runout. No native UI, ordering, notifications, P07/I07/I08 or R01 is included. Migration 20261116140000 adds device-choice provenance and owner reorder preferences only. Assess old 74e backend compatibility before I06-specific writes; after use, preserve device-choice/preferences with an I06-aware backend and prefer web rollback or reviewed forward recovery. Do not reuse the older pre-P05 zero-use rollback rule as if 74e were course-unaware.

## Stock dashboard and preparation queue

Selected I08 is implemented and source-tested on the deployed I06 base; exact App/image/live verification is recorded separately. Place Supply in Medications Log and inline Needs preparation in Preparation & stock. Reuse I06 forecast results and ordering (reorder-now, ok, covered, unknown; order-by date then name), preserving selected unknown medication identity and no-demand distinction. Do not change forecast maths, actuals, Today or saved reorder defaults. No P07/I07/R01, optional-design metrics/count pills/sealed yields, native UI, orders or notifications are included.

Opening a queue item is read-only and opens the existing form for that stock ID, not a create-vial workflow. Queue save requires a fresh expected_preparation_queue_state proof under medication/stock locks; stale state returns a conflict before writes. Only supported-route raw sealed never-used vials with unset physical fields and no current/prior preparation qualify. Formal preparations, known legacy physical stock, used, ambiguous, finished and discarded rows must not be assumed to need mixing. Label mass and nominal dose/count metadata are not physical preparation evidence. No invented device, BUD or diluent defaults.

This adds no DDL or persisted dashboard model. Preserve existing ID-bound prepare semantics and ownership checks. Retain the immediate 25d083bc images/compose; assess any later schema change separately. Code-only release requires no gratuitous database export, while all existing I06 device-choice/preferences and P05 history guards remain intact.

## Course-cycle continuation

Selected P07 is implemented and source-tested on the deployed I08 base; exact App/image/live evidence is recorded separately. Weekly course-cycle metadata is independent of per-rule daily cyclic rhythms. Optional on/off lengths are strict integers from 1 through 104; metadata is advisory until an explicit reviewed End/Start action. Do not infer a medical duration, silently cap Today dues, automatically restart, or add provisional I07 forecasts. Cycle controls stay within Cabinet; no new ramp, prescription, Gantt or notification transport is selected.

Preserve immutable revisions/activity, original authored window context and all actual facts. Server-managed phase-family continuity carries full dose progression across explicit cycle actions; corrections/deletions must affect counts dynamically rather than freezing a guessed carry value. Keep owner/CAS/review/idempotency locks and same-day stored-fact guards. A reviewed action must not erase, redate or detach prior actuals just to fit a new cycle boundary. Exact additive schema and guarded recovery follow the final shared/server contract.

Old f622 backend behavior is unsafe after phase-continuity/cycle use. Zero-use rollback requires a verified final-model-specific condition; after use retain a cycle-aware backend and additive schema with old web or a reviewed forward recovery image. Never down-migrate or restore over actual records. A suitable fresh private verified backup is a later migration release gate, not permission for an early export. Normal startup still includes secret loading/preflight.

## Planned-cycle inventory forecasts

Selected I07 is implemented and source-tested on the P07-aware 5791 baseline; exact App/image/live verification is recorded separately. `forecast_mode=planned_cycles` is an explicit read-only request on inventory forecast/dashboard, not a saved preference or UI toggle. New web opts in automatically, isolates mode in cache keys and requires the echoed mode. Omitted/default/explicit committed requests retain the previous response shape and semantics; an old server must not become an unlabeled committed fallback for a planned request.

Project only eligible active current tips with valid on/off weeks, known weekly anchor and explicit end equal to planned stop. This is hypothetical demand after the committed end, not an activated cycle. Keep independent earlier ends, current rule/activity/successor bounds and original phase-window context. Filter off-windows before matching/cursor advancement and the aggregate slot cap; included pending/projected demand advances once. No hypothetical past consumption, anchor reset, fake actuals or stored slots. Current Today/phase facts and P07 actions remain unchanged.

Projection provenance applies to whole-medication, prepared-only and per-container coverage. Use the first unserved demand kind/day, not the first projection date across the medication. A provisional first failure may say for next cycle; a committed shortage after provisional consumption still needs manual-restart qualification without that label. Preserve unknowns and real-device/BUD/excluded-stock rules, horizon bounds and actual served-stock dates. No DDL, persisted state, dependency, notification/native feature or preparation-queue mutation is selected. Immediate rollback is P07-aware 5791, never pre-P07 f622 after cycle use.

## Selected P08 course timeline

P08 is implemented and source-tested on the deployed I07 baseline. Add a read-only course timeline within the existing Medication Cabinet/versioned-plan flow. Reuse authored course/revision/activity facts, with clearly labelled advisory breaks and eligible hypothetical cycle windows. This is a course-window view, not a dose/titration-phase calendar, actual intake or exposure chart. Keep planned/provisional overlap distinct and avoid double-counting revisions.

Preserve P07 actions, I07 projection eligibility, Today dues and the preparation queue. Missing starts or pre-anchor activity must not become invented history. Navigate to existing reviewed edits; no direct Gantt writes, drag controls, new cycle-anchor controls, DEXA markers, A02 actual-dose calendar, new schema or dependencies are selected. Exact source/tests/App/image/live evidence must be recorded separately. Immediate recovery is the P07-aware I07 baseline, not an older course-unaware backend.

## Selected A02 weekly dose calendar

A02 is implemented and source-tested in Medications → Log/calendar. Week is the default seven-day Monday-first planned/actual view; keep its source-style cells informational. Month day detail reuses existing actual edit/delete flows, including reviewed injection stock corrections. Planned rows do not acquire new Log/Skip/Mark taken actions. Preserve existing month markers, KPIs, checklist, filters, Diary trend preference and all unrelated records.

Use one coherent read-only snapshot and canonical actuals plus capture-aware managed plans; evaluate known legacy plans only for current/future dates, without inventing past history. Keep multiple daily slots, explicit planned-slot attribution, skipped/unknown states, actual amounts/units and recorded time precision. Do not copy the source's nearest-clock rematching, planned amount on an actual row, skipped-to-planned mapping or unsupported Shifted label. No DDL/dependencies are expected. Package/live evidence remains separate; immediate rollback is the mixed pre-A02 pair (web 1a3849c41, server 4d6d823ae).

## Selected R01 structured prescriptions

Selected R01 is implemented and source-tested within Medications. Implement the active regular prescription list/form CRUD, source fields/defaults, manually entered refill counts/dates and optional explicit same-medication stock/course links. Full records are owner-only; do not expose costs or clinical free text through delegated metadata. Preserve omitted fields, allow explicit null unlinking, keep the medication target immutable and preserve children on prescription deletion. No automatic dose/stock/refill/status changes, R02 wizard, refill-event ledger, attachments, stacks, C06 fallback or forecast integration. Final additive migration/RLS and old-client compatibility, exact image/App and live gates must be recorded separately. After prescription/binding use, preserve an R01-aware backend during recovery; older a8d backend is only a proven zero-use fallback with writes stopped. Never down-migrate or restore over new user records.
