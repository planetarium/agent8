import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSettings } from '~/lib/hooks/useSettings';
import { classNames } from '~/utils/classNames';
import * as Tooltip from '@radix-ui/react-tooltip';

// MCP Server Manager Component
const McpServerManager: React.FC<{ chatStarted?: boolean }> = ({ chatStarted = false }) => {
  const { mcpServers, toggleMCPServer, toggleMCPServerV8Auth } = useSettings();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hoveredServerIndex, setHoveredServerIndex] = useState<number | null>(null);

  const disabledServerNames = import.meta.env?.VITE_DISABLED_SERVER_NAMES
    ? JSON.parse(import.meta.env.VITE_DISABLED_SERVER_NAMES)
    : ['All-in-one'];
  const isDisabledServer = (serverName: string) => disabledServerNames.includes(serverName);

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
        return 'i-ph:cube w-4 h-4 text-bolt-elements-textSecondary';
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
              title={server.url}
              onMouseEnter={() => setHoveredServerIndex(index)}
              onMouseLeave={() => setHoveredServerIndex(null)}
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
                <div className={classNames(getServerIcon(server.name), server.enabled ? '' : 'opacity-60')} />
              ) : (
                <img
                  src={getServerIcon(server.name)}
                  alt={server.name}
                  className={server.enabled ? '' : 'opacity-60'}
                />
              )}
              {server.name}
            </div>
          ))}

        {showServerManager && (
          <motion.div
            ref={dropdownRef}
            className={classNames(
              'absolute left-0 flex w-[300px] py-[6.4px] px-0 flex-col items-start rounded-[var(--border-radius-8,8px)] border border-solid border-[var(--color-border-tertiary,rgba(255,255,255,0.12))] bg-[var(--color-bg-interactive-neutral,#222428)] z-10',
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
                {mcpServers
                  .map((server, index) => ({ server, index }))
                  .filter((item) => !isDisabledServer(item.server.name))
                  .map(({ server, index }) => (
                    <div
                      key={index}
                      className={classNames(
                        'flex items-center justify-between w-full',
                        'px-4 py-3.2',
                        'transition-all duration-200',
                        server.enabled
                          ? 'bg-[var(--color-bg-interactive-selected,rgba(17,185,210,0.20))]'
                          : 'hover:bg-bolt-elements-item-backgroundActive',
                      )}
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
                          onClick={() => handleToggleServer(index, !server.enabled)}
                          aria-pressed={server.enabled}
                          aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name} server`}
                        >
                          {server.enabled && <img src="/icons/Check.svg" alt="Selected" className="w-full h-full" />}
                        </button>

                        <div className="flex flex-col justify-center items-start gap-1.6 flex-1">
                          <div className="flex items-center gap-1.6 self-stretch">
                            {server.name === 'All-in-one' ||
                            !['Image', 'Skybox', 'Cinematic', 'Audio', 'UI'].includes(server.name) ? (
                              <div
                                className={classNames(getServerIcon(server.name), server.enabled ? '' : 'opacity-60')}
                              />
                            ) : (
                              <img
                                src={getServerIcon(server.name)}
                                alt={server.name}
                                className={server.enabled ? '' : 'opacity-60'}
                              />
                            )}

                            <div className="flex items-center gap-1.2">
                              <h4 className="text-[var(--color-text-primary,#FFF)] font-primary text-[14px] font-medium leading-[150%]">
                                {server.name}
                              </h4>
                              <span className="text-[var(--color-text-accent-secondary,#FFCB48)] font-primary text-[14px] font-medium leading-[142.9%]">
                                {server.name === 'Audio' ? '1 credit/s (default: 30s)' : '1 Credit'}
                              </span>
                            </div>
                          </div>

                          <div>
                            <p className="text-[12px] font-primary font-medium leading-[142.9%] text-[var(--color-text-tertiary,#99A2B0)]">
                              {server.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="w-full text-center py-3.2 px-3.2 text-bolt-elements-textSecondary text-[11.2px]">
                No MCP servers registered. Add a new server to get started.
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default McpServerManager;
