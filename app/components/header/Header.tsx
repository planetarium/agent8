import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { repoStore } from '~/lib/stores/repo';
import { classNames } from '~/utils/classNames';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { useSearchParams } from '@remix-run/react';
import { HeaderDeployButton } from './HeaderDeployButton.client';
import { HeaderVisibilityButton } from './HeaderVisibilityButton.client';
import { toggleMenu, menuStore } from '~/lib/stores/menu';
import WithTooltip from '~/components/ui/Tooltip';
import { TooltipProvider } from '@radix-ui/react-tooltip';

export function Header() {
  const chat = useStore(chatStore);
  const repo = useStore(repoStore);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('mode') === 'embed';
  const isMenuOpen = useStore(menuStore);

  return (
    <header
      className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
        'mt-[56px]': !chat.started && isEmbedMode,
        'mt-2': chat.started && isEmbedMode,
      })}
    >
      {/* Logo and menu button - hidden in embed mode */}
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary">
        <TooltipProvider>
          <WithTooltip tooltip={isMenuOpen ? 'Close Sidebar' : 'Open Sidebar'} position="right">
            <div
              onClick={(e) => {
                e.stopPropagation();
                toggleMenu();
              }}
              className={`i-ph:sidebar-simple-duotone text-xl hover:text-accent transition-colors cursor-pointer ${isMenuOpen ? 'text-accent' : ''}`}
            />
          </WithTooltip>
        </TooltipProvider>
      </div>

      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span
            className={classNames('truncate text-center text-bolt-elements-textPrimary', {
              'flex-1 px-4': !isEmbedMode,
              'flex-1': isEmbedMode,
            })}
          >
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          {repo.path && <ClientOnly>{() => <HeaderVisibilityButton />}</ClientOnly>}
          <ClientOnly>{() => <HeaderDeployButton />}</ClientOnly>
        </>
      )}
    </header>
  );
}
