import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  closeIncident,
  createIncident,
  getIncident,
  listIncidents,
  qualifyIncident,
} from './incidents.ts';

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

describe('qualification & échéancier (RM §6.1)', () => {
  it('la qualification pose les échéances NIS 2 + CNIL calculées à la qualification', async () => {
    const detail = await withTenant(app.db, T, async (tx) => {
      const id = await createIncident(tx, { tenantId: T, title: 'Test — intrusion', severity: 'majeur', detectedBy: DEMO.userClaire });
      await qualifyIncident(tx, {
        tenantId: T, incidentId: id, nis2Important: true,
        criteria: { perturbation_operationnelle: true }, gdprBreach: true, qualifiedBy: DEMO.userClaire,
      });
      return getIncident(tx, id);
    });
    const kinds = detail!.notifications.map((n) => n.kind).sort();
    expect(kinds).toEqual(['alerte_24h', 'cnil_72h', 'notification_72h', 'rapport_30j']);
    const q = detail!.qualifiedAt!.getTime();
    const alerte = detail!.notifications.find((n) => n.kind === 'alerte_24h')!;
    expect(Math.round((alerte.dueAt.getTime() - q) / 3_600_000)).toBe(24);
    const rapport = detail!.notifications.find((n) => n.kind === 'rapport_30j')!;
    expect(Math.round((rapport.dueAt.getTime() - q) / 3_600_000)).toBe(720);
    expect(detail!.events.some((e) => e.kind === 'qualification')).toBe(true);
  });

  it('un incident non important n’arme pas l’échéancier NIS 2 (mais CNIL si RGPD)', async () => {
    const kinds = await withTenant(app.db, T, async (tx) => {
      const id = await createIncident(tx, { tenantId: T, title: 'Test — mineur', severity: 'mineur', detectedBy: DEMO.userClaire });
      await qualifyIncident(tx, { tenantId: T, incidentId: id, nis2Important: false, criteria: {}, gdprBreach: true, qualifiedBy: DEMO.userClaire });
      return (await getIncident(tx, id))!.notifications.map((n) => n.kind);
    });
    expect(kinds).toEqual(['cnil_72h']);
  });
});

describe('clôture — REX obligatoire si important (RM §6.1)', () => {
  it('refuse la clôture sans REX puis l’accepte avec REX', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const id = await createIncident(tx, { tenantId: T, title: 'Test — clôture', severity: 'critique', detectedBy: DEMO.userClaire });
      await qualifyIncident(tx, { tenantId: T, incidentId: id, nis2Important: true, criteria: {}, gdprBreach: false, qualifiedBy: DEMO.userClaire });
      const blocked = await closeIncident(tx, { tenantId: T, incidentId: id, rex: null, closedBy: DEMO.userClaire });
      const ok = await closeIncident(tx, { tenantId: T, incidentId: id, rex: 'Cause racine traitée ; MFA généralisé.', closedBy: DEMO.userClaire });
      const status = (await getIncident(tx, id))!.status;
      return { blocked: blocked.outcome, ok: ok.outcome, status };
    });
    expect(res.blocked).toBe('rex_requis');
    expect(res.ok).toBe('closed');
    expect(res.status).toBe('clos');
  });

  it('la contrainte SQL refuse aussi une clôture importante sans REX', async () => {
    let rejected = false;
    try {
      await admin`
        INSERT INTO incidents (tenant_id, title, status, nis2_important)
        VALUES (${T}, 'x', 'clos', true)`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('timeline & seed & isolation', () => {
  it('le seed démo pose l’incident hameçonnage qualifié avec sa timeline', async () => {
    const d = await withTenant(app.db, T, (tx) => getIncident(tx, DEMO.incidentPhishing));
    expect(d?.nis2Important).toBe(true);
    expect(d?.events.length).toBeGreaterThanOrEqual(3);
    expect(d?.notifications.length).toBe(4);
  });

  it('la timeline est append-only (aucune modification par le rôle applicatif)', async () => {
    let rejected = false;
    try {
      await withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE incident_events SET description = 'x'`));
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('les incidents d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createIncident(tx, { tenantId: T, title: 'Test — isolé', severity: 'mineur', detectedBy: DEMO.userClaire }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers inc', 'tiers-inc') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listIncidents(tx));
    expect(seen.some((i) => i.id === id)).toBe(false);
  });
});
