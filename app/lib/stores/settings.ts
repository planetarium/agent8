import { atom, map } from 'nanostores';
import { PROVIDER_LIST } from '~/utils/constants';
import type { IProviderConfig } from '~/types/model';
import type {
  TabVisibilityConfig,
  TabWindowConfig,
  UserTabConfig,
  DevTabConfig,
} from '~/components/@settings/core/types';
import { DEFAULT_TAB_CONFIG } from '~/components/@settings/core/constants';
import Cookies from 'js-cookie';
import { toggleTheme } from './theme';
import { create } from 'zustand';

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlOrMetaKey?: boolean;
  action: () => void;
  description?: string; // Description of what the shortcut does
  isPreventDefault?: boolean; // Whether to prevent default browser behavior
}

export interface Shortcuts {
  toggleTheme: Shortcut;
  toggleTerminal: Shortcut;
}

// MCP server settings interface
export interface MCPServer {
  name: string;
  url: string;
  enabled: boolean;
  v8AuthIntegrated: boolean;
  description?: string;
}

export const URL_CONFIGURABLE_PROVIDERS = ['Ollama', 'LMStudio', 'OpenAILike'];
export const LOCAL_PROVIDERS = ['OpenAILike', 'LMStudio', 'Ollama'];

export type ProviderSetting = Record<string, IProviderConfig>;

// Simplified shortcuts store with only theme toggle
export const shortcutsStore = map<Shortcuts>({
  toggleTheme: {
    key: 'd',
    metaKey: true,
    altKey: true,
    shiftKey: true,
    action: () => toggleTheme(),
    description: 'Toggle theme',
    isPreventDefault: true,
  },
  toggleTerminal: {
    key: '`',
    ctrlOrMetaKey: true,
    action: () => {
      // This will be handled by the terminal component
    },
    description: 'Toggle terminal',
    isPreventDefault: true,
  },
});

// Create a single key for provider settings
const PROVIDER_SETTINGS_KEY = 'provider_settings';

// Add this helper function at the top of the file
const isBrowser = typeof window !== 'undefined';

// Initialize provider settings from both localStorage and defaults
const getInitialProviderSettings = (): ProviderSetting => {
  const initialSettings: ProviderSetting = {};

  // Start with default settings
  PROVIDER_LIST.forEach((provider) => {
    initialSettings[provider.name] = {
      ...provider,
      settings: {
        // Only enable by default, disable all others
        enabled: ['Anthropic', 'OpenRouter', 'OpenAI'].includes(provider.name),
      },
    };
  });

  // Only try to load from localStorage in the browser
  if (isBrowser) {
    const savedSettings = localStorage.getItem(PROVIDER_SETTINGS_KEY);

    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        Object.entries(parsed).forEach(([key, value]) => {
          if (initialSettings[key]) {
            initialSettings[key].settings = (value as IProviderConfig).settings;
          }
        });
      } catch (error) {
        console.error('Error parsing saved provider settings:', error);
      }
    }
  }

  return initialSettings;
};

export const providersStore = map<ProviderSetting>(getInitialProviderSettings());

// Create a function to update provider settings that handles both store and persistence
export const updateProviderSettings = (provider: string, settings: ProviderSetting) => {
  const currentSettings = providersStore.get();

  // Create new provider config with updated settings
  const updatedProvider = {
    ...currentSettings[provider],
    settings: {
      ...currentSettings[provider].settings,
      ...settings,
    },
  };

  // Update the store with new settings
  providersStore.setKey(provider, updatedProvider);

  // Save to localStorage
  const allSettings = providersStore.get();
  localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(allSettings));
};

export const isDebugMode = atom(false);

// Define keys for localStorage
export const SETTINGS_KEYS = {
  LATEST_BRANCH: 'isLatestBranch',
  AUTO_SELECT_TEMPLATE: 'autoSelectTemplate',
  CONTEXT_OPTIMIZATION: 'contextOptimizationEnabled',
  TEMPORARY_MODE: 'temporaryMode',
  AGENT8_DEPLOY: 'agent8Deploy',
  EVENT_LOGS: 'isEventLogsEnabled',
  PROMPT_ID: 'promptId',
  DEVELOPER_MODE: 'isDeveloperMode',
  MCP_SERVERS: 'mcpServers',
} as const;

/**
 * Helper function to get default MCP server configuration
 */
const getDefaultMCPServers = (): MCPServer[] => {
  let defaultServers: MCPServer[] = [];

  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MCP_SERVER_CONFIG) {
    defaultServers = JSON.parse(import.meta.env.VITE_MCP_SERVER_CONFIG);
  } else {
    defaultServers = [
      {
        name: 'All-in-one',
        url: 'https://mcp.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'All-in-one server that integrates all MCP tools.',
      },
      {
        name: 'Image',
        url: 'https://mcp-image.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'Create 2D game assets in various styles',
      },
      {
        name: 'Cinematic',
        url: 'https://mcp-cinematic.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'Turn text into styled game cutscenes',
      },
      {
        name: 'Audio',
        url: 'https://mcp-audio.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'Generate music and sound effects fast',
      },
      {
        name: 'Skybox',
        url: 'https://mcp-skybox.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'Make 360° environments for games or VR',
      },
      {
        name: 'UI',
        url: 'https://mcp-ui.verse8.io/mcp',
        enabled: false,
        v8AuthIntegrated: false,
        description: 'Design CSS styles for game interfaces',
      },
    ];
  }

  return defaultServers;
};

// Get initial MCP server settings from localStorage
const getInitialMCPServers = (): MCPServer[] => {
  if (!isBrowser) {
    return [];
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEYS.MCP_SERVERS);
    const defaultServers = getDefaultMCPServers();

    if (!stored || stored === '[]' || stored === '""') {
      // No stored servers, use defaults
      localStorage.setItem(SETTINGS_KEYS.MCP_SERVERS, JSON.stringify(defaultServers));

      if (typeof Cookies !== 'undefined') {
        Cookies.set(SETTINGS_KEYS.MCP_SERVERS, JSON.stringify(defaultServers), {
          expires: 365,
          path: '/',
          sameSite: 'lax',
        });
      }

      return defaultServers;
    }

    // Parse stored servers
    const storedServers = JSON.parse(stored);

    // Combine default servers with stored servers, using URL as unique identifier
    const resultServers = [...defaultServers];

    // Add stored servers that aren't in default list
    storedServers.forEach((storedServer: MCPServer) => {
      const existingIndex = resultServers.findIndex((server) => server.url === storedServer.url);

      if (existingIndex >= 0) {
        /*
         * Replace default with stored version if URL already exists
         * Always use the latest description from the codebase (defaultServers)
         */
        resultServers[existingIndex] = {
          ...storedServer,
          description: resultServers[existingIndex].description, // Always use codebase description
        };
      } else {
        // Add stored server if it's not in default list
        resultServers.push(storedServer);
      }
    });

    // Check if result is different from stored servers
    const resultJson = JSON.stringify(resultServers);
    const storedJson = JSON.stringify(storedServers);

    if (resultJson !== storedJson) {
      // Update localStorage and cookies with combined result
      localStorage.setItem(SETTINGS_KEYS.MCP_SERVERS, resultJson);

      if (typeof Cookies !== 'undefined') {
        Cookies.set(SETTINGS_KEYS.MCP_SERVERS, resultJson, {
          expires: 365,
          path: '/',
          sameSite: 'lax',
        });
      }
    }

    return resultServers;
  } catch (error) {
    console.error('Failed to parse MCP server settings:', error);
    return getDefaultMCPServers(); // Return defaults on error
  }
};

// Initialize settings from localStorage or defaults
const getInitialSettings = () => {
  const getStoredBoolean = (key: string, defaultValue: boolean): boolean => {
    if (!isBrowser) {
      return defaultValue;
    }

    const stored = localStorage.getItem(key);

    if (stored === null) {
      return defaultValue;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return defaultValue;
    }
  };

  return {
    latestBranch: getStoredBoolean(SETTINGS_KEYS.LATEST_BRANCH, false),
    autoSelectTemplate: getStoredBoolean(SETTINGS_KEYS.AUTO_SELECT_TEMPLATE, true),
    contextOptimization: getStoredBoolean(SETTINGS_KEYS.CONTEXT_OPTIMIZATION, true),
    temporaryMode: getStoredBoolean(SETTINGS_KEYS.TEMPORARY_MODE, false),
    agent8Deploy: getStoredBoolean(SETTINGS_KEYS.AGENT8_DEPLOY, true),
    eventLogs: getStoredBoolean(SETTINGS_KEYS.EVENT_LOGS, true),
    promptId: isBrowser ? localStorage.getItem(SETTINGS_KEYS.PROMPT_ID) || 'agent8' : 'agent8',
    developerMode: getStoredBoolean(SETTINGS_KEYS.DEVELOPER_MODE, false),
  };
};

// Initialize stores with persisted values
const initialSettings = getInitialSettings();

export const latestBranchStore = atom<boolean>(initialSettings.latestBranch);
export const autoSelectStarterTemplate = atom<boolean>(initialSettings.autoSelectTemplate);
export const enableContextOptimizationStore = atom<boolean>(initialSettings.contextOptimization);
export const temporaryModeStore = atom<boolean>(initialSettings.temporaryMode);
export const agent8DeployStore = atom<boolean>(initialSettings.agent8Deploy);
export const isEventLogsEnabled = atom<boolean>(initialSettings.eventLogs);
export const promptStore = atom<string>(initialSettings.promptId);
export const mcpServersStore = atom<MCPServer[]>(getInitialMCPServers());

// Helper functions to update settings with persistence
export const updateLatestBranch = (enabled: boolean) => {
  latestBranchStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.LATEST_BRANCH, JSON.stringify(enabled));
};

export const updateAutoSelectTemplate = (enabled: boolean) => {
  autoSelectStarterTemplate.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.AUTO_SELECT_TEMPLATE, JSON.stringify(enabled));
};

export const updateContextOptimization = (enabled: boolean) => {
  enableContextOptimizationStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.CONTEXT_OPTIMIZATION, JSON.stringify(enabled));
};

export const updateTemporaryMode = (enabled: boolean) => {
  temporaryModeStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.TEMPORARY_MODE, JSON.stringify(enabled));
  Cookies.set(SETTINGS_KEYS.TEMPORARY_MODE, JSON.stringify(enabled), {
    expires: 365, // 1년간 유효
    path: '/',
    sameSite: 'lax',
  });
};

export const updateAgent8Deploy = (enabled: boolean) => {
  agent8DeployStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.AGENT8_DEPLOY, JSON.stringify(enabled));
};

export const updateEventLogs = (enabled: boolean) => {
  isEventLogsEnabled.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.EVENT_LOGS, JSON.stringify(enabled));
};

export const updatePromptId = (id: string) => {
  promptStore.set(id);
  localStorage.setItem(SETTINGS_KEYS.PROMPT_ID, id);
};

// Initialize tab configuration from localStorage or defaults
const getInitialTabConfiguration = (): TabWindowConfig => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is UserTabConfig => tab.window === 'user'),
    developerTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is DevTabConfig => tab.window === 'developer'),
  };

  if (!isBrowser) {
    return defaultConfig;
  }

  try {
    const saved = localStorage.getItem('bolt_tab_configuration');

    if (!saved) {
      return defaultConfig;
    }

    const parsed = JSON.parse(saved);

    if (!parsed?.userTabs || !parsed?.developerTabs) {
      return defaultConfig;
    }

    // Ensure proper typing of loaded configuration
    return {
      userTabs: parsed.userTabs.filter((tab: TabVisibilityConfig): tab is UserTabConfig => tab.window === 'user'),
      developerTabs: parsed.developerTabs.filter(
        (tab: TabVisibilityConfig): tab is DevTabConfig => tab.window === 'developer',
      ),
    };
  } catch (error) {
    console.warn('Failed to parse tab configuration:', error);
    return defaultConfig;
  }
};

// console.log('Initial tab configuration:', getInitialTabConfiguration());

export const tabConfigurationStore = map<TabWindowConfig>(getInitialTabConfiguration());

// Helper function to update tab configuration
export const updateTabConfiguration = (config: TabVisibilityConfig) => {
  const currentConfig = tabConfigurationStore.get();
  console.log('Current tab configuration before update:', currentConfig);

  const isUserTab = config.window === 'user';
  const targetArray = isUserTab ? 'userTabs' : 'developerTabs';

  // Only update the tab in its respective window
  const updatedTabs = currentConfig[targetArray].map((tab) => (tab.id === config.id ? { ...config } : tab));

  // If tab doesn't exist in this window yet, add it
  if (!updatedTabs.find((tab) => tab.id === config.id)) {
    updatedTabs.push(config);
  }

  // Create new config, only updating the target window's tabs
  const newConfig: TabWindowConfig = {
    ...currentConfig,
    [targetArray]: updatedTabs,
  };

  console.log('New tab configuration after update:', newConfig);

  tabConfigurationStore.set(newConfig);
  Cookies.set('tabConfiguration', JSON.stringify(newConfig), {
    expires: 365, // Set cookie to expire in 1 year
    path: '/',
    sameSite: 'strict',
  });
};

// Helper function to reset tab configuration
export const resetTabConfiguration = () => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is UserTabConfig => tab.window === 'user'),
    developerTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is DevTabConfig => tab.window === 'developer'),
  };

  tabConfigurationStore.set(defaultConfig);
  localStorage.setItem('bolt_tab_configuration', JSON.stringify(defaultConfig));
};

// Developer mode store with persistence
export const developerModeStore = atom<boolean>(initialSettings.developerMode);

export const setDeveloperMode = (value: boolean) => {
  developerModeStore.set(value);

  if (isBrowser) {
    localStorage.setItem(SETTINGS_KEYS.DEVELOPER_MODE, JSON.stringify(value));
  }
};

// First, let's define the SettingsStore interface
interface SettingsStore {
  isOpen: boolean;
  selectedTab: string;
  openSettings: () => void;
  closeSettings: () => void;
  setSelectedTab: (tab: string) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isOpen: false,
  selectedTab: 'user', // Default tab

  openSettings: () => {
    set({
      isOpen: true,
      selectedTab: 'user', // Always open to user tab
    });
  },

  closeSettings: () => {
    set({
      isOpen: false,
      selectedTab: 'user', // Reset to user tab when closing
    });
  },

  setSelectedTab: (tab: string) => {
    set({ selectedTab: tab });
  },
}));

// MCP Servers management functions
export const updateMCPServers = (servers: MCPServer[]) => {
  mcpServersStore.set(servers);
  localStorage.setItem(SETTINGS_KEYS.MCP_SERVERS, JSON.stringify(servers));

  // Also save to cookie for API routes
  try {
    // Use the same key name as localStorage for consistency
    Cookies.set(SETTINGS_KEYS.MCP_SERVERS, JSON.stringify(servers), {
      expires: 365, // 1년간 유효
      path: '/',
      sameSite: 'lax',
    });
    console.log('MCP servers saved to cookies:', servers);
  } catch (e) {
    console.error('Failed to set mcpServers cookie:', e);
  }
};

export const resetMCPServers = () => {
  // Get default server configuration
  const defaultServers = getDefaultMCPServers();

  // Update store and cookies
  updateMCPServers(defaultServers);

  return defaultServers;
};

export const addMCPServer = (server: MCPServer) => {
  const servers = mcpServersStore.get();
  const updatedServers = [...servers, server];
  updateMCPServers(updatedServers);
};

export const updateMCPServer = (index: number, server: MCPServer) => {
  const servers = mcpServersStore.get();
  const updatedServers = [...servers];
  updatedServers[index] = server;
  updateMCPServers(updatedServers);
};

export const removeMCPServer = (index: number) => {
  const servers = mcpServersStore.get();
  const updatedServers = servers.filter((_, i) => i !== index);
  updateMCPServers(updatedServers);
};

export const toggleMCPServer = (index: number, enabled: boolean) => {
  const servers = mcpServersStore.get();
  const updatedServers = [...servers];
  updatedServers[index] = { ...updatedServers[index], enabled };
  updateMCPServers(updatedServers);
};

export const toggleMCPServerV8Auth = (index: number, v8AuthIntegrated: boolean) => {
  const servers = mcpServersStore.get();
  const updatedServers = [...servers];
  updatedServers[index] = { ...updatedServers[index], v8AuthIntegrated };
  updateMCPServers(updatedServers);
};
