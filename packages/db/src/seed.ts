import { hash } from '@node-rs/argon2';
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
  } finally {
    await sql.end();
  }
}
