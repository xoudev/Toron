import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  closeException,
  createException,
  decideException,
  getExceptionRef,
  listExceptions,
  updateExceptionRequest,
  type ExceptionInput,
} from './exceptions.ts';

const T = DEMO.tenantId;
const TODAY = '2026-10-07';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const messages: string[] = [];
    let cur: unknown = e;
    while (cur instanceof Error) {
      messages.push(cur.message);
      cur = cur.cause;
    }
    expect(messages.join(' | ')).toMatch(pattern);
    return;
  }
  expect.fail('La requête aurait dû être rejetée par Postgres.');
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  await seedRecyfFramework(uri);
  await seedIso27001Framework(uri);
  await seedDemoTenant(uri);
  admin = postgres(uri, { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  app = createDb(
    `postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`,
  );
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

const input: ExceptionInput = {
  title: 'Poste de quai sans verrouillage automatique',
  rule: 'PSSI §5.4 — verrouillage de session après 5 minutes',
  justification: 'Les préparateurs scannent en continu ; le verrouillage interrompt la préparation des commandes.',
  compensatingMeasures: 'Poste en zone à accès badgé, session applicative limitée au module de préparation.',
  controlId: null,
  assetId: null,
  ownerUserId: DEMO.userCamille,
  startsOn: '2026-10-10',
  expiresOn: '2027-03-31',
};

const request = (over: Partial<ExceptionInput> = {}) =>
  withTenant(app.db, T, (tx) => createException(tx, { ...input, ...over, tenantId: T, requestedBy: DEMO.userCamille }));

describe('dérogations du tenant démo', () => {
  it('le seed porte une dérogation à échéance, une demande, une échue et une refusée', async () => {
    const rows = await withTenant(app.db, T, (tx) => listExceptions(tx, TODAY));
    const state = (id: string) => rows.find((r) => r.id === id)?.state;
    expect(state(DEMO.exceptionTrieuse)).toBe('a_echeance');
    expect(state(DEMO.exceptionTelemaintenance)).toBe('en_attente');
    expect(state(DEMO.exceptionSauvegardesVitrolles)).toBe('echue');
    expect(state(DEMO.exceptionCompteAdmin)).toBe('refusee');
    const tele = rows.find((r) => r.id === DEMO.exceptionTelemaintenance)!;
    expect(tele.controlTitle).toBe('MFA sur les accès distants (VPN nomades et prestataires)');
    expect(tele.assetName).not.toBeNull();
    expect(tele.requesterName).toBe('Claire Morel');
    const refused = rows.find((r) => r.id === DEMO.exceptionCompteAdmin)!;
    expect(refused.deciderName).toBe('Claire Morel');
    expect(refused.decisionNote).toMatch(/compte nominatif/);
  });
});

describe('cycle de vie et garde-fous en base', () => {
  it('demande, modification, approbation par un tiers, puis clôture', async () => {
    const id = await request();
    expect(await withTenant(app.db, T, (tx) => updateExceptionRequest(tx, id, { ...input, expiresOn: '2027-01-31' }))).toBe(1);
    expect(await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userClaire, approve: true, note: null }))).toBe(1);
    // Une décision ne se rejoue pas, et la demande ne se modifie plus.
    expect(await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userAntoine, approve: false, note: 'Trop tard' }))).toBe(0);
    expect(await withTenant(app.db, T, (tx) => updateExceptionRequest(tx, id, input))).toBe(0);
    const ref = await withTenant(app.db, T, (tx) => getExceptionRef(tx, id));
    expect(ref).toMatchObject({ status: 'approuvee', expiresOn: '2027-01-31', renewal: 'aucun' });
    expect(await withTenant(app.db, T, (tx) => closeException(tx, { exceptionId: id, closedBy: DEMO.userCamille, note: 'Verrouillage rétabli.' }))).toBe(1);
    expect(await withTenant(app.db, T, (tx) => closeException(tx, { exceptionId: id, closedBy: DEMO.userCamille, note: null }))).toBe(0);
    const rows = await withTenant(app.db, T, (tx) => listExceptions(tx, TODAY));
    expect(rows.find((r) => r.id === id)).toMatchObject({ state: 'cloturee', closerName: 'Camille Poirier', closureNote: 'Verrouillage rétabli.' });
  });

  it('ni le demandeur ni le responsable ne statuent (séparation des tâches)', async () => {
    const id = await request();
    await expectDbError(
      withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userCamille, approve: true, note: null })),
      /policy_exceptions_segregation/,
    );
    const delegated = await withTenant(app.db, T, (tx) =>
      createException(tx, { ...input, ownerUserId: DEMO.userAntoine, tenantId: T, requestedBy: DEMO.userCamille }));
    await expectDbError(
      withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: delegated, decidedBy: DEMO.userAntoine, approve: true, note: null })),
      /policy_exceptions_segregation/,
    );
  });

  it('une dérogation dure douze mois au plus et finit après avoir commencé', async () => {
    await expectDbError(request({ startsOn: '2026-10-10', expiresOn: '2027-10-11' }), /policy_exceptions_window/);
    await expectDbError(request({ startsOn: '2026-10-10', expiresOn: '2026-10-10' }), /policy_exceptions_window/);
    expect(await request({ startsOn: '2026-10-10', expiresOn: '2027-10-10' })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un refus est motivé', async () => {
    const id = await request();
    await expectDbError(
      withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userClaire, approve: false, note: ' ' })),
      /policy_exceptions_refusal_reason/,
    );
    expect(await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userClaire, approve: false, note: 'Écart non justifié.' }))).toBe(1);
  });

  it('une dérogation tranchée est figée et ne revient pas en arrière', async () => {
    const id = await request();
    await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userClaire, approve: true, note: null }));
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE policy_exceptions SET expires_on = '2027-09-30' WHERE id = ${id}`)),
      /derogation_decidee_immuable/,
    );
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE policy_exceptions SET status = 'demandee', decided_by = NULL, decided_at = NULL WHERE id = ${id}`)),
      /derogation_transition_interdite/,
    );
  });

  it('le rôle applicatif ne supprime rien et ne réécrit ni le demandeur ni l’origine', async () => {
    const id = await request();
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM policy_exceptions WHERE id = ${id}`)), /permission denied/);
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE policy_exceptions SET requested_by = ${DEMO.userClaire} WHERE id = ${id}`)),
      /permission denied/,
    );
  });

  it('un renouvellement à la fois ; accordé, il prend la suite de la dérogation échue', async () => {
    const renewal = await withTenant(app.db, T, (tx) => createException(tx, {
      ...input, ownerUserId: DEMO.userClaire, startsOn: TODAY, expiresOn: '2027-03-31',
      tenantId: T, requestedBy: DEMO.userClaire, renewedFromId: DEMO.exceptionSauvegardesVitrolles,
    }));
    expect((await withTenant(app.db, T, (tx) => getExceptionRef(tx, DEMO.exceptionSauvegardesVitrolles)))!.renewal).toBe('demande');
    await expectDbError(
      withTenant(app.db, T, (tx) => createException(tx, {
        ...input, ownerUserId: DEMO.userClaire, tenantId: T, requestedBy: DEMO.userClaire, renewedFromId: DEMO.exceptionSauvegardesVitrolles,
      })),
      /policy_exceptions_one_renewal/,
    );
    await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: renewal, decidedBy: DEMO.userAntoine, approve: true, note: null }));
    const rows = await withTenant(app.db, T, (tx) => listExceptions(tx, TODAY));
    expect(rows.find((r) => r.id === DEMO.exceptionSauvegardesVitrolles)).toMatchObject({ renewal: 'accorde', renewalId: renewal, state: 'renouvelee' });
    expect(rows.find((r) => r.id === renewal)).toMatchObject({ renewedFromId: DEMO.exceptionSauvegardesVitrolles, state: 'en_vigueur' });
  });

  it('supprimer un contrôle efface seulement le lien, même sur une dérogation tranchée', async () => {
    const [ctl] = await admin`INSERT INTO controls (tenant_id, title) VALUES (${T}, 'Contrôle provisoire') RETURNING id`;
    const controlId = (ctl as { id: string }).id;
    const id = await request({ controlId });
    await withTenant(app.db, T, (tx) => decideException(tx, { exceptionId: id, decidedBy: DEMO.userClaire, approve: true, note: null }));
    await withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM controls WHERE id = ${controlId}`));
    expect(await withTenant(app.db, T, (tx) => getExceptionRef(tx, id))).toMatchObject({ controlId: null, status: 'approuvee' });
  });
});

describe('isolation entre organisations', () => {
  it('rien ne se lit, ne se lie ni ne se tranche d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers dérogations', 'tiers-derogations') RETURNING id`;
    const otherId = (other as { id: string }).id;
    await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${otherId}, ${DEMO.userClaire}, 'rssi')`;
    expect(await withTenant(app.db, otherId, (tx) => listExceptions(tx, TODAY))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => getExceptionRef(tx, DEMO.exceptionTelemaintenance))).toBeNull();
    // Un contrôle ou un actif d'une autre organisation ne peut pas être référencé.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createException(tx, { ...input, ownerUserId: DEMO.userClaire, controlId: DEMO.controlMfa, tenantId: otherId, requestedBy: DEMO.userClaire })),
      /foreign key/,
    );
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createException(tx, { ...input, ownerUserId: DEMO.userClaire, assetId: DEMO.assetServeurs, tenantId: otherId, requestedBy: DEMO.userClaire })),
      /foreign key/,
    );
    // Ni renouvellement d'une dérogation d'ailleurs, ni décision sur elle.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createException(tx, { ...input, ownerUserId: DEMO.userClaire, tenantId: otherId, requestedBy: DEMO.userClaire, renewedFromId: DEMO.exceptionTrieuse })),
      /foreign key/,
    );
    expect(await withTenant(app.db, otherId, (tx) => decideException(tx, { exceptionId: DEMO.exceptionTelemaintenance, decidedBy: DEMO.userAntoine, approve: true, note: null }))).toBe(0);
    expect(await withTenant(app.db, otherId, (tx) => closeException(tx, { exceptionId: DEMO.exceptionTrieuse, closedBy: DEMO.userClaire, note: null }))).toBe(0);
    // Une ligne forgée au nom d'une autre organisation est refusée par la politique RLS.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createException(tx, { ...input, ownerUserId: DEMO.userClaire, tenantId: T, requestedBy: DEMO.userClaire })),
      /row-level security/,
    );
  });
});
