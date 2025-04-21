// Remove unused imports
import React, { memo, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Switch } from '~/components/ui/Switch';
import { useSettings } from '~/lib/hooks/useSettings';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { type MCPSSEServer, SETTINGS_KEYS } from '~/lib/stores/settings';

interface FeatureToggle {
  id: string;
  title: string;
  description: string;
  icon: string;
  enabled: boolean;
  beta?: boolean;
  experimental?: boolean;
  tooltip?: string;
}

const FeatureCard = memo(
  ({
    feature,
    index,
    onToggle,
  }: {
    feature: FeatureToggle;
    index: number;
    onToggle: (id: string, enabled: boolean) => void;
  }) => (
    <motion.div
      key={feature.id}
      layoutId={feature.id}
      className={classNames(
        'relative group cursor-pointer',
        'bg-bolt-elements-background-depth-2',
        'hover:bg-bolt-elements-background-depth-3',
        'transition-colors duration-200',
        'rounded-lg overflow-hidden',
      )}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={classNames(feature.icon, 'w-5 h-5 text-bolt-elements-textSecondary')} />
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-bolt-elements-textPrimary">{feature.title}</h4>
              {feature.beta && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/10 text-blue-500 font-medium">Beta</span>
              )}
              {feature.experimental && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-orange-500/10 text-orange-500 font-medium">
                  Experimental
                </span>
              )}
            </div>
          </div>
          <Switch checked={feature.enabled} onCheckedChange={(checked) => onToggle(feature.id, checked)} />
        </div>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary">{feature.description}</p>
        {feature.tooltip && <p className="mt-1 text-xs text-bolt-elements-textTertiary">{feature.tooltip}</p>}
      </div>
    </motion.div>
  ),
);

const FeatureSection = memo(
  ({
    title,
    features,
    icon,
    description,
    onToggleFeature,
  }: {
    title: string;
    features: FeatureToggle[];
    icon: string;
    description: string;
    onToggleFeature: (id: string, enabled: boolean) => void;
  }) => (
    <motion.div
      layout
      className="flex flex-col gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <div className={classNames(icon, 'text-xl text-purple-500')} />
        <div>
          <h3 className="text-lg font-medium text-bolt-elements-textPrimary">{title}</h3>
          <p className="text-sm text-bolt-elements-textSecondary">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {features.map((feature, index) => (
          <FeatureCard key={feature.id} feature={feature} index={index} onToggle={onToggleFeature} />
        ))}
      </div>
    </motion.div>
  ),
);

// MCP SSE Server Management Component
const McpSseServerManager = () => {
  const { mcpSseServers, addMCPSSEServer, removeMCPSSEServer, toggleMCPSSEServer, toggleMCPSSEServerV8Auth } =
    useSettings();

  const [newServer, setNewServer] = useState<{ name: string; url: string }>({
    name: '',
    url: '',
  });

  const handleAddServer = () => {
    if (newServer.name && newServer.url) {
      const server: MCPSSEServer = {
        name: newServer.name,
        url: newServer.url,
        enabled: true,
        v8AuthIntegrated: false,
      };

      addMCPSSEServer(server);
      console.log('Added MCP SSE server to store:', server);

      // 쿠키가 설정되었는지 확인
      setTimeout(() => {
        try {
          const cookies = document.cookie.split(';').reduce(
            (acc, item) => {
              const [key, value] = item.trim().split('=');
              return { ...acc, [key]: value };
            },
            {} as Record<string, string>,
          );

          console.log('Current cookies:', cookies);
          console.log(`MCP settings cookie present:`, cookies[SETTINGS_KEYS.MCP_SSE_SERVERS] !== undefined);
        } catch (error) {
          console.error('Error checking cookies:', error);
        }
      }, 100);

      setNewServer({ name: '', url: '' });
    }
  };

  const handleRemoveServer = (index: number) => {
    removeMCPSSEServer(index);
    toast.success('MCP SSE server removed');
  };

  const handleToggleServer = (index: number, enabled: boolean) => {
    toggleMCPSSEServer(index, enabled);
    toast.success(`MCP SSE server ${enabled ? 'enabled' : 'disabled'}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Add MCP SSE Server</h4>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Server name (e.g. agent8)"
            value={newServer.name}
            onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
            className={classNames(
              'flex-1 p-2 rounded-lg text-sm',
              'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
              'text-bolt-elements-textPrimary',
              'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
            )}
          />
          <input
            type="text"
            placeholder="Server URL (e.g. http://localhost:3333/sse)"
            value={newServer.url}
            onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
            className={classNames(
              'flex-1 p-2 rounded-lg text-sm',
              'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
              'text-bolt-elements-textPrimary',
              'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
            )}
          />
          <button
            onClick={handleAddServer}
            className={classNames(
              'px-4 py-2 rounded-lg text-sm',
              'bg-purple-500 hover:bg-purple-600',
              'text-white',
              'transition-colors duration-200',
            )}
          >
            Add
          </button>
        </div>
      </div>

      {mcpSseServers.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {mcpSseServers.map((server, index) => (
            <div
              key={index}
              className={classNames(
                'flex items-center justify-between',
                'p-3 rounded-lg',
                'bg-bolt-elements-background-depth-2',
                'border border-bolt-elements-borderColor',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="i-ph:server w-5 h-5 text-bolt-elements-textSecondary" />
                <div>
                  <h4 className="font-medium text-bolt-elements-textPrimary">{server.name}</h4>
                  <p className="text-xs text-bolt-elements-textSecondary">{server.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-bolt-elements-textSecondary mr-1">
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch checked={server.enabled} onCheckedChange={(checked) => handleToggleServer(index, checked)} />
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={classNames(
                      'text-xs mr-1',
                      server.enabled ? 'text-bolt-elements-textSecondary' : 'text-bolt-elements-textTertiary',
                    )}
                  >
                    V8 Auth
                  </span>
                  <div
                    className={classNames(
                      'i-ph:lock w-4 h-4',
                      server.enabled ? 'text-bolt-elements-textSecondary' : 'text-bolt-elements-textTertiary',
                    )}
                  />
                  <Switch
                    checked={server.v8AuthIntegrated}
                    disabled={!server.enabled}
                    onCheckedChange={(checked) => toggleMCPSSEServerV8Auth(index, checked)}
                  />
                </div>
                <button
                  onClick={() => handleRemoveServer(index)}
                  className="p-1 rounded-full hover:bg-red-500/10 text-red-500"
                >
                  <div className="i-ph:trash w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center p-4 text-bolt-elements-textSecondary text-sm">
          No MCP SSE servers registered. Add a new server to get started.
        </div>
      )}
    </div>
  );
};

export default function FeaturesTab() {
  const {
    autoSelectTemplate,
    isLatestBranch,
    contextOptimizationEnabled,
    eventLogs,
    setAutoSelectTemplate,
    enableLatestBranch,
    enableContextOptimization,
    setEventLogs,
    setPromptId,
    promptId,
    temporaryMode,
    setTemporaryMode,
    agent8Deploy,
    setAgent8Deploy,
  } = useSettings();

  // Enable features by default on first load
  React.useEffect(() => {
    // Only set defaults if values are undefined
    if (isLatestBranch === undefined) {
      enableLatestBranch(false); // Default: OFF - Don't auto-update from main branch
    }

    if (contextOptimizationEnabled === undefined) {
      enableContextOptimization(true); // Default: ON - Enable context optimization
    }

    if (autoSelectTemplate === undefined) {
      setAutoSelectTemplate(true); // Default: ON - Enable auto-select templates
    }

    if (promptId === undefined) {
      setPromptId('default'); // Default: 'default'
    }

    if (eventLogs === undefined) {
      setEventLogs(true); // Default: ON - Enable event logging
    }
  }, []); // Only run once on component mount

  const handleToggleFeature = useCallback(
    (id: string, enabled: boolean) => {
      switch (id) {
        case 'latestBranch': {
          enableLatestBranch(enabled);
          toast.success(`Main branch updates ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        case 'autoSelectTemplate': {
          setAutoSelectTemplate(enabled);
          toast.success(`Auto select template ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        case 'contextOptimization': {
          enableContextOptimization(enabled);
          toast.success(`Context optimization ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        case 'eventLogs': {
          setEventLogs(enabled);
          toast.success(`Event logging ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        case 'temporaryMode': {
          setTemporaryMode(enabled);
          toast.success(`Temporary mode ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        case 'agent8Deploy': {
          setAgent8Deploy(enabled);
          toast.success(`Agent8 deploy ${enabled ? 'enabled' : 'disabled'}`);
          break;
        }

        default:
          break;
      }
    },
    [
      enableLatestBranch,
      setAutoSelectTemplate,
      enableContextOptimization,
      setEventLogs,
      setTemporaryMode,
      setAgent8Deploy,
    ],
  );

  const features = {
    stable: [
      {
        id: 'latestBranch',
        title: 'Main Branch Updates',
        description: 'Get the latest updates from the main branch',
        icon: 'i-ph:git-branch',
        enabled: isLatestBranch,
        tooltip: 'Enabled by default to receive updates from the main development branch',
      },
      {
        id: 'autoSelectTemplate',
        title: 'Auto Select Template',
        description: 'Automatically select starter template',
        icon: 'i-ph:selection',
        enabled: autoSelectTemplate,
        tooltip: 'Enabled by default to automatically select the most appropriate starter template',
      },
      {
        id: 'contextOptimization',
        title: 'Context Optimization',
        description: 'Optimize context for better responses',
        icon: 'i-ph:brain',
        enabled: contextOptimizationEnabled,
        tooltip: 'Enabled by default for improved AI responses',
      },
      {
        id: 'eventLogs',
        title: 'Event Logging',
        description: 'Enable detailed event logging and history',
        icon: 'i-ph:list-bullets',
        enabled: eventLogs,
        tooltip: 'Enabled by default to record detailed logs of system events and user actions',
      },
      {
        id: 'temporaryMode',
        title: 'Temporary Mode',
        description: 'Use temporarily without interacting with GitLab',
        icon: 'i-ph:clock',
        enabled: temporaryMode,
        tooltip: 'Enabled by default to use temporarily without interacting with GitLab',
      },
      {
        id: 'agent8Deploy',
        title: 'Agent8 Deploy',
        description: 'Deploy your project to Agent8',
        icon: 'i-ph:rocket',
        enabled: agent8Deploy,
        tooltip: 'Enabled by default to deploy your project to Agent8',
      },
    ],
    beta: [],
  };

  return (
    <div className="flex flex-col gap-8">
      <FeatureSection
        title="Core Features"
        features={features.stable}
        icon="i-ph:check-circle"
        description="Essential features that are enabled by default for optimal performance"
        onToggleFeature={handleToggleFeature}
      />

      {features.beta.length > 0 && (
        <FeatureSection
          title="Beta Features"
          features={features.beta}
          icon="i-ph:test-tube"
          description="New features that are ready for testing but may have some rough edges"
          onToggleFeature={handleToggleFeature}
        />
      )}

      <motion.div
        layout
        className={classNames(
          'bg-bolt-elements-background-depth-2',
          'hover:bg-bolt-elements-background-depth-3',
          'transition-all duration-200',
          'rounded-lg p-4',
          'group',
        )}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center gap-4">
          <div
            className={classNames(
              'p-2 rounded-lg text-xl',
              'bg-bolt-elements-background-depth-3 group-hover:bg-bolt-elements-background-depth-4',
              'transition-colors duration-200',
              'text-purple-500',
            )}
          >
            <div className="i-ph:book" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-bolt-elements-textPrimary group-hover:text-purple-500 transition-colors">
              Prompt Library
            </h4>
            <p className="text-xs text-bolt-elements-textSecondary mt-0.5">
              Choose a prompt from the library to use as the system prompt
            </p>
          </div>
          <select
            value={promptId}
            onChange={(e) => {
              setPromptId(e.target.value);
              toast.success('Prompt template updated');
            }}
            className={classNames(
              'p-2 rounded-lg text-sm min-w-[200px]',
              'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
              'text-bolt-elements-textPrimary',
              'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
              'group-hover:border-purple-500/30',
              'transition-all duration-200',
            )}
          >
            {PromptLibrary.getList().map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      </motion.div>

      {/* MCP SSE Server Management Section */}
      <motion.div
        layout
        className={classNames('bg-bolt-elements-background-depth-2', 'transition-all duration-200', 'rounded-lg p-4')}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className={classNames('p-2 rounded-lg text-xl', 'bg-bolt-elements-background-depth-3', 'text-purple-500')}
          >
            <div className="i-ph:server-stack" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-bolt-elements-textPrimary">MCP SSE Server Management</h3>
            <p className="text-sm text-bolt-elements-textSecondary">
              Manage MCP SSE server configurations for AI agents
            </p>
          </div>
        </div>

        <McpSseServerManager />
      </motion.div>
    </div>
  );
}
