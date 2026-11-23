import {
  addDays,
  instantToDay,
  WELLNESS_LOOKBACK_DAYS,
  WELLNESS_WEIGHT_DAYS,
  type MedicationWellnessStreams,
} from '@workspace/shared';
import { loadWellnessRecords } from '../models/medicationWellnessRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

/** The records for the recovery and weight tile, over the owner's last fortnight. */
export async function getMedicationWellnessStreams(
  owner: string,
  authenticatedUserId: string | undefined,
  now = new Date()
): Promise<MedicationWellnessStreams> {
  const timezone = await loadUserTimezone(owner);
  const today = instantToDay(now, timezone);
  const records = await loadWellnessRecords(owner, authenticatedUserId, {
    from_day: addDays(today, -(WELLNESS_LOOKBACK_DAYS - 1)),
    to_day: today,
    // The trend covers the days after `today - 7`.
    weights_from_day: addDays(today, -(WELLNESS_WEIGHT_DAYS - 1)),
  });
  return { today, ...records };
}
