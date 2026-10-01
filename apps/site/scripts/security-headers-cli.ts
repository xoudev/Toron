import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFile, inlineScriptHashes } from './security-headers.ts';

// Usage : enchaîné après `next build` (script build de @toron/site).
// Écrit out/_headers, appliqué par Cloudflare Pages au déploiement.
const OUT_DIR = fileURLToPath(new URL('../out/', import.meta.url));

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name));
}

try {
  const pages = await htmlFiles(OUT_DIR);
  if (pages.length === 0) {
    throw new Error('aucun fichier HTML dans out/');
  }
  const hashes = (await Promise.all(pages.map(async (page) => inlineScriptHashes(await readFile(page, 'utf8'))))).flat();
  await writeFile(join(OUT_DIR, '_headers'), headersFile(hashes), 'utf8');
  console.warn(`out/_headers écrit : ${pages.length} page(s), ${new Set(hashes).size} script(s) inline autorisé(s) par empreinte.`);
} catch (error) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(
    `Génération des en-têtes de sécurité impossible (${cause}). ` +
      "Vérifiez que `next build` a produit l'export statique dans apps/site/out, puis relancez `pnpm --filter @toron/site build`.",
  );
  process.exit(1);
}
