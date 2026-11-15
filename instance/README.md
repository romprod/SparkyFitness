# Instance development

This fork keeps the existing v1.12.1 customisations in Git and records the peptide feature research as a backlog.
The baseline contains the existing chart, diary, reporting and Garmin changes.
New preparation, stock and cost features are proposed work, not completed features.

## Branches and remotes

| Name                         | Purpose                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `origin`                     | This fork: [romprod/SparkyFitness](https://github.com/romprod/SparkyFitness). Push instance changes here.        |
| `upstream`                   | [CodeWithCJ/SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness). Fetch releases and assess updates here. |
| `main`                       | The fork's upstream main branch. It is not the deployed instance baseline.                                       |
| `instance/v1.12.1`           | The pinned v1.12.1 baseline plus the existing customisations and this backlog.                                   |
| `codex/peptide-preparations` | Preparation calculator and mass stock implementation branch.                                                     |

The upstream base is [`39d9ca2d1`](https://github.com/CodeWithCJ/SparkyFitness/commit/39d9ca2d13c2a1b9f64e4be793b2f23433489d0c). The existing source changes were imported unchanged and split into four commits:

1. Minimum nutrient goal completion.
2. Coaching/report totals from canonical diary and hydration sources, including all-day steps.
3. An independent Garmin weight-sync opt-out.
4. Modelled absorbed, injection-site and total amounts, detailed time labels and the current-time marker.

These are preservation commits. They do not claim new peptide preparation features or that a fresh deployment was performed.

## Peptide stock access

Medications → **Preparation & stock** (`/medications?tab=stock`) exposes vial preparation, inventory, injection logging and corrections for every injectable peptide or medication. No GLP-1 flag is needed. **Prepare a vial** opens the calculator directly; **Add peptide / injectable** starts a medication record with the injection form selected. Saved mass doses and schedule overrides are converted to mg without guessing from volume or device units. GLP-1-specific models remain separate.

## Preparation and stock: first implementation

The first slice adds shared preparation arithmetic to the existing web/mobile vial forms, stores concentration and final volume, and derives mass/volume stock from linked injection doses. Edits and deletions reconcile that balance. Incomplete historic use remains unknown; used preparation details are protected from changes. No database migration is required.

This is partial coverage of D03, D05, D09, I02 and I03. Dedicated preparation history, device graduations, waste adjustments, revision audit and supply forecasts remain backlog work. See [medication documentation](../docs/src/features/medications.md). Code/build verification does not itself mean an instance deployment.

## Feature backlog

[feature-backlog.json](feature-backlog.json) contains all 77 reviewed items, stable IDs, source links, proposed work, relative effort and dependencies. It records 30 additions, 32 extensions, 12 capabilities covered by the baseline and 3 deferred ideas.

The comparison is pinned to Pitstop v1.28.1 at [`1caffbcfa`](https://github.com/kavo91/peptide-pitstop/commit/1caffbcfaeb4ccaccee9806a37d169e013328528) and the Sparky baseline above. Recheck each selected feature against the latest upstream implementation before starting it.

Suggested order for selecting small feature branches:

| Work package                              | Backlog IDs             | Dependency                                                       |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Preparation records and draw calculations | I02, D03, D04, D05, I04 | Agree data model and rounding behaviour first.                   |
| Exact stock accounting and corrections    | I01, I03, I05, D09      | Preparation and dose snapshots.                                  |
| Protocol versions and supply forecasts    | P05, I06, I07           | Preserve historical schedules before forecasting changing plans. |
| Invoice-linked dose costs                 | C01, C02, C03, C06      | Exact stock and delivered mass.                                  |
| Bloodwork matrix and appointment report   | L02, E02                | Can proceed independently using existing health records.         |
| Compound identity, blends and overlays    | E03, A05, A06, A04      | Stable identities and composition provenance.                    |

GitHub Actions workflow files are removed from the maintained branches of this fork. Run tests and builds locally. The agent handles branch review and merges without an owner PR approval step. No issues or PRs have been created for these proposals.

## Development workflow

Owner instruction, 15 November 2026: the agent handles commits, review and merges without asking the owner to approve PRs. Do not use GitHub Actions or the owner's browser. Use Git/SSH, supported APIs and local checks.

1. Select a bounded backlog item and implement it autonomously within the requested scope. Ask only when essential information or a consequential decision cannot be resolved from the existing instructions.
2. Start a feature branch from the current instance branch. Keep unrelated work on separate branches/worktrees.
3. Follow the root and package AGENTS guides, the shared schemas and existing permissions. Cover web, iOS, Android, server, MCP/chatbot, sync and docs as applicable.
4. Keep migrations rerunnable and include RLS, shared schemas and the repository's required documentation. Preserve the previous mobile/API contracts.
5. Run the affected package validation and focused regression tests. Compare source with the intended deployment version before building.
6. Review and merge the feature branch into `instance/v1.12.1` after local checks. The agent handles commits and merges; no owner PR approval is required. Deploy through the existing local build/release process with an image version, backup and rollback reference.

For upstream updates, fetch first and compare the new release against both the pinned upstream base and the instance commits. Reapply only patches still required; do not overwrite the local chart or reporting fixes with stock assets.

## Data and provenance

Keep credentials, .env files, database dumps, uploads, health records, provider payloads and machine-specific deployment configuration outside Git. The backlog contains generic product research, not patient records.

Pitstop's source is reference material for feature concepts. Build Sparky-specific implementations using the existing architecture and components. Retain Sparky's licence and attribution; do not copy Pitstop source or assets into this fork without separately resolving their licence requirements.

Keep Sparky's existing absorption/Tmax model and its explicit model labels. The reference app's instantaneous-absorption decay model is not a replacement for it.
