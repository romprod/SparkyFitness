# Lab Results

Keep your blood work and other lab tests in one place, see each marker over time, and check it against its reference range. Lab results are on the web (**Lab results** tab, or the **Add** menu) and in the mobile app (**Library → Lab results**).

## Markers

A marker is one thing a lab measures, such as HbA1c, LDL or vitamin D. SparkyFitness has built-in markers with a default unit and an adult reference range, and you can add your own. A built-in marker appears in the list once it has a result; your own markers always appear.

## Comparing recent panels

The **Latest three imported reports** section in Lab results is a read-only marker-by-panel table, newest first. Manual results are not grouped into invented panels. Reports use their recorded collection date; an absent date remains unknown, and a differing result date is shown with that cell. Missing results show a dash. Each result keeps its recorded unit, range and qualifiers; a displayed threshold such as `<` or `>` is not an exact measurement. The comparison does not convert incompatible units or add a date/filter workflow. Existing marker identities and assay distinctions remain separate. Movement toward the reference range is indicated only for comparable exact results; incompatible units, qualified values or invalid ranges do not produce a numerical trend claim. The direction compares distance outside the newest available reference interval with the immediately preceding displayed report. Existing marker charts and result editing remain available.

## Adding a result

Choose **Add lab result**, pick a marker (or type a new name to create your own), then enter the date, the result, the unit and, if your report prints one, the reference range. The unit and range start from your latest result for that marker, or from the built-in default (the default range uses the sex on your profile when it differs by sex). Labs differ, so use the range printed on your report: it is saved with that result.

Each result keeps its own unit and range, so a result is judged against the range it was saved with. Units are never converted: results in a different unit from the marker's are listed but not drawn on its chart.

## Importing a report

Choose **Import from a report** and pick a PDF, or a photo or screenshot, of a lab report (up to 14 MB). Your active AI provider reads it and the results come back for review; **nothing is saved until you confirm**, and the report itself is not stored.

- Each row is matched to a built-in marker, one of your own, or a new marker.
- Check or correct each value, and untick any row you do not want.
- A second result for the same marker in one report is blocked.
- A unit that differs from the marker's earlier results shows a warning.

The whole report is saved in one step: if it fails, nothing is stored. If the connection drops while saving, the review is locked and **Save** again sends exactly the same report, which is stored only once. Choosing or scanning the report again starts a new import, so a report that did save the first time would then be saved twice; check the list before importing it again. You need an AI provider set up under **Settings → AI**.

## Deleting

- Delete one result from the marker's history.
- **Delete marker and all results** removes every result of a built-in marker, or your own marker with its results.
- **Delete imported results** (in the page menu) removes everything that came from imported reports, and any marker of your own left empty. Results you entered yourself are kept.

Lab results are private to your account and follow the same sharing rules as check-in data.
