import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { description as descriptionStore, chatId as chatIdStore } from '~/lib/persistence';
import { workbenchStore } from '~/lib/stores/workbench';

export function Header() {
  const chat = useStore(chatStore);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('mode') === 'embed';

  return (
    <header
      className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      {/* Logo and menu button - hidden in embed mode */}
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        {!isEmbedMode && (
          <a href="/" className="text-xl font-semibold text-accent flex items-center">
            AGENT8
          </a>
        )}
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
          {/* <ClientOnly>
            {() => (
              <div className="mr-1">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly> */}
          <ClientOnly>
            {() => (
              <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden mr-2 text-sm">
                <Button
                  onClick={() => {
                    const chatId = chatIdStore.get();
                    const description = descriptionStore.get() || 'Game Project';

                    if (chatId) {
                      workbenchStore.publish(chatId, description);
                    }
                  }}
                  className="px-4 dark:bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive flex items-center gap-2"
                >
                  Deploy
                </Button>
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
