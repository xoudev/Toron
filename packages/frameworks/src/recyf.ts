import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// ReCyF v2.5 (ANSSI, 17/03/2026) — référentiel public librement
// utilisable (P4). Codes et intitulés d'objectifs fidèles au document ;
// résumés et intitulés de moyens reformulés maison.

const MeanSchema = z.object({
  ref: z.string().min(3),
  title: z.string().min(10).max(160),
  ei: z.boolean(),
  ee: z.boolean(),
  condition: z.string().optional(),
  extractionNote: z.string().optional(),
});

const ObjectiveSchema = z.object({
  ref: z.string().regex(/^OBJ-\d{2}$/),
  number: z.number().int().min(1).max(20),
  title: z.string().min(5),
  appliesTo: z.enum(['ei_ee', 'ee']),
  summary: z.string().min(20),
  means: z.array(MeanSchema).min(1),
});

const RecyfSchema = z.object({
  code: z.literal('recyf'),
  version: z.string().min(2),
  name: z.string().min(5),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceNote: z.string().min(10),
  objectives: z.array(ObjectiveSchema).length(20),
});

export type RecyfMean = z.infer<typeof MeanSchema>;
export type RecyfObjective = z.infer<typeof ObjectiveSchema>;
export type RecyfFramework = z.infer<typeof RecyfSchema>;

const DATA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'recyf-v2.5.json',
);

let cached: RecyfFramework | undefined;

/** Charge et valide (S2) le référentiel ReCyF v2.5 depuis les données du paquet. */
export function recyf(): RecyfFramework {
  cached ??= RecyfSchema.parse(JSON.parse(readFileSync(DATA_PATH, 'utf8')));
  return cached;
}
