import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import { loadAdherenceMedications } from '../models/medicationInsightRepository.js';
import { getMedicationAdherenceWindow } from '../services/medicationInsightService.js';

// Synthetic opt-in only: run against a throwaway PostgreSQL, never a real database.
describe.runIf(process.env.ADHERENCE_WINDOW_INTEGRATION === '1')(
  'per-medicine adherence window in isolated PostgreSQL',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    const window = { from_day: '2026-08-20', to_day: '2026-11-17' };
    const now = new Date('2026-11-17T12:00:00Z');
    let planned: string;
    let loggedOnly: string;
    let idle: string;
    let injected: string;
    let supplement: string;
    let tablet: string;
    let otherMed: string;

    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `adherence-${id}@example.test`]
          );
        const add = async (
          user: string,
          name: string,
          type: string,
          supplementFlag = false
        ): Promise<string> =>
          (
            await c.query(
              'INSERT INTO public.medications (user_id,name,type_id,is_supplement) VALUES ($1,$2,$3,$4) RETURNING id',
              [user, name, type, supplementFlag]
            )
          ).rows[0].id;
        planned = await add(owner, 'Synthetic planned', 'injection');
        loggedOnly = await add(owner, 'Synthetic logged', 'injection');
        idle = await add(owner, 'Synthetic idle', 'injection');
        injected = await add(owner, 'Synthetic injected', 'injection');
        supplement = await add(
          owner,
          'Synthetic supplement',
          'injection',
          true
        );
        tablet = await add(owner, 'Synthetic tablet', 'tablet');
        otherMed = await add(other, 'Synthetic other', 'injection');

        // A taken dose inside the window, a taken dose outside it, and a skipped one.
        await c.query(
          "INSERT INTO medication_entries (medication_id,user_id,status,taken_at,entry_date) VALUES ($1,$2,'taken','2026-11-10T09:00:00Z','2026-11-10')",
          [loggedOnly, owner]
        );
        await c.query(
          "INSERT INTO medication_entries (medication_id,user_id,status,taken_at,entry_date) VALUES ($1,$2,'taken','2026-01-10T09:00:00Z','2026-01-10')",
          [idle, owner]
        );
        await c.query(
          "INSERT INTO medication_entries (medication_id,user_id,status,taken_at,entry_date) VALUES ($1,$2,'skipped','2026-11-10T09:00:00Z','2026-11-10')",
          [idle, owner]
        );
        await c.query(
          "INSERT INTO injection_entries (medication_id,user_id,injected_at,entry_date) VALUES ($1,$2,'2026-11-11T09:00:00Z','2026-11-11')",
          [injected, owner]
        );
        await c.query(
          "INSERT INTO medication_entries (medication_id,user_id,status,taken_at,entry_date) VALUES ($1,$2,'taken','2026-11-10T09:00:00Z','2026-11-10')",
          [supplement, owner]
        );

        // A daily plan that began a week before `now`, so it has slots and no taken dose.
        const course = randomUUID();
        const revision = randomUUID();
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic planned','2026-11-10','UTC','2026-11-10T00:00:00Z')",
          [course, owner, planned]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,status,start_date,target_dose,dose_unit,dose_basis) VALUES($1,$2,$3,1,'Synthetic plan','active','2026-11-10',1,'mg','per_injection')",
          [revision, owner, course]
        );
        await c.query(
          "INSERT INTO medication_course_rules(user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,0,'daily','08:00')",
          [owner, revision]
        );
        await c.query(
          'INSERT INTO medication_course_steps(user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,0,1,$3,NULL)',
          [owner, revision, 'mg']
        );
        await c.query(
          "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-11-10T00:00:00Z')",
          [owner, revision]
        );
        await c.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [course, revision]
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });

    it('lists injectable non-supplement medicines, with whether a taken dose fell in the window', async () => {
      const rows = await loadAdherenceMedications(owner, owner, window);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect([...byId.keys()].sort()).toEqual(
        [planned, loggedOnly, idle, injected].sort()
      );
      expect(byId.get(planned)?.dosed_in_window).toBe(false);
      expect(byId.get(loggedOnly)?.dosed_in_window).toBe(true);
      // Outside the window, or only skipped: not dosed.
      expect(byId.get(idle)?.dosed_in_window).toBe(false);
      // An injection log counts as a dose.
      expect(byId.get(injected)?.dosed_in_window).toBe(true);
      expect(byId.has(supplement)).toBe(false);
      expect(byId.has(tablet)).toBe(false);
    });

    it('does not show another user’s medication', async () => {
      const rows = await loadAdherenceMedications(owner, owner, window);
      expect(rows.some((row) => row.id === otherMed)).toBe(false);
      const theirs = await loadAdherenceMedications(other, other, window);
      expect(theirs.map((row) => row.id)).toEqual([otherMed]);
      // Acting as someone without access sees nothing of the owner's.
      expect(await loadAdherenceMedications(owner, other, window)).toEqual([]);
    });

    it('scores a plan end to end and lists medicines by the rule', async () => {
      const out = await getMedicationAdherenceWindow(owner, owner, now);
      expect(out.today).toBe('2026-11-17');
      expect(out.from_day).toBe('2026-08-20');
      const names = out.medications.map((row) => row.name).sort();
      // The idle medicine has no slot and no dose in the window, so it is not listed.
      expect(names).toEqual([
        'Synthetic injected',
        'Synthetic logged',
        'Synthetic planned',
      ]);
      const plan = out.medications.find((row) => row.medication_id === planned);
      expect(plan?.taken).toBe(0);
      expect(plan?.missed).toBeGreaterThanOrEqual(7);
      expect(plan?.pct).toBe(0);
      expect(plan?.days_of_data).toBeGreaterThanOrEqual(7);
      const logged = out.medications.find(
        (row) => row.medication_id === loggedOnly
      );
      expect(logged?.pct).toBeNull();
      expect(out.overall.missed).toBe(plan?.missed);
      expect(out.overall.pct).toBe(0);
    });
  }
);
