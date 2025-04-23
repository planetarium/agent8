/**
 * This client-only module that contains everything related to auth and is used
 * to avoid importing `@webcontainer/api` in the server bundle.
 */

/**
 * Interfaces needed for authentication processing can be defined later.
 * Currently maintained as is to maintain compatibility with the original code.
 */
export { auth, type AuthAPI } from '@webcontainer/api';

/**
 * TODO: Will be replaced with abstracted authentication interfaces and implementations in the future
 *
 * import type { AuthAPI } from '@webcontainer/api';
 * import { auth as webcontainerAuth } from '@webcontainer/api';
 *
 * export type { AuthAPI };
 * export const auth = webcontainerAuth;
 */
