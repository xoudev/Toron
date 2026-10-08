import { createHash, randomBytes } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { OBLIGATION_CATALOG, assessSupplier, supplierQuestion, defaultRiskScale, riskBand, type RiskBand, type SupplierAnswers } from '@toron/core';
import { FRAMEWORK_CATALOG, iso27001, recyf } from '@toron/frameworks';
import postgres from 'postgres';

// Seeds M0-6 : référentiel builtin ReCyF v2.5 + tenant de démonstration
// « Meridiane Logistics » (148 salariés, 3 sites, périmètre SMSI + QMS).
// Idempotents (upserts) et déterministes (UUID fixes pour les objets de
// démo). À exécuter avec le rôle DDL/superutilisateur local — les
// builtins (tenant_id NULL) et la création de tenant sont hors de portée
// du rôle applicatif, par construction (RLS M0-2).

// UUID fixes du tenant de démo — jamais utilisés en production réelle.
export const DEMO = {
  tenantId: 'd0000000-0000-4000-8000-000000000001',
  entityId: 'd0000000-0000-4000-8000-000000000010',
  siteSiege: 'd0000000-0000-4000-8000-000000000011',
  siteEntrepot: 'd0000000-0000-4000-8000-000000000012',
  siteAgence: 'd0000000-0000-4000-8000-000000000013',
  userClaire: 'd0000000-0000-4000-8000-000000000021',
  userAntoine: 'd0000000-0000-4000-8000-000000000022',
  userCamille: 'd0000000-0000-4000-8000-000000000023',
  scopeSmsi: 'd0000000-0000-4000-8000-000000000031',
  scopeQms: 'd0000000-0000-4000-8000-000000000032',
  controlInventaire: 'd0000000-0000-4000-8000-000000000041',
  controlMfa: 'd0000000-0000-4000-8000-000000000042',
  controlSauvegardes: 'd0000000-0000-4000-8000-000000000043',
  riskRancongiciel: 'd0000000-0000-4000-8000-000000000051',
  riskCompteDistant: 'd0000000-0000-4000-8000-000000000052',
  riskEntrepot: 'd0000000-0000-4000-8000-000000000053',
  riskObsolescence: 'd0000000-0000-4000-8000-000000000054',
  riskInventaire: 'd0000000-0000-4000-8000-000000000055',
  actionMessagerie: 'd0000000-0000-4000-8000-000000000061',
  actionRevueAcces: 'd0000000-0000-4000-8000-000000000062',
  actionPcaEntrepot: 'd0000000-0000-4000-8000-000000000063',
  docPssi: 'd0000000-0000-4000-8000-000000000071',
  docProcSauvegarde: 'd0000000-0000-4000-8000-000000000072',
  evidenceRestauration: 'd0000000-0000-4000-8000-000000000081',
  evidenceMfa: 'd0000000-0000-4000-8000-000000000082',
  evidenceInventaire: 'd0000000-0000-4000-8000-000000000083',
  assetWms: 'd0000000-0000-4000-8000-000000000091',
  assetServeurs: 'd0000000-0000-4000-8000-000000000092',
  assetDonneesClients: 'd0000000-0000-4000-8000-000000000093',
  assetFluxEdi: 'd0000000-0000-4000-8000-000000000094',
  incidentPhishing: 'd0000000-0000-4000-8000-0000000000a1',
  ncEtiquetage: 'd0000000-0000-4000-8000-0000000000b1',
  actionNcEtiquetage: 'd0000000-0000-4000-8000-0000000000b2',
  supplierHebergeur: 'd0000000-0000-4000-8000-0000000000c1',
  supplierTransporteur: 'd0000000-0000-4000-8000-0000000000c2',
  supplierInfogerance: 'd0000000-0000-4000-8000-0000000000c3',
  auditSmsi: 'd0000000-0000-4000-8000-0000000000d1',
  reviewS1: 'd0000000-0000-4000-8000-0000000000e1',
  processTransport: 'd0000000-0000-4000-8000-0000000000f1',
  processPrepa: 'd0000000-0000-4000-8000-0000000000f2',
  ebiosStudy: 'd0000000-0000-4000-8000-000000000101',
  ebiosSc1: 'd0000000-0000-4000-8000-000000000102',
  ebiosSc2: 'd0000000-0000-4000-8000-000000000103',
  ebiosSc3: 'd0000000-0000-4000-8000-000000000104',
  assessmentIso: 'd0000000-0000-4000-8000-000000000111',
  supplierEvalHebergeur: 'd0000000-0000-4000-8000-000000000121',
  supplierEvalInfogerance: 'd0000000-0000-4000-8000-000000000122',
  attestSecNumCloud: 'd0000000-0000-4000-8000-000000000131',
  attestIsoHebergeur: 'd0000000-0000-4000-8000-000000000132',
  attestDpaHebergeur: 'd0000000-0000-4000-8000-000000000133',
  attestIsoInfogerance: 'd0000000-0000-4000-8000-000000000134',
  attestAssuranceTransporteur: 'd0000000-0000-4000-8000-000000000135',
  actionSupplierIncidents: 'd0000000-0000-4000-8000-000000000141',
  obligationContratClient: 'd0000000-0000-4000-8000-000000000151',
  processingRh: 'd0000000-0000-4000-8000-000000000161',
  processingLivraisons: 'd0000000-0000-4000-8000-000000000162',
  processingGeoloc: 'd0000000-0000-4000-8000-000000000163',
  processingVideo: 'd0000000-0000-4000-8000-000000000164',
  processingReclamations: 'd0000000-0000-4000-8000-000000000165',
  exceptionTrieuse: 'd0000000-0000-4000-8000-000000000171',
  exceptionTelemaintenance: 'd0000000-0000-4000-8000-000000000172',
  exceptionSauvegardesVitrolles: 'd0000000-0000-4000-8000-000000000173',
  exceptionCompteAdmin: 'd0000000-0000-4000-8000-000000000174',
  reviewSauvegardesMars: 'd0000000-0000-4000-8000-000000000181',
  reviewMfaAvril: 'd0000000-0000-4000-8000-000000000182',
  reviewSauvegardesJuillet: 'd0000000-0000-4000-8000-000000000183',
  trainingPreparateurs: 'd0000000-0000-4000-8000-000000000191',
  trainingPhishing: 'd0000000-0000-4000-8000-000000000192',
  trainingDirigeants: 'd0000000-0000-4000-8000-000000000193',
  trainingRgpd: 'd0000000-0000-4000-8000-000000000194',
  evidenceFormationDirigeants: 'd0000000-0000-4000-8000-000000000195',
  evidenceHameconnage: 'd0000000-0000-4000-8000-000000000196',
  continuityExpedition: 'd0000000-0000-4000-8000-0000000001a1',
  continuityEdi: 'd0000000-0000-4000-8000-0000000001a2',
  continuityTournees: 'd0000000-0000-4000-8000-0000000001a3',
  continuityPaie: 'd0000000-0000-4000-8000-0000000001a4',
  exerciseRestaurationEdi: 'd0000000-0000-4000-8000-0000000001b1',
  exerciseTableWms: 'd0000000-0000-4000-8000-0000000001b2',
  exerciseBasculeWms: 'd0000000-0000-4000-8000-0000000001b3',
  actionListesPapier: 'd0000000-0000-4000-8000-0000000001b4',
  surveyNpsS2: 'd0000000-0000-4000-8000-0000000001c1',
  surveyNpsS1: 'd0000000-0000-4000-8000-0000000001c2',
  surveyCsatLivraison: 'd0000000-0000-4000-8000-0000000001c3',
  complaintAvoir: 'd0000000-0000-4000-8000-0000000001d1',
  complaintCasse: 'd0000000-0000-4000-8000-0000000001d2',
  complaintRetards: 'd0000000-0000-4000-8000-0000000001d3',
  complaintEtiquettes: 'd0000000-0000-4000-8000-0000000001d4',
  complaintInversion: 'd0000000-0000-4000-8000-0000000001d5',
  supplierRequestTransporteur: 'd0000000-0000-4000-8000-0000000001e1',
  supplierRequestInfogerance: 'd0000000-0000-4000-8000-0000000001e2',
  slug: 'meridiane-logistics',
  // Identifiants de démonstration locaux — communiqués par la sortie du CLI.
  password: 'Meridiane#Demo2026',
} as const;

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Insère (ou met à jour) le référentiel builtin ReCyF v2.5 et son arbre d'exigences. */
export async function seedRecyfFramework(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    const data = recyf();
    const [fw] = await sql`
      INSERT INTO frameworks (tenant_id, code, version, name, source)
      VALUES (NULL, ${data.code}, ${data.version}, ${data.name}, 'builtin')
      ON CONFLICT ON CONSTRAINT frameworks_code_version_unique
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    const frameworkId = (fw as { id: string }).id;

    let sortOrder = 0;
    for (const objective of data.objectives) {
      const guidance =
        `${objective.summary} Applicabilité : ${
          objective.appliesTo === 'ee' ? 'entités essentielles uniquement.' : 'entités importantes et essentielles.'
        }`;
      const [obj] = await sql`
        INSERT INTO requirements
          (tenant_id, framework_id, ref_id, parent_id, title_internal, guidance_internal, applicable_default, sort_order)
        VALUES
          (NULL, ${frameworkId}, ${objective.ref}, NULL, ${objective.title}, ${guidance}, true, ${sortOrder})
        ON CONFLICT ON CONSTRAINT requirements_framework_ref_unique
        DO UPDATE SET title_internal = EXCLUDED.title_internal,
                      guidance_internal = EXCLUDED.guidance_internal,
                      sort_order = EXCLUDED.sort_order
        RETURNING id`;
      const objectiveRowId = (obj as { id: string }).id;
      sortOrder += 1;

      for (const mean of objective.means) {
        const meanGuidance = [
          `Attendu — EI : ${mean.ei ? 'oui' : 'non'} · EE : ${mean.ee ? 'oui' : 'non'}.`,
          mean.condition ? `Condition : ${mean.condition}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        await sql`
          INSERT INTO requirements
            (tenant_id, framework_id, ref_id, parent_id, title_internal, guidance_internal, applicable_default, sort_order)
          VALUES
            (NULL, ${frameworkId}, ${mean.ref}, ${objectiveRowId}, ${mean.title}, ${meanGuidance}, true, ${sortOrder})
          ON CONFLICT ON CONSTRAINT requirements_framework_ref_unique
          DO UPDATE SET title_internal = EXCLUDED.title_internal,
                        guidance_internal = EXCLUDED.guidance_internal,
                        parent_id = EXCLUDED.parent_id,
                        sort_order = EXCLUDED.sort_order`;
        sortOrder += 1;
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Insère (ou met à jour) le référentiel builtin ISO/IEC 27001:2022 :
 * clauses 4-10 (système de management) et Annexe A (4 thèmes, 93 contrôles),
 * en arbre parent/enfant. Contenu = reformulations maison (P4/§12).
 */
export async function seedIso27001Framework(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    const data = iso27001();
    const [fw] = await sql`
      INSERT INTO frameworks (tenant_id, code, version, name, source)
      VALUES (NULL, ${data.code}, ${data.version}, ${data.name}, 'builtin')
      ON CONFLICT ON CONSTRAINT frameworks_code_version_unique
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    const frameworkId = (fw as { id: string }).id;

    // Un nœud d'exigence, éventuellement enfant d'un parent (upsert idempotent).
    const upsert = async (
      ref: string,
      parentId: string | null,
      title: string,
      guidance: string | null,
      sortOrder: number,
    ): Promise<string> => {
      const [row] = await sql`
        INSERT INTO requirements
          (tenant_id, framework_id, ref_id, parent_id, title_internal, guidance_internal, applicable_default, sort_order)
        VALUES (NULL, ${frameworkId}, ${ref}, ${parentId}, ${title}, ${guidance}, true, ${sortOrder})
        ON CONFLICT ON CONSTRAINT requirements_framework_ref_unique
        DO UPDATE SET title_internal = EXCLUDED.title_internal,
                      guidance_internal = EXCLUDED.guidance_internal,
                      parent_id = EXCLUDED.parent_id,
                      sort_order = EXCLUDED.sort_order
        RETURNING id`;
      return (row as { id: string }).id;
    };

    let sortOrder = 0;
    // Clauses 4-10 et leurs sous-clauses.
    for (const clause of data.clauses) {
      const parentId = await upsert(clause.ref, null, clause.title, clause.guidance, sortOrder);
      sortOrder += 1;
      for (const child of clause.children) {
        await upsert(child.ref, parentId, child.title, child.guidance, sortOrder);
        sortOrder += 1;
      }
    }
    // Annexe A : chaque thème est un nœud parent (sans guidance) portant ses contrôles.
    for (const theme of data.themes) {
      const parentId = await upsert(theme.ref, null, theme.title, null, sortOrder);
      sortOrder += 1;
      for (const control of theme.controls) {
        await upsert(control.ref, parentId, control.title, control.guidance, sortOrder);
        sortOrder += 1;
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Catalogue de référentiels intégrés « légers » (ISO 9001, RGPD, ISO 27701,
 * ISO 22301, DORA, SecNumCloud) : entrées disponibles à l'activation, avec
 * leurs exigences de tête. Idempotent — sûr à rejouer.
 */
export async function seedFrameworkCatalog(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    for (const fwData of FRAMEWORK_CATALOG) {
      const [fw] = await sql`
        INSERT INTO frameworks (tenant_id, code, version, name, source)
        VALUES (NULL, ${fwData.code}, ${fwData.version}, ${fwData.name}, 'builtin')
        ON CONFLICT ON CONSTRAINT frameworks_code_version_unique
        DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      const frameworkId = (fw as { id: string }).id;
      let sortOrder = 0;
      for (const req of fwData.requirements) {
        await sql`
          INSERT INTO requirements
            (tenant_id, framework_id, ref_id, parent_id, title_internal, guidance_internal, applicable_default, sort_order)
          VALUES (NULL, ${frameworkId}, ${req.ref}, NULL, ${req.title}, NULL, true, ${sortOrder})
          ON CONFLICT ON CONSTRAINT requirements_framework_ref_unique
          DO UPDATE SET title_internal = EXCLUDED.title_internal, sort_order = EXCLUDED.sort_order`;
        sortOrder += 1;
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Tenant de démonstration « Meridiane Logistics » — cohérent partout,
 * jamais de lorem ipsum (§13). Comptes de démo au format Better Auth
 * (argon2id) ; TOTP volontairement non activé : l'exigence TOTP pour
 * Direction/RSSI se démontre au premier accès.
 */
export async function seedDemoTenant(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO tenants (id, name, slug, plan, employee_count, sector)
      VALUES (${DEMO.tenantId}, 'Meridiane Logistics', ${DEMO.slug}, 'standard', 148, 'Logistique et transport')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug,
        employee_count = EXCLUDED.employee_count, sector = EXCLUDED.sector`;

    await sql`
      INSERT INTO legal_entities (id, tenant_id, name, siren, nis2_sector, employee_count, turnover_meur,
                                  balance_sheet_meur, nis2_registration)
      VALUES (${DEMO.entityId}, ${DEMO.tenantId}, 'Meridiane Logistics SAS', NULL, 'postal_expedition', 148, 31.5,
              18.2, 'en_cours')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, nis2_sector = EXCLUDED.nis2_sector,
        employee_count = EXCLUDED.employee_count, turnover_meur = EXCLUDED.turnover_meur,
        balance_sheet_meur = EXCLUDED.balance_sheet_meur, nis2_registration = EXCLUDED.nis2_registration`;

    const sites = [
      [DEMO.siteSiege, 'Siège & plateforme logistique — Corbas', '12 rue des Frères Lumière, 69960 Corbas'],
      [DEMO.siteEntrepot, 'Entrepôt régional — Meyzieu', 'ZAC des Gaulnes, 69330 Meyzieu'],
      [DEMO.siteAgence, 'Agence sud — Vitrolles', 'Anjoly, 13127 Vitrolles'],
    ] as const;
    for (const [id, name, address] of sites) {
      await sql`
        INSERT INTO sites (id, tenant_id, entity_id, name, address)
        VALUES (${id}, ${DEMO.tenantId}, ${DEMO.entityId}, ${name}, ${address})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address`;
    }

    const users = [
      [DEMO.userClaire, 'claire.morel@meridiane-logistics.example', 'Claire Morel', 'rssi'],
      [DEMO.userAntoine, 'antoine.vasseur@meridiane-logistics.example', 'Antoine Vasseur', 'direction'],
      [DEMO.userCamille, 'camille.poirier@meridiane-logistics.example', 'Camille Poirier', 'resp_qualite'],
    ] as const;
    const passwordDigest = await hash(DEMO.password, ARGON2_OPTIONS);
    for (const [id, email, name, role] of users) {
      await sql`
        INSERT INTO users (id, email, name, email_verified)
        VALUES (${id}, ${email}, ${name}, true)
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`;
      await sql`
        INSERT INTO accounts (user_id, account_id, provider_id, password)
        SELECT ${id}, ${id}, 'credential', ${passwordDigest}
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts WHERE user_id = ${id} AND provider_id = 'credential'
        )`;
      await sql`
        INSERT INTO memberships (tenant_id, user_id, role)
        VALUES (${DEMO.tenantId}, ${id}, ${role})
        ON CONFLICT ON CONSTRAINT memberships_tenant_user_unique
        DO UPDATE SET role = EXCLUDED.role`;
    }

    const scopes = [
      [DEMO.scopeSmsi, 'SMSI Groupe', 'smsi'],
      [DEMO.scopeQms, 'QMS Groupe', 'qms'],
    ] as const;
    for (const [id, name, kind] of scopes) {
      await sql`
        INSERT INTO scopes (id, tenant_id, name, kind, entity_ids, site_ids)
        VALUES (${id}, ${DEMO.tenantId}, ${name}, ${kind}, ${sql.array([DEMO.entityId])}::uuid[],
                ${sql.array([DEMO.siteSiege, DEMO.siteEntrepot, DEMO.siteAgence])}::uuid[])
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
    }

    const [recyfFw] = await sql`
      SELECT id FROM frameworks WHERE tenant_id IS NULL AND code = 'recyf'`;
    if (!recyfFw) {
      throw new Error(
        'Seed démo : le référentiel ReCyF est absent — lancez d’abord seedRecyfFramework().',
      );
    }
    const frameworkId = (recyfFw as { id: string }).id;
    await sql`
      INSERT INTO scope_frameworks (scope_id, framework_id, tenant_id)
      VALUES (${DEMO.scopeSmsi}, ${frameworkId}, ${DEMO.tenantId})
      ON CONFLICT DO NOTHING`;

    // ISO 27001 activé sur le même périmètre SMSI : la démo porte deux
    // référentiels de sécurité, condition de la mutualisation.
    const [isoFw] = await sql`
      SELECT id FROM frameworks WHERE tenant_id IS NULL AND code = 'iso27001'`;
    if (!isoFw) {
      throw new Error(
        'Seed démo : le référentiel ISO 27001 est absent — lancez d’abord seedIso27001Framework().',
      );
    }
    await sql`
      INSERT INTO scope_frameworks (scope_id, framework_id, tenant_id)
      VALUES (${DEMO.scopeSmsi}, ${(isoFw as { id: string }).id}, ${DEMO.tenantId})
      ON CONFLICT DO NOTHING`;

    // Trois contrôles internes, chacun mappé sur ReCyF ET ISO 27001 :
    // « Prouvez une fois. Couvrez tout. » — ils apparaissent mutualisés
    // (la vue mutualized_controls compte les contrôles couvrant ≥ 2 référentiels).
    const controls = [
      [
        DEMO.controlInventaire,
        'Inventaire des activités, services et SI supports',
        'Liste consolidée revue annuellement avec responsables désignés par activité.',
        DEMO.userClaire,
        'annuelle',
        ['recyf:OBJ-01', 'iso27001:A.5.9'],
      ],
      [
        DEMO.controlMfa,
        'MFA sur les accès distants (VPN nomades et prestataires)',
        'Authentification multifacteur exigée pour tout accès distant au SI.',
        DEMO.userClaire,
        'semestrielle',
        ['recyf:OBJ-08', 'iso27001:A.8.5'],
      ],
      [
        DEMO.controlSauvegardes,
        'Sauvegardes et tests de restauration trimestriels',
        'Sauvegardes isolées et restauration testée chaque trimestre, PV conservé.',
        DEMO.userAntoine,
        'trimestrielle',
        ['recyf:OBJ-13', 'iso27001:A.8.13'],
      ],
    ] as const;
    for (const [id, title, description, owner, freq, mappings] of controls) {
      await sql`
        INSERT INTO controls (id, tenant_id, title, description, owner_user_id, review_frequency, created_at)
        VALUES (${id}, ${DEMO.tenantId}, ${title}, ${description}, ${owner}, ${freq}, '2025-09-01T08:00:00Z')
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, created_at = EXCLUDED.created_at`;
      for (const mapping of mappings) {
        const sep = mapping.indexOf(':');
        const code = mapping.slice(0, sep);
        const ref = mapping.slice(sep + 1);
        await sql`
          INSERT INTO control_requirements (control_id, requirement_id, tenant_id)
          SELECT ${id}, r.id, ${DEMO.tenantId}
          FROM requirements r
          JOIN frameworks f ON f.id = r.framework_id
          WHERE f.tenant_id IS NULL AND f.code = ${code} AND r.ref_id = ${ref}
          ON CONFLICT DO NOTHING`;
      }
    }

    // Revues d'efficacité : la MFA, revue sur échantillon au printemps, est en
    // retard de revue ; les sauvegardes ont échoué au dernier test de
    // restauration ; l'inventaire n'a jamais été revu.
    const controlReviews = [
      [DEMO.reviewSauvegardesMars, DEMO.controlSauvegardes, '2026-03-20', DEMO.userAntoine, 'test_technique', 'efficace',
        'Restauration complète du serveur de fichiers du siège en 2 h 10, dans l’objectif fixé.'],
      [DEMO.reviewMfaAvril, DEMO.controlMfa, '2026-04-02', DEMO.userClaire, 'echantillonnage', 'partiellement_efficace',
        'Deux comptes de prestataires sur quarante testés sans second facteur ; corrigé le jour même, revue des comptes externes à renforcer.'],
      [DEMO.reviewSauvegardesJuillet, DEMO.controlSauvegardes, '2026-07-10', DEMO.userClaire, 'test_technique', 'inefficace',
        'Restauration du serveur EDI impossible : sauvegarde incomplète depuis la migration de juin.'],
    ] as const;
    for (const [id, controlId, reviewedOn, reviewer, method, result, observations] of controlReviews) {
      await sql`
        INSERT INTO control_reviews (id, tenant_id, control_id, reviewed_on, reviewer_user_id, method, result, observations)
        VALUES (${id}, ${DEMO.tenantId}, ${controlId}, ${reviewedOn}, ${reviewer}, ${method}, ${result}, ${observations})
        ON CONFLICT (id) DO NOTHING`;
    }

    // ── Module 5.4 : registre de risques du tenant démo ─────────────────
    // Échelle 4×4 par défaut (version 1), puis quelques risques réalistes
    // couvrant les états d'acceptation (à réduire, transféré, accepté signé,
    // acceptation en attente). Cotations liées aux contrôles mutualisés.
    const scale = defaultRiskScale();
    await sql`
      INSERT INTO risk_scales (tenant_id, version, size, g_labels, v_labels, bands)
      VALUES (${DEMO.tenantId}, 1, ${scale.size},
              ${JSON.stringify(scale.gLabels)}::jsonb,
              ${JSON.stringify(scale.vLabels)}::jsonb,
              ${JSON.stringify(scale.bands)}::jsonb)
      ON CONFLICT ON CONSTRAINT risk_scales_tenant_version_unique DO NOTHING`;

    const band = (g: number, v: number): RiskBand => {
      const b = riskBand(g, v, scale);
      if (b === null) throw new Error(`Seed démo : cotation (${g},${v}) hors échelle.`);
      return b;
    };

    const risks = [
      {
        id: DEMO.riskRancongiciel,
        title: 'Rançongiciel paralysant le SI logistique',
        businessValue: 'Continuité des expéditions et de la facturation',
        scenario:
          'Chiffrement des serveurs applicatifs via une pièce jointe piégée, arrêt des expéditions multi-sites.',
        gg: 4,
        gv: 3,
        ng: 3,
        nv: 2,
        treatment: 'reduire',
        residualTarget: 'moyen',
        owner: DEMO.userClaire,
        nextReview: '2026-12-15',
        controls: [DEMO.controlSauvegardes, DEMO.controlMfa],
      },
      {
        id: DEMO.riskCompteDistant,
        title: 'Compromission d’un compte à privilèges par accès distant',
        businessValue: 'Confidentialité et intégrité du SI',
        scenario:
          'Vol d’identifiants d’un administrateur nomade, connexion VPN illégitime sans second facteur.',
        gg: 4,
        gv: 3,
        ng: 2,
        nv: 2,
        treatment: 'reduire',
        residualTarget: 'faible',
        owner: DEMO.userClaire,
        nextReview: '2026-11-30',
        controls: [DEMO.controlMfa],
      },
      {
        id: DEMO.riskEntrepot,
        title: 'Indisponibilité prolongée de l’entrepôt de Meyzieu',
        businessValue: 'Capacité de stockage et de préparation régionale',
        scenario: 'Sinistre (incendie, dégât des eaux) rendant l’entrepôt régional inexploitable.',
        gg: 4,
        gv: 2,
        ng: 3,
        nv: 2,
        treatment: 'transferer',
        residualTarget: 'moyen',
        owner: DEMO.userAntoine,
        nextReview: '2027-01-31',
        controls: [],
      },
      {
        id: DEMO.riskObsolescence,
        title: 'Obsolescence d’une application de suivi secondaire',
        businessValue: 'Reporting logistique non critique',
        scenario:
          'Application interne sans maintenance éditeur ; risque résiduel formellement accepté par la direction.',
        gg: 3,
        gv: 2,
        ng: 2,
        nv: 2,
        treatment: 'accepter',
        residualTarget: 'moyen',
        owner: DEMO.userClaire,
        nextReview: '2027-06-30',
        controls: [],
        acceptance: {
          by: DEMO.userAntoine,
          rationale:
            'Impact limité au reporting non critique ; remplacement planifié au prochain exercice. Acceptation revue à mi-parcours.',
          expiresAt: '2027-06-30',
        },
      },
      {
        id: DEMO.riskInventaire,
        title: 'Inventaire des actifs SI incomplet sur l’agence de Vitrolles',
        businessValue: 'Maîtrise du périmètre technique',
        scenario:
          'Actifs de l’agence sud non recensés ; décision d’accepter temporairement en attendant la campagne d’inventaire.',
        gg: 3,
        gv: 3,
        ng: 3,
        nv: 2,
        treatment: 'accepter',
        residualTarget: 'moyen',
        owner: DEMO.userClaire,
        nextReview: '2026-10-31',
        controls: [DEMO.controlInventaire],
        // Pas d'acceptation signée : illustre « acceptation en attente » (RM §5.4).
      },
    ] as const;

    for (const r of risks) {
      await sql`
        INSERT INTO risks
          (id, tenant_id, scope_id, title, business_value, scenario, source,
           gross_g, gross_v, net_g, net_v, treatment, residual_target, owner_user_id, next_review)
        VALUES
          (${r.id}, ${DEMO.tenantId}, ${DEMO.scopeSmsi}, ${r.title}, ${r.businessValue},
           ${r.scenario}, 'manual', ${r.gg}, ${r.gv}, ${r.ng}, ${r.nv}, ${r.treatment},
           ${r.residualTarget}, ${r.owner}, ${r.nextReview})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, scenario = EXCLUDED.scenario,
          gross_g = EXCLUDED.gross_g, gross_v = EXCLUDED.gross_v,
          net_g = EXCLUDED.net_g, net_v = EXCLUDED.net_v, treatment = EXCLUDED.treatment`;

      // Instantané d'historique initial (idempotent : un seul par risque au seed).
      await sql`
        INSERT INTO risk_history
          (tenant_id, risk_id, gross_g, gross_v, gross_band, net_g, net_v, net_band, scale_version, rated_by)
        SELECT ${DEMO.tenantId}, ${r.id}, ${r.gg}, ${r.gv}, ${band(r.gg, r.gv)},
               ${r.ng}, ${r.nv}, ${band(r.ng, r.nv)}, 1, ${r.owner}
        WHERE NOT EXISTS (SELECT 1 FROM risk_history WHERE risk_id = ${r.id})`;

      for (const controlId of r.controls) {
        await sql`
          INSERT INTO risk_controls (risk_id, control_id, tenant_id)
          VALUES (${r.id}, ${controlId}, ${DEMO.tenantId})
          ON CONFLICT DO NOTHING`;
      }

      if ('acceptance' in r && r.acceptance) {
        await sql`
          INSERT INTO risk_acceptances (tenant_id, risk_id, accepted_by_user, rationale, expires_at)
          SELECT ${DEMO.tenantId}, ${r.id}, ${r.acceptance.by}, ${r.acceptance.rationale},
                 ${r.acceptance.expiresAt}
          WHERE NOT EXISTS (SELECT 1 FROM risk_acceptances WHERE risk_id = ${r.id})`;
      }
    }

    // ── Module 5.5 : plan d'action du tenant démo ───────────────────────
    // Origines variées (risque, manuel), dont une échéance passée qui
    // illustre le statut « en retard » CALCULÉ (RM §5.5).
    const actions = [
      {
        id: DEMO.actionMessagerie,
        title: 'Durcir la messagerie contre les pièces jointes piégées',
        description:
          'Bac à sable des pièces jointes, blocage des macros, sensibilisation ciblée des services logistiques.',
        originType: 'risk',
        originId: DEMO.riskRancongiciel,
        owner: DEMO.userClaire,
        dueDate: '2026-09-30',
        priority: 'p1',
        status: 'en_cours',
        links: [DEMO.controlMfa, DEMO.controlSauvegardes],
        subtasks: [
          ['Activer le bac à sable des pièces jointes', true],
          ['Bloquer l’exécution des macros Office', false],
          ['Former les équipes préparation de commandes', false],
        ] as const,
        comment: 'Bac à sable activé en préproduction, bascule production prévue la semaine prochaine.',
      },
      {
        id: DEMO.actionRevueAcces,
        title: 'Mettre en place la revue trimestrielle des accès',
        description: 'Revue des comptes à privilèges et des accès prestataires, PV conservé.',
        originType: 'manual',
        originId: null,
        owner: DEMO.userCamille,
        dueDate: '2026-06-30', // passée → « en retard » calculé
        priority: 'p2',
        status: 'planifie',
        links: [DEMO.controlMfa],
        subtasks: [] as const,
        comment: null,
      },
      {
        id: DEMO.actionPcaEntrepot,
        title: 'Documenter le plan de continuité de l’entrepôt régional',
        description: 'Procédure de repli et de reprise en cas de sinistre à Meyzieu.',
        originType: 'risk',
        originId: DEMO.riskEntrepot,
        owner: DEMO.userAntoine,
        dueDate: '2027-02-28',
        priority: 'p3',
        status: 'planifie',
        links: [] as const,
        subtasks: [] as const,
        comment: null,
      },
    ] as const;

    for (const a of actions) {
      await sql`
        INSERT INTO actions
          (id, tenant_id, title, description, origin_type, origin_id, owner_user_id, due_date, priority, status)
        VALUES
          (${a.id}, ${DEMO.tenantId}, ${a.title}, ${a.description}, ${a.originType}, ${a.originId},
           ${a.owner}, ${a.dueDate}, ${a.priority}, ${a.status})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
          due_date = EXCLUDED.due_date, priority = EXCLUDED.priority, status = EXCLUDED.status`;

      for (const controlId of a.links) {
        await sql`
          INSERT INTO action_links (action_id, target_type, target_id, tenant_id)
          VALUES (${a.id}, 'control', ${controlId}, ${DEMO.tenantId})
          ON CONFLICT DO NOTHING`;
      }

      let order = 0;
      for (const [title, done] of a.subtasks) {
        await sql`
          INSERT INTO action_subtasks (tenant_id, action_id, title, done, sort_order)
          SELECT ${DEMO.tenantId}, ${a.id}, ${title}, ${done}, ${order}
          WHERE NOT EXISTS (
            SELECT 1 FROM action_subtasks WHERE action_id = ${a.id} AND title = ${title}
          )`;
        order += 1;
      }

      if (a.comment) {
        await sql`
          INSERT INTO action_comments (tenant_id, action_id, author_user_id, body)
          SELECT ${DEMO.tenantId}, ${a.id}, ${a.owner}, ${a.comment}
          WHERE NOT EXISTS (SELECT 1 FROM action_comments WHERE action_id = ${a.id})`;
      }
    }

    // ── Module 5.6 : documents du tenant démo ───────────────────────────
    // Une PSSI publiée (revue à venir) et une procédure dont la revue est
    // dépassée (alerte) avec une nouvelle version en brouillon. Les exigences
    // couvertes alimenteront la SoA (RM §5.6).
    const documents = [
      {
        id: DEMO.docPssi,
        type: 'pssi',
        title: 'Politique de sécurité du système d’information (PSSI)',
        owner: DEMO.userClaire,
        reviewDue: '2027-03-31',
        req: 'A.5.1',
        versions: [{ semver: '1.0', status: 'publie', file: 'PSSI Meridiane v1.0' }] as const,
      },
      {
        id: DEMO.docProcSauvegarde,
        type: 'procedure',
        title: 'Procédure de sauvegarde et de restauration',
        owner: DEMO.userAntoine,
        reviewDue: '2026-05-31', // dépassée → alerte de revue
        req: 'A.8.13',
        versions: [
          { semver: '1.0', status: 'publie', file: 'Procédure sauvegarde v1.0' },
          { semver: '1.1', status: 'brouillon', file: 'Procédure sauvegarde v1.1 (révision)' },
        ] as const,
      },
    ] as const;

    for (const doc of documents) {
      await sql`
        INSERT INTO documents (id, tenant_id, type, title, scope_id, owner_user_id, review_due)
        VALUES (${doc.id}, ${DEMO.tenantId}, ${doc.type}, ${doc.title}, ${DEMO.scopeSmsi}, ${doc.owner}, ${doc.reviewDue})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, review_due = EXCLUDED.review_due`;

      for (const v of doc.versions) {
        await sql`
          INSERT INTO document_versions
            (tenant_id, document_id, semver, file_name, content, status, created_by, published_at)
          SELECT ${DEMO.tenantId}, ${doc.id}, ${v.semver}, ${`${v.file}.txt`},
                 ${Buffer.from(v.file)}, ${v.status}, ${doc.owner},
                 ${v.status === 'publie' ? sql`now()` : sql`NULL`}
          WHERE NOT EXISTS (
            SELECT 1 FROM document_versions WHERE document_id = ${doc.id} AND semver = ${v.semver}
          )`;
      }

      await sql`
        INSERT INTO document_requirements (document_id, requirement_id, tenant_id)
        SELECT ${doc.id}, r.id, ${DEMO.tenantId}
        FROM requirements r JOIN frameworks f ON f.id = r.framework_id
        WHERE f.tenant_id IS NULL AND f.code = 'iso27001' AND r.ref_id = ${doc.req}
        ON CONFLICT DO NOTHING`;
    }

    // ── Module 5.7 : coffre de preuves du tenant démo ───────────────────
    // Preuves empreintées (SHA-256), liées à des contrôles MUTUALISÉS — elles
    // couvrent donc plusieurs référentiels (CA §5.7). Fraîcheurs variées :
    // une preuve expirée (attestation MFA) signale sans changer de statut.
    const evidences = [
      {
        id: DEMO.evidenceRestauration,
        title: 'PV de test de restauration — T2 2026',
        type: 'pv',
        content: 'PV restauration T2 2026 — sauvegardes vérifiées, RTO respecté.',
        collectedAt: '2026-06-20',
        validUntil: '2026-09-20',
        recurrence: 'trimestrielle',
        collector: DEMO.userAntoine,
        control: DEMO.controlSauvegardes,
      },
      {
        id: DEMO.evidenceMfa,
        title: 'Attestation d’activation MFA — prestataires',
        type: 'attestation',
        content: 'Attestation MFA prestataires — capture console IdP.',
        collectedAt: '2025-11-15',
        validUntil: '2026-05-15', // expirée → signalement
        recurrence: 'semestrielle',
        collector: DEMO.userClaire,
        control: DEMO.controlMfa,
      },
      {
        id: DEMO.evidenceInventaire,
        title: 'Export de l’inventaire des actifs et services',
        type: 'export',
        content: 'Export CSV inventaire — 148 actifs recensés.',
        collectedAt: '2026-07-01',
        validUntil: '2027-07-01',
        recurrence: 'annuelle',
        collector: DEMO.userClaire,
        control: DEMO.controlInventaire,
      },
    ] as const;

    for (const ev of evidences) {
      const buf = Buffer.from(ev.content);
      const sha = createHash('sha256').update(buf).digest('hex');
      await sql`
        INSERT INTO evidences
          (id, tenant_id, title, type, file_name, content, sha256, collected_at, valid_until, recurrence, collector_user_id)
        VALUES
          (${ev.id}, ${DEMO.tenantId}, ${ev.title}, ${ev.type}, ${`${ev.title}.txt`}, ${buf}, ${sha},
           ${ev.collectedAt}, ${ev.validUntil}, ${ev.recurrence}, ${ev.collector})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, valid_until = EXCLUDED.valid_until`;
      await sql`
        INSERT INTO evidence_links (evidence_id, target_type, target_id, tenant_id)
        VALUES (${ev.id}, 'control', ${ev.control}, ${DEMO.tenantId})
        ON CONFLICT DO NOTHING`;
    }

    // ── Module 6.3 : actifs du tenant démo ──────────────────────────────
    // Inventaire minimal (matériel/logiciel/données/flux) coté DICP, quelques
    // liens actif↔risque.
    const assets = [
      {
        id: DEMO.assetWms,
        name: 'Serveurs applicatifs — plateforme logistique',
        category: 'materiel',
        description: 'Cluster hébergeant le WMS et la facturation, site de Corbas.',
        d: 4, i: 3, c: 3, p: 2,
        risk: DEMO.riskRancongiciel,
      },
      {
        id: DEMO.assetServeurs,
        name: 'WMS — logiciel de gestion d’entrepôt',
        category: 'logiciel',
        description: 'Application métier critique de préparation et d’expédition.',
        d: 4, i: 3, c: 2, p: 2,
        risk: DEMO.riskRancongiciel,
      },
      {
        id: DEMO.assetDonneesClients,
        name: 'Base de données clients et commandes',
        category: 'donnees',
        description: 'Données à caractère personnel (clients, destinataires).',
        d: 3, i: 4, c: 4, p: 3,
        risk: DEMO.riskCompteDistant,
      },
      {
        id: DEMO.assetFluxEdi,
        name: 'Flux EDI avec les transporteurs',
        category: 'flux',
        description: 'Échanges de données informatisés commandes/livraisons.',
        d: 3, i: 3, c: 2, p: 2,
        risk: null,
      },
    ] as const;

    for (const a of assets) {
      await sql`
        INSERT INTO assets (id, tenant_id, name, category, description, scope_id, dicp_d, dicp_i, dicp_c, dicp_p)
        VALUES (${a.id}, ${DEMO.tenantId}, ${a.name}, ${a.category}, ${a.description}, ${DEMO.scopeSmsi},
                ${a.d}, ${a.i}, ${a.c}, ${a.p})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
          dicp_d = EXCLUDED.dicp_d, dicp_i = EXCLUDED.dicp_i, dicp_c = EXCLUDED.dicp_c, dicp_p = EXCLUDED.dicp_p`;
      if (a.risk) {
        await sql`
          INSERT INTO asset_risks (asset_id, risk_id, tenant_id)
          VALUES (${a.id}, ${a.risk}, ${DEMO.tenantId})
          ON CONFLICT DO NOTHING`;
      }
    }

    // ── Module 6.1 : incident de démonstration (chronologie NIS 2) ──────
    // Hameçonnage qualifié « important » avec volet RGPD : l'échéancier est
    // posé à la qualification (alerte 24 h transmise, notification 72 h à
    // venir, rapport J+30, CNIL 72 h).
    const qualifiedAt = '2026-07-17 14:00:00+00';
    await sql`
      INSERT INTO incidents
        (id, tenant_id, title, description, severity, status, opened_at, qualified_at,
         nis2_important, nis2_criteria, gdpr_breach, owner_user_id)
      VALUES
        (${DEMO.incidentPhishing}, ${DEMO.tenantId},
         'Hameçonnage ciblé — Direction financière',
         'Campagne de phishing visant des comptes à privilèges de la direction financière.',
         'majeur', 'qualifie', '2026-07-17 09:30:00+00', ${qualifiedAt}, true,
         ${JSON.stringify({ perturbation_operationnelle: true, pertes_financieres: true, impact_tiers: false })}::jsonb,
         true, ${DEMO.userClaire})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status,
        qualified_at = EXCLUDED.qualified_at, nis2_important = EXCLUDED.nis2_important`;

    const events = [
      ['2026-07-17 09:30:00+00', 'detection', 'Détection : signalement d’un e-mail suspect par un utilisateur.', DEMO.userClaire],
      ['2026-07-17 10:15:00+00', 'mesure', 'Mesure conservatoire : réinitialisation des mots de passe des comptes exposés.', DEMO.userClaire],
      ['2026-07-17 14:00:00+00', 'qualification', 'Qualifié « incident important » NIS 2 — échéancier réglementaire armé.', DEMO.userClaire],
    ] as const;
    for (const [at, kind, desc, author] of events) {
      await sql`
        INSERT INTO incident_events (tenant_id, incident_id, at, kind, description, author_user_id)
        SELECT ${DEMO.tenantId}, ${DEMO.incidentPhishing}, ${at}, ${kind}, ${desc}, ${author}
        WHERE NOT EXISTS (
          SELECT 1 FROM incident_events WHERE incident_id = ${DEMO.incidentPhishing} AND kind = ${kind} AND at = ${at}
        )`;
    }

    const notifs = [
      ['alerte_24h', '24 hours', '2026-07-18 10:00:00+00'],
      ['notification_72h', '72 hours', null],
      ['rapport_30j', '30 days', null],
      ['cnil_72h', '72 hours', null],
    ] as const;
    for (const [kind, interval, sentAt] of notifs) {
      await sql`
        INSERT INTO incident_notifications (tenant_id, incident_id, kind, due_at, sent_at)
        VALUES (${DEMO.tenantId}, ${DEMO.incidentPhishing}, ${kind},
                ${qualifiedAt}::timestamptz + ${interval}::interval, ${sentAt})
        ON CONFLICT ON CONSTRAINT incident_notifications_unique DO NOTHING`;
    }

    // ── Module 7.2 : non-conformité de démonstration (pack QMS) ─────────
    // NC interne en traitement, avec action immédiate, analyse 5 pourquoi et
    // une action corrective portée par le moteur commun (origin_type = 'nc').
    await sql`
      INSERT INTO nonconformities
        (id, tenant_id, title, description, source, process_ref, gravity, cost_estimate,
         immediate_action, root_cause, status, detected_by, owner_user_id)
      VALUES
        (${DEMO.ncEtiquetage}, ${DEMO.tenantId},
         'Écarts d’étiquetage sur les colis — agence de Vitrolles',
         'Étiquettes transporteur erronées détectées lors d’un audit interne, retours clients en hausse.',
         'interne', 'Réalisation · Préparation & expédition', 'majeure', 3200.00,
         'Blocage des expéditions de l’agence, revérification manuelle du lot en cours.',
         ${JSON.stringify({
           probleme: 'Étiquettes transporteur erronées',
           pourquoi: [
             'Le poste d’étiquetage imprime un mauvais gabarit.',
             'Le gabarit par défaut n’a pas été mis à jour après changement de transporteur.',
             'La procédure de changement de transporteur n’intègre pas la mise à jour des gabarits.',
             'Aucun point de contrôle qualité en fin de configuration.',
           ],
           cause_racine: 'Procédure de changement de transporteur incomplète (pas de vérification des gabarits).',
         })}::jsonb,
         'en_traitement', ${DEMO.userCamille}, ${DEMO.userCamille})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status,
        immediate_action = EXCLUDED.immediate_action, root_cause = EXCLUDED.root_cause`;

    await sql`
      INSERT INTO actions
        (id, tenant_id, title, description, origin_type, origin_id, owner_user_id, priority, status)
      VALUES
        (${DEMO.actionNcEtiquetage}, ${DEMO.tenantId},
         'Compléter la procédure de changement de transporteur (contrôle des gabarits)',
         'Ajouter un point de contrôle qualité et la mise à jour des gabarits d’étiquettes.',
         'nc', ${DEMO.ncEtiquetage}, ${DEMO.userCamille}, 'p2', 'en_cours')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status`;

    // ── Module 5.10 : fournisseurs du tenant démo ───────────────────────
    const suppliers = [
      [DEMO.supplierHebergeur, 'Hébergeur cloud souverain', 't1', 'Hébergement du SI et sauvegardes',
       ['Données clients', 'Données RH'], 'conforme', DEMO.userClaire, '2027-01-31'],
      [DEMO.supplierInfogerance, 'Prestataire d’infogérance', 't1', 'Administration SI, MFA, supervision',
       ['Accès à privilèges'], 'conforme', DEMO.userClaire, '2026-11-30'],
      [DEMO.supplierTransporteur, 'Transporteur régional', 't2', 'Livraison du dernier kilomètre',
       ['Coordonnées des destinataires'], 'en_cours', DEMO.userAntoine, '2027-03-15'],
    ] as const;
    for (const [id, name, tier, services, cats, contract, owner, review] of suppliers) {
      await sql`
        INSERT INTO suppliers (id, tenant_id, name, tier, services, data_categories, contract_status, owner_user_id, next_review)
        VALUES (${id}, ${DEMO.tenantId}, ${name}, ${tier}, ${services}, ${sql.array(cats as unknown as string[])}::text[],
                ${contract}, ${owner}, ${review})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier,
          contract_status = EXCLUDED.contract_status`;
    }

    // Évaluations : l'hébergeur est à jour et satisfaisant ; l'infogérant,
    // évalué il y a plus d'un an, n'engage pas de notification sous 24 h —
    // point bloquant pour un fournisseur critique, action corrective ouverte.
    const yes = (overrides: SupplierAnswers): SupplierAnswers => ({
      gouvernance: 'oui', mfa: 'oui', chiffrement: 'oui', localisation: 'oui', incidents: 'oui', continuite: 'oui',
      vulnerabilites: 'oui', sous_traitance: 'oui', rgpd: 'oui', reversibilite: 'oui', audit: 'oui', ...overrides,
    });
    const evaluations = [
      [DEMO.supplierEvalHebergeur, DEMO.supplierHebergeur, 't1', '2026-03-12', yes({ sous_traitance: 'partiel', reversibilite: 'partiel' }),
       'Qualification SecNumCloud vérifiée. Liste des sous-traitants ultérieurs à compléter au renouvellement.'],
      [DEMO.supplierEvalInfogerance, DEMO.supplierInfogerance, 't1', '2025-06-20', yes({ incidents: 'non', vulnerabilites: 'partiel', audit: 'non' }),
       'Pas d’engagement de délai de notification des incidents dans le contrat actuel.'],
    ] as const;
    for (const [id, supplierId, tier, on, answers, notes] of evaluations) {
      const result = assessSupplier(answers, tier);
      if (!result.ok) throw new Error('Évaluation de démonstration incomplète');
      await sql`
        INSERT INTO supplier_assessments (id, tenant_id, supplier_id, assessed_on, assessor_user_id, answers, score, rating, notes)
        VALUES (${id}, ${DEMO.tenantId}, ${supplierId}, ${on}, ${DEMO.userClaire}, ${sql.json(answers)},
                ${result.score}, ${result.rating}, ${notes})
        ON CONFLICT (id) DO NOTHING`;
    }

    const attestations = [
      [DEMO.attestSecNumCloud, DEMO.supplierHebergeur, 'secnumcloud', 'Offre IaaS qualifiée', '2024-06-30', '2027-06-30'],
      [DEMO.attestIsoHebergeur, DEMO.supplierHebergeur, 'iso27001', 'Périmètre : centres de données France', '2023-10-28', '2026-10-28'],
      [DEMO.attestDpaHebergeur, DEMO.supplierHebergeur, 'dpa', 'Annexe 3 du contrat cadre', '2024-07-01', null],
      [DEMO.attestIsoInfogerance, DEMO.supplierInfogerance, 'iso27001', 'Périmètre : centre de services Lyon', '2023-09-15', '2026-09-15'],
      [DEMO.attestAssuranceTransporteur, DEMO.supplierTransporteur, 'assurance', 'Responsabilité civile professionnelle', '2026-02-01', '2027-01-31'],
    ] as const;
    for (const [id, supplierId, kind, label, issued, until] of attestations) {
      await sql`
        INSERT INTO supplier_attestations (id, tenant_id, supplier_id, kind, label, issued_on, valid_until, created_by)
        VALUES (${id}, ${DEMO.tenantId}, ${supplierId}, ${kind}, ${label}, ${issued}, ${until}, ${DEMO.userClaire})
        ON CONFLICT (id) DO NOTHING`;
    }

    await sql`
      INSERT INTO actions (id, tenant_id, title, description, origin_type, origin_id, owner_user_id, due_date, priority, status)
      VALUES (${DEMO.actionSupplierIncidents}, ${DEMO.tenantId},
              ${`Prestataire d’infogérance — ${supplierQuestion('incidents')!.correctiveAction}`},
              'Avenant à négocier avant le renouvellement ; NIS 2 impose l’alerte précoce sous 24 h.',
              'supplier', ${DEMO.supplierInfogerance}, ${DEMO.userClaire}, '2026-11-15', 'p1', 'en_cours')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status`;

    // Portail fournisseur : le transporteur, jamais évalué, a répondu
    // lui-même au questionnaire (réponse à examiner) ; l'infogérant, à
    // réévaluer, a reçu sa demande. Les jetons de démonstration sont
    // aléatoires et jamais conservés : « Nouveau lien » en émet un.
    const portalToken = () => createHash('sha256').update(randomBytes(32).toString('base64url'), 'utf8').digest('hex');
    await sql`
      INSERT INTO supplier_requests (id, tenant_id, supplier_id, contact_name, contact_email, message, token_hash, status,
                                     due_on, expires_on, answers, comments, requested_by, submitted_at, created_at)
      VALUES (${DEMO.supplierRequestTransporteur}, ${DEMO.tenantId}, ${DEMO.supplierTransporteur}, 'Service qualité et sécurité',
              'qualite@transporteur-regional.example',
              'Premier questionnaire de sécurité dans le cadre du contrat de livraison du dernier kilomètre.',
              ${portalToken()}, 'soumise', '2026-10-10', '2026-10-24',
              ${sql.json({
                gouvernance: 'partiel', mfa: 'partiel', chiffrement: 'oui', localisation: 'oui', incidents: 'non',
                continuite: 'partiel', vulnerabilites: 'partiel', sous_traitance: 'oui', rgpd: 'oui', reversibilite: 'oui', audit: 'non',
              })},
              ${sql.json({
                gouvernance: 'Charte informatique signée par les salariés ; pas de responsable sécurité nommé, le directeur administratif assure le rôle.',
                mfa: 'Double authentification sur le portail de suivi des tournées ; pas encore sur la messagerie.',
                incidents: 'Aucun délai prévu au contrat. Nous pouvons nous engager sur 48 heures.',
                continuite: 'Sauvegarde quotidienne du logiciel de tournées ; restauration jamais testée.',
                audit: 'Pas d’audit externe à ce jour.',
              })},
              ${DEMO.userAntoine}, '2026-10-02 15:42:00+02', '2026-09-22 09:10:00+02')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO supplier_requests (id, tenant_id, supplier_id, contact_name, contact_email, message, token_hash, status,
                                     due_on, expires_on, requested_by, created_at)
      VALUES (${DEMO.supplierRequestInfogerance}, ${DEMO.tenantId}, ${DEMO.supplierInfogerance}, 'Responsable de la sécurité',
              'securite@infogerance.example',
              'Réévaluation annuelle avant le renouvellement du contrat, en particulier sur la notification des incidents.',
              ${portalToken()}, 'envoyee', '2026-10-30', '2026-11-13', ${DEMO.userClaire}, '2026-10-01 11:00:00+02')
      ON CONFLICT (id) DO NOTHING`;

    // ── Module 6.4 : registre des obligations ───────────────────────────
    // Meridiane Logistics est une entité importante NIS 2 (services
    // d'expédition, entreprise moyenne) : catalogue complet, avancement réaliste.
    const obligationState: Record<string, [string, string, string | null, string | null]> = {
      nis2_enregistrement: ['en_cours', DEMO.userClaire, '2026-11-30', null],
      nis2_gouvernance: ['en_cours', DEMO.userAntoine, '2026-12-15', null],
      nis2_mesures: ['en_cours', DEMO.userClaire, null, null],
      nis2_chaine: ['en_cours', DEMO.userClaire, '2027-03-31', null],
      nis2_notification: ['conforme', DEMO.userClaire, null, null],
      nis2_controle: ['a_evaluer', DEMO.userClaire, null, null],
      rgpd_registre: ['en_cours', DEMO.userClaire, '2026-10-30', null],
      rgpd_information: ['conforme', DEMO.userCamille, null, null],
      rgpd_droits: ['conforme', DEMO.userCamille, null, null],
      rgpd_sous_traitants: ['en_cours', DEMO.userClaire, '2026-12-31', null],
      rgpd_violations: ['conforme', DEMO.userClaire, null, null],
      rgpd_dpo: ['non_applicable', DEMO.userAntoine, null,
        'Analyse du 12/02/2026 : ni suivi régulier et systématique à grande échelle, ni données sensibles à grande échelle. Un référent RGPD interne est désigné.'],
    };
    for (const t of OBLIGATION_CATALOG) {
      const [status, owner, due, justification] = obligationState[t.key] ?? ['a_evaluer', DEMO.userClaire, null, null];
      await sql`
        INSERT INTO obligations (tenant_id, entity_id, regime, catalog_key, title, source, owner_user_id, status, due_date, justification)
        VALUES (${DEMO.tenantId}, ${DEMO.entityId}, ${t.regime}, ${t.key}, ${t.title}, ${t.source}, ${owner}, ${status}, ${due}, ${justification})
        ON CONFLICT (tenant_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), catalog_key)
          WHERE catalog_key IS NOT NULL DO NOTHING`;
    }
    await sql`
      INSERT INTO obligations (id, tenant_id, entity_id, regime, title, source, description, owner_user_id, status, due_date)
      VALUES (${DEMO.obligationContratClient}, ${DEMO.tenantId}, ${DEMO.entityId}, 'contractuel',
              'Remettre chaque année au client distributeur le compte rendu du test de restauration',
              'Contrat logistique cadre, annexe sécurité, art. 7',
              'Le client exige la preuve d’une restauration réussie des données de traçabilité.',
              ${DEMO.userClaire}, 'en_cours', '2027-01-31')
      ON CONFLICT (id) DO NOTHING`;

    // ── Registre des activités de traitement (RGPD art. 30) ─────────────
    // Cinq fiches ; la vidéosurveillance et les réclamations sont encore
    // incomplètes, le transporteur n'a pas d'accord de traitement enregistré.
    const processing = [
      {
        id: DEMO.processingRh, name: 'Gestion du personnel et paie', owner: DEMO.userAntoine, reviewed: '2026-02-12',
        purpose: 'Recrutement, gestion administrative des salariés, paie et déclarations sociales.',
        basis: 'obligation_legale', basisDetail: null,
        subjects: ['Salariés', 'Candidats'], categories: ['Identité', 'Coordonnées', 'Données bancaires', 'NIR', 'Rémunération'],
        sensitive: false, recipients: 'Service RH, cabinet de paie, organismes sociaux', retention: 'Durée du contrat puis 5 ans ; bulletins de paie selon les obligations légales',
        security: 'Accès restreint au service RH, MFA, chiffrement des sauvegardes', processors: [DEMO.supplierHebergeur],
      },
      {
        id: DEMO.processingLivraisons, name: 'Suivi des livraisons et preuve de remise', owner: DEMO.userCamille, reviewed: '2025-11-14',
        purpose: 'Planifier les tournées, informer les destinataires et prouver la remise des colis.',
        basis: 'contrat', basisDetail: null,
        subjects: ['Destinataires des colis'], categories: ['Identité', 'Adresse de livraison', 'Téléphone', 'Signature'],
        sensitive: false, recipients: 'Clients donneurs d’ordre, transporteurs partenaires', retention: '3 ans après la livraison',
        security: 'Accès nominatifs au WMS, journalisation, chiffrement au repos', processors: [DEMO.supplierHebergeur, DEMO.supplierTransporteur],
      },
      {
        id: DEMO.processingGeoloc, name: 'Géolocalisation des véhicules', owner: DEMO.userClaire, reviewed: '2026-03-02',
        purpose: 'Optimiser les tournées et répondre aux demandes de suivi des clients.',
        basis: 'interet_legitime', basisDetail: 'Organisation des tournées et information des clients sur l’heure de passage ; pas de suivi en dehors du temps de travail.',
        subjects: ['Conducteurs'], categories: ['Position du véhicule', 'Horaires de tournée'],
        sensitive: false, recipients: 'Exploitation transport', retention: '2 mois pour les positions ; 1 an pour les rapports agrégés',
        security: 'Désactivation hors temps de travail, accès limité à l’exploitation', processors: [DEMO.supplierHebergeur],
      },
      {
        id: DEMO.processingVideo, name: 'Vidéosurveillance des entrepôts', owner: DEMO.userClaire, reviewed: null,
        purpose: 'Sécurité des biens et des personnes sur les quais et dans les entrepôts.',
        basis: 'interet_legitime', basisDetail: 'Prévention des vols et des atteintes aux personnes.',
        subjects: ['Salariés', 'Visiteurs', 'Chauffeurs externes'], categories: ['Images'],
        sensitive: false, recipients: 'Responsable sûreté ; forces de l’ordre sur réquisition', retention: '30 jours',
        security: null, processors: [],
      },
      {
        id: DEMO.processingReclamations, name: 'Gestion des réclamations clients', owner: DEMO.userCamille, reviewed: null,
        purpose: 'Traiter les réclamations et litiges de livraison.',
        basis: 'contrat', basisDetail: null,
        subjects: ['Clients', 'Destinataires des colis'], categories: ['Identité', 'Coordonnées', 'Description du litige'],
        sensitive: false, recipients: null, retention: null,
        security: 'Accès limité au service client', processors: [DEMO.supplierInfogerance],
      },
    ] as const;
    for (const t of processing) {
      await sql`
        INSERT INTO processing_activities (id, tenant_id, entity_id, name, purpose, legal_basis, legal_basis_detail,
          data_subjects, data_categories, sensitive_data, recipients, retention, security_measures, owner_user_id, last_reviewed_on)
        VALUES (${t.id}, ${DEMO.tenantId}, ${DEMO.entityId}, ${t.name}, ${t.purpose}, ${t.basis}, ${t.basisDetail},
          ${sql.array(t.subjects as unknown as string[])}::text[], ${sql.array(t.categories as unknown as string[])}::text[],
          ${t.sensitive}, ${t.recipients}, ${t.retention}, ${t.security}, ${t.owner}, ${t.reviewed})
        ON CONFLICT (id) DO NOTHING`;
      for (const supplierId of t.processors) {
        await sql`
          INSERT INTO processing_processors (tenant_id, processing_id, supplier_id)
          VALUES (${DEMO.tenantId}, ${t.id}, ${supplierId})
          ON CONFLICT DO NOTHING`;
      }
    }

    // ── Module 5.8 : audit interne de démonstration ─────────────────────
    // Piloté par Antoine (direction), pas par Claire (RSSI, propriétaire du
    // SMSI) : séparation des tâches respectée.
    await sql`
      INSERT INTO audits (id, tenant_id, title, framework_id, scope_id, status, planned_at, lead_auditor)
      SELECT ${DEMO.auditSmsi}, ${DEMO.tenantId}, 'Audit interne SMSI — S2 2026',
             (SELECT id FROM frameworks WHERE tenant_id IS NULL AND code = 'iso27001'),
             ${DEMO.scopeSmsi}, 'en_cours', '2026-07-10', ${DEMO.userAntoine}
      WHERE NOT EXISTS (SELECT 1 FROM audits WHERE id = ${DEMO.auditSmsi})`;
    const findings = [
      ['A.8.5', 'conforme', 'MFA effectivement déployée sur les accès distants ; preuves à jour.'],
      ['A.5.9', 'observation', 'Inventaire des actifs complet mais fréquence de revue à formaliser.'],
      ['A.8.13', 'nc_mineure', 'Un test de restauration trimestriel manquant sur l’agence sud.'],
    ] as const;
    for (const [ref, type, desc] of findings) {
      await sql`
        INSERT INTO audit_findings (tenant_id, audit_id, requirement_ref, type, description)
        SELECT ${DEMO.tenantId}, ${DEMO.auditSmsi}, ${ref}, ${type}, ${desc}
        WHERE NOT EXISTS (SELECT 1 FROM audit_findings WHERE audit_id = ${DEMO.auditSmsi} AND requirement_ref = ${ref})`;
    }

    // ── Module 5.9 : revue de direction de démonstration ────────────────
    // Une seule revue couvre SMSI + QMS (clause 9.3). Séance tenue au T1,
    // trois participants, décisions dont une déjà convertie en action tracée.
    const reviewActionId = 'd0000000-0000-4000-8000-0000000000e2';
    await sql`
      INSERT INTO management_reviews (id, tenant_id, title, scope_label, status, held_at, next_review_at)
      SELECT ${DEMO.reviewS1}, ${DEMO.tenantId}, 'Revue de direction — S1 2026', 'SMSI + QMS',
             'tenue', '2026-01-15', '2026-07-24'
      WHERE NOT EXISTS (SELECT 1 FROM management_reviews WHERE id = ${DEMO.reviewS1})`;
    for (const uid of [DEMO.userClaire, DEMO.userAntoine, DEMO.userCamille]) {
      await sql`
        INSERT INTO review_participants (tenant_id, review_id, user_id)
        VALUES (${DEMO.tenantId}, ${DEMO.reviewS1}, ${uid})
        ON CONFLICT (review_id, user_id) DO NOTHING`;
    }
    await sql`
      INSERT INTO actions (id, tenant_id, title, origin_type, origin_id, owner_user_id, priority, status)
      VALUES (${reviewActionId}, ${DEMO.tenantId},
              'Valider la Déclaration d’applicabilité v3 (27001) et le plan d’action du T3',
              'review', ${DEMO.reviewS1}, ${DEMO.userClaire}, 'p1', 'en_cours')
      ON CONFLICT (id) DO NOTHING`;
    const decisions = [
      ['Valider la Déclaration d’applicabilité v3 (27001) et le plan d’action du T3.', reviewActionId],
      ['Renforcer le budget du déploiement MFA — priorité P1 sur les accès distants.', null],
      ['Acter l’acceptation formelle du risque de dépendance SaaS jusqu’à la prochaine revue.', null],
    ] as const;
    for (const [body, actionId] of decisions) {
      await sql`
        INSERT INTO review_decisions (tenant_id, review_id, body, action_id)
        SELECT ${DEMO.tenantId}, ${DEMO.reviewS1}, ${body}, ${actionId}
        WHERE NOT EXISTS (SELECT 1 FROM review_decisions WHERE review_id = ${DEMO.reviewS1} AND body = ${body})`;
    }

    // ── Module 7.1 : cartographie des processus (pack QMS) ──────────────
    // Familles Management / Réalisation / Support. Deux processus détaillés
    // (Transport, Préparation) avec SIPOC, indicateurs, exigences dont des
    // contrôles 27001 mutualisés (fil orange), et risques rattachés au
    // registre unique. Pilotes = utilisateurs réels du tenant démo.
    const emptySipoc = { suppliers: [], inputs: [], activities: [], outputs: [], clients: [] };
    const processSeed: {
      id: string | null;
      family: string;
      name: string;
      pilot: string | null;
      version: string;
      workflow: string;
      sipoc: unknown;
      kpis: unknown;
      exig: unknown;
      interactions: unknown;
    }[] = [
      { id: null, family: 'management', name: 'Pilotage stratégique', pilot: DEMO.userAntoine, version: 'v1.2', workflow: 'publie', sipoc: emptySipoc, kpis: [{ label: 'Objectifs qualité atteints', actual: '8/10', target: '10/10', tone: 'warn' }], exig: [{ framework: '9001', code: '§5.1', mutualized: false }, { framework: '9001', code: '§6.2', mutualized: false }], interactions: [{ dir: '↔', name: 'Amélioration continue' }] },
      { id: null, family: 'management', name: 'Amélioration continue', pilot: DEMO.userCamille, version: 'v1.1', workflow: 'publie', sipoc: emptySipoc, kpis: [{ label: 'Actions correctives soldées', actual: '92 %', target: '90 %', tone: 'ok' }], exig: [{ framework: '9001', code: '§10.2', mutualized: false }, { framework: '27001', code: 'A.5.27', mutualized: true }], interactions: [{ dir: '↔', name: 'Pilotage stratégique' }] },
      { id: null, family: 'realisation', name: 'Prise de commande', pilot: DEMO.userCamille, version: 'v1.3', workflow: 'publie', sipoc: emptySipoc, kpis: [{ label: 'Commandes conformes', actual: '99,1 %', target: '99 %', tone: 'ok' }], exig: [{ framework: '9001', code: '§8.2', mutualized: false }], interactions: [{ dir: '→', name: 'Préparation logistique' }] },
      {
        id: DEMO.processPrepa, family: 'realisation', name: 'Préparation logistique', pilot: DEMO.userCamille, version: 'v1.4', workflow: 'approuve',
        sipoc: { suppliers: ['Prise de commande', 'Entrepôt'], inputs: ['Commande validée', 'Stock'], activities: ['Picking', 'Emballage', 'Contrôle'], outputs: ['Colis préparé', 'Étiquette'], clients: ['Transport & livraison'] },
        kpis: [{ label: 'Taux de préparation juste', actual: '98,1 %', target: '99 %', tone: 'warn' }, { label: 'Délai de préparation', actual: '1,2 j', target: '< 1,5 j', tone: 'ok' }],
        exig: [{ framework: '9001', code: '§8.5', mutualized: false }, { framework: '27001', code: 'A.7.1', mutualized: true }],
        interactions: [{ dir: '←', name: 'Prise de commande' }, { dir: '→', name: 'Transport & livraison' }],
      },
      {
        id: DEMO.processTransport, family: 'realisation', name: 'Transport & livraison', pilot: DEMO.userAntoine, version: 'v2.1', workflow: 'publie',
        sipoc: { suppliers: ['Préparation logistique', 'Transporteurs'], inputs: ['Colis préparés', 'Bon de transport'], activities: ['Affrètement', 'Suivi de tournée', 'Preuve de livraison'], outputs: ['Colis livré', 'POD signée'], clients: ['Client final', 'SAV'] },
        kpis: [{ label: 'Taux de service', actual: '96,2 %', target: '98 %', tone: 'warn' }, { label: 'Livraison à l’heure', actual: '94 %', target: '95 %', tone: 'warn' }, { label: 'Taux de casse', actual: '0,8 %', target: '< 1 %', tone: 'ok' }],
        exig: [{ framework: '9001', code: '§8.5', mutualized: false }, { framework: '9001', code: '§8.6', mutualized: false }, { framework: '27001', code: 'A.8.16', mutualized: true }],
        interactions: [{ dir: '←', name: 'Préparation logistique' }, { dir: '→', name: 'Service après-vente' }, { dir: '↔', name: 'Achats & fournisseurs' }],
      },
      { id: null, family: 'realisation', name: 'Service après-vente', pilot: DEMO.userCamille, version: 'v1.0', workflow: 'relecture', sipoc: emptySipoc, kpis: [{ label: 'Réclamations traitées < 48 h', actual: '81 %', target: '90 %', tone: 'danger' }], exig: [{ framework: '9001', code: '§8.7', mutualized: false }], interactions: [{ dir: '←', name: 'Transport & livraison' }] },
      { id: null, family: 'support', name: 'Ressources humaines', pilot: DEMO.userAntoine, version: 'v1.1', workflow: 'publie', sipoc: emptySipoc, kpis: [{ label: 'Taux de sensibilisation', actual: '78 %', target: '90 %', tone: 'warn' }], exig: [{ framework: '9001', code: '§7.2', mutualized: false }, { framework: '27001', code: 'A.6.3', mutualized: true }], interactions: [{ dir: '↔', name: 'Pilotage stratégique' }] },
      { id: null, family: 'support', name: 'Systèmes d’information', pilot: DEMO.userClaire, version: 'v1.5', workflow: 'publie', sipoc: emptySipoc, kpis: [{ label: 'Disponibilité SI', actual: '99,6 %', target: '99,9 %', tone: 'warn' }], exig: [{ framework: '9001', code: '§7.1.3', mutualized: false }, { framework: '27001', code: 'A.8.6', mutualized: true }], interactions: [{ dir: '↔', name: 'Transport & livraison' }] },
    ];
    for (const p of processSeed) {
      const [row] = await sql`
        INSERT INTO processes (id, tenant_id, family, name, pilot_user_id, version, workflow, sipoc, kpis, covered_requirements, interactions)
        SELECT ${p.id ?? sql`gen_random_uuid()`}, ${DEMO.tenantId}, ${p.family}::process_family, ${p.name}, ${p.pilot},
               ${p.version}, ${p.workflow}::process_workflow,
               ${JSON.stringify(p.sipoc)}::jsonb, ${JSON.stringify(p.kpis)}::jsonb,
               ${JSON.stringify(p.exig)}::jsonb, ${JSON.stringify(p.interactions)}::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM processes WHERE tenant_id = ${DEMO.tenantId} AND name = ${p.name})
        RETURNING id`;
      void row;
    }
    // Risques rattachés (registre unique) : Transport ↔ entrepôt/compte distant ;
    // Préparation ↔ rançongiciel (erreur humaine en production).
    const processRiskLinks: [string, string][] = [
      [DEMO.processTransport, DEMO.riskEntrepot],
      [DEMO.processTransport, DEMO.riskCompteDistant],
      [DEMO.processPrepa, DEMO.riskRancongiciel],
    ];
    for (const [pid, rid] of processRiskLinks) {
      await sql`
        INSERT INTO process_risks (tenant_id, process_id, risk_id)
        VALUES (${DEMO.tenantId}, ${pid}, ${rid})
        ON CONFLICT (process_id, risk_id) DO NOTHING`;
    }
    // Rattache la procédure de sauvegarde au processus « Préparation logistique »
    // (fait ici : les processus doivent exister avant la contrainte FK).
    await sql`
      UPDATE documents SET process_id = ${DEMO.processPrepa}
      WHERE id = ${DEMO.docProcSauvegarde} AND process_id IS NULL`;

    // ── Module 5.4b : étude EBIOS RM de démonstration ───────────────────
    // Étude à l'atelier 4 : trois scénarios opérationnels hérités de couples
    // source de risque / objectif visé (atelier 2), avec kill chain MITRE
    // ATT&CK. Vraisemblance cohérente avec la complétude des phases.
    await sql`
      INSERT INTO ebios_studies (id, tenant_id, title, scope_id, workshop)
      SELECT ${DEMO.ebiosStudy}, ${DEMO.tenantId}, 'SI de production 2026', ${DEMO.scopeSmsi}, 4
      WHERE NOT EXISTS (SELECT 1 FROM ebios_studies WHERE id = ${DEMO.ebiosStudy})`;

    const scenarios: [string, string, string, string][] = [
      // [id, source de risque, objectif visé, vraisemblance]
      [DEMO.ebiosSc1, 'Cybercriminel organisé', 'Rançonner l’entreprise', 'v3'],
      [DEMO.ebiosSc2, 'Concurrent', 'Voler des données R&D', 'v2'],
      [DEMO.ebiosSc3, 'État (attaquant étatique)', 'Espionner durablement', 'v2'],
    ];
    for (const [id, src, obj, vrais] of scenarios) {
      await sql`
        INSERT INTO ebios_scenarios (id, tenant_id, study_id, kind, risk_source, target_objective, likelihood)
        SELECT ${id}, ${DEMO.tenantId}, ${DEMO.ebiosStudy}, 'operationnel', ${src}, ${obj}, ${vrais}::ebios_likelihood
        WHERE NOT EXISTS (SELECT 1 FROM ebios_scenarios WHERE id = ${id})`;
    }

    const ebiosActionRows: [string, string, number, string, string, string][] = [
      // [scenarioId, phase, position, mitreId, mitreName, label]
      [DEMO.ebiosSc1, 'connaitre', 0, 'T1591', 'Ciblage org.', 'Reconnaissance de l’organisation cible'],
      [DEMO.ebiosSc1, 'connaitre', 1, 'T1589', 'Identités', 'Collecte d’adresses e-mail des dirigeants'],
      [DEMO.ebiosSc1, 'rentrer', 0, 'T1566', 'Phishing', 'Hameçonnage ciblé du service financier'],
      [DEMO.ebiosSc1, 'rentrer', 1, 'T1204', 'Exécution', 'Ouverture de la pièce jointe piégée'],
      [DEMO.ebiosSc1, 'trouver', 0, 'T1078', 'Comptes valides', 'Réutilisation d’identifiants dérobés'],
      [DEMO.ebiosSc1, 'trouver', 1, 'T1068', 'Élévation', 'Escalade de privilèges sur un serveur'],
      [DEMO.ebiosSc1, 'exploiter', 0, 'T1041', 'Exfiltration', 'Vol des données sensibles avant chiffrement'],
      [DEMO.ebiosSc1, 'exploiter', 1, 'T1486', 'Impact', 'Chiffrement pour impact (rançongiciel)'],
      [DEMO.ebiosSc2, 'connaitre', 0, 'T1591', 'Ciblage org.', 'Identification des équipes R&D'],
      [DEMO.ebiosSc2, 'rentrer', 0, 'T1566', 'Phishing', 'E-mail piégé vers un ingénieur'],
      [DEMO.ebiosSc2, 'trouver', 0, 'T1083', 'Découverte', 'Exploration des partages de fichiers'],
      [DEMO.ebiosSc3, 'connaitre', 0, 'T1598', 'Phishing info', 'Collecte de renseignements sur le SI'],
      [DEMO.ebiosSc3, 'rentrer', 0, 'T1133', 'Services distants', 'Exploitation d’un accès distant exposé'],
      [DEMO.ebiosSc3, 'trouver', 0, 'T1021', 'Mouvement latéral', 'Propagation vers les serveurs sensibles'],
    ];
    for (const [sid, phase, pos, tid, tname, label] of ebiosActionRows) {
      await sql`
        INSERT INTO ebios_actions (tenant_id, scenario_id, phase, position, mitre_id, mitre_name, label)
        SELECT ${DEMO.tenantId}, ${sid}, ${phase}::ebios_phase, ${pos}, ${tid}, ${tname}, ${label}
        WHERE NOT EXISTS (SELECT 1 FROM ebios_actions WHERE scenario_id = ${sid} AND label = ${label})`;
    }

    // ── Campagne d'évaluation ISO 27001 en cours (module 5.3) ─────────────
    // Écarts cohérents avec le reste de la démo : inventaire incomplet de
    // l'agence sud, tests de restauration non documentés, revue des accès en
    // retard, continuité de l'entrepôt, obsolescence. Exclusions justifiées
    // (pas de développement logiciel interne). Sécurité physique à évaluer
    // lors des visites de sites : la campagne n'est pas close.
    await sql`
      INSERT INTO assessments (id, tenant_id, framework_id, scope_id, campaign_label, status, started_at)
      SELECT ${DEMO.assessmentIso}, ${DEMO.tenantId}, f.id, ${DEMO.scopeSmsi}, 'Évaluation SMSI — S2 2026', 'en_cours', '2026-09-01T08:00:00Z'
      FROM frameworks f WHERE f.tenant_id IS NULL AND f.code = 'iso27001'
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO assessment_items (tenant_id, assessment_id, requirement_id)
      SELECT ${DEMO.tenantId}, ${DEMO.assessmentIso}, r.id
      FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.tenant_id IS NULL AND f.code = 'iso27001'
        AND NOT EXISTS (SELECT 1 FROM requirements c WHERE c.parent_id = r.id)
      ON CONFLICT ON CONSTRAINT assessment_items_assessment_req_unique DO NOTHING`;

    const gaps: [string, string][] = [
      ['A.5.9', 'Inventaire complet au siège et à Meyzieu ; actifs de l’agence de Vitrolles non recensés (RSK-085).'],
      ['A.5.18', 'Revue trimestrielle des droits d’accès non réalisée depuis le T2 (action en retard).'],
      ['A.5.30', 'Pas de plan de continuité éprouvé pour l’entrepôt régional de Meyzieu.'],
      ['A.8.8', 'Serveurs de l’entrepôt hors support éditeur ; correctifs non appliqués.'],
      ['A.8.13', 'Sauvegardes quotidiennes en place ; aucun test de restauration documenté depuis mars 2026.'],
    ];
    const excluded: [string, string][] = [
      ['A.8.25', 'Aucun développement logiciel interne : WMS et applications sont des progiciels maintenus par leurs éditeurs.'],
      ['A.8.26', 'Exigences de sécurité applicatives portées par les contrats éditeurs ; aucun développement interne.'],
      ['A.8.27', 'Aucune architecture logicielle conçue en interne.'],
      ['A.8.28', 'Aucun code source produit en interne.'],
      ['A.8.29', 'Pas de cycle de développement interne à tester ; recette fonctionnelle éditeur seulement.'],
      ['A.8.31', 'Pas d’environnements de développement ni de test internes.'],
    ];
    const pending = ['A.7.5', 'A.7.6', 'A.7.7', 'A.7.8', 'A.7.9', 'A.7.10', 'A.7.11', 'A.7.12', 'A.7.13', 'A.7.14'];

    // Statuts appliqués seulement aux éléments jamais évalués : relancer le
    // seed n'écrase pas une évaluation faite depuis l'interface.
    const setItem = async (ref: string, status: string, statement: string | null, included: boolean, justification: string | null) => {
      await sql`
        UPDATE assessment_items ai SET status = ${status}::assessment_item_status, statement = ${statement},
          soa_included = ${included}, soa_justification = ${justification},
          assessed_by = ${DEMO.userClaire}, assessed_at = '2026-09-15T14:00:00Z'
        FROM requirements r
        WHERE ai.assessment_id = ${DEMO.assessmentIso} AND ai.requirement_id = r.id AND r.ref_id = ${ref}
          AND ai.assessed_at IS NULL`;
    };
    for (const [ref, statement] of gaps) await setItem(ref, 'ecart', statement, true, null);
    for (const [ref, justification] of excluded) await setItem(ref, 'non_applicable', null, false, justification);
    const leaves = (await sql`
      SELECT r.ref_id FROM assessment_items ai JOIN requirements r ON r.id = ai.requirement_id
      WHERE ai.assessment_id = ${DEMO.assessmentIso} AND ai.assessed_at IS NULL`) as unknown as { ref_id: string }[];
    for (const { ref_id: ref } of leaves) {
      if (!pending.includes(ref)) await setItem(ref, 'conforme', null, true, null);
    }

    // ── Dérogations : une à échéance, une en attente de décision, une échue
    // jamais clôturée, une refusée. Décisions prises par une autre personne
    // que le demandeur (séparation des tâches, contrainte en base).
    const exceptions = [
      {
        id: DEMO.exceptionTrieuse,
        title: 'Poste de pilotage de la trieuse de Meyzieu sans antivirus',
        rule: 'PSSI §6.2 — antivirus géré sur tous les postes de travail',
        justification: 'L’éditeur de la trieuse ne certifie pas son logiciel de pilotage avec un antivirus : une installation annulerait la garantie et le contrat de maintenance.',
        measures: 'Poste isolé dans un VLAN dédié sans accès Internet, ports USB bloqués, mises à jour de l’éditeur contrôlées avant installation chaque trimestre.',
        control: null, asset: null,
        requestedBy: DEMO.userCamille, owner: DEMO.userCamille,
        startsOn: '2026-03-01', expiresOn: '2026-10-31', requestedAt: '2026-02-20T09:00:00Z',
        status: 'approuvee', decidedBy: DEMO.userClaire, decidedAt: '2026-02-26T10:00:00Z',
        note: 'Accordée jusqu’à la livraison de la version certifiée annoncée par l’éditeur.',
      },
      {
        id: DEMO.exceptionTelemaintenance,
        title: 'Télémaintenance de l’éditeur du WMS sans second facteur',
        rule: 'Contrôle « MFA sur les accès distants » — second facteur pour tout accès distant',
        justification: 'Le boîtier de télémaintenance de l’éditeur ne prend pas en charge le second facteur ; son remplacement est prévu au premier trimestre 2027.',
        measures: 'Compte nominatif ouvert à la demande par le support, plage horaire restreinte, sessions journalisées et revues chaque semaine.',
        control: DEMO.controlMfa, asset: DEMO.assetServeurs,
        requestedBy: DEMO.userClaire, owner: DEMO.userClaire,
        startsOn: '2026-10-15', expiresOn: '2027-03-31', requestedAt: '2026-10-02T14:20:00Z',
        status: 'demandee', decidedBy: null, decidedAt: null, note: null,
      },
      {
        id: DEMO.exceptionSauvegardesVitrolles,
        title: 'Rétention des sauvegardes de l’agence de Vitrolles réduite à 14 jours',
        rule: 'Procédure de sauvegarde — rétention de 30 jours',
        justification: 'Capacité du NAS de l’agence insuffisante en attendant son remplacement, budgété au deuxième semestre.',
        measures: 'Copie hebdomadaire externalisée chez l’hébergeur du siège, contrôle mensuel de restauration d’un échantillon.',
        control: DEMO.controlSauvegardes, asset: null,
        requestedBy: DEMO.userClaire, owner: DEMO.userClaire,
        startsOn: '2026-04-15', expiresOn: '2026-09-30', requestedAt: '2026-04-08T11:00:00Z',
        status: 'approuvee', decidedBy: DEMO.userAntoine, decidedAt: '2026-04-10T16:30:00Z',
        note: 'Accordée le temps du remplacement du NAS ; à clôturer dès sa mise en service.',
      },
      {
        id: DEMO.exceptionCompteAdmin,
        title: 'Compte administrateur partagé sur les imprimantes d’étiquettes',
        rule: 'PSSI §4.1 — un compte nominatif par intervenant',
        justification: 'Les techniciens de maintenance se relaient la nuit et partagent aujourd’hui un même accès aux imprimantes.',
        measures: 'Mot de passe changé chaque mois.',
        control: null, asset: null,
        requestedBy: DEMO.userCamille, owner: DEMO.userCamille,
        startsOn: '2026-06-15', expiresOn: '2026-12-31', requestedAt: '2026-06-08T08:45:00Z',
        status: 'refusee', decidedBy: DEMO.userClaire, decidedAt: '2026-06-12T09:15:00Z',
        note: 'Le gestionnaire de mots de passe permet un compte nominatif par technicien : pas d’écart justifié.',
      },
    ] as const;
    for (const e of exceptions) {
      await sql`
        INSERT INTO policy_exceptions
          (id, tenant_id, title, rule, justification, compensating_measures, control_id, asset_id,
           requested_by, owner_user_id, starts_on, expires_on, status, decided_by, decided_at, decision_note, created_at)
        VALUES
          (${e.id}, ${DEMO.tenantId}, ${e.title}, ${e.rule}, ${e.justification}, ${e.measures}, ${e.control}, ${e.asset},
           ${e.requestedBy}, ${e.owner}, ${e.startsOn}, ${e.expiresOn}, ${e.status}, ${e.decidedBy}, ${e.decidedAt}, ${e.note},
           ${e.requestedAt})
        ON CONFLICT (id) DO NOTHING`;
    }

    // ── Sensibilisation et formation : effectifs comptés, dirigeants nommés.
    // Antoine a suivi la formation des dirigeants (NIS 2, art. 20) en
    // novembre 2025, les trois autres membres du comité n'ont pas de compte
    // Toron ; la feuille d'émargement de Meyzieu manque au coffre ; la
    // formation RGPD du service client est planifiée.
    const trainingSheets = [
      [DEMO.evidenceFormationDirigeants, 'Attestations de formation des dirigeants — novembre 2025', 'attestation',
        'Attestations de suivi délivrées par l’organisme de formation, quatre membres du comité de direction.', '2025-11-18', '2026-11-18', 'annuelle'],
      [DEMO.evidenceHameconnage, 'Rapport de l’exercice d’hameçonnage — juin 2026', 'rapport',
        'Rapport de campagne : 148 destinataires, 121 participants au rappel des réflexes, taux de clic en baisse.', '2026-06-20', null, 'ponctuelle'],
    ] as const;
    for (const [id, title, type, text, collectedAt, validUntil, recurrence] of trainingSheets) {
      const buf = Buffer.from(text);
      await sql`
        INSERT INTO evidences
          (id, tenant_id, title, type, file_name, content, sha256, collected_at, valid_until, recurrence, collector_user_id)
        VALUES
          (${id}, ${DEMO.tenantId}, ${title}, ${type}, ${`${title}.txt`}, ${buf}, ${createHash('sha256').update(buf).digest('hex')},
           ${collectedAt}, ${validUntil}, ${recurrence}, ${DEMO.userClaire})
        ON CONFLICT (id) DO NOTHING`;
    }
    const trainings = [
      [DEMO.trainingPreparateurs, 'Sensibilisation cybersécurité des préparateurs de Meyzieu', 'sensibilisation', '2026-03-12', 60,
        'Préparateurs de commandes, entrepôt de Meyzieu', 42, 37, 'RSSI interne', null],
      [DEMO.trainingPhishing, 'Exercice d’hameçonnage et rappel des réflexes', 'phishing', '2026-06-20', 30,
        'Tous les salariés disposant d’une messagerie', 148, 121, 'RSSI interne', DEMO.evidenceHameconnage],
      [DEMO.trainingDirigeants, 'Formation des dirigeants à la cybersécurité (NIS 2, art. 20)', 'formation_dirigeants', '2025-11-18', 180,
        'Comité de direction', 4, 4, 'Organisme de formation spécialisé', DEMO.evidenceFormationDirigeants],
      [DEMO.trainingRgpd, 'Protection des données pour le service client', 'rgpd', '2026-11-05', 90,
        'Conseillers du service client', 12, null, 'Déléguée à la protection des données', null],
    ] as const;
    for (const [id, title, kind, heldOn, minutes, audience, expected, attended, provider, sheet] of trainings) {
      await sql`
        INSERT INTO training_sessions
          (id, tenant_id, title, kind, held_on, duration_minutes, audience, expected_count, attended_count, provider, evidence_id, created_by)
        VALUES (${id}, ${DEMO.tenantId}, ${title}, ${kind}, ${heldOn}, ${minutes}, ${audience}, ${expected}, ${attended}, ${provider}, ${sheet}, ${DEMO.userClaire})
        ON CONFLICT (id) DO NOTHING`;
    }
    await sql`
      INSERT INTO training_attendees (tenant_id, session_id, user_id)
      VALUES (${DEMO.tenantId}, ${DEMO.trainingDirigeants}, ${DEMO.userAntoine})
      ON CONFLICT DO NOTHING`;

    // ── Continuité d'activité : quatre activités critiques, trois exercices.
    // La paie n'a pas revu son bilan d'impact depuis septembre 2025 ;
    // l'exercice sur table du WMS a laissé un enseignement en cours de
    // traitement ; la bascule du WMS est planifiée en novembre.
    const continuityActivities = [
      {
        id: DEMO.continuityExpedition, name: 'Préparation et expédition des commandes', owner: DEMO.userAntoine, process: DEMO.processPrepa,
        description: 'Préparation des commandes à Corbas et Meyzieu, édition des étiquettes et remise aux transporteurs.',
        criticality: 4, rto: 8, rpo: 1, assessedOn: '2026-02-10',
        degraded: 'Préparation sur listes papier éditées chaque matin depuis le WMS ; ressaisie des expéditions au retour du système.',
        assets: [DEMO.assetWms, DEMO.assetServeurs], suppliers: [DEMO.supplierHebergeur, DEMO.supplierInfogerance],
      },
      {
        id: DEMO.continuityEdi, name: 'Échanges EDI avec les clients et les transporteurs', owner: DEMO.userClaire, process: null,
        description: 'Réception des commandes clients et transmission des bordereaux aux transporteurs.',
        criticality: 3, rto: 24, rpo: 4, assessedOn: '2026-02-10',
        degraded: 'Envoi des bordereaux par courriel chiffré aux trois transporteurs principaux.',
        assets: [DEMO.assetFluxEdi, DEMO.assetServeurs], suppliers: [DEMO.supplierTransporteur, DEMO.supplierHebergeur],
      },
      {
        id: DEMO.continuityTournees, name: 'Planification des tournées de livraison', owner: DEMO.userAntoine, process: DEMO.processTransport,
        description: 'Affectation des livraisons aux tournées et aux chauffeurs, la veille pour le lendemain.',
        criticality: 3, rto: 12, rpo: 4, assessedOn: '2026-02-10',
        degraded: 'Tournées de la veille reconduites, ajustées par téléphone avec les chauffeurs.',
        assets: [], suppliers: [DEMO.supplierTransporteur],
      },
      {
        id: DEMO.continuityPaie, name: 'Paie et administration du personnel', owner: DEMO.userAntoine, process: null,
        description: 'Calcul et versement de la paie mensuelle, déclarations sociales.',
        criticality: 2, rto: 120, rpo: 24, assessedOn: '2025-09-15',
        degraded: 'Acompte versé sur la base de la paie du mois précédent, régularisé le mois suivant.',
        assets: [], suppliers: [],
      },
    ] as const;
    for (const a of continuityActivities) {
      await sql`
        INSERT INTO continuity_activities
          (id, tenant_id, name, description, owner_user_id, process_id, criticality, rto_hours, rpo_hours, degraded_mode, assessed_on, created_by)
        VALUES (${a.id}, ${DEMO.tenantId}, ${a.name}, ${a.description}, ${a.owner}, ${a.process}, ${a.criticality}, ${a.rto}, ${a.rpo},
                ${a.degraded}, ${a.assessedOn}, ${DEMO.userClaire})
        ON CONFLICT (id) DO NOTHING`;
      for (const assetId of a.assets) {
        await sql`
          INSERT INTO continuity_activity_assets (tenant_id, activity_id, asset_id)
          VALUES (${DEMO.tenantId}, ${a.id}, ${assetId}) ON CONFLICT DO NOTHING`;
      }
      for (const supplierId of a.suppliers) {
        await sql`
          INSERT INTO continuity_activity_suppliers (tenant_id, activity_id, supplier_id)
          VALUES (${DEMO.tenantId}, ${a.id}, ${supplierId}) ON CONFLICT DO NOTHING`;
      }
    }

    const continuityExercises = [
      {
        id: DEMO.exerciseRestaurationEdi, title: 'Test de restauration des sauvegardes EDI', kind: 'restauration',
        scheduledOn: '2026-06-20', status: 'realise', result: 'atteint', recovery: 270,
        findings: 'Restauration complète en 4 h 30 depuis la sauvegarde externalisée ; procédure suivie sans écart.',
        evidence: DEMO.evidenceRestauration, lead: DEMO.userClaire, activities: [DEMO.continuityEdi],
      },
      {
        id: DEMO.exerciseTableWms, title: 'Exercice sur table : indisponibilité du WMS un jour de pic', kind: 'table',
        scheduledOn: '2026-05-14', status: 'realise', result: 'partiel', recovery: null,
        findings: 'Les listes de préparation papier de Meyzieu dataient de 2024 ; l’astreinte de l’hébergeur n’a été jointe qu’au bout d’1 h 40.',
        evidence: null, lead: DEMO.userAntoine, activities: [DEMO.continuityExpedition, DEMO.continuityTournees],
      },
      {
        id: DEMO.exerciseBasculeWms, title: 'Test de bascule du WMS sur l’infrastructure de secours', kind: 'bascule',
        scheduledOn: '2026-11-20', status: 'planifie', result: null, recovery: null, findings: null,
        evidence: null, lead: DEMO.userClaire, activities: [DEMO.continuityExpedition],
      },
    ] as const;
    for (const e of continuityExercises) {
      await sql`
        INSERT INTO continuity_exercises
          (id, tenant_id, title, kind, scheduled_on, status, result, recovery_minutes, findings, evidence_id, lead_user_id, created_by)
        VALUES (${e.id}, ${DEMO.tenantId}, ${e.title}, ${e.kind}, ${e.scheduledOn}, ${e.status}, ${e.result}, ${e.recovery},
                ${e.findings}, ${e.evidence}, ${e.lead}, ${DEMO.userClaire})
        ON CONFLICT (id) DO NOTHING`;
      for (const activityId of e.activities) {
        await sql`
          INSERT INTO continuity_exercise_activities (tenant_id, exercise_id, activity_id)
          VALUES (${DEMO.tenantId}, ${e.id}, ${activityId}) ON CONFLICT DO NOTHING`;
      }
    }
    await sql`
      INSERT INTO actions (id, tenant_id, title, description, origin_type, origin_id, owner_user_id, due_date, priority, status)
      VALUES (${DEMO.actionListesPapier}, ${DEMO.tenantId}, 'Régénérer chaque trimestre les listes de préparation papier de Meyzieu',
              'Enseignement de l’exercice du 14 mai : les listes du mode dégradé dataient de 2024.',
              'exercise', ${DEMO.exerciseTableWms}, ${DEMO.userAntoine}, '2026-10-31', 'p2', 'en_cours')
      ON CONFLICT (id) DO NOTHING`;

    // ── Satisfaction client : deux baromètres NPS (en hausse, encore sous
    // l'objectif), une mesure CSAT après livraison, cinq réclamations sur
    // douze mois. Résultats agrégés uniquement, aucun client nommé.
    const surveys = [
      {
        id: DEMO.surveyNpsS2, title: 'Baromètre NPS — clients e-commerce, second semestre 2025', method: 'nps',
        segment: 'Clients e-commerce', closedOn: '2025-12-15', invited: 380, respondents: 95,
        promoters: 45, passives: 30, detractors: 20, satisfied: null, target: 40,
        findings: 'Détracteurs surtout motivés par les retards de fin d’année et le suivi des colis.',
      },
      {
        id: DEMO.surveyNpsS1, title: 'Baromètre NPS — clients e-commerce, premier semestre 2026', method: 'nps',
        segment: 'Clients e-commerce', closedOn: '2026-06-30', invited: 400, respondents: 100,
        promoters: 52, passives: 31, detractors: 17, satisfied: null, target: 40,
        findings: 'Progression nette après la mise en place des créneaux de livraison ; le suivi en temps réel reste le premier irritant.',
      },
      {
        id: DEMO.surveyCsatLivraison, title: 'Satisfaction après livraison — troisième trimestre 2026', method: 'csat',
        segment: 'Destinataires livrés', closedOn: '2026-09-30', invited: null, respondents: 212,
        promoters: null, passives: null, detractors: null, satisfied: 178, target: 80,
        findings: 'Les avis négatifs portent sur les livraisons en zone Est lyonnaise.',
      },
    ] as const;
    for (const v of surveys) {
      await sql`
        INSERT INTO customer_surveys
          (id, tenant_id, title, method, segment, closed_on, invited_count, respondents, promoters, passives, detractors, satisfied,
           target, findings, owner_user_id, created_by)
        VALUES (${v.id}, ${DEMO.tenantId}, ${v.title}, ${v.method}, ${v.segment}, ${v.closedOn}, ${v.invited}, ${v.respondents},
                ${v.promoters}, ${v.passives}, ${v.detractors}, ${v.satisfied}, ${v.target}, ${v.findings}, ${DEMO.userCamille}, ${DEMO.userCamille})
        ON CONFLICT (id) DO NOTHING`;
    }

    const complaints = [
      [DEMO.complaintAvoir, 'Avoir non émis après un retour accepté', 'Le client attendait l’avoir depuis cinq semaines.', 'mineure', 'efficace', '2025-11-12'],
      [DEMO.complaintCasse, 'Colis de mobilier livrés endommagés (lot du 12 mars)', 'Trois colis sur douze reçus abîmés, emballage insuffisant.', 'majeure', 'efficace', '2026-03-20'],
      [DEMO.complaintRetards, 'Retards de livraison récurrents en zone Est lyonnaise', 'Six réclamations du même client en trois semaines.', 'majeure', 'en_traitement', '2026-09-03'],
      [DEMO.complaintEtiquettes, 'Étiquettes de retour illisibles', 'Impression pâle sur l’imprimante du quai 2 à Meyzieu.', 'mineure', 'ouverte', '2026-09-15'],
      [DEMO.complaintInversion, 'Références inversées dans une commande', 'Deux références voisines inversées à la préparation.', 'mineure', 'ouverte', '2026-10-02'],
    ] as const;
    for (const [id, title, description, gravity, status, openedOn] of complaints) {
      await sql`
        INSERT INTO nonconformities (id, tenant_id, title, description, source, gravity, status, opened_at, detected_by, owner_user_id)
        VALUES (${id}, ${DEMO.tenantId}, ${title}, ${description}, 'reclamation_client', ${gravity}, ${status},
                ${`${openedOn}T09:00:00+02:00`}, ${DEMO.userCamille}, ${DEMO.userCamille})
        ON CONFLICT (id) DO NOTHING`;
    }
  } finally {
    await sql.end();
  }
}
