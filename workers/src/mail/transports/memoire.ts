// Transport des tests : garde les e-mails en mémoire et rejoue les échecs
// programmés, dans l'ordre.

import type { Mailer, OutgoingEmail, SendFailure, SendOutcome } from '../mailer.ts';

export interface MemoireMailer extends Mailer {
  readonly sent: OutgoingEmail[];
  /** Les `times` prochains envois échouent avec ce résultat. */
  failWith(outcome: SendFailure, times?: number): void;
  /** Appelé au début de chaque envoi, avant le résultat. */
  onSend: ((email: OutgoingEmail) => void | Promise<void>) | null;
}

export function createMemoireMailer(): MemoireMailer {
  const sent: OutgoingEmail[] = [];
  const failures: SendFailure[] = [];
  const mailer: MemoireMailer = {
    transport: 'memoire',
    sent,
    onSend: null,
    failWith(outcome, times = 1) {
      for (let i = 0; i < times; i++) failures.push(outcome);
    },
    async send(email): Promise<SendOutcome> {
      try {
        await mailer.onSend?.(email);
      } catch {
        return { ok: false, verdict: { effect: 'reprise', code: 'RESEAU' } };
      }
      const failure = failures.shift();
      if (failure) return failure;
      sent.push(email);
      return { ok: true, providerMessageId: `memoire-${sent.length}` };
    },
  };
  return mailer;
}
