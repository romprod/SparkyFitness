# Medications & Supplements

Track scheduled and as-needed medications and supplements, log each dose as taken or skipped, and see how consistently you take them. The same data is available in the web app (**Medications**) and the mobile app (**Library → Medications**, or the Medications card on the Dashboard).

---

## 1. Logging Doses

- **Scheduled doses** (daily, weekly, every N days, monthly, cyclic, taper) appear in the day's checklist. Take, skip or undo each one.
- **As-needed (PRN) medications** have no fixed time; log one whenever you take it.
- **Supplements** are medications flagged as supplements. Their nutrients count toward the day's nutrition totals, and a **All / Meds / Supplements** filter narrows every view.
- **GLP-1 injections** are logged as injections so pen and vial inventory stays in sync. They appear in the dose history like any other dose.

---

## 2. Adherence Overview

- **Doses today**: scheduled doses logged out of those due.
- **14-day adherence**: the share of due doses taken over the last 14 days. As-needed doses count toward a day, up to the number of scheduled doses due, and a day with only as-needed doses counts as complete. Skipped and snoozed doses never count as taken.
- **Perfect days**: days in that window where everything due was taken.
- **Ring**: the 14-day adherence percentage (green at 90% and above, amber at 70% and above, red below).
- **Last 14 days**: one bar per day (green all taken, amber partial, orange mostly missed, red none taken, grey nothing due) and your **current streak** of perfect days. A day still in progress does not break the streak, but any skipped dose does.

The overview, the checklist and the month calendar all use one shared calculation, so web and mobile always agree.

---

## 3. Month Log Calendar

A month view of your logged doses:

- Each day is coloured by how complete it was: **all doses taken**, **partially taken**, **mostly skipped**, **all doses skipped**, or **snoozed only**.
- A small badge shows the number of doses taken on days with more than one.
- A dot marks days with a **side-effect symptom** (a symptom logged against a medication) or a **general symptom**. Symptom dots only appear when you have access to symptoms, and cycle-hub symptoms are never shown here.
- A filter narrows the month to **all medications** or a single one, and the header shows how many doses were logged that month.
- Tap a day to select it. The checklist, the adherence window and the day log then follow that date.

---

## 4. Day Log

The **Logged today** card (or **Logged on {date}** for another day) lists everything taken or skipped on the selected date, with the time and a **Taken / Skipped** chip.

- **Edit** changes the time, status (taken, skipped, snoozed) and notes of a logged dose. For an injection it also changes the injection site.
- **Delete** removes the entry after a confirmation. Deleting an injection credits the dose back to the pen or vial it was deducted from.

Changing a logged dose refreshes the Dashboard card, the checklist, the adherence numbers and the calendar together.

---

## 5. Using It on Mobile

1. Open **Medications** from the Dashboard card (**View all**) or the Library.
2. Tap **Adherence & log** at the top of the list.
3. The screen shows, top to bottom: the adherence overview, the checklist, today's medications (and supplements), the month calendar with its filter and legend, and the day log.
4. Pull down to refresh. Choosing a day other than today shows a **Back to today** shortcut.

Mobile does not yet include the web page's GLP-1 daily check-in on this screen; the GLP-1 tracker is opened from the medication itself.

---

## 6. Privacy & Family Delegation

- All data stays in your own database.
- Managing another person's medications uses the `medications` permission. Symptom dots on the calendar need the separate `symptoms` permission or **View Reports**, and are simply left off without one of them.
- Reproductive-health data is never delegated and never appears in medication views.

See [Family & Friends Sharing](./family-friends-sharing.md) for how permissions are granted.

## Vial preparation and mass stock

**Open Medications → Preparation & stock** to choose an injectable peptide/medication or supported prepared nasal medication. The GLP-1 flag is not required. Use **Add peptide / injectable** for a new record, or select an existing injectable. This tab can be bookmarked at `/medications?tab=stock`. Preparation and inventory live in this tab. Use **Cabinet** and select the medication to log an injection or review and correct injection history. Those dose changes still reconcile stock automatically. The same tools are available in the Cabinet detail for supported prepared medications; oral logging retains its existing workflow.

Click **Prepare a vial** for the three-step flow: choose dry powder or premixed, enter the labelled inputs, then review before saving. Dry preparation takes labelled mass in **mg or mcg** and **final prepared volume in mL**. Premixed preparation takes the labelled concentration in **mg/mL** and fill volume. Both record the preparation date and optional diluent. Final volume means total prepared solution, rather than an assumed amount of diluent. Review shows the resulting preparation and existing draw information; it does not select a treatment dose.

Saving records the initial labelled inputs and server-derived mass/concentration under a stable preparation ID. An unused legacy vial can receive a preparation, but past inputs are never inferred. To correct a saved preparation, use **Edit preparation → Review → Confirm**. Review shows the concentration/stock effect and number of linked doses whose mass would change. If the preparation or linked history changes before confirmation, review it again.

A concentration correction preserves each known physical draw volume and its recorded marking, unit, timestamp, tracking day, site and notes; delivered mass is recalculated from that volume. Incomplete or unaccounted physical draw history blocks a concentration change rather than inventing consumption. Metadata-only edits remain possible. Changing fill with the same concentration preserves dose masses; an already unknown balance stays unknown. Omitted diluent/BUD fields retain their values, including the existing BUD basis when preparation date changes; deliberate clearing follows the form controls.

Corrections retain immutable before/after and per-dose mass audit records, including after the medication, vial, preparation or dose is removed. Account deletion removes its audit records. This is correction of the current preparation, not a new re-preparation/generation workflow. Web vial tools stay in Preparation & stock and logging/history in Cabinet. Mobile keeps its combined tracker; native source changes need rebuilt apps.

Lot number and storage location are optional stock details and remain editable. Sealed expiry, opened date and preparation date are separate fields. Beyond-use dates require an explicit date or an entered interval with a base date and source/reference. There is no automatic 28-day default. Existing saved dates remain available without inventing their provenance; an unknown date stays unknown. Beyond-use dates and their sources describe current vial handling metadata, not an immutable history of date revisions. Approaching or passed date warnings do not establish product stability or sterility.

For a vial with complete records, remaining mass is concentration × prepared volume minus the sum of the doses linked to that vial. Remaining volume follows from that mass and concentration. Variable doses, edited doses and deleted injections all affect the balance. Only injections logged with stock deduction consume stock. Existing count-based pen inventory continues to work.

If older usage counts do not match linked injections, a dose amount is missing, or preparation details are incomplete, mass stock is unavailable. A historic dose count is not treated as a known mass. Recorded use above the vial content is retained and flagged; it is never silently discarded. These figures describe recorded stock and do not account for unlogged waste, spills or device dead space.

Changing only injection notes or site preserves the saved timestamp, tracking day and recorded administration route. New prepared doses retain the medication route at logging; legacy records without a route snapshot stay generic rather than being backfilled from a later medication setting. A deliberate date/time edit updates those fields; opening an edit form does not itself change them.

Deleting a medication removes its linked vial/preparation records while retaining stored injection history and its delivered quantities, timestamps, site and notes. The removed medication, vial and preparation references are cleared by database cleanup. Used vials and used preparations cannot be deleted directly while their parent medication remains; application updates cannot detach preparation provenance while its stock still exists. Account deletion retains its existing full cleanup behavior.

### Prepared dose calculations

Reusable syringe, pen and pump settings have a name and the capacity, scale and increment relevant to that device. Account-owned devices can be added, edited and removed; available global devices are read-only. An owned or global device can be preferred. Settings belong to the device, not the preparation. Removing a device clears its preference/history link while retaining saved delivered mass, volume and markings. An untouched form chooses a compatible preferred device, otherwise the first available; explicit Manual remains available for legacy injection logging.

For injection, enter a target in mg, mcg, mL or device units. Prepared nasal doses use a compatible pump and offer pump-count/mass input without an injection site. Medication route controls the flow; selecting a device does not turn another medication into a nasal or GLP-1 treatment.

The preview shows target mass and volume, the nearest measurable marking, delivered mass and volume, and the rounding difference. Decimal calculations round half-up to the device increment. Logging stores the delivered mass/volume and device reference; the preview does not establish a measured biological dose. Legacy mass-only entries retain their existing behavior.

For a saved calibrated dose, edit in its supported input unit, review the resulting draw and stock impact, then confirm. If its original device was removed, the quantity remains read-only; metadata can still be corrected without rewriting the delivered values. A different device is not substituted to reinterpret that history. Existing legacy manual-mass records keep their compatible editing path.

A target volume above device capacity or above known remaining vial volume blocks a calibrated draw. A unit-graduated draw below two raw units, a target filling the barrel exactly, or mass rounding error greater than 5% shows a warning. Exactly two units or exactly 5% does not trigger those warnings. No extra dose-range rules or already-taken override are added.

The Cabinet preview includes the matching syringe, pen or pump visual. Syringe fill shows target volume relative to capacity with quarter-capacity ticks and a **Draw to** marking. The pen uses a **Dial to** dose window and capacity strip; the pump uses a **Spray** count without a fictitious barrel fill. Target-unit details show mcg, mg, mL and raw syringe units from that same calculation. These figures remain separate from the delivered mass/volume after rounding. Graphics and captions use capacity/increment from the same calculated response; a refreshed device list cannot alter an older preview. These tools remain in Cabinet, not the stock tab.

With a vial and compatible saved devices available, an untouched form automatically chooses the valid preferred device, otherwise the first available compatible device. No separate device-selection step is needed to reveal that preview. It keeps a neutral device figure and an em-dash caption visible before a current calculation is available, including while loading or after an error. Target and delivered numbers appear only for the current valid response; an earlier dose or device preview is not reused. Explicit manual entry remains available, and dose/unit/device changes keep the existing clearing guards. No device is assumed when the saved list is empty. A neutral figure and em-dash caption remain as a placeholder; configure an available device before using calibrated logging. No capacity or marking is guessed. Dose, device and calculation controls appear above the injection-site map within the same Cabinet card; nasal doses have no site map.

### Finished and discarded vials

Use the existing inventory controls to mark stock finished or discarded, or edit its status to reopen it. Retiring stock records its status and finish time without zeroing remaining mass/volume or deleting injection history. Finished/discarded stock is grouped separately from active stock. This is lifecycle management, not a spill, priming or manual stock-adjustment ledger.

### Dose units

Preparation and vial stock use mg and mL. A saved default dose in mcg (including µg/μg) is divided by 1,000 before it fills a dose field in mg or is deducted from stock. Gram doses are multiplied by 1,000. For non-GLP-1 mass-based injectables, the daily Log tab also deducts stock using the scheduled dose amount when one is present. Default volume, device units and unspecified peptide units are never assumed to mean mg. Use the calibrated preparation/device flow to convert supported volume or markings, or enter an explicit mg dose in legacy manual mode. Existing GLP-1 records without a dose unit retain their legacy mg interpretation.

## Medication invoices

The invoice flow is implemented and tested; instance deployment verification is recorded separately. Open **Medications → Costs** to enter an invoice with its own currency, vendor, ordered/received dates, reference and notes. Add medication or consumable lines, quantities and unit prices. Shipping, tax, fees and discounts are entered once; choose allocation by line value, quantity or no allocation and review the resulting landed costs. Currency is editable and defaults to AUD, following the reference app; invoices are not converted or totalled across different currencies.

Match existing vials to medication lines from the invoice or Preparation & stock. The purchased quantity determines the per-vial allocation even when only some vials have been entered. Linking more vials than purchased produces a warning, rather than changing stock or imposing a quantity cap. A linked zero-priced vial is distinct from a vial with no invoice linkage. Unlinking or deleting an invoice preserves vials, preparations, dose history and remaining quantities.

Consumable lines need a description; complete it or remove an unused row. After an uncertain save, retry the same invoice. Reload/review when another change produces a conflict. Invoices are private to the authenticated owner and are not included in medication/report sharing. The selected flow includes no invoice OCR, automatic vial creation, consumed-dose/waste/course dashboard or currency conversion.

## Consumed-cost report

The report is implemented and tested, with instance deployment verification recorded separately. It adds By medication Spend, Per dose and Per mg with costed/uncosted dose coverage inside Costs. Source 3/6/12-month and All windows default to 12 months and affect the report only; your complete invoice ledger remains visible.

An optional explicit vial labelled mass is separate from preparation and remaining stock. No existing vial is backfilled from its preparation, concentration, volume or dose counts. Changing the labelled mass or invoice price changes the current report retrospectively; it does not alter physical stock or recorded doses. Known zero/negative cost is not the same as an unknown rate. Mixed currencies make the affected metric unavailable with a warning, without conversion or a new grouping workflow. Consumable usage, waste, prescription estimates and inclusive total cost per dose are outside this selected report.

## Diary chart

The owner-requested web Diary chart is implemented and source-tested. It reuses the existing modelled absorbed, injection-site and total amounts below Caffeine as an independent widget. Cabinet keeps its chart and dose tools. The widget respects the active profile and existing medication read permissions; it does not add logging controls or change the model. Client and isolated final-build verification are complete; live release readback is recorded separately.
