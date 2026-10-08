import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { cleanPortalDraft, type SupplierAnswers } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant, type TenantTx } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  cancelSupplierRequest,
  createSupplierRequest,
  getSupplierRequestRef,
  hashPortalToken,
  listSupplierRequests,
  markSupplierRequestValidated,
  notifySupplierResponse,
  renewSupplierRequestLink,
  resolvePortalRequest,
  savePortalDraft,
} from './supplier-requests.ts';
import { recordSupplierAssessment } from './suppliers.ts';

const T = DEMO.tenantId;
const TODAY = '2026-10-08';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let authSql: postgres.Sql;
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
  await admin`CREATE ROLE auth_login LOGIN PASSWORD 'auth_login_test'`;
  await admin`GRANT toron_auth TO auth_login`;
  const base = `${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(`postgres://app_login:app_login_test@${base}`);
  authSql = postgres(`postgres://auth_login:auth_login_test@${base}`, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await app?.close();
  await authSql?.end();
  await admin?.end();
  await container?.stop();
});

const ALL_YES: SupplierAnswers = {
  gouvernance: 'oui', mfa: 'oui', chiffrement: 'oui', localisation: 'oui', incidents: 'oui', continuite: 'oui',
  vulnerabilites: 'oui', sous_traitance: 'oui', rgpd: 'oui', reversibilite: 'oui', audit: 'oui',
};

const request = (over: { supplierId?: string; requestedBy?: string; dueOn?: string } = {}, tenantId: string = T) =>
  withTenant(app.db, tenantId, (tx) => createSupplierRequest(tx, {
    tenantId, supplierId: over.supplierId ?? DEMO.supplierTransporteur, contactName: 'Service qualité',
    contactEmail: 'qualite@transporteur-regional.example', message: null, dueOn: over.dueOn ?? '2026-10-30',
    requestedBy: over.requestedBy ?? DEMO.userAntoine,
  }));

const save = (requestId: string, answers: Partial<SupplierAnswers>, submit: boolean, today = TODAY, tenantId: string = T) =>
  withTenant(app.db, tenantId, (tx) => savePortalDraft(tx, { requestId, draft: cleanPortalDraft(answers, {}), submit, today }));

describe('demandes de réponse', () => {
  it('le seed porte une réponse du transporteur à examiner, avec ses commentaires', async () => {
    const rows = await withTenant(app.db, T, (tx) => listSupplierRequests(tx, DEMO.supplierTransporteur));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: DEMO.supplierRequestTransporteur, status: 'soumise', dueOn: '2026-10-10', expiresOn: '2026-10-24' });
    expect(rows[0]!.answers['incidents']).toBe('non');
    expect(rows[0]!.comments['incidents']).toMatch(/48 heures/);
    expect(rows[0]!.submittedAt).toBeInstanceOf(Date);
    expect(rows[0]!.requestedByName).not.toBeNull();
  });

  it('le jeton n’est rendu qu’une fois et seule son empreinte est stockée', async () => {
    const { id, token, expiresOn } = await request();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresOn).toBe('2026-11-13');
    const [row] = await admin`SELECT token_hash FROM supplier_requests WHERE id = ${id}` as unknown as { token_hash: string }[];
    expect(row!.token_hash).toBe(hashPortalToken(token));
    expect(row!.token_hash).not.toContain(token);
  });

  it('le portail retrouve la demande par son jeton, et seulement par lui', async () => {
    const { id, token } = await request();
    const found = await resolvePortalRequest(app.db, token);
    expect(found).toMatchObject({
      tenantId: T, requestId: id, organisationName: 'Meridiane Logistics', supplierId: DEMO.supplierTransporteur,
      supplierName: 'Transporteur régional', status: 'envoyee',
    });
    expect(await resolvePortalRequest(app.db, `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(await resolvePortalRequest(app.db, 'pas-un-jeton')).toBeNull();
    expect(await resolvePortalRequest(app.db, `${token}'; --`)).toBeNull();
  });

  it('brouillon puis soumission ; une réponse soumise ne se modifie plus', async () => {
    const { id } = await request();
    expect(await save(id, { mfa: 'oui', chiffrement: 'partiel' }, false)).toBe(true);
    expect(await withTenant(app.db, T, (tx) => getSupplierRequestRef(tx, id))).toMatchObject({ status: 'en_cours', submittedAt: null });
    expect(await save(id, ALL_YES, true)).toBe(true);
    const ref = await withTenant(app.db, T, (tx) => getSupplierRequestRef(tx, id));
    expect(ref).toMatchObject({ status: 'soumise', answers: ALL_YES });
    expect(ref!.submittedAt).toBeInstanceOf(Date);
    expect(await save(id, { mfa: 'non' }, false)).toBe(false);
    expect(await save(id, { mfa: 'non' }, true)).toBe(false);
  });

  it('un lien expiré n’enregistre plus rien', async () => {
    const { id } = await request({ dueOn: '2026-10-09' });
    expect(await save(id, { mfa: 'oui' }, false, '2026-10-23')).toBe(true);
    expect(await save(id, { mfa: 'oui' }, false, '2026-10-24')).toBe(false);
  });

  it('un nouveau lien remplace l’ancien, tant que rien n’est soumis', async () => {
    const { id, token } = await request();
    const renewed = await withTenant(app.db, T, (tx) => renewSupplierRequestLink(tx, id, '2026-11-20'));
    expect(renewed).toMatchObject({ expiresOn: '2026-12-04' });
    expect(await resolvePortalRequest(app.db, token)).toBeNull();
    expect(await resolvePortalRequest(app.db, renewed!.token)).toMatchObject({ requestId: id, dueOn: '2026-11-20' });
    expect(await withTenant(app.db, T, (tx) => renewSupplierRequestLink(tx, DEMO.supplierRequestTransporteur, '2026-11-20'))).toBeNull();
  });

  it('une demande annulée ferme le portail ; une demande validée ne s’annule plus', async () => {
    const { id, token } = await request();
    expect(await withTenant(app.db, T, (tx) => cancelSupplierRequest(tx, id))).toBe(true);
    expect(await resolvePortalRequest(app.db, token)).toMatchObject({ status: 'annulee' });
    expect(await save(id, { mfa: 'oui' }, false)).toBe(false);
    expect(await withTenant(app.db, T, (tx) => cancelSupplierRequest(tx, id))).toBe(false);
  });

  it('validation : l’évaluation est rattachée à la demande, une seule fois', async () => {
    const { id } = await request();
    await save(id, ALL_YES, true);
    const assessmentId = await withTenant(app.db, T, (tx) => recordSupplierAssessment(tx, {
      tenantId: T, supplierId: DEMO.supplierTransporteur, assessorUserId: DEMO.userAntoine, assessedOn: TODAY,
      answers: ALL_YES, score: 100, rating: 'satisfaisant',
    }));
    const validate = () => withTenant(app.db, T, (tx) => markSupplierRequestValidated(tx, { requestId: id, reviewerUserId: DEMO.userAntoine, assessmentId }));
    expect(await validate()).toBe(true);
    expect(await validate()).toBe(false);
    const rows = await withTenant(app.db, T, (tx) => listSupplierRequests(tx, DEMO.supplierTransporteur));
    expect(rows.find((r) => r.id === id)).toMatchObject({ status: 'validee', assessmentId });
    expect(await withTenant(app.db, T, (tx) => cancelSupplierRequest(tx, id))).toBe(false);
  });

  it('réponse reçue : le demandeur et le responsable du fournisseur sont prévenus, sans doublon', async () => {
    const count = (userId: string) => admin`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND kind = 'reponse'`
      .then((r) => (r[0] as { n: number }).n);
    const antoine = await count(DEMO.userAntoine);
    const camille = await count(DEMO.userCamille);
    // Camille demande, Antoine est responsable du transporteur : deux personnes prévenues.
    const { id } = await request({ requestedBy: DEMO.userCamille });
    expect(await withTenant(app.db, T, (tx) => notifySupplierResponse(tx, { tenantId: T, slug: 'meridiane-logistics', requestId: id }))).toBe(2);
    expect(await count(DEMO.userAntoine)).toBe(antoine + 1);
    expect(await count(DEMO.userCamille)).toBe(camille + 1);
    const [n] = await admin`SELECT title, href, subject, actor_user_id FROM notifications WHERE user_id = ${DEMO.userCamille} AND kind = 'reponse' ORDER BY created_at DESC LIMIT 1` as unknown as
      { title: string; href: string; subject: string; actor_user_id: string | null }[];
    expect(n).toMatchObject({
      title: 'Questionnaire rempli par le fournisseur : Transporteur régional', subject: 'fournisseur', actor_user_id: null,
      href: `/t/meridiane-logistics/fournisseurs?ouvrir=${DEMO.supplierTransporteur}`,
    });
    // Antoine demande et est responsable : une seule notification.
    const { id: own } = await request();
    expect(await withTenant(app.db, T, (tx) => notifySupplierResponse(tx, { tenantId: T, slug: 'meridiane-logistics', requestId: own }))).toBe(1);
  });
});

describe('garde-fous de la base', () => {
  it('une demande soumise porte sa date ; une demande validée, sa revue', async () => {
    await expectDbError(admin`
      INSERT INTO supplier_requests (tenant_id, supplier_id, contact_name, contact_email, token_hash, status, due_on, expires_on)
      VALUES (${T}, ${DEMO.supplierTransporteur}, 'Contact', 'a@b.example', ${'a'.repeat(64)}, 'soumise', '2026-10-30', '2026-11-13')`,
      /supplier_requests_submitted/);
    await expectDbError(admin`
      INSERT INTO supplier_requests (tenant_id, supplier_id, contact_name, contact_email, token_hash, status, due_on, expires_on, submitted_at)
      VALUES (${T}, ${DEMO.supplierTransporteur}, 'Contact', 'a@b.example', ${'b'.repeat(64)}, 'validee', '2026-10-30', '2026-11-13', now())`,
      /supplier_requests_reviewed/);
  });

  it('empreinte de jeton au bon format, unique ; adresse plausible', async () => {
    const insert = (hash: string, email = 'a@b.example') => admin`
      INSERT INTO supplier_requests (tenant_id, supplier_id, contact_name, contact_email, token_hash, due_on, expires_on)
      VALUES (${T}, ${DEMO.supplierTransporteur}, 'Contact', ${email}, ${hash}, '2026-10-30', '2026-11-13')`;
    await expectDbError(insert('pas-une-empreinte'), /check constraint/);
    await expectDbError(insert('c'.repeat(64), 'sans-arobase'), /check constraint/);
    await insert('d'.repeat(64));
    await expectDbError(insert('d'.repeat(64)), /supplier_requests_token_hash_key/);
  });

  it('la résolution des liens n’est ouverte qu’au rôle applicatif', async () => {
    await expect(authSql`SELECT * FROM supplier_portal_lookup(${'e'.repeat(64)})`).rejects.toThrow(/permission denied/);
  });
});

describe('isolation entre organisations', () => {
  it('ni lecture, ni création, ni modification, ni notification d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers portail', 'tiers-portail') RETURNING id`;
    const otherId = (other as { id: string }).id;
    const inOther = <R,>(fn: (tx: TenantTx) => Promise<R>) => withTenant(app.db, otherId, fn);
    expect(await inOther((tx) => listSupplierRequests(tx, DEMO.supplierTransporteur))).toEqual([]);
    expect(await inOther((tx) => getSupplierRequestRef(tx, DEMO.supplierRequestTransporteur))).toBeNull();
    expect(await inOther((tx) => cancelSupplierRequest(tx, DEMO.supplierRequestInfogerance))).toBe(false);
    expect(await inOther((tx) => renewSupplierRequestLink(tx, DEMO.supplierRequestInfogerance, '2026-11-20'))).toBeNull();
    expect(await save(DEMO.supplierRequestInfogerance, ALL_YES, true, TODAY, otherId)).toBe(false);
    expect(await inOther((tx) => markSupplierRequestValidated(tx, {
      requestId: DEMO.supplierRequestTransporteur, reviewerUserId: DEMO.userAntoine, assessmentId: DEMO.supplierEvalHebergeur,
    }))).toBe(false);
    expect(await inOther((tx) => notifySupplierResponse(tx, { tenantId: otherId, slug: 'tiers-portail', requestId: DEMO.supplierRequestTransporteur }))).toBe(0);
    await expectDbError(request({}, otherId), /foreign key/);
    const ref = await withTenant(app.db, T, (tx) => getSupplierRequestRef(tx, DEMO.supplierRequestInfogerance));
    expect(ref).toMatchObject({ status: 'envoyee' });
  });

  it('une demande ne peut pas pointer vers l’évaluation d’une autre organisation', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers éval', 'tiers-eval') RETURNING id`;
    const otherId = (other as { id: string }).id;
    const [sup] = await admin`INSERT INTO suppliers (tenant_id, name, tier) VALUES (${otherId}, 'Fournisseur tiers', 't3') RETURNING id`;
    await expectDbError(admin`
      INSERT INTO supplier_requests (tenant_id, supplier_id, contact_name, contact_email, token_hash, status, due_on, expires_on,
                                     submitted_at, reviewed_at, reviewed_by, assessment_id)
      VALUES (${otherId}, ${(sup as { id: string }).id}, 'Contact', 'a@b.example', ${'f'.repeat(64)}, 'validee', '2026-10-30',
              '2026-11-13', now(), now(), ${DEMO.userAntoine}, ${DEMO.supplierEvalHebergeur})`,
      /foreign key/);
  });
});
