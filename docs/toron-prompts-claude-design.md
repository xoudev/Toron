# Toron — Prompts Claude Design (recueil complet)

## Mode d'emploi

1. Colle le **SOCLE** ci-dessous en début de session (une seule fois par session).
2. Remplace la ligne `TÂCHE : […]` par **un** des blocs numérotés.
3. Un écran par prompt. Valide, itère, puis passe au suivant.
4. Joins les fichiers `toron-marque-strates.svg`, `toron-poincon-sceau.svg`
   et `toron-dashboard.html` (référence visuelle) à la session.

Ordre de construction recommandé : 04 → 02 → 03 (le cœur métier),
puis 08 → 06 → 05, le reste ensuite, 16 (landing) en dernier.

---

## SOCLE (à coller une fois par session)

```text
Tu es directeur artistique et design engineer sur TORON, une plateforme SaaS
B2B française de conformité et de gestion des risques (GRC : SMSI ISO 27001,
NIS2/ReCyF, RGPD + pack QMS ISO 9001) pour PME/ETI et leurs RSSI.
Positionnement : souverain (hébergement UE), sobre, dense, crédible en audit.
L'identité existe déjà — tu l'appliques, tu ne la réinventes pas.

TÂCHE : [remplacer par un bloc TÂCHE du recueil]

═══ IDENTITÉ (fournie, ne pas redessiner) ═══
Deux marques SVG jointes, deux rôles distincts, jamais fusionnées :
• « Strates » = LA MARQUE : logo produit, header, favicon, avatars.
  Trois barres (les référentiels) cousues par un fil orange vertical.
• « Poinçon » = LE SCEAU : uniquement frappé sur les livrables générés
  (rapports, exports, attestations) avec une empreinte SHA-256 et une URL
  de vérification. Jamais utilisé comme logo.
L'encre des SVG est en currentColor ; le fil est #CB4E0A sur fond clair,
#EF7A32 sur fond sombre.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="4" y="4.4" width="16" height="3.2" rx="1.6" fill="currentColor"/>
  <rect x="4" y="10.4" width="16" height="3.2" rx="1.6" fill="currentColor"/>
  <rect x="4" y="16.4" width="16" height="3.2" rx="1.6" fill="currentColor"/>
  <rect x="7.6" y="1.4" width="2.8" height="21.2" rx="1.4" fill="#CB4E0A"/>
  <rect x="7.6" y="10.4" width="2.8" height="3.2" fill="currentColor"/>
</svg>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 2.6 L21 12 L12 21.4 L3 12 Z" fill="none"
        stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  <rect x="0.6" y="10.8" width="22.8" height="2.4" rx="1.2" fill="#CB4E0A"/>
</svg>

═══ TOKENS ═══
Clair :  fond #F2F3F3 · surface #FFFFFF · surface-2 #F7F7F6 ·
         bordure #E4E5E3 · texte #1C1E1D · texte-2 #5B605D ·
         accent #CB4E0A · ok #2E7D4F · warn #946200 · danger #B23327
Sombre : fond #151412 · surface #1C1B18 · surface-2 #22211D ·
         bordure #2C2A25 · texte #ECEAE3 · texte-2 #A6A198 ·
         accent #EF7A32 · ok #5FB582 · warn #D8A23E · danger #E0685A
Typo :   IBM Plex Sans (UI, base 13px) ; IBM Plex Mono pour identifiants,
         valeurs chiffrées et labels de sections (9–10px, MAJUSCULES,
         letter-spacing .1em).
Forme :  rayons 4–8px max, bordures 1px, ombres quasi nulles,
         densité élevée type outil métier.

═══ RÈGLES ═══
- Orange rationné : actions primaires, états actifs, et le « fil »
  (signature reliant les éléments mutualisés entre référentiels).
  Jamais en fond, jamais en dégradé, jamais décoratif.
- Interdits : dégradés, glassmorphism, fond crème + terracotta,
  illustrations 3D, emojis en guise d'icônes, cartes sur-arrondies,
  ombres lourdes.
- Icônes : trait 1.5–2px, monochromes, minimalistes.
- Contenu 100 % français, vocabulaire GRC exact : référentiels, exigences,
  contrôles, écarts, preuves, plan d'action, revue de direction, EBIOS RM.
  Identifiants réalistes en mono : ACT-0142, INC-007, A.5.19 (27001),
  OBJ-08 (ReCyF), §8.7 (9001). Jamais de lorem ipsum.
- Thème sombre ET clair ; le sombre n'est pas une inversion du clair.
- États vides = invitation à agir ; erreurs = cause + correction.

═══ RÉFÉRENCE ═══
Un dashboard existe déjà : sidebar 236px, topbar 52px, cartes bordure 1px
rayon 8px, KPI en bandeau, tableaux denses. Toute nouvelle vue doit sembler
sortir du même produit.
```

---

## 01 · Référentiels — catalogue

```text
TÂCHE : conçois l'écran « Référentiels » (catalogue). Grille de cartes, une
par référentiel actif : ISO/IEC 27001:2022 (jauge 72 %, 93 contrôles
applicables, 14 écarts, SoA v3, dernière évaluation 02/07), NIS 2 · ReCyF
v2.5 (profil Entité importante, 56 moyens, badge « Enregistré MonEspaceNIS2 »),
ISO 9001:2015 (pill PACK QMS, 11 processus, 3 NC ouvertes), RGPD
(24 traitements). Chaque carte : jauge de couverture, écarts, prochaine
échéance d'évaluation, actions « Ouvrir » et « Lancer une évaluation ».
Sous la grille, section « Disponibles à l'activation » : DORA, ISO 14001,
ISO 45001 en cartes grisées avec bouton « Activer ». En pied de page, le
bandeau signature : fil orange reliant les cartes actives avec la mention
« 38 contrôles mutualisés couvrent 2 référentiels ou plus » et un lien
« Voir le mapping ». Prévois l'état vide : aucun référentiel activé,
message d'invitation + deux CTA « Activer un référentiel » et
« Importer un existant depuis Excel ».
```

## 02 · Référentiel — vue détail (ISO 27001 + SoA)

```text
TÂCHE : conçois la vue détail d'un référentiel, exemple ISO/IEC 27001:2022.
Layout master-detail : à gauche, arborescence repliable (clauses 4 à 10,
puis Annexe A par domaines A.5 Organisationnel, A.6 Personnel, A.7 Physique,
A.8 Technologique) avec compteur d'écarts par nœud. À droite, la liste des
exigences du nœud sélectionné : chaque ligne porte l'ID en mono (A.5.19),
un intitulé REFORMULÉ en langage maison (jamais le texte intégral de la
norme, il est sous copyright AFNOR), le statut (Conforme / Écart /
Non applicable / À évaluer), les contrôles internes liés, les preuves avec
pastille de fraîcheur, et — détail signature — un petit fil orange sur les
lignes mutualisées avec badges des autres référentiels couverts (NIS2,
9001). Au clic, panneau latéral SoA : justification d'inclusion, ou
justification d'exclusion OBLIGATOIRE si Non applicable, responsable,
historique des changements de statut horodaté. Header : jauge globale,
filtres par statut et domaine, bouton « Exporter la Déclaration
d'applicabilité » (mention : export PDF scellé du poinçon).
```

## 03 · Plan d'action

```text
TÂCHE : conçois l'écran « Plan d'action » complet. Table dense, colonnes :
ID (ACT-0142), intitulé, origine (chip : Risque / Écart d'audit / Incident /
Non-conformité / Évaluation), exigences liées (multi-chips mono : 27001 ·
A.8.5, ReCyF · OBJ-08…), responsable (avatar initiales), échéance (rouge si
dépassée, format J+4), priorité (P1–P3), effort estimé, statut (Planifié /
En cours / En retard / Terminé / Vérification). Barre supérieure : recherche,
filtres sauvegardés (« Mes actions », « En retard », « Revue de direction »),
toggle vue Table / Kanban, actions groupées (réassigner, décaler l'échéance
avec justification). Au clic, drawer latéral : description, sous-tâches
cochables, preuves attachées, exigences couvertes, commentaires, et un
historique horodaté immuable (création, changements de statut, relances
envoyées). État vide : « Aucune action pour l'instant — elles naîtront de
vos évaluations, audits et incidents », avec CTA « Créer une action » et
« Lancer une évaluation ».
```

## 04 · Registre des risques

```text
TÂCHE : conçois l'écran « Registre des risques ». En haut, la matrice 4×4
(gravité × vraisemblance, échelles EBIOS RM) : cellules cliquables qui
filtrent la table, compteurs par cellule, palette sobre (vert sauge → ambre
→ orange → rouge profond, le rouge critique distinct de l'orange de marque).
En dessous, la table : ID (RSK-023), intitulé du risque, valeur métier /
actif concerné, source (Atelier EBIOS · Direction financière), cotation
brute G×V, option de traitement (Réduire / Transférer / Accepter / Éviter),
cotation nette, résiduel cible, propriétaire du risque, prochaine revue.
Détail expert : les risques ACCEPTÉS portent un badge dédié avec date et
signataire de la direction — l'acceptation formelle est un objet de
première classe, pas un simple statut. Drawer au clic : scénario complet,
contrôles liés, plan de traitement (actions liées), et l'historique des
cotations dans le temps en mini-graphique. Header : appétence au risque
affichée, filtre par périmètre (SMSI / QMS), export du registre scellé.
```

## 05 · Atelier EBIOS RM (écran différenciateur — soigner)

```text
TÂCHE : conçois l'écran « Atelier EBIOS RM », le module guidé. Stepper
horizontal des 5 ateliers : 1 Cadrage et socle de sécurité · 2 Sources de
risque · 3 Scénarios stratégiques · 4 Scénarios opérationnels · 5 Traitement
du risque. Montre l'atelier 4 actif : zone centrale = canvas du scénario
opérationnel sous forme de kill chain horizontale (phases : Connaître →
Rentrer → Trouver → Exploiter), chaque phase portant des actions élémentaires
avec leur technique MITRE ATT&CK en chip mono (T1566 Phishing, T1078 Comptes
valides, T1486 Chiffrement pour impact). Panneau droit : couple source de
risque / objectif visé hérité de l'atelier 2 (ex. « Cybercriminel ·
Rançonner l'entreprise »), chemin d'attaque, cotation de vraisemblance par
mode opératoire. Panneau gauche : liste des scénarios de l'atelier avec
statut (Coté / En cours / À faire). Footer : progression de l'atelier,
bouton « Exporter le livrable » (format conforme à la méthode ANSSI, PDF
scellé du poinçon). Ton : on guide un non-expert pas à pas sans
infantiliser l'expert.
```

## 06 · Incidents (avec chronologie réglementaire NIS2)

```text
TÂCHE : conçois l'écran « Incidents » en master-detail. Liste à gauche :
ID (INC-007), titre, sévérité (Mineur / Majeur / Critique), statut, date
d'ouverture. Détail à droite pour un incident ouvert « Phishing ciblé —
Direction financière » : bandeau de qualification « Incident important
NIS 2 » avec la checklist des critères (perturbation opérationnelle grave,
pertes financières, impact sur des tiers) cochée ; le stepper réglementaire
en évidence : Alerte 24 h (faite, horodatée) → Notification 72 h (compte à
rebours vivant : « dans 54 h », en orange) → Rapport final J+30 (à venir) ;
bouton primaire « Générer la déclaration ANSSI » (formulaire pré-rempli
depuis les données de l'incident). Piste parallèle discrète : « Données
personnelles concernées ? » → volet violation RGPD avec son propre délai
CNIL 72 h. En dessous : timeline horodatée immuable (détection,
qualification, mesures conservatoires, communications), actions correctives
liées, et section REX à la clôture. État vide : « Aucun incident ouvert »
avec CTA « Déclarer un incident » et rappel de la procédure.
```

## 07 · Documents (GED du système de management)

```text
TÂCHE : conçois l'écran « Documents ». Table : titre, type (PSSI, Politique,
Procédure, Charte, PCA/PRA, Fiche processus), version en mono (v2.3), statut
du workflow (Brouillon → Relecture → Approuvé → Publié) avec avatars des
approbateurs et étape courante, propriétaire, date de prochaine revue
(alerte si dépassée : « Revue échue depuis 34 j »), et colonne accusés de
lecture avec mini-barre (ex. 112/148 signés). Filtres : type, statut,
périmètre (SMSI / QMS), « à revoir ». Drawer au clic : aperçu, historique
des versions avec qui/quand/quoi, exigences couvertes par le document
(chips multi-référentiels avec le fil orange si mutualisé), campagne de
diffusion (relances des non-signataires). Modale secondaire esquissée :
l'écran « Lire et signer » vu par un salarié (document + case de
reconnaissance + signature horodatée). État vide : bibliothèque de modèles
proposée (PSSI, procédure incidents, charte) « alignés ReCyF, à adapter ».
```

## 08 · Coffre de preuves

```text
TÂCHE : conçois l'écran « Preuves », le coffre-fort. Header : statistique
de fraîcheur globale (87 % à jour), répartition (5 expirées, 12 expirent
sous 30 j), bouton « Ajouter une preuve ». Table : nom de la preuve, type
(Capture, Export, Attestation, Rapport, PV), contrôles et exigences
couverts en multi-chips mono — avec le fil orange quand une preuve sert
plusieurs référentiels (c'est l'écran où la mutualisation devient
tangible) —, date de collecte, fraîcheur (À jour / Expire J-21 / Expirée
depuis 12 j), collecteur, récurrence de la tâche de collecte
(trimestrielle, annuelle). Tri par défaut : expirées d'abord. Drawer :
aperçu du fichier, empreinte SHA-256 en mono, journal des accès, tâche de
renouvellement liée avec responsable et échéance. Action contextuelle :
« Réutiliser dans une réponse fournisseur ». État vide : expliquer que la
collecte est manuelle au départ, avec un mot sur les connecteurs
automatiques à venir — honnête, pas de promesse floue.
```

## 09 · Audits internes

```text
TÂCHE : conçois l'écran « Audits » en deux zones. Zone haute : le programme
d'audit pluriannuel en frise (2026–2027), une ligne par audit avec
périmètre, référentiel, auditeur, statut (Planifié / En cours / Clôturé) —
un gantt léger, pas une usine. Zone basse : l'exécution de l'audit en cours
« Audit interne ISO 27001 — S2 · périmètre logistique » : checklist générée
depuis le référentiel (exigence par exigence), saisie des constats typés
(Écart majeur / Écart mineur / Observation / Point fort) avec exigence liée
en chip mono, preuve photo ou fichier attachable, et bouton « Convertir en
action » qui crée l'action correctrice pré-liée. Compteurs de progression
(34/93 exigences couvertes). Footer : « Générer le rapport d'audit » —
PDF scellé du poinçon, mention du package de preuves exportable pour
l'organisme certificateur. Détail d'intégrité : l'auditeur assigné ne peut
pas être le propriétaire des contrôles audités (séparation des tâches,
l'indiquer subtilement).
```

## 10 · Fournisseurs (tiers & effet cascade)

```text
TÂCHE : conçois l'écran « Fournisseurs ». Table du registre : fournisseur,
criticité (T1 / T2 / T3 avec définition au survol), services fournis,
données accédées (chips : RH, Client, Santé…), clauses de sécurité
contractuelles (Présentes / Manquantes / À renouveler), score de dernière
évaluation, prochaine campagne. Header : répartition par tier, bouton
« Lancer une campagne d'évaluation ». Vue campagne (onglet ou section) :
questionnaire envoyé à N fournisseurs, taux de réponse, relances
automatiques programmées, réponses en attente de revue. Drawer fournisseur :
attestations déposées avec fraîcheur (« Attestation ISO 27001 hébergeur —
expirée depuis 12 j » en rouge), incidents impliquant ce tiers, demandes
d'actions correctives fournisseur, historique des évaluations. Contexte à
faire sentir : NIS 2 art. 21 rend le client responsable de sa chaîne
d'approvisionnement — le registre est la réponse à « prouvez que vous
maîtrisez vos tiers ».
```

## 11 · Revue de direction

```text
TÂCHE : conçois l'écran « Revue de direction ». C'est un écran de
préparation et de séance : l'ordre du jour est auto-généré avec les entrées
exigées par la clause 9.3 — commune à ISO 27001 et ISO 9001, donc UNE seule
revue couvre les deux systèmes (le faire sentir : badge « SMSI + QMS »).
Chaque entrée est une section avec ses données injectées automatiquement :
1. Suivi des actions des revues précédentes (7/9 soldées), 2. Évolution des
enjeux internes et externes, 3. Performance — KPI et tendances, 4. Résultats
d'audits et état des non-conformités, 5. Évolution des risques et
opportunités, 6. Retours des parties intéressées, 7. Opportunités
d'amélioration. Colonne droite : zone de séance — décisions saisies en
direct, chacune convertible en action avec responsable et échéance.
Footer : participants avec émargement, bouton « Générer le procès-verbal »
(PDF scellé du poinçon). État avant préparation : « Prochaine revue le
24 juillet — les entrées se rempliront automatiquement » avec aperçu grisé.
```

## 12 · Processus (pack QMS)

```text
TÂCHE : conçois l'écran « Processus » du pack QMS. Vue principale :
cartographie des processus en trois bandeaux horizontaux — Management
(Pilotage stratégique, Amélioration continue), Réalisation (Prise de
commande, Préparation logistique, Transport & livraison, SAV), Support
(RH, SI, Achats, Maintenance) — cartes cliquables avec pilote et indicateur
de santé. Au clic, fiche processus : cartouche SIPOC (Fournisseurs,
Entrées, Activités, Sorties, Clients), pilote du processus, indicateurs
avec cible et réalisé (taux de service 96,2 % / cible 98 %), risques liés
(renvoi registre), exigences couvertes (chips 9001 §8.5, et le fil orange
si un contrôle 27001 s'y adosse), interactions avec les autres processus,
et documents rattachés avec leur version. La fiche est versionnée et
approuvée comme un document (réutiliser visuellement le workflow de
l'écran Documents — cohérence du socle commun).
```

## 13 · Non-conformités (pack QMS)

```text
TÂCHE : conçois l'écran « Non-conformités ». Registre : ID (NC-031), source
(Interne / Fournisseur / Réclamation client), description courte, processus
concerné, gravité, coût de non-qualité estimé (mono, €), statut. Fiche NC
au clic, structurée en étapes : 1. Description et détection, 2. Action
immédiate (curative — traiter le symptôme), 3. Analyse de cause racine avec
un outil « 5 Pourquoi » interactif (chaîne de pourquoi repliable ; mention
Ishikawa en alternative), 4. Actions correctives liées (créées dans le
moteur commun du plan d'action, chips visibles), 5. Clôture. Détail expert
à mettre en évidence : la clôture déclenche une VÉRIFICATION D'EFFICACITÉ
planifiée à J+90 — statut distinct « Clôturée · efficacité à vérifier »
puis « Efficace » ou réouverture. C'est la subtilité ISO que les outils
génériques ratent. Lien discret : une NC d'origine fournisseur propose
« Émettre une demande d'action corrective fournisseur » (renvoi écran 10).
```

## 14 · Paramètres & administration

```text
TÂCHE : conçois l'écran « Paramètres » avec navigation secondaire à gauche :
Organisation, Périmètres, Utilisateurs & rôles, Sécurité, Journal d'audit,
Données. Montre trois sections : (a) Organisation : entités juridiques et
sites (Meridiane Logistics SAS · 3 sites), rattachements ; (b) Utilisateurs
& rôles : table des membres avec rôle (Direction, RSSI, Responsable
qualité, Pilote de processus, Auditeur, Contributeur, Lecteur), et une
matrice de permissions par module — avec la règle de séparation des tâches
visible (un Auditeur ne peut pas éditer les contrôles qu'il audite) ;
(c) Journal d'audit de la plateforme : flux immuable en mono (horodatage,
acteur, action, objet — « 16/07 14:02 · j.durand · Statut modifié ·
RSK-023 : Net 12 → 8 »), filtrable, exportable. Section Sécurité esquissée :
SSO SAML/OIDC, MFA obligatoire, durée de session. Section Données :
export complet (mention anti-verrouillage : « vos données vous
appartiennent »), rétention, région d'hébergement UE affichée.
```

## 15 · Onboarding — import depuis Excel

```text
TÂCHE : conçois le parcours « Importer depuis Excel », la porte d'entrée
n°1 du produit (tous les clients migrent depuis des classeurs). Wizard en
4 étapes avec progression : 1. Dépôt des fichiers (zone de drop, formats
xlsx/csv, plusieurs fichiers) ; 2. Mapping : détection automatique des
colonnes → objets Toron (Risques, Actions, Actifs, Fournisseurs) avec
aperçu des 5 premières lignes et menus de correspondance par colonne,
confiance de détection affichée ; 3. Résolution : les lignes rejetées sont
listées UNE PAR UNE avec la cause exacte et la correction proposée
(« Ligne 47 : échéance ‹ 31/02/2026 › invalide → corriger la date ») —
jamais d'échec silencieux, jamais de « 12 erreurs » sans détail ;
4. Confirmation : récapitulatif (214 risques, 89 actions importés), liens
vers les registres remplis. Ton rassurant et respectueux : « Vos années
de travail sous Excel ne sont pas perdues — elles deviennent votre socle. »
État d'erreur global : fichier illisible → cause + format attendu +
modèle téléchargeable.
```

## 16 · Landing page (registre marketing — à faire en dernier)

```text
TÂCHE : conçois la landing page publique de Toron. Même identité, autre
respiration : plus d'air, corps de texte plus grand, mais toujours zéro
dégradé, zéro glassmorphism, zéro capture floue générique. Structure :
Hero = la thèse « Prouvez une fois. Couvrez tout. » + sous-titre « La
plateforme de conformité des PME et ETI françaises — ISO 27001, NIS 2,
ISO 9001, RGPD sur un socle unique » + CTA « Demander une démo » (orange)
et « Voir la plateforme » (ghost) ; sous le hero, la marque en action :
les trois strates reliées par le fil, animation sobre au chargement
(le fil se tisse une fois, respecte prefers-reduced-motion). Section 2 :
la mutualisation expliquée en un schéma (un contrôle → trois référentiels).
Section 3 : le poinçon — « Chaque export est scellé : empreinte SHA-256,
vérifiable en audit ». Section 4 : souveraineté — hébergement UE, données
exportables, pas de dépendance US. Section 5 : les modules en grille
sobre. Pricing : 3 paliers simples avec prix affichés (transparence =
différenciateur face aux « contactez-nous »). Footer institutionnel.
Interdits spécifiques : badges de notation inventés, logos clients fictifs,
compteurs animés mensongers.
```
