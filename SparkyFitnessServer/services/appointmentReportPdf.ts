import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import type { AppointmentReportData } from '@workspace/shared';
import coverage from '../assets/fonts/coverage.json' with { type: 'json' };
import mathCoverage from '../assets/fonts/math-coverage.json' with { type: 'json' };

const fontPath = (name: string) =>
  fileURLToPath(new URL(`../assets/fonts/${name}.ttf`, import.meta.url));
const supports = (ranges: number[][], code: number) =>
  ranges.some(([start, end]) => code >= start! && code <= end!);
const missing = 'Not recorded';
const amount = (value: string | number | null, unit: string | null) =>
  value === null
    ? missing
    : `${value}${unit ? ` ${unit}` : ' (unit not recorded)'}`;

/** Pure ephemeral PDF: no record reads, network calls, file writes or logging. */
export function renderAppointmentReportPdf(
  data: AppointmentReportData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: 'SparkyFitness appointment report',
        Author: 'SparkyFitness',
        CreationDate: new Date(data.generatedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont('regular', fontPath('NotoSans-Regular'));
      doc.registerFont('bold', fontPath('NotoSans-Bold'));
      doc.registerFont('math', fontPath('NotoSansMath-Regular'));
      const left = 40,
        width = 515.28,
        bottom = 778,
        lineHeight = 13;
      let y = 80,
        sectionName = '',
        unsupportedUsed = false;
      const clean = (value: string) =>
        [...value]
          .map((char) => {
            const code = char.codePointAt(0)!;
            if (
              char === '\n' ||
              char === '\t' ||
              supports(coverage, code) ||
              supports(mathCoverage, code)
            )
              return char;
            unsupportedUsed = true;
            return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
          })
          .join('');
      const glyphFont = (char: string, bold: boolean) =>
        supports(coverage, char.codePointAt(0)!)
          ? bold
            ? 'bold'
            : 'regular'
          : 'math';
      const textWidth = (text: string, size: number, bold = false) =>
        [...text].reduce(
          (sum, char) =>
            sum +
            doc.font(glyphFont(char, bold)).fontSize(size).widthOfString(char),
          0
        );
      const lines = (
        raw: string,
        max: number,
        size = 9,
        bold = false
      ): string[] => {
        const result: string[] = [];
        for (const paragraph of clean(raw).split('\n')) {
          let line = '';
          for (const token of paragraph.replace(/\t/g, '    ').split(/(\s+)/)) {
            if (line && textWidth(line + token, size, bold) > max) {
              result.push(line.trimEnd());
              line = '';
            }
            for (const char of token) {
              if (!line && /\s/.test(char)) continue;
              if (line && textWidth(line + char, size, bold) > max) {
                result.push(line);
                line = '';
              }
              line += char;
            }
          }
          result.push(line.trimEnd());
        }
        return result;
      };
      const paint = (
        text: string,
        x: number,
        top: number,
        size = 9,
        bold = false,
        color = '#263345'
      ) => {
        doc.fillColor(color);
        let run = '',
          selected = '';
        const flush = () => {
          if (!run) return;
          doc
            .font(selected)
            .fontSize(size)
            .text(run, x, top, { lineBreak: false });
          x += doc.widthOfString(run);
          run = '';
        };
        for (const char of text) {
          const font = glyphFont(char, bold);
          if (font !== selected) {
            flush();
            selected = font;
          }
          run += char;
        }
        flush();
      };
      const page = () => {
        doc.addPage();
        y = 80;
        paint('SPARKYFITNESS', left, 30, 10, true, '#285B51');
        paint('Appointment report', 345, 30, 10, false, '#586578');
        doc
          .moveTo(left, 54)
          .lineTo(left + width, 54)
          .strokeColor('#D8E1E5')
          .stroke();
      };
      const ensure = (height: number) => {
        if (y + height > bottom) {
          page();
          if (sectionName) {
            paint(`${sectionName} (continued)`, left, y, 13, true);
            y += 25;
          }
        }
      };
      const paragraph = (text: string, size = 9, bold = false) => {
        const leading = Math.max(lineHeight, size * 1.4);
        for (const line of lines(text, width, size, bold)) {
          ensure(leading);
          paint(line, left, y, size, bold);
          y += leading;
        }
        y += 6;
      };
      const section = (name: string) => {
        sectionName = '';
        ensure(55);
        sectionName = name;
        y += 8;
        paint(name, left, y, 14, true, '#285B51');
        y += 26;
      };
      const table = (
        head: string[],
        rows: string[][],
        fractions: number[],
        context?: string
      ) => {
        const widths = fractions.map((f) => f * width);
        const header = () => {
          const wrapped = head.map((cell, i) =>
            lines(cell, widths[i]! - 10, 8, true)
          );
          const height =
            Math.max(...wrapped.map((c) => c.length)) * lineHeight + 10;
          doc.rect(left, y, width, height).fill('#EAF1EF');
          let x = left;
          wrapped.forEach((cell, i) => {
            cell.forEach((line, n) =>
              paint(line, x + 5, y + 5 + n * lineHeight, 8, true)
            );
            x += widths[i]!;
          });
          y += height;
        };
        const continueTable = () => {
          page();
          paint(`${sectionName} (continued)`, left, y, 13, true);
          y += 25;
          if (context) paragraph(context, 10, true);
          header();
        };
        ensure(55);
        header();
        for (const row of rows) {
          const cells = row.map((cell, i) => lines(cell, widths[i]! - 10));
          const count = Math.max(...cells.map((cell) => cell.length));
          let offset = 0;
          if (count * lineHeight + 10 > bottom - y && y > 150) continueTable();
          while (offset < count) {
            if (bottom - y < lineHeight + 10) {
              continueTable();
            }
            const take = Math.min(
              count - offset,
              Math.floor((bottom - y - 10) / lineHeight)
            );
            let x = left;
            cells.forEach((cell, i) => {
              cell
                .slice(offset, offset + take)
                .forEach((line, n) =>
                  paint(line, x + 5, y + 5 + n * lineHeight)
                );
              x += widths[i]!;
            });
            y += take * lineHeight + 10;
            doc
              .moveTo(left, y)
              .lineTo(left + width, y)
              .strokeColor('#E0E6EB')
              .stroke();
            offset += take;
          }
        }
        y += 8;
      };
      const dateTime = (value: string | null) => {
        if (!value) return missing;
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: data.range.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(date);
      };
      page();
      paragraph('Appointment report', 23, true);
      paragraph(data.ownerDisplayName ?? 'Display name not recorded', 14, true);
      paragraph(`Period: ${data.range.from} to ${data.range.to} (inclusive)`);
      paragraph(
        `Timezone: ${data.range.timezone} | Generated: ${dateTime(data.generatedAt)}`
      );
      paragraph(
        'A personal record for sharing with your healthcare professional. Recorded facts only; this report is not medical advice. Missing records do not mean zero or no symptoms.'
      );
      section('Current medications and plans');
      paragraph(
        'Current facts at export time. Plans are not evidence that a dose was taken.'
      );
      if (!data.currentMedications.length)
        paragraph('No current medication records.');
      for (const med of data.currentMedications) {
        paragraph(
          `${med.name} | ${med.active ? 'Active' : 'Inactive'} | ${amount(med.doseAmount, med.doseUnit)}`,
          10,
          true
        );
        if (!med.schedules.length) paragraph('Schedule: not recorded.');
        for (const schedule of med.schedules) {
          paragraph(
            `Schedule: ${schedule.type}; ${schedule.active ? 'active' : 'inactive'}; time ${schedule.timeOfDay ?? missing}; dose ${amount(schedule.doseAmount, schedule.doseUnit)}; ${schedule.startDate ?? missing} to ${schedule.endDate ?? missing}`
          );
          const cadence = [
            schedule.daysOfWeek === null
              ? null
              : `Weekdays: ${schedule.daysOfWeek.map((day) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? `Unknown weekday (${day})`).join(', ')}`,
            schedule.intervalDays === null
              ? null
              : `Interval: ${schedule.intervalDays} days`,
            schedule.dayOfMonth === null
              ? null
              : `Day of month: ${schedule.dayOfMonth}`,
            schedule.cycleOnDays === null
              ? null
              : `Cycle on: ${schedule.cycleOnDays} days`,
            schedule.cycleOffDays === null
              ? null
              : `Cycle off: ${schedule.cycleOffDays} days`,
            schedule.withMeal === null ? null : `Meal: ${schedule.withMeal}`,
            schedule.prnReason === null
              ? null
              : `As-needed reason: ${schedule.prnReason}`,
            schedule.prnMaxPerDay === null
              ? null
              : `As-needed maximum per day: ${schedule.prnMaxPerDay}`,
          ].filter((value): value is string => value !== null);
          if (cadence.length) paragraph(cadence.join('; '));
        }
        for (const plan of med.titration)
          paragraph(
            `Titration: ${amount(plan.doseAmount, plan.doseUnit)}; start ${plan.startDate ?? missing}; planned weeks ${plan.plannedWeeks ?? missing}; status ${plan.status}`
          );
      }
      section('Recorded doses and medication events');
      paragraph(
        'Includes logged non-administered events with their recorded status. No skipped or planned event is counted as taken. Recorded medication labels are used when available; otherwise current linked labels are identified.'
      );
      if (!data.doseLog.length)
        paragraph('No doses or medication events in this range.');
      else
        table(
          [
            'Tracking day / time',
            'Medication / route / site',
            'Recorded dose',
            'Status',
          ],
          data.doseLog.map((row) => [
            `${row.trackingDay}\n${dateTime(row.occurredAt)}${row.scheduledFor ? `\nScheduled: ${dateTime(row.scheduledFor)}` : ''}`,
            `${row.name ?? 'Unknown medication'}${row.nameBasis === 'current_link' ? ' (current linked label)' : ''}\n${row.administrationRoute ?? 'Route not recorded'}\n${row.site ?? 'Site not recorded'}`,
            `${amount(row.doseAmount, row.doseUnit)}${row.deliveredMassMg !== null && row.doseUnit !== 'mg' ? `\nDelivered mass: ${row.deliveredMassMg} mg` : ''}`,
            `${row.status}\n${row.administered ? 'Administered' : 'Not administered'}\n${row.sourceKind === 'injection' ? 'Injection log' : 'Medication event'}`,
          ]),
          [0.24, 0.32, 0.2, 0.24]
        );
      section('Recorded symptoms');
      paragraph('Recorded symptoms; no cause is inferred.');
      const symptoms = new Map<
        string,
        { count: number; severity: Map<string, number> }
      >();
      for (const symptom of data.symptoms) {
        const key = symptom.name.trim();
        if (!key) continue;
        const row = symptoms.get(key) ?? {
          count: 0,
          severity: new Map<string, number>(),
        };
        row.count++;
        const severity =
          symptom.severityLabel ??
          (symptom.severity === null ? null : String(symptom.severity));
        if (severity !== null)
          row.severity.set(severity, (row.severity.get(severity) ?? 0) + 1);
        symptoms.set(key, row);
      }
      if (!symptoms.size) paragraph('No symptoms recorded in this range.');
      for (const [name, row] of [...symptoms].sort(
        ([a, x], [b, z]) => z.count - x.count || a.localeCompare(b)
      )) {
        const modal = [...row.severity].sort((a, b) => b[1] - a[1])[0]?.[0];
        paragraph(
          `${name} ×${row.count}${modal === undefined ? '' : ` | Most recorded severity: ${modal}`}`
        );
      }
      section('Wellness summary');
      const average = (values: (number | null)[]) => {
        const observed = values.filter(
          (v): v is number => v !== null && Number.isFinite(v)
        );
        return observed.length
          ? `${(observed.reduce((a, b) => a + b, 0) / observed.length).toFixed(1)} (${observed.length} recorded entries)`
          : missing;
      };
      const w = data.wellness;
      if (
        ![w.weights, w.nutrition, w.water, w.mood].some((rows) => rows.length)
      )
        paragraph('No wellness data in this range.');
      else {
        const weights = [...w.weights].sort((a, b) =>
          a.day.localeCompare(b.day)
        );
        const first = weights[0],
          last = weights.at(-1);
        paragraph(
          last
            ? `Latest weight: ${last.value} ${last.unit} on ${last.day}${first && weights.length > 1 && first.unit === last.unit ? ` | Change: ${(last.value - first.value).toFixed(1)} ${last.unit}` : ''}`
            : 'Weight: not recorded.'
        );
        if (
          weights.length > 1 &&
          weights.every((point) => point.unit === weights[0]!.unit)
        ) {
          ensure(85);
          const minimum = Math.min(...weights.map((point) => point.value)),
            maximum = Math.max(...weights.map((point) => point.value));
          const start = y + 10,
            height = 45;
          doc.strokeColor('#285B51').lineWidth(1.3);
          weights.forEach((point, index) => {
            const x = left + (index / (weights.length - 1)) * width;
            const py =
              start +
              height -
              (maximum === minimum
                ? 0.5
                : (point.value - minimum) / (maximum - minimum)) *
                height;
            if (index === 0) doc.moveTo(x, py);
            else doc.lineTo(x, py);
          });
          doc.stroke().lineWidth(1);
          y = start + height + 8;
          paint(
            `${first!.day} to ${last!.day} | Recorded weight (${last!.unit})`,
            left,
            y,
            8
          );
          y += 20;
        }
        paragraph(
          `Average calories (kcal): ${average(w.nutrition.map((row) => row.calories))}`
        );
        paragraph(
          `Average protein (g): ${average(w.nutrition.map((row) => row.proteinGrams))}`
        );
        paragraph(
          `Average water (mL): ${average(w.water.map((row) => row.millilitres))}`
        );
        paragraph(
          `Average recorded mood: ${average(w.mood.map((row) => row.mood))} | Energy: ${average(w.mood.map((row) => row.energy))}`
        );
      }
      section('Bloodwork: latest three explicit panels');
      paragraph(
        'Panel selection is independent of the report period. H/L compare a recorded numeric result with its recorded reference range. Qualified text stays unknown. Reference ranges and assays remain separate; no clinical interpretation is added.'
      );
      if (!data.labPanels.length) paragraph('No bloodwork recorded.');
      for (const panel of data.labPanels) {
        paragraph(
          `${panel.collectedOn ?? 'Collection date not recorded'} | ${panel.labName ?? 'Lab not recorded'} | ${panel.origin}`,
          10,
          true
        );
        if (!panel.results.length) paragraph('No results in this panel.');
        else
          table(
            ['Marker', 'Recorded result', 'Reference range', 'Flag'],
            panel.results.map((row) => [
              row.name,
              `${row.valueText ?? (row.valueNumeric === null ? missing : String(row.valueNumeric))} ${row.unit}`,
              row.referenceLow !== null && row.referenceHigh !== null
                ? `${row.referenceLow} to ${row.referenceHigh} ${row.unit}`
                : row.referenceLow !== null
                  ? `≥ ${row.referenceLow} ${row.unit}`
                  : row.referenceHigh !== null
                    ? `≤ ${row.referenceHigh} ${row.unit}`
                    : missing,
              row.rangeFlag === 'high'
                ? 'H'
                : row.rangeFlag === 'low'
                  ? 'L'
                  : row.rangeFlag,
            ]),
            [0.32, 0.28, 0.27, 0.13],
            `${panel.collectedOn ?? 'Collection date not recorded'} | ${panel.labName ?? 'Lab not recorded'} | ${panel.origin}`
          );
      }
      sectionName = '';
      if (unsupportedUsed)
        paragraph(
          'Font note: unsupported characters are preserved as reversible [U+XXXX] Unicode codepoints.'
        );
      const pages = doc.bufferedPageRange();
      for (
        let index = pages.start;
        index < pages.start + pages.count;
        index++
      ) {
        doc.switchToPage(index);
        paint(
          'Personal record | Not medical advice',
          left,
          804,
          8,
          false,
          '#586578'
        );
        paint(
          `Page ${index + 1} of ${pages.count}`,
          445,
          804,
          8,
          false,
          '#586578'
        );
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
