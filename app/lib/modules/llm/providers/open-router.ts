import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('open-router');

interface OpenRouterModel {
  name: string;
  id: string;
  context_length: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export default class OpenRouterProvider extends BaseProvider {
  name = 'OpenRouter';
  getApiKeyLink = 'https://openrouter.ai/settings/keys';

  config = {
    apiTokenKey: 'OPEN_ROUTER_API_KEY',
  };

  staticModels: ModelInfo[] = [];

  async getDynamicModels(
    _apiKeys?: Record<string, string>,
    _settings?: IProviderSetting,
    _serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = (await response.json()) as OpenRouterModelsResponse;

      return data.data
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => {
          const maxTokenAllowed = m.name.includes('Claude 3.7 Sonnet') ? 64000 : 8000;
          return {
            name: m.id,
            label: `${m.name} - in:$${(m.pricing.prompt * 1_000_000).toFixed(2)} out:$${(m.pricing.completion * 1_000_000).toFixed(2)} - context ${Math.floor(m.context_length / 1000)}k`,
            provider: this.name,
            maxTokenAllowed,
          };
        });
    } catch (error) {
      console.error('Error getting OpenRouter models:', error);
      return [];
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPEN_ROUTER_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openRouter = createOpenRouter({
      apiKey,
      fetch: (url, options: any) => {
        try {
          const body = JSON.parse(options.body as string);

          /*
           * When using the Anthropic model on OpenRouter, the cache_control format differs and needs to be adjusted accordingly.
           * See: https://openrouter.ai/docs/features/prompt-caching#anthropic-claude
           */

          if (body.model?.startsWith('anthropic') && body.messages?.length > 0) {
            body.messages = body.messages.map((message: any) => {
              if (message.cache_control) {
                return {
                  role: message.role,
                  content: [
                    {
                      type: 'text',
                      text: message.content,
                      cache_control: message.cache_control,
                    },
                  ],
                };
              }

              return message;
            });

            body.provider = {
              order: ['Anthropic'],
            };

            options.body = JSON.stringify(body);
          }
        } catch {
          logger.error('Error parsing OpenRouter request body', { url, options });
        }

        return fetch(url, options);
      },
    });
    const instance = openRouter.chat(model) as LanguageModelV1;

    return instance;
  }
}
