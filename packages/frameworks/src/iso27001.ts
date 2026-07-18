import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// ISO/IEC 27001:2022 — structure et identifiants de clauses (faits publics) ;
// intitulés et guidances = REFORMULATIONS MAISON (P4, PLAN §12). Jamais le
// texte normatif AFNOR/ISO. Revue juridique requise avant diffusion externe.

const ClauseChildSchema = z.object({
  ref: z.string().regex(/^\d{1,2}(\.\d{1,2}){1,2}$/),
  title: z.string().min(5).max(120),
  guidance: z.string().min(20).max(400),
});

const ClauseSchema = z.object({
  ref: z.string().regex(/^(4|5|6|7|8|9|10)$/),
  title: z.string().min(5).max(120),
  guidance: z.string().min(20).max(400),
  children: z.array(ClauseChildSchema).min(1),
});

const ControlSchema = z.object({
  ref: z.string().regex(/^A\.[5-8]\.\d{1,2}$/),
  title: z.string().min(5).max(120),
  guidance: z.string().min(20).max(400),
});

const ThemeSchema = z.object({
  ref: z.enum(['A.5', 'A.6', 'A.7', 'A.8']),
  title: z.string().min(5).max(120),
  controls: z.array(ControlSchema).min(1),
});

const Iso27001Schema = z.object({
  code: z.literal('iso27001'),
  version: z.literal('2022'),
  name: z.literal('ISO/IEC 27001:2022'),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceNote: z.string().min(20),
  clauses: z.array(ClauseSchema).length(7),
  themes: z.array(ThemeSchema).length(4),
});

export type Iso27001Clause = z.infer<typeof ClauseSchema>;
export type Iso27001Control = z.infer<typeof ControlSchema>;
export type Iso27001Theme = z.infer<typeof ThemeSchema>;
export type Iso27001Framework = z.infer<typeof Iso27001Schema>;

const DATA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'iso27001-2022.json',
);

let cached: Iso27001Framework | undefined;

/** Charge et valide (S2) le référentiel ISO/IEC 27001:2022 depuis les données du paquet. */
export function iso27001(): Iso27001Framework {
  cached ??= Iso27001Schema.parse(JSON.parse(readFileSync(DATA_PATH, 'utf8')));
  return cached;
}

/** Nombre total de contrôles de l'Annexe A (référence : 93 en 2022). */
export function iso27001AnnexAControlCount(data: Iso27001Framework = iso27001()): number {
  return data.themes.reduce((n, theme) => n + theme.controls.length, 0);
}
