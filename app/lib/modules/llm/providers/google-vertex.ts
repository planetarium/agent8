import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModel } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex/edge';
import { PROVIDER_NAMES } from '~/lib/modules/llm/provider-names';
import { createScopedLogger } from '~/utils/logger';

// import { ACTION_FIELDS, GENERATE_ARTIFACT_FIELDS } from '~/lib/constants/tool-fields';

interface VertexCredentials {
  projectId: string;
  location: string;
  clientEmail: string;
  privateKey: string;
}

/*
 * const VERTEX_FINISH_REASON = {
 *   MALFORMED_FUNCTION_CALL: 'MALFORMED_FUNCTION_CALL',
 * } as const;
 */

const SSE_DATA_PREFIX = 'data: ' as const;

const logger = createScopedLogger('vertex-ai-provider');

export default class GoogleVertexProvider extends BaseProvider {
  // private _artifactParser = new ArtifactParser();

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
    {
      name: 'gemini-3-pro-preview',
      label: 'Gemini 3 Pro',
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

      return line;
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
