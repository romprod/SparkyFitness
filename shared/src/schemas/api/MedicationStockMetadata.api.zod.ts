import { Decimal } from 'decimal.js';
import { z } from 'zod';

/** Independent total printed vial mass, never a dose or an inferred preparation input. */
export const medicationVialLabelMassSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const amount = new Decimal(value);
      // PostgreSQL NUMERIC limits are storage limits, not medication limits.
      if (
        amount.isFinite() &&
        amount.gt(0) &&
        amount.e <= 131071 &&
        amount.decimalPlaces() <= 16383
      )
        return amount.toString();
    } catch {
      /* Report the same validation result for malformed decimals. */
    }
    context.addIssue({
      code: 'custom',
      message: 'Enter a finite positive vial label amount',
    });
    return z.NEVER;
  });
