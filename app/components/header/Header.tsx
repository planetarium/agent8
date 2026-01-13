import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { useSearchParams } from '@remix-run/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { ClientOnly } from 'remix-utils/client-only';

import { chatStore } from '~/lib/stores/chat';
import { repoStore } from '~/lib/stores/repo';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { toggleMenu, menuStore } from '~/lib/stores/menu';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';

import { HeaderDeployButton } from './HeaderDeployButton.client';
import { HeaderVisibilityButton } from './HeaderVisibilityButton.client';
import { HeaderGitCloneButton } from './HeaderGitCloneButton.client';
import { HeaderCommitHistoryButton } from './HeaderCommitHistoryButton.client';
import { HeaderBookmarksButton } from './HeaderBookmarksButton.client';
import { HeaderLegacyUiToggle } from './HeaderLegacyUiToggle.client';
import { LegacyProjectBanner } from './LegacyProjectBanner';
import WithTooltip from '~/components/ui/Tooltip';
import { MoreIcon, PreviewIcon, ChatIcon } from '~/components/ui/Icons';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { Dropdown, DropdownItem } from '~/components/ui/Dropdown';

export function Header() {
  const chat = useStore(chatStore);
  const repo = useStore(repoStore);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('mode') === 'embed';
  const isMenuOpen = useStore(menuStore);
  const isSideMenuDisabled = import.meta.env.VITE_DISABLE_SIDEMENU === 'true';
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isDesktopDropdownOpen, setIsDesktopDropdownOpen] = useState<boolean>(false);
  const isPreviewMode = useStore(workbenchStore.mobilePreviewMode);

  const togglePreviewMode = () => {
    workbenchStore.mobilePreviewMode.set(!isPreviewMode);
  };

  const closeDropdown = (): void => setIsDropdownOpen(false);
  const closeDesktopDropdown = (): void => setIsDesktopDropdownOpen(false);

  // Hide header completely on mobile preview mode, but keep toggle switch visible
  const showHeader = !(isSmallViewport && isPreviewMode);

  return (
    <TooltipProvider>
      {showHeader && (
        <header
          className={classNames('flex items-center py-5 px-7 border-b h-[var(--header-height)]', {
            'border-transparent flex-shrink-0': !chat.started,
            'border-bolt-elements-borderColor': chat.started,
            'mt-5 bg-primary': !chat.started && isEmbedMode,
            'backdrop-blur-[6px] bg-[rgba(17, 19, 21, 0.30)] z-10': chat.started,
          })}
        >
          {/* Logo and menu button - hidden in embed mode */}
          <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary">
            {!isSideMenuDisabled && (
              <WithTooltip tooltip={isMenuOpen ? 'Close Sidebar' : 'Open Sidebar'} position="right">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMenu();
                  }}
                  className={`i-ph:sidebar-simple-duotone text-xl hover:text-accent transition-colors cursor-pointer ${isMenuOpen ? 'text-accent' : ''}`}
                />
              </WithTooltip>
            )}
          </div>

          {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
            <div className="flex justify-between items-center self-stretch w-full">
              <span
                className={classNames('text-interactive-neutral overflow-visible flex-1 min-w-0', {
                  'pl-4': !isEmbedMode,
                })}
              >
                <ClientOnly>{() => <ChatDescription />}</ClientOnly>
              </span>

              {/* Desktop: Show all buttons */}
              {!isSmallViewport && (
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {repo.path && (
                    <Dropdown
                      trigger={
                        <CustomIconButton variant="secondary-outlined" size="md" icon={<MoreIcon size={22} />} />
                      }
                      align="end"
                      size="compact"
                      open={isDesktopDropdownOpen}
                      onOpenChange={setIsDesktopDropdownOpen}
                    >
                      <DropdownItem size="compact">
                        <ClientOnly>
                          {() => <HeaderGitCloneButton asMenuItem onClose={closeDesktopDropdown} />}
                        </ClientOnly>
                      </DropdownItem>
                      <DropdownItem size="compact">
                        <ClientOnly>
                          {() => <HeaderLegacyUiToggle asMenuItem onClose={closeDesktopDropdown} />}
                        </ClientOnly>
                      </DropdownItem>
                    </Dropdown>
                  )}
                  {repo.path && <ClientOnly>{() => <HeaderCommitHistoryButton />}</ClientOnly>}
                  {repo.path && <ClientOnly>{() => <HeaderBookmarksButton />}</ClientOnly>}
                  {repo.path && <ClientOnly>{() => <HeaderVisibilityButton />}</ClientOnly>}
                  <ClientOnly>{() => <HeaderDeployButton />}</ClientOnly>
                </div>
              )}

              {/* Mobile: Show More dropdown with all buttons */}
              {isSmallViewport && (
                <div className="flex items-center gap-2">
                  <Dropdown
                    trigger={
                      <CustomIconButton variant="secondary-transparent" size="md" icon={<MoreIcon size={20} />} />
                    }
                    align="end"
                    open={isDropdownOpen}
                    onOpenChange={setIsDropdownOpen}
                  >
                    {repo.path && (
                      <>
                        <DropdownItem>
                          <ClientOnly>{() => <HeaderVisibilityButton asMenuItem onClose={closeDropdown} />}</ClientOnly>
                        </DropdownItem>
                        <DropdownItem>
                          <ClientOnly>{() => <ChatDescription asMenuItem onClose={closeDropdown} />}</ClientOnly>
                        </DropdownItem>
                        <DropdownItem>
                          <ClientOnly>{() => <HeaderBookmarksButton asMenuItem onClose={closeDropdown} />}</ClientOnly>
                        </DropdownItem>
                        <DropdownItem>
                          <ClientOnly>
                            {() => <HeaderCommitHistoryButton asMenuItem onClose={closeDropdown} />}
                          </ClientOnly>
                        </DropdownItem>
                        <DropdownItem>
                          <ClientOnly>{() => <HeaderGitCloneButton asMenuItem onClose={closeDropdown} />}</ClientOnly>
                        </DropdownItem>
                      </>
                    )}
                  </Dropdown>
                  <ClientOnly>{() => <HeaderDeployButton />}</ClientOnly>
                </div>
              )}
            </div>
          )}
        </header>
      )}

      {/* Floating pill UI - visible on small viewport after chat started */}
      {chat.started && isSmallViewport && (
        <div
          className="fixed right-2 z-5 inline-flex items-center rounded-full border border-tertiary bg-interactive-neutral cursor-pointer"
          style={{
            top: 'calc(var(--header-height) + 8px)',
            boxShadow: '0 4px 8px 0 rgba(0, 0, 0, 0.28), 0 0 4px 0 rgba(0, 0, 0, 0.24)',
          }}
          onClick={togglePreviewMode}
        >
          {/* Left side - Chat button, active when isPreviewMode is false */}
          <div
            className={classNames('flex h-[44px] items-center rounded-full', {
              'w-[52px] px-4 py-3 gap-2 bg-interactive-neutral-subtle': !isPreviewMode,
              'w-[44px] pt-3 pb-3 pl-4 pr-2 gap-[10px]': isPreviewMode,
            })}
            style={{
              transition: 'all 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <ChatIcon size={20} className="flex-shrink-0" />
          </div>
          {/* Right side - Preview button */}
          <div
            className={classNames('flex h-[44px] items-center gap-2 rounded-full', {
              'w-[52px] px-4 py-3 bg-interactive-neutral-subtle': isPreviewMode,
              'w-[44px] pt-3 pb-3 pl-2 pr-4 bg-transparent': !isPreviewMode,
            })}
            style={{
              transition: 'all 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <PreviewIcon size={20} className="flex-shrink-0" />
          </div>
        </div>
      )}

      {/* Legacy Project Banner */}
      <LegacyProjectBanner chatStarted={chat.started} />
    </TooltipProvider>
  );
}
