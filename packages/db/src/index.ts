export { createDb, type Db, type DbHandle } from './client.js';
export { withTenant, type TenantTx } from './tenant.js';
export { applyMigrations } from './migrate.js';
export { writeAuditEntry, type AuditEntry } from './audit.js';
export * as schema from './schema/index.js';
