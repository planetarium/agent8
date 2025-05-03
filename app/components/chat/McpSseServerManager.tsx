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
  const [showServerManager, setShowServerManager] = useState<boolean>(false);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);

  const handleAddServer = () => {
    if (newServer.name && newServer.url) {
      const server: MCPSSEServer = {
        name: newServer.name,
        url: newServer.url,
        enabled: true,
        v8AuthIntegrated: true,
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
      setShowAddForm(false);
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
          </div>

          {mcpSseServers.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {mcpSseServers
                .map((server, index) => ({ server, index }))
                .filter((item) => item.server.name !== 'All-in-one')
                .map(({ server, index }) => (
                  <div
                    key={index}
                    className={classNames(
                      'flex items-center justify-between',
                      'p-3 rounded-lg',
                      'border',
                      server.enabled
                        ? 'bg-bolt-elements-background-depth-1 border-l-4 border-l-purple-500 border-bolt-elements-borderColor shadow-sm'
                        : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor opacity-75',
                      'transition-all duration-200',
                    )}
                  >
                    <div className="flex items-center gap-3 ml-2">
                      <div className={classNames(getServerIcon(server.name), server.enabled ? '' : 'opacity-60')} />
                      <div>
                        <h4
                          className={classNames(
                            'font-medium flex items-center gap-1',
                            server.enabled ? 'text-bolt-elements-textPrimary' : 'text-bolt-elements-textSecondary',
                          )}
                        >
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

                    <div className="flex items-center gap-2 mr-2">
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={(checked) => handleToggleServer(index, checked)}
                        />
                      </div>
                      {!isDefaultServer(server.name) && (
                        <button
                          onClick={() => handleRemoveServer(index)}
                          className="p-1 rounded-full hover:bg-red-500/10 text-red-500 ml-2"
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

          {showAddForm && (
            <motion.div
              className="mt-4 bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center">
                    <span className="bg-purple-100 dark:bg-purple-900/30 p-1.5 rounded-md mr-2">
                      <div className="i-ph:plus-circle-fill w-4 h-4 text-purple-700 dark:text-purple-400" />
                    </span>
                    Add Custom MCP Tool
                  </h4>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 group transition-all duration-200"
                  >
                    <div className="i-ph:x w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                  </button>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-[0.4]">
                    <label
                      htmlFor="mcp-tool-name"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 ml-1"
                    >
                      MCP Tool Name
                    </label>
                    <input
                      id="mcp-tool-name"
                      type="text"
                      placeholder="e.g. agent8"
                      value={newServer.name}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                      className={classNames(
                        'w-full p-2.5 rounded-lg text-sm',
                        'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
                        'text-gray-900 dark:text-gray-100',
                        'focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500',
                        'transition-all duration-200',
                      )}
                    />
                  </div>
                  <div className="flex-[0.6]">
                    <label
                      htmlFor="mcp-tool-url"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 ml-1"
                    >
                      MCP Tool URL
                    </label>
                    <input
                      id="mcp-tool-url"
                      type="text"
                      placeholder="http://localhost:3333/sse"
                      value={newServer.url}
                      onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                      className={classNames(
                        'w-full p-2.5 rounded-lg text-sm',
                        'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
                        'text-gray-900 dark:text-gray-100',
                        'focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500',
                        'transition-all duration-200',
                      )}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowAddForm(false)}
                      className={classNames(
                        'px-4 py-2 rounded-lg text-sm font-medium',
                        'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
                        'text-gray-700 dark:text-gray-300',
                        'transition-colors duration-200',
                        'border border-gray-200 dark:border-gray-700',
                      )}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddServer}
                      className={classNames(
                        'px-4 py-2 rounded-lg text-sm font-medium',
                        'transition-colors duration-200',
                        'shadow-sm',
                        'disabled:cursor-not-allowed',
                        !newServer.name || !newServer.url
                          ? 'bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700'
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-purple-500 hover:text-white dark:hover:bg-purple-600 dark:hover:text-white hover:border-purple-400 dark:hover:border-purple-500',
                      )}
                      disabled={!newServer.name || !newServer.url}
                    >
                      Add Tool
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div className="flex justify-end mr-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={classNames('bg-transparent text-gray-500 hover:underline text-sm font-medium')}
            >
              Add Custom MCP Tool
            </button>
          </div>
        </motion.div>
      )}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {mcpSseServers
          .map((server, index) => ({ server, index }))
          .filter((item) => item.server.enabled && item.server.name !== 'All-in-one')
          .map(({ server, index }) => (
            <div
              key={index}
              className="flex items-center gap-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-gray-200"
              title={server.url}
            >
              <div className={classNames(getServerIcon(server.name), server.enabled ? '' : 'opacity-60')} />
              {server.name}
            </div>
          ))}

        <button
          onClick={() => setShowServerManager(!showServerManager)}
          className={classNames(
            'flex items-center gap-1.5',
            'text-sm font-medium',
            'bg-transparent',
            'text-bolt-elements-textSecondary hover:text-gray-500',
            'transition-colors duration-200',
          )}
        >
          <div className="i-ph:plus-circle w-4 h-4" />
          <span className="font-normal">Use Tools</span>
        </button>
      </div>
    </div>
  );
};

export default McpSseServerManager;
