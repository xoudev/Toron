import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

import type { SoaModel } from './soa-model.ts';
import { renderSoaTypst } from './soa-template.ts';

export interface CompileOptions {
  /** Chemin du binaire Typst (défaut : `typst` dans le PATH). */
  typstBin?: string;
  timeoutMs?: number;
}

/** Compile une source Typst en PDF (stdin → stdout), déterministe (ADR-5). */
export function compileTypst(source: string, opts: CompileOptions = {}): Promise<Buffer> {
  const { typstBin = process.env['TYPST_BIN'] ?? 'typst', timeoutMs = 25_000 } = opts;
  return new Promise((resolve, reject) => {
    const proc = spawn(typstBin, ['compile', '--format', 'pdf', '-', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Compilation Typst : délai dépassé.'));
    }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => err.push(d));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`Typst a échoué (code ${code}) : ${Buffer.concat(err).toString().slice(0, 300)}`));
    });
    proc.stdin.write(source);
    proc.stdin.end();
  });
}

/** Rend et compile la Déclaration d'applicabilité. */
export function compileSoa(model: SoaModel, opts: CompileOptions = {}): Promise<Buffer> {
  return compileTypst(renderSoaTypst(model), opts);
}

/** Empreinte SHA-256 (hex) d'un PDF — le poinçon (ADR-6). */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Slug de vérification non devinable (URL-safe). */
export function randomVerifySlug(): string {
  return randomBytes(12).toString('base64url');
}
