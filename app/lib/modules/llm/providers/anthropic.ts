import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModel } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createScopedLogger } from '~/utils/logger';
import { PROVIDER_NAMES } from '~/lib/modules/llm/provider-names';

const logger = createScopedLogger('llm.providers.anthropic');

export default class AnthropicProvider extends BaseProvider {
  name = PROVIDER_NAMES.ANTHROPIC;
  getApiKeyLink = 'https://console.anthropic.com/settings/keys';

  config = {
    apiTokenKey: 'ANTHROPIC_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'claude-sonnet-4.5',
      label: 'Claude 4.5 Sonnet',
      provider: PROVIDER_NAMES.ANTHROPIC,
      maxTokenAllowed: 64000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.anthropic.com/v1/models`, {
      headers: {
        'x-api-key': `${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter((model: any) => model.type === 'model' && !staticModelIds.includes(model.id));

    return data.map((m: any) => ({
      name: m.id,
      label: `${m.display_name}`,
      provider: this.name,
      maxTokenAllowed: 32000,
    }));
  }

  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModel = (options) => {
    const { serverEnv, model } = options;
    const apiKey = serverEnv.ANTHROPIC_API_KEY;
    const anthropic = createAnthropic({
      apiKey,
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'token-efficient-tools-2025-02-19',
      },
      fetch: (url, options: any) => {
        try {
          const body = JSON.parse(options.body as string);

          /*
           * When using tools on the Anthropic model, apply the cache_control to the tool call.
           * See alse: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching?q=cach#caching-tool-definitions
           */

          if (body.tools?.length > 0) {
            body.tools[body.tools.length - 1].cache_control = { type: 'ephemeral' };
          }

          options.body = JSON.stringify(body);
        } catch {
          logger.error('Error parsing Anthropic request body', { url, options });
        }

        return fetch(url, options);
      },
    });

    return anthropic(model);
  };
}
