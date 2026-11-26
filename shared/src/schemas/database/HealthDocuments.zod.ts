import { z } from 'zod';

export const healthDocumentsIdSchema = z.string().or(z.number());

export const healthDocumentsSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  kind: z.string(),
  label: z.string().nullable().optional(),
  document_day: z.date().nullable().optional(),
  original_name: z.string(),
  mime: z.string(),
  size_bytes: z.number().int(),
  sha256: z.string(),
  file_path: z.string(),
  body_comp_scan_id: z.string().nullable().optional(),
  metabolic_test_id: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const healthDocumentsInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  kind: z.string().optional(),
  label: z.string().nullable().optional(),
  document_day: z.date().nullable().optional(),
  original_name: z.string().optional(),
  mime: z.string().optional(),
  size_bytes: z.number().int().optional(),
  sha256: z.string().optional(),
  file_path: z.string().optional(),
  body_comp_scan_id: z.string().nullable().optional(),
  metabolic_test_id: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const healthDocumentsMutatorSchema = healthDocumentsInitializerSchema.partial();

export type HealthDocuments = z.infer<typeof healthDocumentsSchema>;
export type HealthDocumentsInitializer = z.infer<typeof healthDocumentsInitializerSchema>;
export type HealthDocumentsMutator = z.infer<typeof healthDocumentsMutatorSchema>;
