/**
 * Slug d'URL d'un tenant (/t/[slug]/…, RM §5.1) : minuscules ASCII,
 * accents retirés, séparateurs normalisés en tirets. Pure et testée.
 */
export function slugifyTenantName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
