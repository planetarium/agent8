import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModel } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex/edge';

interface VertexCredentials {
  projectId: string;
  location: string;
  clientEmail: string;
  privateKey: string;
}

export default class GoogleVertexProvider extends BaseProvider {
  name = 'GoogleVertexAI';
  getApiKeyLink = 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal';

  config = {
    apiTokenKey: 'GOOGLE_PRIVATE_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 65535 },
    { name: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'GoogleVertexAI', maxTokenAllowed: 65535 },
    { name: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
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
    };
  }
}
