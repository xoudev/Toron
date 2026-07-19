const APP = 'https://app.toron.fr';
const DEMO = 'mailto:bonjour@toron.fr?subject=Demande%20de%20démo%20Toron';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 9c6-4 14-4 20 0M6 16c6-4 14-4 20 0M6 23c6-4 14-4 20 0" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export default function Landing() {
  return (
    <>
      <header className="hdr">
        <div className="wrap hdr-in">
          <a className="brand" href="#top"><Mark /> Toron</a>
          <nav>
            <a href="#plateforme">Plateforme</a>
            <a href="#mutualisation">Mutualisation</a>
            <a href="#souverainete">Souveraineté</a>
            <a href="#prix">Prix</a>
          </nav>
          <div className="right">
            <a className="link" href={`${APP}/connexion`}>Se connecter</a>
            <a className="btn btn-primary btn-sm" href={DEMO}>Demander une démo</a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero" style={{ borderTop: 'none' }}>
          <div className="wrap">
            <span className="kicker">GRC souveraine · hébergée en UE</span>
            <h1>Prouvez une fois.<br /><span className="em">Couvrez tout.</span></h1>
            <p className="lead">
              La plateforme de conformité et de gestion des risques des PME et ETI :
              ISO&nbsp;27001, NIS&nbsp;2/ReCyF, RGPD, puis ISO&nbsp;9001 — sur un socle unique.
              Un contrôle, une preuve ou un document satisfait plusieurs référentiels à la fois.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary" href={DEMO}>Demander une démo</a>
              <a className="btn btn-ghost" href="#plateforme">Voir la plateforme</a>
            </div>
            <div className="hero-badges">
              <span className="chip"><span className="dot" /> EBIOS RM guidé</span>
              <span className="chip"><span className="dot" /> Chronologie NIS 2 · 24h / 72h / J+30</span>
              <span className="chip"><span className="dot" /> Exports PDF scellés (poinçon SHA-256)</span>
              <span className="chip"><span className="dot" /> Import Excel en 4 étapes</span>
            </div>
          </div>
        </section>

        <section id="signature">
          <div className="wrap">
            <div className="sec-head">
              <span className="kicker">La signature Toron</span>
              <h2>Trois référentiels, un seul fil</h2>
              <p>
                Le cross-mapping est l’objet central du produit, pas une option. Chaque exigence
                d’ISO&nbsp;27001, de NIS&nbsp;2 (ReCyF) et du RGPD est reliée à vos contrôles internes —
                vous voyez immédiatement ce qui couvre quoi.
              </p>
            </div>
            <div className="grid grid-3">
              <div className="card">
                <div className="icon" aria-hidden="true">◆</div>
                <h3>ISO/IEC 27001:2022</h3>
                <p>Système de management (clauses 4–10) et Annexe A (93 contrôles), reformulés maison. Déclaration d’applicabilité générée et scellée.</p>
              </div>
              <div className="card">
                <div className="icon" aria-hidden="true">◆</div>
                <h3>NIS 2 · ReCyF</h3>
                <p>Objectifs et moyens ANSSI, applicabilité entités essentielles / importantes, chronologie réglementaire des incidents intégrée.</p>
              </div>
              <div className="card">
                <div className="icon" aria-hidden="true">◆</div>
                <h3>RGPD</h3>
                <p>Registre des traitements et exigences de protection des données, mutualisés avec la sécurité — une preuve, plusieurs cadres.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="mutualisation">
          <div className="wrap">
            <div className="grid grid-2">
              <div className="sec-head">
                <span className="kicker">La mutualisation</span>
                <h2>Un contrôle. Plusieurs référentiels.</h2>
                <p>
                  Un même contrôle interne — l’authentification multifacteur, par exemple — satisfait à
                  la fois ISO&nbsp;27001 (A.8.5) et NIS&nbsp;2 (OBJ-08). Vous le prouvez une fois ; Toron
                  le compte partout. Sur un déploiement type, ce sont
                  <b> 38 contrôles mutualisés</b> qui couvrent deux référentiels ou plus.
                </p>
              </div>
              <div className="mut-viz">
                <div className="mut-node">
                  <span className="ref">CTL-FOURN-03</span>
                  Évaluation sécurité des fournisseurs critiques
                </div>
                <div className="mut-thread" aria-hidden="true" />
                <div className="mut-refs" style={{ justifyContent: 'center' }}>
                  <span className="ref">27001 · A.5.19</span>
                  <span className="ref">NIS 2 · OBJ-14</span>
                  <span className="ref">RGPD · Art. 28</span>
                </div>
                <p style={{ textAlign: 'center', marginTop: 22 }}>
                  <span className="big-num">38</span><br />
                  <span style={{ color: 'var(--text-2)', fontSize: 13 }}>contrôles mutualisés</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="poincon">
          <div className="wrap">
            <div className="grid grid-2">
              <div className="seal-card">
                <div className="seal-row"><span>Déclaration d’applicabilité</span><b>SoA v3</b></div>
                <div className="seal-row"><span>Scellé le</span><b>02/07/2026</b></div>
                <div className="seal-row"><span>Statut</span><b style={{ color: 'var(--ok)' }}>SCELLÉ</b></div>
                <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 10 }}>EMPREINTE SHA-256</div>
                <div className="seal-hash">08c16823ec33a1b9f4d2e7c8a5b0139d6f7e2a4c8b1d0e9f3a6c5b2d1e0f7a4c</div>
                <div className="verify-ok">✓ Vérifiable publiquement, sans compte Toron</div>
              </div>
              <div className="sec-head">
                <span className="kicker">Le poinçon</span>
                <h2>Chaque livrable est scellé</h2>
                <p>
                  Chaque export — Déclaration d’applicabilité, registre des risques — porte une empreinte
                  SHA-256 et une page publique de vérification. L’empreinte change au moindre octet
                  modifié : un auditeur confirme l’intégrité d’un document en un clic, sans accès à
                  votre espace.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="souverainete">
          <div className="wrap">
            <div className="sec-head" style={{ maxWidth: '68ch' }}>
              <span className="kicker">Souveraineté</span>
              <h2>Vos données restent les vôtres, en Europe</h2>
              <p>
                Hébergement et sous-traitance intégralement européens, aucun sous-traitant hors UE.
                Chiffrement en transit et au repos, journal d’audit immuable, isolation stricte entre
                organisations. La souveraineté n’est pas une option cochée après coup : c’est le socle.
              </p>
            </div>
            <div className="grid grid-3">
              <div className="card"><div className="icon" aria-hidden="true">⬢</div><h3>Hébergement UE</h3><p>Infrastructure et sauvegardes en Europe, trajectoire SecNumCloud.</p></div>
              <div className="card"><div className="icon" aria-hidden="true">⬢</div><h3>Isolation par tenant</h3><p>Cloisonnement au niveau base (RLS) : une organisation ne voit jamais les données d’une autre.</p></div>
              <div className="card"><div className="icon" aria-hidden="true">⬢</div><h3>Journal immuable</h3><p>Chaque action tracée, sans aucune API d’effacement — la preuve de votre gouvernance.</p></div>
            </div>
          </div>
        </section>

        <section id="plateforme">
          <div className="wrap">
            <div className="sec-head">
              <span className="kicker">La plateforme</span>
              <h2>Un module par métier de la conformité</h2>
              <p>Du référentiel à la preuve, du risque à l’incident réglementaire — tout communique sur le même socle.</p>
            </div>
            <div className="grid grid-3">
              {[
                ['Référentiels & cross-mapping', 'Catalogue, arbres d’exigences, contrôles mutualisés.'],
                ['Évaluations & SoA', 'Campagnes, gap analysis, Déclaration d’applicabilité scellée.'],
                ['Risques', 'Matrice versionnée, acceptations signées, EBIOS RM guidé.'],
                ['Plan d’action', 'Un seul moteur pour risques, écarts, incidents et NC.'],
                ['Preuves & documents', 'Coffre empreinté, fraîcheur, versions immuables publiées.'],
                ['Incidents NIS 2 & QMS', 'Chronologie 24h/72h/J+30, non-conformités & CAPA.'],
              ].map(([t, d]) => (
                <div className="card" key={t}><h3 style={{ marginTop: 0 }}>{t}</h3><p>{d}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section id="prix">
          <div className="wrap">
            <div className="sec-head">
              <span className="kicker">Tarifs</span>
              <h2>Des prix affichés, sans détour</h2>
              <p>Facturation annuelle, sans engagement pluriannuel imposé. Migration Excel incluse.</p>
            </div>
            <div className="prices">
              <div className="price">
                <h3>Découverte</h3>
                <div className="amount">290&nbsp;€<small> /mois</small></div>
                <ul><li>1 référentiel actif</li><li>Jusqu’à 15 utilisateurs</li><li>Exports scellés</li><li>Import Excel</li></ul>
                <a className="btn btn-ghost btn-sm" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }} href={DEMO}>Commencer</a>
              </div>
              <div className="price feat">
                <span className="price-tag">LE PLUS CHOISI</span>
                <h3>Standard</h3>
                <div className="amount">690&nbsp;€<small> /mois</small></div>
                <ul><li>27001 + NIS 2 + RGPD</li><li>Utilisateurs illimités</li><li>EBIOS RM guidé</li><li>Chronologie incidents NIS 2</li><li>Support prioritaire</li></ul>
                <a className="btn btn-primary btn-sm" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }} href={DEMO}>Demander une démo</a>
              </div>
              <div className="price">
                <h3>Entreprise</h3>
                <div className="amount">Sur mesure</div>
                <ul><li>Pack QMS ISO 9001</li><li>Multi-entités & périmètres</li><li>SSO & rôles avancés</li><li>Accompagnement dédié</li></ul>
                <a className="btn btn-ghost btn-sm" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }} href={DEMO}>Nous contacter</a>
              </div>
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="wrap">
            <h2>Reprenez la main sur votre conformité</h2>
            <p className="lead" style={{ margin: '16px auto 0', maxWidth: '52ch', color: 'var(--text-2)' }}>
              Vos années de travail sous Excel ne sont pas perdues — elles deviennent votre socle.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary" href={DEMO}>Demander une démo</a>
              <a className="btn btn-ghost" href={`${APP}/connexion`}>Importer depuis Excel</a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot-in">
          <div>
            <div className="brand" style={{ fontSize: 15, marginBottom: 6 }}><Mark /> Toron</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>HÉBERGEMENT UE · SECNUMCLOUD</div>
            <div style={{ marginTop: 8 }}>© 2026 Toron SAS · RCS Paris</div>
          </div>
          <div className="foot-links">
            <a href="#">Mentions légales</a>
            <a href="#">Confidentialité</a>
            <a href="#">Sous-traitants (RGPD)</a>
            <a href={`${APP}/connexion`}>Se connecter</a>
          </div>
        </div>
      </footer>
    </>
  );
}
