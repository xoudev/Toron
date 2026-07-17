import 'server-only';

import { cache } from 'react';

import { resolveTenantContext } from './tenant-context.js';

/**
 * Mémoïsation par requête (React cache) : layout et page partagent la
 * même résolution session → tenant → membership sans requête double.
 */
export const getTenantContext = cache(resolveTenantContext);
