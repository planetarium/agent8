import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModel } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex/edge';
import { PROVIDER_NAMES } from '~/lib/modules/llm/provider-names';
import { createScopedLogger } from '~/utils/logger';
import { TOOL_NAMES } from '~/utils/constants';
import { ACTION_FIELDS, GENERATE_ARTIFACT_FIELDS } from '~/lib/constants/tool-fields';

interface VertexCredentials {
  projectId: string;
  location: string;
  clientEmail: string;
  privateKey: string;
}

const VERTEX_FINISH_REASON = {
  MALFORMED_FUNCTION_CALL: 'MALFORMED_FUNCTION_CALL',
} as const;

const SSE_DATA_PREFIX = 'data: ' as const;

const logger = createScopedLogger('vertex-ai-provider');

export default class GoogleVertexProvider extends BaseProvider {
  name = PROVIDER_NAMES.GOOGLE_VERTEX_AI;
  getApiKeyLink = 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal';

  config = {
    apiTokenKey: 'GOOGLE_PRIVATE_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: PROVIDER_NAMES.GOOGLE_VERTEX_AI,
      maxTokenAllowed: 65535,
    },
    {
      name: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      provider: PROVIDER_NAMES.GOOGLE_VERTEX_AI,
      maxTokenAllowed: 65535,
    },
  ];

  async getDynamicModels(): Promise<ModelInfo[]> {
    return this.staticModels;
  }

  getModelInstance(options: {
    model: string;
    serverEnv?: any;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModel {
    const { model, serverEnv } = options;

    this._validateEnvironment();

    const credentials = this._loadCredentials(serverEnv);
    const vertexConfig = this._buildVertexConfig(credentials);

    return createVertex(vertexConfig)(model);
  }

  /**
   * Validates the runtime environment for Google Vertex AI
   * Ensures server-side execution and module availability
   */
  private _validateEnvironment(): void {
    if (typeof window !== 'undefined') {
      throw new Error('Google Vertex AI is only supported on the server side');
    }

    if (!createVertex) {
      throw new Error('Google Vertex AI module is still loading. Please try again in a moment.');
    }
  }

  /**
   * Loads and validates Google Cloud credentials from environment variables
   * Supports both Cloudflare Pages (serverEnv) and local environment (process.env)
   *
   * @param serverEnv - Server environment variables (Cloudflare Pages)
   * @returns Validated credentials object
   */
  private _loadCredentials(serverEnv?: any): VertexCredentials {
    const projectId = this._getEnvVariable('GOOGLE_CLOUD_PROJECT', serverEnv);
    const location = this._getEnvVariable('GOOGLE_CLOUD_LOCATION', serverEnv) || 'us-central1';
    const clientEmail = this._getEnvVariable('GOOGLE_CLIENT_EMAIL', serverEnv);
    const rawPrivateKey = this._getEnvVariable('GOOGLE_PRIVATE_KEY', serverEnv);

    if (!projectId) {
      throw new Error('Missing GOOGLE_CLOUD_PROJECT environment variable');
    }

    if (!clientEmail) {
      throw new Error('Missing GOOGLE_CLIENT_EMAIL environment variable');
    }

    if (!rawPrivateKey) {
      throw new Error('Missing GOOGLE_PRIVATE_KEY environment variable');
    }

    return {
      projectId,
      location,
      clientEmail,
      privateKey: this._normalizePrivateKey(rawPrivateKey),
    };
  }

  /**
   * Retrieves environment variable with fallback priority
   * 1. serverEnv (Cloudflare Pages)
   * 2. process.env (local environment)
   *
   * @param key - Environment variable name
   * @param serverEnv - Server environment variables
   * @returns Environment variable value or undefined
   */
  private _getEnvVariable(key: string, serverEnv?: any): string | undefined {
    return serverEnv?.[key] || process.env[key];
  }

  /**
   * Normalizes private key format by converting escaped newlines to actual newlines
   * Fixes base64 decoding issues when private key contains \n strings
   *
   * @param privateKey - Raw private key string
   * @returns Normalized private key with proper line breaks
   */
  private _normalizePrivateKey(privateKey: string): string {
    return privateKey.replace(/\\n/g, '\n');
  }

  /**
   * Builds Google Vertex AI configuration object
   *
   * @param credentials - Validated credentials
   * @returns Vertex AI configuration object
   */
  private _buildVertexConfig(credentials: VertexCredentials) {
    return {
      project: credentials.projectId,
      location: credentials.location,
      googleCredentials: {
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      },
      thinkingConfig: {
        includeThoughts: false,
      },
      fetch: this._createCustomFetch(),
    };
  }

  /**
   * Counts trailing backslashes before a position
   * Used to determine if a quote is escaped
   *
   * @example
   * "text\\"  at pos 5 (")  → returns 2 (even, not escaped)
   * "text\\\" at pos 6 (")  → returns 3 (odd, escaped)
   */
  private _countTrailingBackslashes(str: string, pos: number): number {
    let count = 0;
    let i = pos - 1;

    while (i >= 0 && str[i] === '\\') {
      count++;
      i--;
    }

    return count;
  }

  /**
   * Builds Python object type name from tool name and field names
   * Used to match against Vertex AI's generated Python type annotations
   *
   * @example
   * _buildObjectTypeName('generate_artifact', 'fileActions') → 'GenerateArtifactFileactions'
   * _buildObjectTypeName('generate_artifact', 'modifyActions', 'modifications') → 'GenerateArtifactModifyactionsModifications'
   */
  private _buildObjectTypeName(toolName: string, ...fieldNames: string[]): string {
    // Convert snake_case tool name to PascalCase: generate_artifact → GenerateArtifact
    const pascalToolName = toolName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');

    // Convert camelCase field names to capitalized: fileActions → Fileactions
    const normalizedFieldNames = fieldNames
      .map((fieldName) => fieldName.charAt(0).toUpperCase() + fieldName.slice(1).toLowerCase())
      .join('');

    return pascalToolName + normalizedFieldNames;
  }

  /**
   * Fallback method to extract array when field name is missing
   * Searches for all instances of type constructor and wraps them in array
   *
   * @example
   * Input: "modifyActions = [...]), default_api.GenerateArtifactFileactions(...)"
   * typeName: "GenerateArtifactFileactions"
   * Output: "[default_api.GenerateArtifactFileactions(...)]"
   */
  private _fallbackExtractArray(argsStr: string, typeName: string): string | null {
    const pattern = `default_api.${typeName}(`;
    const objects: string[] = [];
    let i = 0;

    logger.info(`fallbackExtractArray searching for pattern: ${pattern}`);

    while (i < argsStr.length) {
      const startIdx = argsStr.indexOf(pattern, i);

      if (startIdx === -1) {
        break;
      }

      // Extract complete object
      const objStr = this._extractCompleteObject(argsStr, startIdx);

      if (objStr) {
        objects.push(objStr);
        i = startIdx + objStr.length;
      } else {
        i = startIdx + pattern.length;
      }
    }

    if (objects.length === 0) {
      return null;
    }

    return '[' + objects.join(', ') + ']';
  }

  /**
   * Extracts the complete function call arguments from finishMessage
   * Finds 'default_api.{toolName}(' and extracts everything until the matching closing parenthesis
   *
   * @param finishMessage - Complete finish message containing the function call
   * @param toolName - Name of the tool/function to extract (e.g., 'generate_artifact')
   * @returns Arguments string between the parentheses, or null if not found or malformed
   */
  private _extractFunctionArgs(finishMessage: string, toolName: string): string | null {
    // Find the pattern 'default_api.{toolName}('
    const pattern = `default_api.${toolName}(`;
    const startIdx = finishMessage.indexOf(pattern);

    if (startIdx === -1) {
      logger.warn(`Pattern '${pattern}' not found in finishMessage`);
      return null;
    }

    // Find opening parenthesis
    let i = finishMessage.indexOf('(', startIdx);

    if (i === -1) {
      logger.warn('Opening parenthesis not found');
      return null;
    }

    i++; // Skip opening '('

    const argsStart = i;
    let depth = 1;
    let tripleQuoteType = ''; // '', "'''", or '"""'
    let inString = false;
    let stringChar = '';

    while (i < finishMessage.length && depth > 0) {
      const char = finishMessage[i];
      const next3 = finishMessage.substring(i, i + 3);

      /* Priority 1: Handle single/double quote strings (highest priority) */
      if (inString) {
        /* Check if this is an unescaped closing quote */
        if (char === stringChar) {
          const backslashCount = this._countTrailingBackslashes(finishMessage, i);
          const isEscaped = backslashCount % 2 === 1;

          if (!isEscaped) {
            inString = false;
            stringChar = '';
          }
        }

        i++;
        continue;
      }

      /* Priority 2: Handle triple quotes (both ''' and """) */
      if (next3 === "'''" || next3 === '"""') {
        if (tripleQuoteType === '') {
          // Opening triple quote
          tripleQuoteType = next3;
        } else if (tripleQuoteType === next3) {
          // Closing triple quote (must match opening type)
          tripleQuoteType = '';
        }

        // else: different triple quote type inside, just continue

        i += 3;
        continue;
      }

      /* Priority 3: Start new single/double quote string (only when not in triple quote) */
      if (tripleQuoteType === '' && (char === "'" || char === '"')) {
        const backslashCount = this._countTrailingBackslashes(finishMessage, i);
        const isEscaped = backslashCount % 2 === 1;

        if (!isEscaped) {
          inString = true;
          stringChar = char;
        }

        i++;
        continue;
      }

      /* Only track parentheses outside of all strings */
      if (tripleQuoteType === '') {
        if (char === '(') {
          depth++;
        } else if (char === ')') {
          depth--;

          if (depth === 0) {
            // Found closing parenthesis - return the arguments string
            return finishMessage.substring(argsStart, i);
          }
        }
      }

      i++;
    }

    // Unclosed triple quote - data is incomplete, cannot recover
    if (tripleQuoteType !== '') {
      logger.warn(`[FunctionArgs] Unclosed triple quote: '${tripleQuoteType}' - data incomplete, cannot recover`);
      return null;
    }

    // Triple quotes closed but parentheses not closed - only recoverable if depth=1
    if (depth > 0) {
      if (depth === 1) {
        logger.warn(`[FunctionArgs] Unclosed parenthesis detected (depth=1), attempting recovery`);

        const recovered = finishMessage.substring(argsStart);
        logger.info(`[FunctionArgs] Recovery attempt: extracted ${recovered.length} characters`);

        return recovered;
      } else {
        logger.error(`[FunctionArgs] Multiple unclosed parentheses detected (depth=${depth}), cannot recover`);
        return null;
      }
    }

    return null; // Should not reach here
  }

  /**
   * Extracts a complete Python object starting from given index
   * Handles parentheses matching with triple quotes and string literals
   *
   * @param argsStr - Full argument string
   * @param startIdx - Starting index of 'default_api.TypeName('
   * @returns Complete object string including 'default_api.TypeName(...)'
   */
  private _extractCompleteObject(argsStr: string, startIdx: number): string | null {
    // Find opening parenthesis
    let i = argsStr.indexOf('(', startIdx);

    if (i === -1) {
      return null;
    }

    i++; // Skip opening '('

    let depth = 1;
    let tripleQuoteType = ''; // '', "'''", or '"""'
    let inString = false;
    let stringChar = '';

    const objStart = startIdx;

    while (i < argsStr.length && depth > 0) {
      const char = argsStr[i];
      const next3 = argsStr.substring(i, i + 3);

      /* Priority 1: Handle single/double quote strings (highest priority) */
      if (inString) {
        /* Check if this is an unescaped closing quote */
        if (char === stringChar) {
          const backslashCount = this._countTrailingBackslashes(argsStr, i);
          const isEscaped = backslashCount % 2 === 1;

          if (!isEscaped) {
            inString = false;
            stringChar = '';
          }
        }

        i++;
        continue;
      }

      /* Priority 2: Handle triple quotes (both ''' and """) */
      if (next3 === "'''" || next3 === '"""') {
        if (tripleQuoteType === '') {
          // Opening triple quote
          tripleQuoteType = next3;
        } else if (tripleQuoteType === next3) {
          // Closing triple quote (must match opening type)
          tripleQuoteType = '';
        }

        // else: different triple quote type inside, just continue

        i += 3;
        continue;
      }

      /* Priority 3: Start new single/double quote string (only when not in triple quote) */
      if (tripleQuoteType === '' && (char === "'" || char === '"')) {
        const backslashCount = this._countTrailingBackslashes(argsStr, i);
        const isEscaped = backslashCount % 2 === 1;

        if (!isEscaped) {
          inString = true;
          stringChar = char;
        }

        i++;
        continue;
      }

      /* Only track parentheses outside of all strings */
      if (tripleQuoteType === '') {
        if (char === '(') {
          depth++;
        } else if (char === ')') {
          depth--;

          if (depth === 0) {
            // Found closing parenthesis
            return argsStr.substring(objStart, i + 1);
          }
        }
      }

      i++;
    }

    // Unclosed triple quote - data is incomplete, cannot recover
    if (tripleQuoteType !== '') {
      logger.error(`[CompleteObject] Unclosed triple quote: '${tripleQuoteType}' - data incomplete, cannot recover`);
      return null;
    }

    // Triple quotes closed but parentheses not closed - only recoverable if depth=1
    if (depth > 0) {
      if (depth === 1) {
        logger.warn(`[CompleteObject] Unclosed parenthesis detected (depth=1), attempting recovery`);

        const recovered = argsStr.substring(objStart) + ')';
        logger.info(`[CompleteObject] Recovery successful: added 1 closing parenthesis`);

        return recovered;
      } else {
        logger.error(`[CompleteObject] Multiple unclosed parentheses detected (depth=${depth}), cannot recover`);
        return null;
      }
    }

    return null; // Should not reach here
  }

  /**
   * Extracts value of a field from Python args string using bracket/quote matching
   * Handles nested quotes and brackets properly
   * If field name pattern is not found, tries fallback extraction by searching for type constructor
   */
  private _extractFieldValue(argsStr: string, fieldName: string): string | null {
    const fieldPattern = new RegExp(`${fieldName}\\s*=\\s*`);
    const match = fieldPattern.exec(argsStr);

    if (!match) {
      // Fallback: Try to extract by searching for type constructor directly
      const typeName = this._buildObjectTypeName(TOOL_NAMES.GENERATE_ARTIFACT, fieldName);

      if (argsStr.includes(typeName)) {
        const fallbackResult = this._fallbackExtractArray(argsStr, typeName);

        if (fallbackResult) {
          return fallbackResult;
        }
      }

      return null;
    }

    const startIdx = match.index + match[0].length;
    let i = startIdx;
    const quoteChar = argsStr[i]; // ', ", or [

    /* Handle string values (single or double quotes) */
    if (quoteChar === "'" || quoteChar === '"') {
      i++; // Skip opening quote

      let value = '';

      while (i < argsStr.length) {
        const char = argsStr[i];

        /* Check for closing quote */
        if (char === quoteChar && argsStr[i - 1] !== '\\') {
          return value;
        }

        value += char;
        i++;
      }

      return null; // Unclosed quote
    }

    /* Handle array values */
    if (quoteChar === '[') {
      let depth = 0;
      let value = '';
      let inString = false;
      let stringChar = '';
      let tripleQuoteType = ''; // '', "'''", or '"""'

      while (i < argsStr.length) {
        const char = argsStr[i];
        const next3 = argsStr.substring(i, i + 3);

        /* Priority 1: Handle single/double quote strings (highest priority) */
        if (inString) {
          /* Check if this is an unescaped closing quote */
          if (char === stringChar) {
            const backslashCount = this._countTrailingBackslashes(argsStr, i);
            const isEscaped = backslashCount % 2 === 1;

            if (!isEscaped) {
              inString = false;
              stringChar = '';
            }
          }

          value += char;
          i++;
          continue;
        }

        /* Priority 2: Handle triple quotes (both ''' and """) */
        if (next3 === "'''" || next3 === '"""') {
          if (tripleQuoteType === '') {
            // Opening triple quote
            tripleQuoteType = next3;
          } else if (tripleQuoteType === next3) {
            // Closing triple quote (must match opening type)
            tripleQuoteType = '';
          }

          // else: different triple quote type inside, just add to value

          value += next3;
          i += 3;
          continue;
        }

        /* Priority 3: Start new single/double quote string (only when not in triple quote) */
        if (tripleQuoteType === '' && (char === "'" || char === '"')) {
          const backslashCount = this._countTrailingBackslashes(argsStr, i);
          const isEscaped = backslashCount % 2 === 1;

          if (!isEscaped) {
            inString = true;
            stringChar = char;
          }

          value += char;
          i++;
          continue;
        }

        /* Only count brackets outside of all strings */
        if (tripleQuoteType === '') {
          if (char === '[') {
            depth++;
          } else if (char === ']') {
            depth--;

            if (depth === 0) {
              return value;
            }
          }
        }

        value += char;
        i++;
      }

      return null; // Unclosed bracket
    }

    return null;
  }

  /**
   * Parses Python-style function call from MALFORMED_FUNCTION_CALL finishMessage
   * Extracts generate_artifact arguments and reconstructs as valid JSON
   *
   * @param finishMessage - Python-style function call string
   * @returns Parsed arguments object or null if parsing fails
   */
  private _parsePythonFunctionCall(finishMessage: string): any {
    try {
      /* Extract complete function call using depth tracking */
      const toolName = TOOL_NAMES.GENERATE_ARTIFACT;
      const argsStr = this._extractFunctionArgs(finishMessage, toolName);

      if (!argsStr) {
        logger.warn(`Failed to extract function arguments for ${toolName}`);
        return null;
      }

      const result: any = {};

      /* Parse simple string fields: id, title, summary */
      const simpleFields = [
        GENERATE_ARTIFACT_FIELDS.ID,
        GENERATE_ARTIFACT_FIELDS.TITLE,
        GENERATE_ARTIFACT_FIELDS.SUMMARY,
      ];

      for (const field of simpleFields) {
        const value = this._extractFieldValue(argsStr, field);

        if (value !== null) {
          result[field] = value;
        }
      }

      /* Parse actions array */
      const actionsValue = this._extractFieldValue(argsStr, GENERATE_ARTIFACT_FIELDS.ACTIONS);

      if (actionsValue !== null) {
        result[GENERATE_ARTIFACT_FIELDS.ACTIONS] = this._parseActions(actionsValue);
      }

      return result;
    } catch (error) {
      logger.warn('Failed to parse Python function call:', error);
      return null;
    }
  }

  /**
   * Splits array string into individual objects by tracking parentheses depth
   */
  private _splitArrayObjects(arrayStr: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let current = '';
    let tripleQuoteType = ''; // '', "'''", or '"""'
    let inString = false;
    let stringChar = '';
    let i = 0;

    while (i < arrayStr.length) {
      const char = arrayStr[i];
      const next3 = arrayStr.substring(i, i + 3);

      /* Priority 1: Handle single/double quote strings (highest priority) */
      if (inString) {
        /* Check if this is an unescaped closing quote */
        if (char === stringChar) {
          const backslashCount = this._countTrailingBackslashes(arrayStr, i);
          const isEscaped = backslashCount % 2 === 1;

          if (!isEscaped) {
            inString = false;
            stringChar = '';
          }
        }

        current += char;
        i++;
        continue;
      }

      /* Priority 2: Handle triple quotes (both ''' and """) */
      if (next3 === "'''" || next3 === '"""') {
        if (tripleQuoteType === '') {
          // Opening triple quote
          tripleQuoteType = next3;
        } else if (tripleQuoteType === next3) {
          // Closing triple quote (must match opening type)
          tripleQuoteType = '';
        }

        // else: different triple quote type inside, just add to current

        current += next3;
        i += 3;
        continue;
      }

      /* Priority 3: Start new single/double quote string (only when not in triple quote) */
      if (tripleQuoteType === '' && (char === "'" || char === '"')) {
        const backslashCount = this._countTrailingBackslashes(arrayStr, i);
        const isEscaped = backslashCount % 2 === 1;

        if (!isEscaped) {
          inString = true;
          stringChar = char;
        }

        current += char;
        i++;
        continue;
      }

      /* Only track parentheses outside of all strings */
      if (tripleQuoteType === '') {
        if (char === '(') {
          depth++;
        } else if (char === ')') {
          depth--;

          if (depth === 0) {
            current += char;
            objects.push(current.trim());
            current = '';
            i++;
            continue;
          }
        }
      }

      current += char;
      i++;
    }

    return objects;
  }

  /**
   * Extracts field value from Python object string (handles triple quotes)
   */
  private _extractObjectField(objStr: string, fieldName: string): string | null {
    const fieldPattern = new RegExp(`${fieldName}\\s*=\\s*`);
    const match = fieldPattern.exec(objStr);

    if (!match) {
      return null;
    }

    const startIdx = match.index + match[0].length;
    let i = startIdx;

    /* Handle triple quotes (both ''' and """) */
    const triple = objStr.substring(i, i + 3);

    if (triple === "'''" || triple === '"""') {
      i += 3; // Skip opening triple quotes

      let value = '';

      while (i < objStr.length) {
        if (objStr.substring(i, i + 3) === triple) {
          return value;
        }

        value += objStr[i];
        i++;
      }

      return null; // Unclosed triple quote
    }

    /* Handle single or double quotes */
    const quoteChar = objStr[i];

    if (quoteChar === "'" || quoteChar === '"') {
      i++; // Skip opening quote

      let value = '';

      while (i < objStr.length) {
        const char = objStr[i];

        if (char === quoteChar && objStr[i - 1] !== '\\') {
          return value;
        }

        value += char;
        i++;
      }

      return null; // Unclosed quote
    }

    return null;
  }

  /**
   * Parses actions from Python array string
   */
  private _parseActions(arrayStr: string): any[] {
    const actions: any[] = [];
    const objects = this._splitArrayObjects(arrayStr);

    for (const objStr of objects) {
      const typeName = this._buildObjectTypeName(TOOL_NAMES.GENERATE_ARTIFACT, GENERATE_ARTIFACT_FIELDS.ACTIONS);

      if (!objStr.includes(typeName)) {
        continue;
      }

      const action: any = {};
      let isValidAction = false;

      /* Extract path */
      const path = this._extractObjectField(objStr, ACTION_FIELDS.PATH);

      if (path !== null) {
        action[ACTION_FIELDS.PATH] = path;
      }

      /* Extract type */
      const type = this._extractObjectField(objStr, ACTION_FIELDS.TYPE);

      if (type !== null) {
        action[ACTION_FIELDS.TYPE] = type;

        if (type === 'file') {
          /* Extract content */
          const content = this._extractObjectField(objStr, ACTION_FIELDS.CONTENT);

          if (content !== null) {
            action[ACTION_FIELDS.CONTENT] = content;
            isValidAction = true;
          }
        } else if (type === 'modify') {
          /* Extract before */
          const before = this._extractObjectField(objStr, ACTION_FIELDS.BEFORE);

          /* Extract after */
          const after = this._extractObjectField(objStr, ACTION_FIELDS.AFTER);

          if (before !== null && after !== null) {
            action[ACTION_FIELDS.BEFORE] = before;
            action[ACTION_FIELDS.AFTER] = after;
            isValidAction = true;
          }
        } else if (type === 'shell') {
          /* Extract command */
          const command = this._extractObjectField(objStr, ACTION_FIELDS.COMMAND);

          if (command !== null) {
            action[ACTION_FIELDS.COMMAND] = command;
            isValidAction = true;
          }
        }
      }

      if (isValidAction) {
        actions.push(action);
      }
    }

    return actions;
  }

  private _isValidArtifact(artifact: any): boolean {
    const actions = artifact?.actions;

    if (!actions || !Array.isArray(actions)) {
      return false;
    }

    return actions.some((action: any) => action.path && !action.path.endsWith('.md'));
  }

  /**
   * Processes a single SSE line and fixes MALFORMED_FUNCTION_CALL if needed
   * @param line - SSE line to process
   * @returns Processed line
   */
  private _processSSELine(line: string): string {
    // Only process SSE data lines
    if (!line.startsWith(SSE_DATA_PREFIX)) {
      return line;
    }

    try {
      const data = JSON.parse(line.substring(SSE_DATA_PREFIX.length));
      const candidate = data.candidates?.[0];

      if (candidate?.finishReason) {
        logger.info('finishReason:', candidate.finishReason);
      }

      /* Fix MALFORMED_FUNCTION_CALL with generate_artifact */
      if (candidate?.finishReason === VERTEX_FINISH_REASON.MALFORMED_FUNCTION_CALL) {
        const finishMessage = candidate.finishMessage || '';
        const toolName = TOOL_NAMES.GENERATE_ARTIFACT;

        if (finishMessage.includes(toolName)) {
          /* Parse Python function call */
          const parsedArgs = this._parsePythonFunctionCall(finishMessage);

          if (parsedArgs && this._isValidArtifact(parsedArgs)) {
            logger.debug('parsedArgs:', parsedArgs);

            /* Create valid functionCall part */
            const fixedPart = {
              functionCall: {
                name: toolName,
                args: parsedArgs,
              },
            };

            /* Add to content.parts or create new content */
            if (!candidate.content) {
              candidate.content = { parts: [fixedPart] };
            } else if (!candidate.content.parts) {
              candidate.content.parts = [fixedPart];
            } else {
              candidate.content.parts.push(fixedPart);
            }

            /* Change finishReason to STOP */
            candidate.finishReason = 'STOP';
          } else {
            logger.warn('Failed to parse Python function call:', parsedArgs);
          }
        }
      }

      return `data: ${JSON.stringify(data)}`;
    } catch (parseError) {
      logger.warn('Failed to parse/modify SSE line:', parseError);
      return line;
    }
  }

  /**
   * Creates a custom fetch function that intercepts Vertex AI responses
   * Fixes MALFORMED_FUNCTION_CALL errors by parsing Python-style function calls
   * Uses streaming to avoid blocking and prevent timeouts in Cloudflare Workers
   * Buffers complete SSE events (until \n\n) to ensure JSON integrity
   *
   * @returns Custom fetch function
   */
  private _createCustomFetch(): typeof fetch {
    const originalFetch = globalThis.fetch;

    return async (url, init) => {
      const response = await originalFetch(url, init);

      if (!response.ok) {
        return response;
      }

      if (!response.body) {
        return response;
      }

      const contentType = response.headers.get('content-type');

      const isStreaming = contentType?.includes('text/event-stream');

      try {
        if (isStreaming) {
          let buffer = '';

          const transformStream = new TransformStream({
            transform: (chunk, controller) => {
              // Add to buffer
              buffer += chunk;

              // SSE events are separated by \n\n
              const events = buffer.split('\n\n');

              // Keep last incomplete event in buffer
              buffer = events.pop() || '';

              // Process each complete event
              for (const event of events) {
                if (event.trim()) {
                  const lines = event.split('\n');
                  const processedLines = lines.map((line) => this._processSSELine(line));
                  controller.enqueue(processedLines.join('\n') + '\n\n');
                }
              }
            },
            flush: (controller) => {
              // Process any remaining buffer
              if (buffer.trim()) {
                const lines = buffer.split('\n');
                const processedLines = lines.map((line) => this._processSSELine(line));
                controller.enqueue(processedLines.join('\n'));
              }
            },
          });

          return new Response(
            response.body
              .pipeThrough(new TextDecoderStream())
              .pipeThrough(transformStream)
              .pipeThrough(new TextEncoderStream()),
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            },
          );
        } else {
          const rawText = await response.text();
          const lines = rawText.split('\n');
          const processedLines = lines.map((line) => this._processSSELine(line));
          const modifiedText = processedLines.join('\n');

          return new Response(modifiedText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch (error) {
        logger.warn('Failed to transform response:', error);

        return response;
      }
    };
  }
}
