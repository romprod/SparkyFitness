import { z } from 'zod';
import { isDayString } from '../../utils/timezone.ts';

/** What a stored original is: the report or paper it was made from. */
export const HEALTH_DOCUMENT_KINDS = [
  'prescription',
  'lab_report',
  'dexa_report',
  'rmr_report',
  'other',
] as const;
export type HealthDocumentKind = (typeof HEALTH_DOCUMENT_KINDS)[number];

/** The file types kept: a PDF or a photo or scan of one. Anything else is refused. */
export const HEALTH_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type HealthDocumentMime = (typeof HEALTH_DOCUMENT_MIME_TYPES)[number];
/** Fifteen megabytes: a long multi-page report, scanned. */
export const HEALTH_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));
/** A form field that arrives as text: blank means not given. */
const optionalId = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))
  .pipe(z.string().uuid().nullable());
const optionalDay = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || isDayString(value),
    'Use a real date (YYYY-MM-DD)'
  );

/**
 * What goes with the file when it is stored. The file's name, type, size and checksum are read
 * from the file itself, never from the form. A document can be tied to one scan or one RMR test;
 * it is kept if that record is deleted.
 */
export const healthDocumentFieldsSchema = z
  .object({
    kind: z.enum(HEALTH_DOCUMENT_KINDS),
    label: text(100),
    document_day: optionalDay,
    body_comp_scan_id: optionalId,
    metabolic_test_id: optionalId,
  })
  .refine((value) => !(value.body_comp_scan_id && value.metabolic_test_id), {
    path: ['metabolic_test_id'],
    message: 'A document can be linked to one record',
  });
export type HealthDocumentFields = z.output<typeof healthDocumentFieldsSchema>;

export const healthDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(HEALTH_DOCUMENT_KINDS),
  label: z.string().nullable(),
  document_day: z.string().nullable(),
  original_name: z.string(),
  mime: z.enum(HEALTH_DOCUMENT_MIME_TYPES),
  size_bytes: z.number(),
  body_comp_scan_id: z.string().uuid().nullable(),
  metabolic_test_id: z.string().uuid().nullable(),
  uploaded_at: z.string(),
});
export type HealthDocument = z.infer<typeof healthDocumentSchema>;

export const healthDocumentListSchema = z.object({
  health_documents: z.array(healthDocumentSchema),
});

/**
 * The type of a file from its first bytes, or null when it is not a PDF or an image we keep. The
 * name and the type the browser sent can both be made up, so only the bytes decide.
 */
export function detectHealthDocumentType(
  bytes: Uint8Array
): { mime: HealthDocumentMime; ext: string } | null {
  const at = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length &&
    sig.every((b, i) => bytes[offset + i] === b);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { mime: 'application/pdf', ext: 'pdf' }; // %PDF-
  if (at([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: 'image/png', ext: 'png' };
  if (at([0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', ext: 'gif' };
  // WebP is a RIFF container: "RIFF" <size> "WEBP"; the RIFF prefix alone also matches WAV and AVI.
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8))
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}
