import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useSettings } from '~/lib/hooks/useSettings';
import { classNames } from '~/utils/classNames';
import * as Tooltip from '@radix-ui/react-tooltip';

// MCP Server Manager Component
const McpServerManager: React.FC<{ chatStarted?: boolean }> = ({ chatStarted = false }) => {
  const { mcpServers, toggleMCPServer, toggleMCPServerV8Auth, addMCPServer, removeMCPServer } = useSettings();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hoveredServerIndex, setHoveredServerIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newServer, setNewServer] = useState<{ name: string; url: string }>({
    name: '',
    url: '',
  });

  const defaultServerNames = import.meta.env?.VITE_DEFAULT_SERVER_NAMES
    ? JSON.parse(import.meta.env.VITE_DEFAULT_SERVER_NAMES)
    : ['Image', 'Cinematic', 'Audio', 'Skybox', 'UI'];
  const disabledServerNames = import.meta.env?.VITE_DISABLED_SERVER_NAMES
    ? JSON.parse(import.meta.env.VITE_DISABLED_SERVER_NAMES)
    : ['All-in-one'];
  const isDisabledServer = (serverName: string) => disabledServerNames.includes(serverName);
  const isDefaultServer = (serverName: string) => defaultServerNames.includes(serverName);

  const hasActiveTools = mcpServers.some((server) => server.enabled && !isDisabledServer(server.name));

  const getServerIcon = (serverName: string) => {
    switch (serverName) {
      case 'Image':
        return '/icons/Image.svg';
      case 'Cinematic':
        return '/icons/Cinematic.svg';
      case 'Audio':
        return '/icons/Audio.svg';
      case 'Skybox':
        return '/icons/Skybox.svg';
      case 'UI':
        return '/icons/UI.svg';
      default:
        return '/icons/Sparkle.svg';
    }
  };

  const [showServerManager, setShowServerManager] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showServerManager &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowServerManager(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showServerManager]);

  const handleToggleServer = (index: number, enabled: boolean) => {
    toggleMCPServer(index, enabled);

    if (enabled) {
      toggleMCPServerV8Auth(index, true);
    } else {
      toggleMCPServerV8Auth(index, false);
    }
  };

  const handleAddServer = () => {
    if (newServer.name && newServer.url) {
      const server = {
        name: newServer.name,
        url: newServer.url,
        enabled: true,
        v8AuthIntegrated: true,
        description: '',
      };

      addMCPServer(server);

      setNewServer({ name: '', url: '' });
      setShowAddForm(false);
    }
  };

  const handleRemoveServer = (index: number) => {
    removeMCPServer(index);
  };

  return (
    <div
      className={classNames('w-full mx-auto', {
        'max-w-chat': chatStarted,
        'max-w-chat-before-start': !chatStarted,
      })}
    >
      <div className="flex items-center gap-[6.3px] flex-wrap relative">
        {hasActiveTools && (
          <span className="text-[var(--color-text-subtle,#767D8C)] font-primary text-[12px] font-semibold leading-[142.9%] font-feature-[ss10]">
            Tools Active
          </span>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              ref={buttonRef}
              onClick={() => setShowServerManager(!showServerManager)}
              className={classNames(
                hasActiveTools
                  ? 'flex w-[32px] min-h-[32px] max-h-[32px] justify-center items-center rounded-[var(--border-radius-circle,99999px)] border border-solid border-[var(--color-border-interactive-neutral,rgba(255,255,255,0.18))] bg-[var(--color-bg-interactive-neutral,#222428)] hover:bg-[var(--color-bg-interactive-neutral-hovered,#32363C)] active:bg-[var(--color-bg-interactive-neutral-pressed,#464C54)] focus:bg-[var(--color-bg-interactive-neutral,#222428)]'
                  : 'flex min-h-8 max-h-8 px-[14px] py-[8px] justify-center items-center gap-1.5 rounded-full border border-white/18 bg-[#222428] hover:bg-[var(--color-bg-interactive-neutral-hovered,#32363C)] active:bg-[var(--color-bg-interactive-neutral-pressed,#464C54)] focus:bg-[var(--color-bg-interactive-neutral,#222428)] text-xs font-medium hover:text-gray-500',
                'transition-colors duration-200',
              )}
            >
              <img src="/icons/Plus.svg" alt="Plus" className={hasActiveTools ? 'w-4 h-4' : ''} />
              {!hasActiveTools && <span className="font-normal text-cyan-400 text-[14px]">Use Tools</span>}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%] w-[292px] justify-between"
              sideOffset={5}
              side={chatStarted ? 'top' : 'bottom'}
              align="start"
              alignOffset={0}
            >
              Use it to create images, cinematics, audio, skyboxes, and UI elements
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {mcpServers
          .map((server, index) => ({ server, index }))
          .filter((item) => item.server.enabled && !isDisabledServer(item.server.name))
          .map(({ server, index }) => (
            <div
              key={index}
              className="flex min-h-8 max-h-8 px-[12.8px] py-[8px] justify-center items-center gap-[4.8px] rounded-[var(--border-radius-circle,99999px)] border border-solid border-[var(--color-border-interactive-neutral-hovered,rgba(255,255,255,0.22))] text-[14px] font-medium text-gray-800 dark:text-gray-200 cursor-pointer"
              onMouseEnter={() => setHoveredServerIndex(index)}
              onMouseLeave={() => setHoveredServerIndex(null)}
              onClick={() => handleToggleServer(index, false)}
            >
              {hoveredServerIndex === index ? (
                <img
                  src="/icons/Close.svg"
                  alt="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleServer(index, false);
                  }}
                  className="cursor-pointer"
                />
              ) : server.name === 'All-in-one' ||
                !['Image', 'Skybox', 'Cinematic', 'Audio', 'UI'].includes(server.name) ? (
                <img
                  src={getServerIcon(server.name)}
                  alt={server.name}
                  className={classNames('w-5 h-5', server.enabled ? '' : 'opacity-60')}
                />
              ) : (
                <img
                  src={getServerIcon(server.name)}
                  alt={server.name}
                  className={classNames('w-5 h-5', server.enabled ? '' : 'opacity-60')}
                />
              )}
              <span className="max-w-[120px] truncate">{server.name}</span>
            </div>
          ))}

        {showServerManager && (
          <motion.div
            ref={dropdownRef}
            className={classNames(
              'absolute left-0 flex w-[330px] py-[6.4px] px-0 flex-col items-start rounded-[var(--border-radius-8,8px)] border border-solid border-[var(--color-border-tertiary,rgba(255,255,255,0.12))] bg-[var(--color-bg-interactive-neutral,#222428)] z-10',
              chatStarted ? 'bottom-full mb-2' : 'top-full mt-2',
            )}
            style={{
              boxShadow: '0px 8px 16px 0px rgba(0, 0, 0, 0.32), 0px 0px 8px 0px rgba(0, 0, 0, 0.28)',
            }}
            initial={{ opacity: 0, y: chatStarted ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: chatStarted ? 10 : -10 }}
          >
            {mcpServers.length > 0 ? (
              <div className="w-full">
                <div className="max-h-[364.95px] overflow-y-auto">
                  {mcpServers
                    .map((server, index) => ({ server, index }))
                    .filter((item) => !isDisabledServer(item.server.name))
                    .map(({ server, index }) => (
                      <div
                        key={index}
                        className={classNames(
                          'flex items-center justify-between w-full',
                          'px-4 py-3.2',
                          'transition-all duration-200 cursor-pointer',
                          server.enabled
                            ? 'bg-[var(--color-bg-interactive-selected,rgba(17,185,210,0.20))] hover:bg-[rgba(17,185,210,0.30)]'
                            : 'hover:bg-bolt-elements-item-backgroundActive active:bg-[var(--color-bg-interactive-neutral-pressed,#464C54)]',
                        )}
                        onClick={() => handleToggleServer(index, !server.enabled)}
                      >
                        <div className="flex items-center gap-4.8">
                          <button
                            type="button"
                            className={classNames(
                              'flex w-4 h-4 p-[var(--spacing-0,0px)] flex-col items-start gap-[var(--spacing-0,0px)] aspect-square rounded-[var(--border-radius-2,2px)] cursor-pointer',
                              server.enabled
                                ? 'bg-[var(--color-bg-interactive-primary,#1A92A4)]'
                                : 'bg-[#383838] border border-solid border-[var(--color-border-tertiary,rgba(255,255,255,0.12))]',
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleServer(index, !server.enabled);
                            }}
                            aria-pressed={server.enabled}
                            aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name} server`}
                          >
                            {server.enabled && <img src="/icons/Check.svg" alt="Selected" className="w-full h-full" />}
                          </button>

                          <div className="flex flex-col justify-center items-start gap-1.6 flex-1 min-w-0">
                            <div className="flex items-center gap-1.6 self-stretch min-w-0">
                              {server.name === 'All-in-one' ||
                              !['Image', 'Skybox', 'Cinematic', 'Audio', 'UI'].includes(server.name) ? (
                                <img
                                  src={getServerIcon(server.name)}
                                  alt={server.name}
                                  className={classNames('w-5 h-5 flex-shrink-0', server.enabled ? '' : 'opacity-60')}
                                />
                              ) : (
                                <img
                                  src={getServerIcon(server.name)}
                                  alt={server.name}
                                  className={classNames('w-5 h-5 flex-shrink-0', server.enabled ? '' : 'opacity-60')}
                                />
                              )}

                              <div className="flex items-center gap-1.2 flex-1 min-w-0">
                                <h4 className="text-[var(--color-text-primary,#FFF)] font-primary text-[14px] font-medium leading-[150%] break-all min-w-0 line-clamp-1">
                                  {server.name}
                                </h4>
                                {isDefaultServer(server.name) && (
                                  <span className="text-[var(--color-text-accent-secondary,#FFCB48)] font-primary text-[14px] font-medium leading-[142.9%] flex-shrink-0">
                                    {server.name === 'Audio' ? '1 credit/s (default: 30s)' : '1 Credit'}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="w-full min-w-0">
                              <p className="text-[12px] font-primary font-medium leading-[142.9%] text-[var(--color-text-tertiary,#99A2B0)] break-all w-full line-clamp-3">
                                {isDefaultServer(server.name) ? server.description : server.url}
                              </p>
                            </div>
                          </div>
                        </div>

                        {!isDefaultServer(server.name) && (
                          <button
                            className="ml-2 p-1 bg-transparent flex-shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveServer(index);
                            }}
                            aria-label={`Remove ${server.name} server`}
                          >
                            <img src="/icons/Close.svg" alt="Remove" className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                </div>

                <div className="w-full flex justify-end px-2 pt-3">
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="text-[var(--color-text-interactive-primary,#11B9D2)] hover:text-[var(--color-text-interactive-primary-hovered,#1A92A4)] active:text-[var(--color-text-interactive-primary-pressed,#1A7583)] focus:text-[var(--color-text-interactive-primary,#11B9D2)] font-primary bg-transparent border-none text-[14px] font-semibold leading-[142.9%] font-feature-[ss10] px-[14px] py-[10px] transition-colors duration-200"
                  >
                    Add Custom MCP Tool
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full text-center py-3.2 px-3.2 text-bolt-elements-textSecondary text-[11.2px]">
                No MCP servers registered. Add a new server to get started.
              </div>
            )}
          </motion.div>
        )}
      </div>

      {showAddForm &&
        createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-50 font-primary flex items-center justify-center"
            style={{ zIndex: 1200 }}
            onClick={() => setShowAddForm(false)}
          >
            <motion.div
              className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md w-[500px] max-w-[90vw]"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center">
                    <span className="bg-cyan-100 dark:bg-cyan-900/30 p-1.5 rounded-md mr-2">
                      <div className="i-ph:plus-circle-fill w-4 h-4 text-cyan-700 dark:text-cyan-400" />
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
                        'focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500',
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
                        'focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500',
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
                      disabled={!newServer.name || !newServer.url}
                      className={classNames(
                        'px-4 py-2 rounded-lg text-sm font-medium',
                        'transition-colors duration-200',
                        'shadow-sm',
                        'disabled:cursor-not-allowed',
                        !newServer.name || !newServer.url
                          ? 'bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700'
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-cyan-500 hover:text-white dark:hover:bg-cyan-600 dark:hover:text-white hover:border-cyan-400 dark:hover:border-cyan-500',
                      )}
                    >
                      Add Tool
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default McpServerManager;
