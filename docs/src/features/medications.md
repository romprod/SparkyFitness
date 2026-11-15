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

**Open Medications → Preparation & stock** to choose any injectable peptide or medication. The GLP-1 flag is not required. Use **Add peptide / injectable** for a new record, or select an existing injectable. This tab can be bookmarked at `/medications?tab=stock`. It includes preparation, stock, injection logging and editable injection history together. The same tools are also available in the Cabinet detail for injectable medications.

Click **Prepare a vial**, then enter its labelled content in **mg**, its **final prepared volume in mL**, and the dose in **mg**. The calculator shows concentration in mg/mL and the draw volume in mL for that entered dose. The final volume is the total prepared solution, rather than an assumed quantity of diluent. The calculator does not choose a dose or convert to syringe units.

Saving retains the concentration and prepared volume in the vial record. Once used, those preparation details cannot be changed; add a new vial for a new preparation. Web and mobile source use the same calculation and existing inventory forms. The mobile medication detail links to Preparation & stock for any injectable; pharmacokinetic modelling, GLP-1 check-ins and titration remain specific to GLP-1 medications. Native source changes require a rebuilt app.

For a vial with complete records, remaining mass is concentration × prepared volume minus the sum of the doses linked to that vial. Remaining volume follows from that mass and concentration. Variable doses, edited doses and deleted injections all affect the balance. Only injections logged with stock deduction consume stock. Existing count-based pen inventory continues to work.

If older usage counts do not match linked injections, a dose amount is missing, or preparation details are incomplete, mass stock is unavailable. A historic dose count is not treated as a known mass. Recorded use above the vial content is retained and flagged; it is never silently discarded. These figures describe recorded stock and do not account for unlogged waste, spills or device dead space.

### Dose units

Preparation and vial stock use mg and mL. A saved default dose in mcg (including µg/μg) is divided by 1,000 before it fills a dose field in mg or is deducted from stock. Gram doses are multiplied by 1,000. For non-GLP-1 mass-based injectables, the daily Log tab also deducts stock using the scheduled dose amount when one is present. Volume, device units and unspecified peptide units are never assumed to mean mg; enter the dose explicitly in mg when using the injection form. Existing GLP-1 records without a dose unit retain their legacy mg interpretation.
