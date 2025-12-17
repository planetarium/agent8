import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { useSearchParams } from '@remix-run/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { ClientOnly } from 'remix-utils/client-only';

import { chatStore } from '~/lib/stores/chat';
import { repoStore } from '~/lib/stores/repo';
import { classNames } from '~/utils/classNames';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { toggleMenu, menuStore } from '~/lib/stores/menu';
import useViewport from '~/lib/hooks';

import { HeaderDeployButton } from './HeaderDeployButton.client';
import { HeaderVisibilityButton } from './HeaderVisibilityButton.client';
import { HeaderGitCloneButton } from './HeaderGitCloneButton.client';
import { HeaderCommitHistoryButton } from './HeaderCommitHistoryButton.client';
import { HeaderVersionHistoryButton } from './HeaderVersionHistoryButton.client';
import WithTooltip from '~/components/ui/Tooltip';
import { MoreIcon } from '~/components/ui/Icons';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { Dropdown, DropdownItem } from '~/components/ui/Dropdown';

export function Header() {
  const chat = useStore(chatStore);
  const repo = useStore(repoStore);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('mode') === 'embed';
  const isMenuOpen = useStore(menuStore);
  const isSideMenuDisabled = import.meta.env.VITE_DISABLE_SIDEMENU === 'true';
  const isSmallViewport = useViewport(1003);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  const closeDropdown = (): void => setIsDropdownOpen(false);

  return (
    <TooltipProvider>
      <header
        className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
          'mt-5 bg-primary': !chat.started && isEmbedMode,
          'backdrop-blur-[6px] bg-[rgba(17, 19, 21, 0.30)] z-2': chat.started,
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
              className={classNames('text-interactive-neutral overflow-visible', {
                'px-4': !isEmbedMode,
              })}
            >
              <ClientOnly>{() => <ChatDescription />}</ClientOnly>
            </span>

            {/* Desktop: Show all buttons */}
            {!isSmallViewport && (
              <div className="flex items-center gap-3">
                {repo.path && <ClientOnly>{() => <HeaderVersionHistoryButton />}</ClientOnly>}
                {repo.path && <ClientOnly>{() => <HeaderCommitHistoryButton />}</ClientOnly>}
                {repo.path && <ClientOnly>{() => <HeaderVisibilityButton />}</ClientOnly>}
                {repo.path && <ClientOnly>{() => <HeaderGitCloneButton />}</ClientOnly>}
                <ClientOnly>{() => <HeaderDeployButton />}</ClientOnly>
              </div>
            )}

            {/* Mobile: Show More dropdown with all buttons */}
            {isSmallViewport && (
              <div className="flex items-center gap-2">
                <Dropdown
                  trigger={<CustomIconButton variant="secondary-transparent" size="md" icon={<MoreIcon size={20} />} />}
                  align="end"
                  open={isDropdownOpen}
                  onOpenChange={setIsDropdownOpen}
                >
                  {repo.path && (
                    <>
                      <DropdownItem>
                        <ClientOnly>{() => <ChatDescription asMenuItem onClose={closeDropdown} />}</ClientOnly>
                      </DropdownItem>
                      <DropdownItem>
                        <ClientOnly>{() => <HeaderVisibilityButton asMenuItem onClose={closeDropdown} />}</ClientOnly>
                      </DropdownItem>
                      <DropdownItem>
                        <ClientOnly>
                          {() => <HeaderVersionHistoryButton asMenuItem onClose={closeDropdown} />}
                        </ClientOnly>
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
    </TooltipProvider>
  );
}
