# Instance development

This fork keeps the existing v1.12.1 customisations in Git and records the peptide feature research as a backlog.
The baseline contains the existing chart, diary, reporting and Garmin changes.
Preparation calculations and dose-linked stock are implemented. Preparation records, lot/storage metadata and explicit beyond-use dates extend that foundation; cost and forecast work remains proposed.

## Branches and remotes

| Name                                  | Purpose                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `origin`                              | This fork: [romprod/SparkyFitness](https://github.com/romprod/SparkyFitness). Push instance changes here.        |
| `upstream`                            | [CodeWithCJ/SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness). Fetch releases and assess updates here. |
| `main`                                | The fork's upstream main branch. It is not the deployed instance baseline.                                       |
| `instance/v1.12.1`                    | The pinned v1.12.1 baseline plus the existing customisations and this backlog.                                   |
| `codex/peptide-preparations`          | Preparation calculator and mass stock implementation branch.                                                     |
| `codex/syringe-vial-lifecycle`        | Syringe draw calculations, source guardrails and bounded vial lifecycle.                                         |
| `codex/syringe-visual-lab-comparison` | Local review branch for syringe visuals and recent imported-lab comparison.                                      |

The upstream base is [`39d9ca2d1`](https://github.com/CodeWithCJ/SparkyFitness/commit/39d9ca2d13c2a1b9f64e4be793b2f23433489d0c). The existing source changes were imported unchanged and split into four commits:

1. Minimum nutrient goal completion.
2. Coaching/report totals from canonical diary and hydration sources, including all-day steps.
3. An independent Garmin weight-sync opt-out.
4. Modelled absorbed, injection-site and total amounts, detailed time labels and the current-time marker.

These are preservation commits. They do not claim new peptide preparation features or that a fresh deployment was performed.

## Peptide stock access

Medications → **Preparation & stock** (`/medications?tab=stock`) exposes vial preparation and inventory for every injectable peptide or medication. **Cabinet**, after selecting the medication, contains dose logging and editable injection history, with automatic stock reconciliation. No GLP-1 flag is needed. **Prepare a vial** opens the calculator directly; **Add peptide / injectable** starts a medication record with the injection form selected. Saved mass doses and schedule overrides are converted to mg without guessing from volume or device units. GLP-1-specific models remain separate.

## Preparation and stock

Shared preparation arithmetic supports web/mobile vial forms and derives mass/volume stock from linked injections. Edits and deletions reconcile that balance; incomplete historic use remains unknown.

The preparation-records tranche stores original labelled mass (mg/mcg), final prepared volume, reconstituted/premixed mode, preparation date and optional diluent as one immutable record per vial, with server-derived mass and concentration. New draws link to that record. Unused legacy vials can receive a record; historic inputs are not invented. Lot number and storage location remain editable stock metadata. Beyond-use dates use an explicit date or an entered interval/base date/source; there is no universal 28-day default. BUD is current handling metadata, not a date-revision audit.

This extends D03, I02, I03 and I04. Repeated preparations on the same vial, full preparation/revision audit and supply forecasts remain backlog work. Spill/priming ledgers and generic stock adjustments are not verified Pitstop features and are outside the authorised parity scope. See [medication documentation](../docs/src/features/medications.md). Local verification and instance deployment are separate steps; native source changes need rebuilt apps.

## Syringes and vial lifecycle

D04/D05 adds reusable syringe settings and a preferred syringe, separate from preparation records. This tranche manages account-owned syringes; the source shared/global device library and pen/pump presentation remain deferred. Entered mg/mcg/mL/units convert through the saved preparation concentration. Decimal arithmetic rounds half-up to the selected syringe increment and shows target mass/volume, marking, delivered mass/volume and rounding error. The server recomputes calibrated draws before logging delivered quantities. Deleting a syringe clears its default/reference while retaining historical delivered values.

The five Pitstop checks are preserved: target volume above capacity or known remaining volume blocks; unit-scale draws below two raw units, a full-barrel target, and mass rounding error above 5% warn. These are physical draw checks, not clinical dose validation. There is no new already-taken override or additional threshold. Legacy mass-only logging remains compatible.

Bounded I01 adds finished/discarded status, a finished timestamp and status audit within existing inventory. Retiring a vial preserves quantities and dose history; reopening uses existing status editing. Archived stock is separated from normal stock selection. A status change is not a waste deduction or a new stock-adjustment workflow. Syringe selection/calculation and injection history remain in Cabinet; vial management stays in Preparation & stock. Native source changes need rebuilt apps.

## Visual draw and lab comparison slice

D06 extends the existing Cabinet draw preview with a syringe-only visual and target-unit details. Its barrel fill represents target volume relative to the selected capacity; its caption retains the calculated measurable marking. Target mcg, mg, mL and raw syringe units are display conversions of the same preview, not a new dose calculation. Quarter-capacity ticks and the existing blocking-warning state follow the pinned source behavior. Pen and pump visuals remain deferred.

L02 adds a read-only comparison of the latest three existing imported lab reports (`lab_reports`/`report_id`), newest first, inside existing Lab results. Manual result dates are not fabricated into panels. Marker rows use stable existing marker identity and retain the values, units, qualifiers and reference information already stored in Sparky. The adaptation preserves existing assay identities and only compares movement toward a range when the values/units/ranges are comparable; it does not copy source qualifier stripping, cross-unit arrows or CRP assay merging. There is no new arbitrary date picker, filter workflow, report importer or clinical recommendation.

I05 and D09 already have partial implementation: linked delivered mass drives vial balances, calibrated corrections recalculate delivered quantities, and edits/deletions reconcile stock transactionally. Incomplete legacy balances remain unknown. A separate dose-revision audit is not implemented; the existing stock-status audit must not be described as one. No generic stock-adjustment, spill or priming ledger is included.

## Feature backlog

[feature-backlog.json](feature-backlog.json) contains all 77 reviewed items, stable IDs, source links, proposed work, relative effort and dependencies. It records 30 additions, 32 extensions, 12 capabilities covered by the baseline and 3 deferred ideas.

The comparison is pinned to Pitstop v1.28.1 at [`1caffbcfa`](https://github.com/kavo91/peptide-pitstop/commit/1caffbcfaeb4ccaccee9806a37d169e013328528) and the Sparky baseline above. Recheck each selected feature against the latest upstream implementation before starting it.

Suggested order for selecting small feature branches:

| Work package                                 | Backlog IDs             | Dependency                                                       |
| -------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Preparation records and draw calculations    | I02, D03, D04, D05, I04 | Agree data model and rounding behaviour first.                   |
| Delivered stock reconciliation and lifecycle | I01, I03, I05, D09      | Preparation and dose snapshots.                                  |
| Protocol versions and supply forecasts       | P05, I06, I07           | Preserve historical schedules before forecasting changing plans. |
| Invoice-linked dose costs                    | C01, C02, C03, C06      | Exact stock and delivered mass.                                  |
| Bloodwork matrix and appointment report      | L02, E02                | Can proceed independently using existing health records.         |
| Compound identity, blends and overlays       | E03, A05, A06, A04      | Stable identities and composition provenance.                    |

GitHub Actions workflow files are removed from the maintained branches of this fork. Run tests and builds locally. The agent handles branch review and merges without an owner PR approval step. No issues or PRs have been created for these proposals.

## Development workflow

Owner scope rule: **always stick to verified Peptide Pitstop features. Ask before adding any feature beyond the source application.** Record the pinned source evidence for each selected capability. A suggested enhancement in this backlog is not permission to implement an unverified feature.

Owner instruction, 15 November 2026: the agent handles commits, review and merges without asking the owner to approve PRs. Do not use GitHub Actions or the owner's browser. Use Git/SSH, supported APIs and local checks.

1. Select a bounded backlog item and implement it autonomously within the requested scope. Ask only when essential information or a consequential decision cannot be resolved from the existing instructions.
2. Start a local feature branch from the current instance branch. Keep unrelated work on separate branches/worktrees. Keep new topic branches local for review; after integration push only `instance/v1.12.1` unless explicitly requested otherwise. Preserve existing remote refs.
3. Follow the root and package AGENTS guides, the shared schemas and existing permissions. Cover web, iOS, Android, server, MCP/chatbot, sync and docs as applicable.
4. Keep migrations rerunnable and include RLS, shared schemas and the repository's required documentation. Preserve the previous mobile/API contracts.
5. Run the affected package validation and focused regression tests. Compare source with the intended deployment version before building.
6. Review and merge the feature branch into `instance/v1.12.1` after local checks. The agent handles commits and merges; no owner PR approval is required. Deploy through the existing local build/release process with an image version, backup and rollback reference.

For upstream updates, fetch first and compare the new release against both the pinned upstream base and the instance commits. Reapply only patches still required; do not overwrite the local chart or reporting fixes with stock assets.

## Data and provenance

Keep credentials, .env files, database dumps, uploads, health records, provider payloads and machine-specific deployment configuration outside Git. The backlog contains generic product research, not patient records.

Pitstop's source is reference material for feature concepts. Build Sparky-specific implementations using the existing architecture and components. Retain Sparky's licence and attribution; do not copy Pitstop source or assets into this fork without separately resolving their licence requirements.

Keep Sparky's existing absorption/Tmax model and its explicit model labels. The reference app's instantaneous-absorption decay model is not a replacement for it.
