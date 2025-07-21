import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

let createVertex: any = null;

if (typeof window === 'undefined') {
  try {
    const module = await import('@ai-sdk/google-vertex');
    createVertex = module.createVertex;
  } catch (error) {
    console.warn('Failed to load @ai-sdk/google-vertex:', error);
  }
}

export default class GoogleVertexProvider extends BaseProvider {
  name = 'GoogleVertexAI';
  getApiKeyLink = 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal';

  config = {
    baseUrlKey: 'GOOGLE_CLOUD_PROJECT',
    apiTokenKey: 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  };

  staticModels: ModelInfo[] = [
    { name: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 65535 },
    { name: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro - Vertex', provider: 'GoogleVertexAI', maxTokenAllowed: 65535 },
    { name: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'GoogleVertexAI', maxTokenAllowed: 8192 },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { projectId } = this._getVertexAIConfig({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
    });

    if (!projectId) {
      throw new Error(
        `Missing Google Cloud Project ID for ${this.name} provider. Please set GOOGLE_CLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS_JSON.`,
      );
    }

    return this.staticModels;
  }

  private _getVertexAIConfig(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: IProviderSetting;
    serverEnv?: Record<string, string>;
  }) {
    const { apiKeys, providerSettings, serverEnv } = options;

    // Use BaseProvider's method to get configuration
    const { baseUrl: projectId, apiKey: credentialsJson } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv,
      defaultBaseUrlKey: 'GOOGLE_CLOUD_PROJECT',
      defaultApiTokenKey: 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    });

    // Parse credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON
    let credentials = null;

    if (credentialsJson) {
      try {
        credentials = JSON.parse(credentialsJson);
      } catch (error) {
        console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
        throw new Error('Invalid JSON format in GOOGLE_APPLICATION_CREDENTIALS_JSON');
      }
    }

    // Get project ID from credentials if not provided directly
    const finalProjectId = projectId || credentials?.project_id;

    const location =
      serverEnv?.GOOGLE_CLOUD_LOCATION ||
      process?.env?.GOOGLE_CLOUD_LOCATION ||
      apiKeys?.GOOGLE_CLOUD_LOCATION ||
      'us-central1';

    return { projectId: finalProjectId, location, credentials };
  }

  getModelInstance(options: {
    model: string;
    serverEnv: any;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    // Browser environment check
    if (typeof window !== 'undefined') {
      throw new Error('Google Vertex AI provider can only be used on the server side');
    }

    if (!createVertex) {
      throw new Error('Google Vertex AI not available - failed to load @ai-sdk/google-vertex package');
    }

    const { projectId, location, credentials } = this._getVertexAIConfig({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
    });

    if (!projectId) {
      throw new Error(
        `Missing Google Cloud Project ID for ${this.name} provider. Please set GOOGLE_CLOUD_PROJECT or provide credentials in GOOGLE_APPLICATION_CREDENTIALS_JSON.`,
      );
    }

    const vertexConfig: any = {
      project: projectId,
      location,
    };

    if (credentials) {
      vertexConfig.googleAuthOptions = { credentials };
    }

    const vertex = createVertex(vertexConfig);

    return vertex(model);
  }
}
