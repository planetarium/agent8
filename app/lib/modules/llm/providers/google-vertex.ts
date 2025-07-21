import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

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

  async getDynamicModels(): Promise<ModelInfo[]> {
    return this.staticModels;
  }

  getModelInstance(options: {
    model: string;
    serverEnv?: any;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model } = options;

    // Browser environment is not supported
    if (typeof window !== 'undefined') {
      throw new Error('Google Vertex AI is only supported on the server side');
    }

    // Use Google Vertex AI SDK directly on server
    const createVertexModel = async () => {
      const { createVertex } = await import('@ai-sdk/google-vertex');

      // Read settings from environment variables (no credential transmission)
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      if (!projectId) {
        throw new Error('Missing GOOGLE_CLOUD_PROJECT environment variable');
      }

      const vertexConfig: any = {
        project: projectId,
        location,
      };

      // Parse and use credentials JSON if available
      if (credentialsJson) {
        try {
          const credentials = JSON.parse(credentialsJson);
          vertexConfig.googleAuthOptions = { credentials };
        } catch {
          throw new Error('Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON format');
        }
      }

      const vertex = createVertex(vertexConfig);

      return vertex(model);
    };

    // Proxy for lazy loading
    let modelPromise: Promise<LanguageModelV1> | null = null;

    const getModel = () => {
      if (!modelPromise) {
        modelPromise = createVertexModel();
      }

      return modelPromise;
    };

    return {
      specificationVersion: 'v1',
      provider: 'google-vertex',
      modelId: model,
      defaultObjectGenerationMode: undefined,

      async doGenerate(options: any) {
        const vertexModel = await getModel();
        return vertexModel.doGenerate(options);
      },

      async doStream(options: any) {
        const vertexModel = await getModel();
        return vertexModel.doStream(options);
      },
    } as LanguageModelV1;
  }
}
