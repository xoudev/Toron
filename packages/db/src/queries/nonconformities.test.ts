import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  closeNc,
  confirmEffective,
  createNc,
  getNc,
  listNc,
  reopenNc,
  updateNcSteps,
} from './nonconformities.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
const T = DEMO.tenantId;

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

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

describe('cycle de vie & vérification d’efficacité (RM §7.2)', () => {
  it('la clôture passe « à vérifier » et planifie J+90 ; confirmer/rouvrir', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const id = await createNc(tx, { tenantId: T, title: 'Test — NC', source: 'interne', gravity: 'majeure', detectedBy: DEMO.userCamille });
      await updateNcSteps(tx, { ncId: id, immediateAction: 'Blocage du lot.', status: 'en_traitement' });
      await closeNc(tx, id);
      const afterClose = await getNc(tx, id);
      await confirmEffective(tx, id);
      const afterConfirm = (await getNc(tx, id))!.status;
      await reopenNc(tx, id);
      const afterReopen = await getNc(tx, id);
      return { afterClose, afterConfirm, afterReopen };
    });
    expect(res.afterClose!.status).toBe('cloturee_a_verifier');
    // La date de vérification est ~90 jours après la clôture.
    expect(res.afterClose!.effectivenessCheckAt).not.toBeNull();
    expect(res.afterConfirm).toBe('efficace');
    expect(res.afterReopen!.status).toBe('rouverte');
    expect(res.afterReopen!.effectivenessCheckAt).toBeNull();
  });

  it('la contrainte refuse « à vérifier » sans date de clôture/contrôle', async () => {
    let rejected = false;
    try {
      await admin`
        INSERT INTO nonconformities (tenant_id, title, status)
        VALUES (${T}, 'x', 'cloturee_a_verifier')`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('seed & CAPA commune', () => {
  it('la NC démo porte son analyse 5 pourquoi et une action corrective (moteur commun)', async () => {
    const d = await withTenant(app.db, T, (tx) => getNc(tx, DEMO.ncEtiquetage));
    expect(d?.source).toBe('interne');
    expect(d?.costEstimate).toBe(3200);
    expect((d?.rootCause as { pourquoi: string[] }).pourquoi.length).toBe(4);
    expect(d?.correctiveActions.length).toBe(1);
    expect(d?.correctiveActions[0]!.title).toMatch(/procédure de changement de transporteur/i);
  });
});

describe('isolation', () => {
  it('les NC d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createNc(tx, { tenantId: T, title: 'Test — isolée', source: 'fournisseur', gravity: 'mineure', detectedBy: DEMO.userCamille }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers nc', 'tiers-nc') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listNc(tx));
    expect(seen.some((n) => n.id === id)).toBe(false);
  });
});
