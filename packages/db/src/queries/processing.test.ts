import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { processingGaps, processorAgreementState } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { createProcessing, deleteProcessing, listProcessing, updateProcessing, type ProcessingInput } from './processing.ts';
import { listMyWork } from './work.ts';

const T = DEMO.tenantId;

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

const input: ProcessingInput = {
  entityId: null, name: 'Annuaire interne', purpose: 'Permettre aux salariés de se joindre.', legalBasis: 'interet_legitime',
  legalBasisDetail: 'Communication interne', dataSubjects: ['Salariés'], dataCategories: ['Identité', 'Téléphone professionnel'],
  sensitiveData: false, recipients: 'Salariés', transfersOutsideEu: false, transferSafeguards: null,
  retention: 'Durée du contrat', securityMeasures: 'Accès authentifié', ownerUserId: null, lastReviewedOn: null,
};

describe('registre des traitements (RGPD art. 30)', () => {
  it('le seed porte cinq fiches, dont deux incomplètes, et lit les accords de traitement des fournisseurs', async () => {
    const list = await withTenant(app.db, T, (tx) => listProcessing(tx));
    expect(list).toHaveLength(5);
    expect(list.filter((p) => processingGaps(p).length > 0).map((p) => p.id).sort()).toEqual([DEMO.processingVideo, DEMO.processingReclamations].sort());
    const livraisons = list.find((p) => p.id === DEMO.processingLivraisons)!;
    const states = Object.fromEntries(livraisons.processors.map((x) => [x.supplierId, processorAgreementState(x, '2026-10-06')]));
    expect(states).toEqual({ [DEMO.supplierHebergeur]: 'couvert', [DEMO.supplierTransporteur]: 'absent' });
  });

  it('création avec sous-traitants, mise à jour puis suppression', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createProcessing(tx, T, input, [DEMO.supplierHebergeur, DEMO.supplierHebergeur]);
      const created = (await listProcessing(tx)).find((p) => p.id === id)!;
      await updateProcessing(tx, T, id, { ...input, retention: 'Durée du contrat + 1 mois' }, [DEMO.supplierInfogerance]);
      const updated = (await listProcessing(tx)).find((p) => p.id === id)!;
      const removed = await deleteProcessing(tx, id);
      return { created: created.processors.map((x) => x.supplierId), updated: updated.processors.map((x) => x.supplierId), retention: updated.retention, removed };
    });
    expect(result).toEqual({ created: [DEMO.supplierHebergeur], updated: [DEMO.supplierInfogerance], retention: 'Durée du contrat + 1 mois', removed: { name: 'Annuaire interne' } });
  });

  it('un transfert hors UE doit indiquer ses garanties', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => createProcessing(tx, T, { ...input, transfersOutsideEu: true }, [])), /processing_transfers_framed/);
  });

  it('isolation : ni lecture croisée, ni sous-traitant ou entité d’une autre organisation', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers traitements', 'tiers-traitements') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await withTenant(app.db, otherId, (tx) => listProcessing(tx))).toEqual([]);
    await expectDbError(withTenant(app.db, otherId, (tx) => createProcessing(tx, otherId, input, [DEMO.supplierHebergeur])), /foreign key/);
    await expectDbError(withTenant(app.db, otherId, (tx) => createProcessing(tx, otherId, { ...input, entityId: DEMO.entityId }, [])), /foreign key/);
    expect(await withTenant(app.db, otherId, (tx) => deleteProcessing(tx, DEMO.processingRh))).toBeNull();
  });

  it('« Mon travail » propose la révision annuelle au responsable de la fiche', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    const geoloc = items.find((i) => i.kind === 'traitement' && i.id === DEMO.processingGeoloc)!;
    expect(geoloc).toMatchObject({ due: '2027-03-02', detail: 'Révision annuelle de la fiche' });
    expect(items.find((i) => i.id === DEMO.processingVideo)?.detail).toBe('Fiche de traitement à relire');
  });
});
