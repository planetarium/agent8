/**
 * Tool field name constants - Single source of truth
 * Shared between client and server code
 */

/**
 * Generate artifact field names
 */
export const GENERATE_ARTIFACT_FIELDS = {
  ID: 'id',
  TITLE: 'title',
  SUMMARY: 'summary',
  FILE_ACTIONS: 'fileActions',
  MODIFY_ACTIONS: 'modifyActions',
  SHELL_ACTIONS: 'shellActions',
} as const;

/**
 * File action field names
 */
export const FILE_ACTION_FIELDS = {
  PATH: 'path',
  CONTENT: 'content',
} as const;

/**
 * Modify action field names
 */
export const MODIFY_ACTION_FIELDS = {
  PATH: 'path',
  MODIFICATIONS: 'modifications',
} as const;

/**
 * Modification field names
 */
export const MODIFICATION_FIELDS = {
  BEFORE: 'before',
  AFTER: 'after',
} as const;

/**
 * Shell action field names
 */
export const SHELL_ACTION_FIELDS = {
  COMMAND: 'command',
} as const;
