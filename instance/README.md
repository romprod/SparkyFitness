# Instance development

This fork keeps the existing v1.12.1 customisations in Git and records the peptide feature research as a backlog.
The baseline contains the existing chart, diary, reporting and Garmin changes.
Preparation calculations and dose-linked stock are implemented. Preparation records, lot/storage metadata and explicit beyond-use dates extend that foundation; invoice-ledger/allocation and existing-vial matching are implemented and tested; forecasts remain proposed.

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

The preparation flow uses three steps for dry mass/final volume or labelled premix concentration/fill, then review. A stable current preparation projection retains labelled inputs and server-derived mass/concentration. Reviewed active corrections append immutable owner-scoped before/after and per-dose mass audits that survive parent deletion; the initial inputs remain in the correction history. New draws link to the stable preparation ID. Unused legacy attachment does not invent historic inputs. Lot/storage and explicit BUD remain handling metadata; omitted BUD fields preserve their basis, with no automatic 28-day date.

This extends D03, I02, I03 and I04. Source API-only replacement/re-preparation, a general history screen and supply forecasts remain deferred. The selected correction audit is not a universal entity or dose-revision audit. Spill/priming ledgers and generic stock adjustments are not verified Pitstop features and are outside the authorised parity scope. See [medication documentation](../docs/src/features/medications.md). Local verification and instance deployment are separate steps; native source changes need rebuilt apps.

## Syringes and vial lifecycle

D04/D05 supports reusable syringe, pen and pump settings and a preferred available device, separate from preparations. Account-owned devices are editable; existing global devices are read-only, without adding source-catalog seeding or administration UI. Entered mg/mcg/mL/units convert through the saved preparation concentration. Decimal arithmetic rounds half-up to the selected syringe increment and shows target mass/volume, marking, delivered mass/volume and rounding error. The server recomputes calibrated draws before logging delivered quantities. Deleting a syringe clears its default/reference while retaining historical delivered values.

The five Pitstop checks are preserved: target volume above capacity or known remaining volume blocks; unit-scale draws below two raw units, a full-barrel target, and mass rounding error above 5% warn. These are physical draw checks, not clinical dose validation. There is no new already-taken override or additional threshold. Legacy mass-only logging remains compatible.

Bounded I01 adds finished/discarded status, a finished timestamp and status audit within existing inventory. Retiring a vial preserves quantities and dose history; reopening uses existing status editing. Archived stock is separated from normal stock selection. A status change is not a waste deduction or a new stock-adjustment workflow. Syringe selection/calculation and injection history remain in Cabinet; vial management stays in Preparation & stock. Native source changes need rebuilt apps.

## Visual draw and lab comparison slice

D06 extends the existing Cabinet preview with matching syringe, pen-window and pump-count visuals and target-unit details. The syringe fill represents target volume relative to capacity; captions retain the measurable marking/count from that response. Target mcg, mg, mL and raw syringe units are display conversions of the same preview, not a new dose calculation. Quarter-capacity ticks and the existing blocking-warning state follow the pinned source behavior. No optional source design embellishment or numbered ruler is assumed.

L02 compares the latest three explicit imported or manual panels (`lab_reports`/`report_id`), newest first, inside existing Lab results. Manual multi-marker entry and full panel history/deletion reuse that grouping. Existing standalone manual/FHIR-labelled result dates are not fabricated into panels. Marker rows use stable existing marker identity and retain the values, units, qualifiers and reference information already stored in Sparky. The adaptation preserves existing assay identities and only compares movement toward a range when the values/units/ranges are comparable; it does not copy source qualifier stripping, cross-unit arrows or CRP assay merging. There is no new arbitrary date picker, filter workflow, report importer or clinical recommendation. The matrix is adapted from the original optional design; its deployed current-design page instead shows trends and panel history.

I05 and D09 already have partial implementation: linked delivered mass drives vial balances, calibrated corrections recalculate delivered quantities, and edits/deletions reconcile stock transactionally. Incomplete legacy balances remain unknown. A separate dose-revision audit is not implemented; the existing stock-status audit must not be described as one. No generic stock-adjustment, spill or priming ledger is included.

## Syringe preview flow parity

The existing Cabinet injection flow automatically selects a valid preferred saved syringe, otherwise the first available saved syringe, and retains its figure with a neutral **Draw to —** caption when no current calculation is available. Explicit manual mode is preserved. Pending/error states do not reuse earlier numerical results. No device is fabricated when the saved list is empty; a neutral placeholder graphic is the owner-requested adaptation of the source conditional display. Existing dose/device/calculation controls precede the body map inside the same card, matching the source form order. Dose/unit/device transition guards remain unchanged in purpose.

This follows the pinned source ad-hoc form (`AdHocLogForm.tsx`, initial choice and persistent figure). The original scheduled `LogDoseForm.tsx` gates its figure on a valid draw, so this is not a claim that every original form always displays an empty syringe. No numbered scale, Pitstop-design dashed marker, new arithmetic, schema or dependency is introduced.

## Deployed-reference fidelity audit

The [deployed-reference review](deployed-reference-review.md) anchors the broader appearance/flow and delivered-feature audit to the actual public source revision, records active design flags without private configuration, and distinguishes verified matches, approved adaptations and remaining partial coverage. It does not authorise new implementation.

## Feature backlog

[feature-backlog.json](feature-backlog.json) contains all 77 reviewed items, stable IDs, source links, proposed work, relative effort and dependencies. It records 30 additions, 32 extensions, 12 capabilities covered by the baseline and 3 deferred ideas.

The original comparison is pinned to v1.28.1 at [`1caffbcfa`](https://github.com/kavo91/peptide-pitstop/commit/1caffbcfaeb4ccaccee9806a37d169e013328528). The actual deployed reference is [`b305c4c95`](https://github.com/kavo91/peptide-pitstop/commit/b305c4c95f2118051c0e03f719d9330bfe3f9818), active design `current` and optional prescription wizard disabled. All 581 application source files match the earlier review pin. Verify the deployed revision and active flags before claiming parity; exact-source synthetic screens are distinct from an observed signed-in owner account.

Current invoice tranche: **C01/C02/bounded C06 invoice ledger, landed-cost allocation and matching existing vials**, inside Medications → Costs with Preparation & stock links. Source implementation, isolated tests and synthetic full-screen verification are complete; live deployment readback is recorded separately. Each invoice retains its editable currency (source default AUD); financial records are owner-only. This tranche adds no OCR, automatic inventory creation, consumed/waste/course dashboard, mixed-currency total or FX conversion. Wider C06 prescription fallback remains deferred. P05/P06 protocol revisions/lifecycle remain deferred pending course/phase association design and are prerequisites before schedule-aware forecasts.

Implemented and tested tranche: **C03 + bounded C07**, adding the source-visible By medication report to Costs. The four columns are Medication, Spend, Per dose and Per mg, with dose-cost coverage beneath the medication. Source windows are 3, 6, 12 months and All, defaulting to 12 months; they filter analytics only, while the existing invoice ledger remains complete. An optional explicit vial `label_mass_mg` is independent of preparation and stock, with no inference or backfill. Current invoice allocations and editable labelled mass retrospectively recompute rates, following the source. Known zero/negative costs remain known; a metric with mixed currencies is unavailable with a warning, without grouping or FX. C04/C05, prescription fallback/full C06, inclusive headline cost per dose, protocols and forecasts are not included. Source, isolated tests and synthetic client verification are complete; live release identity is recorded separately.

The same release source also includes the owner-requested website chrome change: remove the Initial Beta Release notices and bottom version/What's New rows from shared page layouts. This is an explicit presentation request, not a new Pitstop feature or removal of App/About/release data. Final combined client checks are complete; live release readback remains separate.

Research dependencies, rather than a list of outstanding implementation tasks:

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
6. Review and merge the feature branch into `instance/v1.12.1` after local checks. The agent handles commits and merges; no owner PR approval is required. Deploy through the existing local build/release process with an image version and rollback reference. Server/schema/data changes need an appropriate backup. A frontend-only release retains the old web image and compose, verifies the server/schema unchanged, and creates no patient-data archive.

For upstream updates, fetch first and compare the new release against both the pinned upstream base and the instance commits. Reapply only patches still required; do not overwrite the local chart or reporting fixes with stock assets.

## Data and provenance

Keep credentials, .env files, database dumps, uploads, health records, provider payloads and machine-specific deployment configuration outside Git. The backlog contains generic product research, not patient records.

Pitstop's source is reference material for feature concepts. Build Sparky-specific implementations using the existing architecture and components. Retain Sparky's licence and attribution; do not copy Pitstop source or assets into this fork without separately resolving their licence requirements.

Keep Sparky's existing absorption/Tmax model and its explicit model labels. The reference app's instantaneous-absorption decay model is not a replacement for it.

## Selected direct website requests

The owner explicitly requested two web extensions after the completed cost release: reuse the existing three-amount GLP graph as an independent Diary widget after Caffeine, and show hover/focus/tap explanations for every built-in lab marker with an honest custom/unknown fallback. These are authorised user requests beyond the Pitstop comparison, not newly claimed reference features. Implementation, source/client tests and isolated final-build verification are complete; live release readback is recorded separately.

The graph keeps the existing model, Cabinet chart and medication read permissions, with authoritative active-profile gating. Marker help explains what a test measures using verified primary medical/laboratory sources; it does not interpret saved values or add diagnoses, ranges or treatment advice. The intended release is frontend-only: preserve the current server, schema and records, retain the old web image/compose for rollback, and do not create an unnecessary patient-data archive.

The owner also requested REM/deep sleep in the web Sleep History & Analytics table and CSV, plus consolidation of duplicate CSV export controls. Existing stage-second fields supply the data; no backend/schema change or stage inference/backfill is selected. Known zero remains known, missing session data leaves the affected day's stage unknown, and averages use days with a known value for that stage. This joins the same tested frontend-only release; live readback is recorded separately.

## Selected cost breakdown continuation

C04, C05 and bounded C07 monthly spend are implemented and source-tested in **Medications → Costs**, using the deployed v1.28.1 revision `b305c4c95` with the `current` design. C04 derives consumable category spend, pieces and administration estimates from existing invoice assumptions; it does not decrement consumable stock. Monthly spend separates medication and consumable line subtotals from net overhead so allocation is not counted twice. Existing ledger and By medication behavior remain intact.

C05 is an explicitly labelled unused-value estimate for finished/discarded vials with known cost and positive explicit label mass. The source includes utilisation at or below 70%, excludes higher utilisation, clamps negative residual mass to zero and displays the first six values. The approved compatibility correction uses all-history delivered mass independently of the selected analytics window, avoiding omission of older consumption. No stock balance, lifecycle, invoice or dose is changed by these reads. Existing unknown/zero/negative and mixed-currency safeguards apply per metric.

Source, isolated PostgreSQL, numerical and client checks passed; live operational release identity is recorded separately. No schema migration or new dependency is expected. C06 prescription fallback, inclusive headline cost per dose, course costs, FX, A07 and native presentation are outside this selected extension. Preserve the completed Diary, lab-help, Sleep and medication-chart changes.

Monthly presentation applies a deterministic category rounding residual so rounded bands reconcile to paid invoice totals while preserving the actual net shipping/tax/fee/discount overhead. This is a documented correction to the reference rounding defect, not an extra charge or stock adjustment.

## Selected model-availability clarity

A07 is implemented and source-tested for the existing Cabinet and Diary charts. Explain when required modelling parameters are missing separately from a model with no logged history. Retain custom-profile eligibility, existing three-amount calculations and the latest-60 history bound; keep the existing history notice rather than duplicating it. This is omission transparency, not full parity with the reference absorption model. Additive API metadata is expected, with no migration, dependency or native presentation change. Actual-build and live release verification are recorded separately. E02 appointment/PDF work is deferred.

Existing custom-profile fallback values remain part of model resolution; the notice does not turn a missing/zero/non-numeric custom setting that already uses those defaults into an unavailable model. The selected diagnostic distinguishes an unresolved profile or invalid effective parameters from an otherwise available model with no logged history.

## Selected appointment PDF extension

E02 is implemented and source-tested on the existing **Reports → Medications → Prescriber-Ready Data Export** card. A direct owner-only PDF download gets its own From/To range, defaulting to today minus 90 calendar days through today. Keep the current browser Print/Save PDF and CSV controls distinct; delegated existing Print remains unchanged. The new endpoint validates real ISO dates, ordered inclusive bounds and an IANA timezone.

The PDF includes recorded medication/schedule/titration facts, complete in-range medication entries and injections merged once, symptoms and available weight/nutrition/water. The latest three explicit lab panels have a separate period label and preserve exact units, qualifiers and assay identities. No clinical inference, silent row cap, DEXA/RMR/blend model or new protocol model is selected. PDFs are generated in memory with no-store responses; client identity proof and late-response discard protect the download. No owner report is used in tests. Pinned PDFKit, licensed Unicode fonts and reproducible lock/runtime packaging are verified source requirements; actual-image and live release evidence are recorded separately. No migration is needed.

## Selected PDF parity follow-up

The bounded E02 follow-up is implemented and source-tested: hydration target/percentage context and clearly labelled derived schedule-timing offsets where supported by recorded facts. Missing or ambiguous targets/timing remain unknown rather than invented. Preserve the existing owner-only PDF, date scopes, Print/CSV and pinned PDFKit/fonts. No dependency or migration change is selected. This PDF fix will be tested and deployed first; P05/P06 stays read-only until that release and the protocol model design are approved.

The hydration comparison uses the current saved target at report generation, not an assumed historical target. Timing offsets describe the recorded instants only; they are not a clinical adherence judgement, and backdated events can carry an app-default time.
