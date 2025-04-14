import type { Message } from 'ai';
import { Fragment } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { Dropdown, DropdownItem } from '~/components/ui/Dropdown';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  onRetry?: (message: Message) => void;
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [], onRetry } = props;
    const location = useLocation();
    const profile = useStore(profileStore);

    const handleRevert = (messageId: string) => {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('revertTo', messageId);
      window.location.search = searchParams.toString();
    };

    return (
      <div id={id} className={props.className} ref={ref}>
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, id: messageId, annotations } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isLast = index === messages.length - 1;
              const isHidden = annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              // `message.content` has an internal problem of duplicating strings for multipart message.
              const content =
                message.parts && message.parts.length > 1
                  ? message.parts
                      .filter((part) => part.type === 'text')
                      .map((part) => part.text)
                      .join('')
                  : message.content;

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 p-6 w-full rounded-[calc(0.75rem-1px)]', {
                    'bg-bolt-elements-messages-background': isUserMessage || !isStreaming || (isStreaming && !isLast),
                    'bg-gradient-to-b from-bolt-elements-messages-background from-30% to-transparent':
                      isStreaming && isLast,
                    'mt-4': !isFirst,
                  })}
                >
                  {isUserMessage && (
                    <div className="flex items-center justify-center w-[40px] h-[40px] overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-500 rounded-full shrink-0 self-start">
                      {profile?.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile?.username || 'User'}
                          className="w-full h-full object-cover"
                          loading="eager"
                          decoding="sync"
                        />
                      ) : (
                        <div className="i-ph:user-fill text-2xl" />
                      )}
                    </div>
                  )}
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} />
                    ) : (
                      <AssistantMessage content={content} annotations={message.annotations} />
                    )}
                  </div>
                  {!isUserMessage ? (
                    <div className="flex items-start mt-2.5">
                      <Dropdown
                        trigger={
                          <button className="i-ph:dots-three-vertical text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors" />
                        }
                      >
                        {messageId && isCommitHash(messageId) && (
                          <DropdownItem onSelect={() => handleRevert(messageId)} disabled={isLast}>
                            <span className="i-ph:arrow-u-up-left text-xl" />
                            Revert to this message
                          </DropdownItem>
                        )}
                        <DropdownItem onSelect={() => {}}>
                          <span className="i-ph:git-fork text-xl" />
                          Fork chat from this message
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  ) : (
                    <div className="flex items-start mt-2.5">
                      <Dropdown
                        trigger={
                          <button className="i-ph:dots-three-vertical text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors" />
                        }
                      >
                        <DropdownItem onSelect={() => onRetry?.(message)}>
                          <span className="i-ph:arrow-clockwise text-xl" />
                          Retry chat
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  )}
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div className="text-center w-full text-bolt-elements-textSecondary i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
        )}
      </div>
    );
  },
);
