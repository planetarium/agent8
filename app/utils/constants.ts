import { LLMManager } from '~/lib/modules/llm/manager';
import type { Template } from '~/types/template';
import { PROVIDER_NAMES } from '~/lib/modules/llm/provider-names';

export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
export const MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
export const AUTO_SYNTAX_FIX_TAG_NAME = 'autoSyntaxFix';

// Message annotations
export const MESSAGE_ANNOTATIONS = {
  ABORTED: 'aborted',
  HIDDEN: 'hidden',
  RESTORE_MESSAGE: 'restore-message',
} as const;

export const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
export const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
export const ATTACHMENTS_REGEX = /\[Attachments: (.*?)\]\n\n/;
export const DEV_TAG_REGEX = /<__DEV__>(.*?)<\/__DEV__>/gs;
export const DEFAULT_MODEL = 'auto';
export const PROMPT_COOKIE_KEY = 'cachedPrompt';

const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();
export const DEFAULT_PROVIDER = PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!;

const DEFAULT_MODEL_NAME = 'gemini-3-pro-preview';

export const FIXED_MODELS = {
  SELECT_STARTER_TEMPLATES: [
    {
      provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
      model: 'gemini-2.5-flash',
    },
    {
      provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
      model: 'gemini-2.5-flash',
    },
  ],
  PROMPT_ENHANCER_TEMPLATE: {
    model: 'gemini-2.5-pro',
    provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
  },
  FIRST_2D_CHAT: {
    model: DEFAULT_MODEL_NAME,
    provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
  },
  FIRST_3D_CHAT: {
    model: DEFAULT_MODEL_NAME,
    provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
  },
  DEFAULT_MODEL: {
    model: DEFAULT_MODEL_NAME,
    provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
  },
  IMAGE_DESCRIPTION: {
    model: 'gemini-2.5-flash',
    provider: PROVIDER_LIST.find((p) => p.name === PROVIDER_NAMES.GOOGLE_VERTEX_AI)!,
  },
};

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

// Tool configurations
export const TOOL_NAMES = {
  // Internal system tool - prefixed to avoid conflicts with user tools
  UNKNOWN_HANDLER: '__system_unknownToolHandler',
  INVALID_TOOL_INPUT_HANDLER: '__system_invalidToolInputHandler',

  SUBMIT_FILE_ACTION: 'submit_file_action',
  SUBMIT_MODIFY_ACTION: 'submit_modify_action',
  SUBMIT_SHELL_ACTION: 'submit_shell_action',
  SEARCH_FILE_CONTENTS: 'search_file_contents',
  READ_FILES_CONTENTS: 'read_files_contents',
} as const;

export const SHELL_COMMANDS = {
  UPDATE_DEPENDENCIES: 'bun update',
  START_DEV_SERVER: 'bun run dev',
  BUILD_PROJECT: 'bun run build',
} as const;

export const REACT_THREE_FIBER_PACKAGE_NAME = '@react-three/fiber';
export const VIBE_STARTER_3D_PACKAGE_NAME = 'vibe-starter-3d';
export const VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME = 'vibe-starter-3d-environment';

export const EXCLUSIVE_3D_DOC_TOOLS = [
  'read_r3f_rapier_essentials',
  'read_projectile_systems',
  'read_input_system_guide',
  'read_how_to_use_3d_tree',
  'read_environment_terrain',
  'read_environment_stage',
  'read_environment_grass',
  'read_environment_model_placer',
  'read_environment_navigator',
  'read_environment_trigger',
  'read_environment_water',
  'read_environment_weather',
  'read_vibe_starter_3d_character',
  'read_vibe_starter_3d_follow_light',
  'read_vibe_starter_3d_rigidbody_object',
  'read_vibe_starter_3d_rigidbody_player',
  'read_vibe_starter_3d_view_controllers',
];

// Error names
export const ERROR_NAMES = {
  ABORT: 'AbortError',
} as const;

export const ATTACHMENT_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',

  // 3D 모델
  '.glb',
  '.gltf',
  '.vrm',

  // 오디오
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',

  // 비디오
  '.mp4',
  '.webm',
  '.mov',

  // 폰트
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',

  // 텍스트
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xml',
];
