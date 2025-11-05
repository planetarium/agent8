import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModel } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex/edge';
import { PROVIDER_NAMES } from '~/lib/modules/llm/provider-names';
import {
  SUBMIT_ARTIFACT_FIELDS,
  FILE_ACTION_FIELDS,
  MODIFY_ACTION_FIELDS,
  MODIFICATION_FIELDS,
  SHELL_ACTION_FIELDS,
} from '~/lib/constants/tool-fields';
import { TOOL_NAMES } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

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
   * _buildObjectTypeName('submit_artifact', 'fileActions') → 'SubmitArtifactFileactions'
   * _buildObjectTypeName('submit_artifact', 'modifyActions', 'modifications') → 'SubmitArtifactModifyactionsModifications'
   */
  private _buildObjectTypeName(toolName: string, ...fieldNames: string[]): string {
    // Convert snake_case tool name to PascalCase: submit_artifact → SubmitArtifact
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
   * Extracts value of a field from Python args string using bracket/quote matching
   * Handles nested quotes and brackets properly
   */
  private _extractFieldValue(argsStr: string, fieldName: string): string | null {
    const fieldPattern = new RegExp(`${fieldName}\\s*=\\s*`);
    const match = fieldPattern.exec(argsStr);

    if (!match) {
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
      let inTripleQuote = false;

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
          inTripleQuote = !inTripleQuote;
          value += next3;
          i += 3;
          continue;
        }

        /* Priority 3: Start new single/double quote string (only when not in triple quote) */
        if (!inTripleQuote && (char === "'" || char === '"')) {
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
        if (!inTripleQuote) {
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
   * Extracts submit_artifact arguments and reconstructs as valid JSON
   *
   * @param finishMessage - Python-style function call string
   * @returns Parsed arguments object or null if parsing fails
   */
  private _parsePythonFunctionCall(finishMessage: string): any {
    try {
      /* Extract content between submit_artifact( and final ) */
      const toolName = TOOL_NAMES.SUBMIT_ARTIFACT;
      const pattern = new RegExp(`${toolName}\\((.*)\\)\\)`, 's');
      const match = finishMessage.match(pattern);

      if (!match) {
        return null;
      }

      const argsStr = match[1];
      const result: any = {};

      /* Parse simple string fields: id, title, summary */
      const simpleFields = [SUBMIT_ARTIFACT_FIELDS.ID, SUBMIT_ARTIFACT_FIELDS.TITLE, SUBMIT_ARTIFACT_FIELDS.SUMMARY];

      for (const field of simpleFields) {
        const value = this._extractFieldValue(argsStr, field);

        if (value !== null) {
          result[field] = value;
        }
      }

      /* Parse fileActions array */
      const fileActionsValue = this._extractFieldValue(argsStr, SUBMIT_ARTIFACT_FIELDS.FILE_ACTIONS);

      if (fileActionsValue !== null) {
        result[SUBMIT_ARTIFACT_FIELDS.FILE_ACTIONS] = this._parseFileActions(fileActionsValue);
      }

      /* Parse modifyActions array */
      const modifyActionsValue = this._extractFieldValue(argsStr, SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS);

      if (modifyActionsValue !== null) {
        result[SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS] = this._parseModifyActions(modifyActionsValue);
      }

      /* Parse shellActions array */
      const shellActionsValue = this._extractFieldValue(argsStr, SUBMIT_ARTIFACT_FIELDS.SHELL_ACTIONS);

      if (shellActionsValue !== null) {
        result[SUBMIT_ARTIFACT_FIELDS.SHELL_ACTIONS] = this._parseShellActions(shellActionsValue);
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
    let inTripleQuote = false;
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
        inTripleQuote = !inTripleQuote;
        current += next3;
        i += 3;
        continue;
      }

      /* Priority 3: Start new single/double quote string (only when not in triple quote) */
      if (!inTripleQuote && (char === "'" || char === '"')) {
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
      if (!inTripleQuote) {
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

    /* Handle triple quotes */
    if (objStr.substring(i, i + 3) === "'''") {
      i += 3; // Skip opening '''

      let value = '';

      while (i < objStr.length) {
        if (objStr.substring(i, i + 3) === "'''") {
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
   * Parses fileActions from Python array string
   */
  private _parseFileActions(arrayStr: string): any[] {
    const actions: any[] = [];
    const objects = this._splitArrayObjects(arrayStr);

    for (const objStr of objects) {
      const typeName = this._buildObjectTypeName(TOOL_NAMES.SUBMIT_ARTIFACT, SUBMIT_ARTIFACT_FIELDS.FILE_ACTIONS);

      if (!objStr.includes(typeName)) {
        continue;
      }

      const action: any = {};

      /* Extract path */
      const path = this._extractObjectField(objStr, FILE_ACTION_FIELDS.PATH);

      if (path !== null) {
        action[FILE_ACTION_FIELDS.PATH] = path;
      }

      /* Extract content */
      const content = this._extractObjectField(objStr, FILE_ACTION_FIELDS.CONTENT);

      if (content !== null) {
        action[FILE_ACTION_FIELDS.CONTENT] = content;
      }

      actions.push(action);
    }

    return actions;
  }

  /**
   * Parses modifyActions from Python array string
   */
  private _parseModifyActions(arrayStr: string): any[] {
    const actions: any[] = [];
    const objects = this._splitArrayObjects(arrayStr);

    for (const objStr of objects) {
      const typeName = this._buildObjectTypeName(TOOL_NAMES.SUBMIT_ARTIFACT, SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS);

      if (!objStr.includes(typeName)) {
        continue;
      }

      const action: any = {};

      /* Extract path */
      const path = this._extractObjectField(objStr, MODIFY_ACTION_FIELDS.PATH);

      if (path !== null) {
        action[MODIFY_ACTION_FIELDS.PATH] = path;
      }

      /* Extract modifications array */
      const modsValue = this._extractFieldValue(objStr, MODIFY_ACTION_FIELDS.MODIFICATIONS);

      if (modsValue !== null) {
        action[MODIFY_ACTION_FIELDS.MODIFICATIONS] = this._parseModifications(modsValue);
      }

      actions.push(action);
    }

    return actions;
  }

  /**
   * Parses modifications array from Python string
   */
  private _parseModifications(arrayStr: string): any[] {
    const modifications: any[] = [];
    const objects = this._splitArrayObjects(arrayStr);

    for (const objStr of objects) {
      const typeName = this._buildObjectTypeName(
        TOOL_NAMES.SUBMIT_ARTIFACT,
        SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS,
        MODIFY_ACTION_FIELDS.MODIFICATIONS,
      );

      if (!objStr.includes(typeName)) {
        continue;
      }

      const modification: any = {};

      /* Extract before */
      const before = this._extractObjectField(objStr, MODIFICATION_FIELDS.BEFORE);

      if (before !== null) {
        modification[MODIFICATION_FIELDS.BEFORE] = before;
      }

      /* Extract after */
      const after = this._extractObjectField(objStr, MODIFICATION_FIELDS.AFTER);

      if (after !== null) {
        modification[MODIFICATION_FIELDS.AFTER] = after;
      }

      modifications.push(modification);
    }

    return modifications;
  }

  /**
   * Parses shellActions from Python array string
   */
  private _parseShellActions(arrayStr: string): any[] {
    const actions: any[] = [];
    const objects = this._splitArrayObjects(arrayStr);

    for (const objStr of objects) {
      const typeName = this._buildObjectTypeName(TOOL_NAMES.SUBMIT_ARTIFACT, SUBMIT_ARTIFACT_FIELDS.SHELL_ACTIONS);

      if (!objStr.includes(typeName)) {
        continue;
      }

      const action: any = {};

      /* Extract command */
      const command = this._extractObjectField(objStr, SHELL_ACTION_FIELDS.COMMAND);

      if (command !== null) {
        action[SHELL_ACTION_FIELDS.COMMAND] = command;
      }

      actions.push(action);
    }

    return actions;
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

      /* Fix MALFORMED_FUNCTION_CALL with submit_artifact */
      if (candidate?.finishReason === VERTEX_FINISH_REASON.MALFORMED_FUNCTION_CALL) {
        const finishMessage = candidate.finishMessage || '';
        const toolName = TOOL_NAMES.SUBMIT_ARTIFACT;

        if (finishMessage.includes(toolName)) {
          /* Parse Python function call */
          const parsedArgs = this._parsePythonFunctionCall(finishMessage);

          if (parsedArgs) {
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
        response
          .body!.pipeThrough(new TextDecoderStream())
          .pipeThrough(transformStream)
          .pipeThrough(new TextEncoderStream()),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    };
  }
}
