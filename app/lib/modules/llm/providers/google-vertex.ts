import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex/edge';

export default class GoogleVertexProvider extends BaseProvider {
  name = 'GoogleVertexAI';
  getApiKeyLink = 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal';

  config = {
    baseUrlKey: 'GOOGLE_CLOUD_PROJECT',
    apiTokenKey: 'GOOGLE_PRIVATE_KEY',
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
    const { model, serverEnv } = options;

    // Browser environment is not supported
    if (typeof window !== 'undefined') {
      throw new Error('Google Vertex AI is only supported on the server side');
    }

    // Check if Google Vertex module is loaded
    if (!createVertex) {
      throw new Error('Google Vertex AI module is still loading. Please try again in a moment.');
    }

    /*
     * Read settings from environment variables with fallback order:
     * 1. serverEnv (Cloudflare Pages)
     * 2. process.env (local environment)
     */
    const projectId = serverEnv?.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    const location = serverEnv?.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

    if (!projectId) {
      throw new Error('Missing GOOGLE_CLOUD_PROJECT environment variable');
    }

    const clientEmail = serverEnv?.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = serverEnv?.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;

    // Private key의 \n을 실제 줄바꿈으로 변환 (base64 오류 해결)
    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const vertexConfig: any = {
      project: projectId,
      location,
      googleCredentials: {
        clientEmail,
        privateKey,
      },
    };

    const vertex = createVertex(vertexConfig);

    return vertex(model);
  }
}
