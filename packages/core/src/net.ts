/**
 * Ne conserve le premier hop de X-Forwarded-For que s'il ressemble à une IP,
 * sinon undefined : évite d'insérer une valeur arbitraire/invalide dans
 * audit_log.ip (type inet), qui annulerait la transaction métier.
 */
export function normalizeIp(raw: string | null): string | undefined {
  const first = raw?.split(',')[0]?.trim();
  if (!first) return undefined;
  const isIpv4 =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(first) && first.split('.').every((o) => Number(o) <= 255);
  const isIpv6 = first.includes(':') && /^[0-9a-fA-F:.]+$/.test(first);
  return isIpv4 || isIpv6 ? first : undefined;
}
