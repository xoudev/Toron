'use client';

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * QR code dessiné en SVG à partir de la matrice de modules : aucune image
 * distante, aucun innerHTML. Les modules contigus d'une ligne sont fusionnés
 * en un seul rectangle pour alléger le rendu.
 */
export function QrCode({ value, label, size = 184 }: { value: string; label: string; size?: number }) {
  const { count, rects } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const out: { x: number; y: number; w: number }[] = [];
    for (let y = 0; y < n; y += 1) {
      let x = 0;
      while (x < n) {
        if (!qr.isDark(y, x)) { x += 1; continue; }
        const start = x;
        while (x < n && qr.isDark(y, x)) x += 1;
        out.push({ x: start, y, w: x - start });
      }
    }
    return { count: n, rects: out };
  }, [value]);

  const margin = 4;
  const dim = count + margin * 2;
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={dim} height={dim} fill="#ffffff" />
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x + margin} y={r.y + margin} width={r.w} height={1} fill="#000000" />
      ))}
    </svg>
  );
}
