import { LLMManager } from '~/lib/modules/llm/manager';
import type { Template } from '~/types/template';

export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
export const MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
export const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
export const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
export const DEFAULT_MODEL = 'anthropic/claude-3.7-sonnet';
export const PROMPT_COOKIE_KEY = 'cachedPrompt';

const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();
export const DEFAULT_PROVIDER = llmManager.getDefaultProvider();

export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {};
PROVIDER_LIST.forEach((provider) => {
  providerBaseUrlEnvKeys[provider.name] = {
    baseUrlKey: provider.config.baseUrlKey,
    apiTokenKey: provider.config.apiTokenKey,
  };
});

// starter Templates

export const STARTER_TEMPLATES: Template[] = [
  {
    name: 'basic-vite-react',
    label: 'Basic Template',
    description: 'Lightweight Vite starter template for building fast static websites',
    githubRepo: 'planetarium/agent8-templates',
    path: 'basic-vite-react',
    tags: ['vite', 'react', 'typescript', 'minimal'],
  },
  {
    name: 'basic-2d-game',
    label: 'Basic 2D Game Template',
    description:
      'Template for creating 2D games using Phaser with React integration. Ideal for platformers, top-down games, and side-scrollers with physics, sprites, and animations.',
    githubRepo: 'planetarium/agent8-templates',
    path: 'basic-2d',
    tags: ['vite', 'react', 'typescript', 'phaser'],
  },
  {
    name: 'basic-3d-game',
    label: 'Basic 3D Game Template',
    description:
      'Template for building 3D games using Three.js and react-three-fiber. Perfect for creating immersive 3D environments, first-person experiences, and interactive 3D visualizations.',
    githubRepo: 'planetarium/agent8-templates',
    path: 'basic-3d',
    tags: ['vite', 'react', 'typescript', 'three.js'],
  },
];
