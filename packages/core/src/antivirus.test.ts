import { describe, expect, it } from 'vitest';

import { instreamFrames, parseClamdReply } from './antivirus.ts';

const length = (frame: Uint8Array) => new DataView(frame.buffer, frame.byteOffset).getUint32(0, false);

describe('trames INSTREAM', () => {
  it('préfixe chaque tronçon de sa longueur et termine par une trame vide', () => {
    const frames = instreamFrames(new TextEncoder().encode('abcdefghij'), 4);
    expect(frames.map(length)).toEqual([4, 4, 2, 0]);
    expect(new TextDecoder().decode(frames[0]!.subarray(4))).toBe('abcd');
    expect(new TextDecoder().decode(frames[2]!.subarray(4))).toBe('ij');
    expect(frames[3]).toEqual(new Uint8Array(4));
  });

  it('écrit la longueur en gros-boutiste sur quatre octets', () => {
    const [first] = instreamFrames(new Uint8Array(300), 1024);
    expect([...first!.subarray(0, 4)]).toEqual([0, 0, 1, 44]);
  });

  it('un fichier vide n’envoie que la trame de fin ; une taille de tronçon absurde est refusée', () => {
    expect(instreamFrames(new Uint8Array(0)).map(length)).toEqual([0]);
    expect(() => instreamFrames(new Uint8Array(1), 0)).toThrow(RangeError);
  });
});

describe('réponse de clamd', () => {
  it('reconnaît un fichier sain et un fichier infecté', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'sain' });
    expect(parseClamdReply('stream: Eicar-Test-Signature FOUND\0')).toEqual({ status: 'infecte', signature: 'Eicar-Test-Signature' });
  });

  it('ne conclut jamais « sain » par défaut', () => {
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR\0')).toEqual({ status: 'erreur', detail: 'INSTREAM size limit exceeded. ERROR' });
    expect(parseClamdReply('')).toEqual({ status: 'erreur', detail: 'réponse vide' });
    expect(parseClamdReply('stream: OK mais pas tout à fait').status).toBe('erreur');
  });
});
