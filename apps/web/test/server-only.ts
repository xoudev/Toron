// Remplace « server-only » sous vitest : le module réel lève hors du
// rendu serveur de Next, ce qui empêcherait d'importer lib/ dans un test.
export {};
