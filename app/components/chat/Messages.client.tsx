import type { JSONValue, UIMessage } from 'ai';
import { Fragment } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { Dropdown, DropdownItem } from '~/components/ui/Dropdown';
import { isEnabledGitbasePersistence } from '~/lib/persistenceGitbase/api.client';
import Lottie from 'lottie-react';
import { loadingAnimationData } from '~/utils/animationData';
import { extractAllTextContent } from '~/utils/message';
import { StarLineIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: UIMessage[];
  annotations?: JSONValue[];
  onRetry?: (message: UIMessage, prevMessage?: UIMessage) => void;
  onFork?: (message: UIMessage) => void;
  onRevert?: (message: UIMessage) => void;
  onViewDiff?: (message: UIMessage) => void;
  onSaveVersion?: (message: UIMessage) => void;
  savedVersionHashes?: Set<string>;
  hasMore?: boolean;
  loadingBefore?: boolean;
  loadBefore?: () => Promise<void>;
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const {
      id,
      isStreaming = false,
      messages = [],
      annotations = [],
      onRetry,
      onFork,
      onRevert,
      onViewDiff,
      onSaveVersion,
      savedVersionHashes,
      hasMore,
      loadingBefore,
      loadBefore,
    } = props;
    const profile = useStore(profileStore);

    return (
      <div
        id={id}
        className={classNames(props.className, 'pr-1', isStreaming ? 'flex flex-col justify-center' : '')}
        ref={ref}
      >
        {hasMore && !isStreaming && (
          <div className="flex justify-center mb-4">
            {loadingBefore ? (
              <div className="flex items-center justify-center flex-grow">
                <div style={{ width: '30px', height: '36px', aspectRatio: '1/1' }}>
                  <Lottie animationData={loadingAnimationData} loop={true} />
                </div>
              </div>
            ) : (
              <button
                onClick={() => loadBefore?.()}
                className="px-4 py-2 bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text rounded-md transition-colors duration-200 font-medium text-sm"
              >
                Load More
              </button>
            )}
          </div>
        )}
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, id: messageId } = message;
              const messageText = extractAllTextContent(message);
              const messageMetadata = message.metadata as any;
              const isHidden = messageMetadata?.annotations?.includes('hidden');
              const isRestoreMessage = messageMetadata?.annotations?.includes('restore-message');
              const isUserMessage = role === 'user';
              const isFirstMessage = index === 0;
              const isLast = index === messages.length - 1;
              const isMergeMessage = messageText.includes('Merge task');

              if (isHidden || isMergeMessage) {
                return <Fragment key={index} />;
              }

              // Special rendering for restore messages
              if (isRestoreMessage) {
                return (
                  <div
                    key={index}
                    className="flex flex-col items-center justify-center gap-3 mt-4 p-[14px] self-stretch"
                  >
                    <div className="flex items-center gap-2 self-stretch">
                      <span className="text-body-md-medium text-secondary">Restored</span>
                      <span className="text-heading-xs text-accent-primary flex-[1_0_0]">{messageText}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 p-6 w-full rounded-[calc(0.75rem-1px)]', {
                    'border border-gray-700 bg-bolt-elements-messages-background mt-4 py-4': isUserMessage,
                    'bg-gray-800 bg-opacity-70 mt-4': !isStreaming && !isUserMessage,
                    'bg-gradient-to-b from-bolt-elements-messages-background from-30% to-transparent':
                      isStreaming && isLast,
                  })}
                >
                  {isUserMessage && (
                    <div className="flex items-center justify-center w-[40px] h-[40px] overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-500 rounded-full shrink-0 self-start -mt-0.5">
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
                      <UserMessage content={messageText} />
                    ) : (
                      <AssistantMessage
                        content={messageText}
                        annotations={annotations}
                        metadata={messageMetadata}
                        forceExpanded={isLast}
                      />
                    )}
                  </div>
                  {isEnabledGitbasePersistence && (
                    <>
                      {!isUserMessage ? (
                        <div className="flex items-start gap-2 mt-2.5">
                          {messageId &&
                            isCommitHash(messageId.split('-').pop() as string) &&
                            (() => {
                              const commitHash = messageId.split('-').pop() as string;
                              const isSaved = savedVersionHashes?.has(commitHash);

                              return isSaved ? (
                                <CustomButton variant="primary-text" size="sm">
                                  Restore
                                </CustomButton>
                              ) : (
                                <button
                                  onClick={() => onSaveVersion?.(message)}
                                  className="p-1.5 rounded-md hover:bg-bolt-elements-background-depth-2 bg-transparent transition-colors"
                                  title="Save as version"
                                >
                                  <StarLineIcon size={20} />
                                </button>
                              );
                            })()}
                          <Dropdown
                            trigger={
                              <button className="i-ph:dots-three-vertical text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors" />
                            }
                          >
                            {messageId && isCommitHash(messageId.split('-').pop() as string) && (
                              <>
                                <DropdownItem onSelect={() => onRevert?.(message)} disabled={isLast}>
                                  <span className="i-ph:arrow-u-up-left text-xl" />
                                  Revert to this message
                                </DropdownItem>

                                <DropdownItem onSelect={() => onViewDiff?.(message)}>
                                  <span className="i-ph:git-diff text-xl" />
                                  View diff for this message
                                </DropdownItem>
                              </>
                            )}
                            <DropdownItem onSelect={() => onFork?.(message)}>
                              <span className="i-ph:git-fork text-xl" />
                              Fork chat from this message
                            </DropdownItem>
                          </Dropdown>
                        </div>
                      ) : (
                        !isFirstMessage && (
                          <div className="flex items-start mt-2.5">
                            <Dropdown
                              trigger={
                                <button className="i-ph:dots-three-vertical text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors" />
                              }
                            >
                              <DropdownItem
                                onSelect={() => {
                                  const prevMessage = index > 0 ? messages[index - 1] : undefined;
                                  onRetry?.(message, prevMessage);
                                }}
                              >
                                <span className="i-ph:arrow-clockwise text-xl" />
                                Retry chat
                              </DropdownItem>
                            </Dropdown>
                          </div>
                        )
                      )}
                    </>
                  )}
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div className="flex items-center justify-center flex-grow mt-10 mb-12">
            <div style={{ width: '60px', height: '60px', aspectRatio: '1/1' }}>
              <Lottie animationData={loadingAnimationData} loop={true} />
            </div>
          </div>
        )}
      </div>
    );
  },
);
