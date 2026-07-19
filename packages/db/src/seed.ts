import { createHash } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { defaultRiskScale, riskBand, type RiskBand } from '@toron/core';
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
      INSERT INTO tenants (id, name, slug, plan)
      VALUES (${DEMO.tenantId}, 'Meridiane Logistics', ${DEMO.slug}, 'standard')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug`;

    await sql`
      INSERT INTO legal_entities (id, tenant_id, name, siren)
      VALUES (${DEMO.entityId}, ${DEMO.tenantId}, 'Meridiane Logistics SAS', NULL)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;

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
        INSERT INTO controls (id, tenant_id, title, description, owner_user_id, review_frequency)
        VALUES (${id}, ${DEMO.tenantId}, ${title}, ${description}, ${owner}, ${freq})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description`;
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
  } finally {
    await sql.end();
  }
}
