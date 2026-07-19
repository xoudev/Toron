-- ═══════════════════════════════════════════════════════════════════════
-- 0020 · Documents : rattachement processus + éditeur intégré (module 5.6)
-- ═══════════════════════════════════════════════════════════════════════
-- Deux ajouts non destructifs :
--  · documents.process_id — rattache une procédure/fiche au processus qu'elle
--    décrit (tri du registre documentaire par processus). ON DELETE SET NULL :
--    supprimer un processus ne perd pas le document.
--  · document_versions.body — contenu rédigé DANS Toron (éditeur intégré), en
--    plus de l'upload de fichier. L'immuabilité des versions publiées
--    (trigger document_versions_freeze) protège aussi ce champ.

ALTER TABLE documents
  ADD COLUMN process_id uuid REFERENCES processes(id) ON DELETE SET NULL;
CREATE INDEX documents_process_idx ON documents (process_id);

ALTER TABLE document_versions
  ADD COLUMN body text;
