import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Switch } from '~/components/ui/Switch';
import { toast } from 'react-toastify';
import { useSettings } from '~/lib/hooks/useSettings';
import type { MCPSSEServer } from '~/lib/stores/settings';
import { SETTINGS_KEYS } from '~/lib/stores/settings';
import { classNames } from '~/utils/classNames';

// MCP SSE Server Manager Component
const McpSseServerManager: React.FC = () => {
  const { mcpSseServers, addMCPSSEServer, removeMCPSSEServer, toggleMCPSSEServer, toggleMCPSSEServerV8Auth } =
    useSettings();

  const defaultServerNames = ['All-in-one', '2D-Image', 'Cinematic', 'Audio', 'Skybox'];

  const isDefaultServer = (serverName: string) => defaultServerNames.includes(serverName);

  const getServerIcon = (serverName: string) => {
    switch (serverName) {
      case 'All-in-one':
        return 'i-ph:globe w-4 h-4 text-blue-500';
      case '2D-Image':
        return 'i-ph:image w-4 h-4 text-green-500';
      case 'Cinematic':
        return 'i-ph:film-strip w-4 h-4 text-purple-500';
      case 'Audio':
        return 'i-ph:speaker-high w-4 h-4 text-red-500';
      case 'Skybox':
        return 'i-ph:cloud w-4 h-4 text-cyan-500';
      default:
        return 'i-ph:cube w-4 h-4 text-bolt-elements-textSecondary';
    }
  };

  const [newServer, setNewServer] = useState<{ name: string; url: string }>({
    name: '',
    url: '',
  });
  const [showServerManager, setShowServerManager] = useState(false);

  const handleAddServer = () => {
    if (newServer.name && newServer.url) {
      const server: MCPSSEServer = {
        name: newServer.name,
        url: newServer.url,
        enabled: true,
        v8AuthIntegrated: false,
      };

      addMCPSSEServer(server);
      toast.success(`${newServer.name} tool added`, { autoClose: 1500 });

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

    toast.success('tool removed', { autoClose: 1500 });
  };

  const handleToggleServer = (index: number, enabled: boolean) => {
    toggleMCPSSEServer(index, enabled);

    if (enabled) {
      toggleMCPSSEServerV8Auth(index, true);
    } else {
      toggleMCPSSEServerV8Auth(index, false);
    }

    const serverName = mcpSseServers[index].name;

    toast.success(enabled ? `${serverName} tool enabled` : `${serverName} tool disabled`, { autoClose: 1500 });
  };

  return (
    <div>
      {showServerManager && (
        <motion.div
          className="flex flex-col gap-4 bg-bolt-elements-background-depth-2 p-4 rounded-lg mb-4"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Select Tools to Use</h4>
              <button
                onClick={() => setShowServerManager(false)}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200  mb-1.5"
              >
                <div className="i-ph:x w-4 h-4 text-gray-500 dark:text-gray-400 group-hover:text-purple-500 transition-colors" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Tool name (e.g. agent8)"
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                className={classNames(
                  'flex-[0.3] p-2 rounded-lg text-sm',
                  'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                )}
              />
              <input
                type="text"
                placeholder="Tool URL (e.g. http://localhost:3333/sse)"
                value={newServer.url}
                onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                className={classNames(
                  'flex-[0.7] p-2 rounded-lg text-sm',
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
                    <div className="flex items-center gap-1 mr-15">
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={(checked) => handleToggleServer(index, checked)}
                      />
                      <span className="text-xs text-bolt-elements-textSecondary mr-1">
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className={getServerIcon(server.name)} />
                    <div>
                      <h4 className="font-medium text-bolt-elements-textPrimary flex items-center gap-1">
                        {server.name}
                        {isDefaultServer(server.name) && (
                          <div className="relative group cursor-help">
                            <div className="i-ph:star-fill w-3.5 h-3.5 text-yellow-500" />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-normal text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-100 whitespace-nowrap pointer-events-none">
                              Default tool
                            </div>
                          </div>
                        )}
                      </h4>
                      <p className="text-xs text-bolt-elements-textSecondary">{server.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDefaultServer(server.name) && (
                      <button
                        onClick={() => handleRemoveServer(index)}
                        className="p-1 rounded-full hover:bg-red-500/10 text-red-500"
                      >
                        <div className="i-ph:trash w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center p-4 text-bolt-elements-textSecondary text-sm">
              No MCP SSE servers registered. Add a new server to get started.
            </div>
          )}
        </motion.div>
      )}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {mcpSseServers
          .filter((server) => server.enabled)
          .map((server, index) => (
            <div
              key={index}
              className="flex items-center gap-1.5 bg-gray-200 dark:bg-gray-700 rounded-full px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-gray-200"
              title={server.url}
            >
              <div className={getServerIcon(server.name)} />
              {server.name}
              {isDefaultServer(server.name) && (
                <div className="relative group cursor-help">
                  <div className="i-ph:star-fill w-3.5 h-3.5 text-yellow-500" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-normal text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-100 whitespace-nowrap pointer-events-none">
                    Default tool
                  </div>
                </div>
              )}
            </div>
          ))}

        <button
          onClick={() => setShowServerManager(!showServerManager)}
          className={classNames(
            'flex items-center gap-1',
            'text-sm font-medium',
            'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
            'transition-colors duration-200',
            'pl-1 pr-3 py-1 rounded-md',
            'hover:bg-bolt-elements-background-depth-3',
          )}
        >
          <div className="i-ph:server-stack text-bolt-elements-textSecondary" />
          <span className="inline-flex items-center">
            <span className="bg-gradient-to-r from-purple-500 to-blue-500 text-transparent bg-clip-text font-semibold">
              +
            </span>
            <span className="ml-1 bg-gradient-to-r from-blue-500 to-purple-500 text-transparent bg-clip-text font-semibold">
              {' '}
              more
            </span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default McpSseServerManager;
