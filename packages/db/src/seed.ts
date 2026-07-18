import { createHash } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { defaultRiskScale, riskBand, type RiskBand } from '@toron/core';
import { iso27001, recyf } from '@toron/frameworks';
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
  } finally {
    await sql.end();
  }
}
