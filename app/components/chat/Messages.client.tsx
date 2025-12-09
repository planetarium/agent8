import type { JSONValue, UIMessage } from 'ai';
import { Fragment } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { isEnabledGitbasePersistence } from '~/lib/persistenceGitbase/api.client';
import Lottie from 'lottie-react';
import { loadingAnimationData } from '~/utils/animationData';
import { extractAllTextContent } from '~/utils/message';
import { StarLineIcon, DiffIcon, RefreshIcon, CopyLineIcon } from '~/components/ui/Icons';
import { toast } from 'react-toastify';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';

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
  onRestoreVersion?: (commitHash: string, commitTitle: string) => void;
  savedVersions?: Map<string, string>;
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
      onViewDiff,
      onSaveVersion,
      onRestoreVersion,
      savedVersions,
      hasMore,
      loadingBefore,
      loadBefore,
    } = props;

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
              const isForkMessage = messageText.startsWith('Fork from');
              const isUserMessage = role === 'user';
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

              // Special rendering for fork messages
              if (isForkMessage) {
                const forkSource = messageText.replace('Fork from ', '');

                return (
                  <div
                    key={index}
                    className="flex flex-col items-center justify-center gap-3 mt-4 p-[14px] self-stretch"
                  >
                    <div className="flex items-center gap-2 self-stretch">
                      <span className="text-body-md-medium text-secondary">Forked from</span>
                      <span className="text-heading-xs text-accent-primary flex-[1_0_0]">{forkSource}</span>
                    </div>
                  </div>
                );
              }

              return (
                <Fragment key={index}>
                  <div
                    className={classNames(
                      'flex self-stretch',
                      isUserMessage
                        ? 'items-start py-2 px-[14px] gap-[10px] rounded-[24px_0_24px_24px] bg-tertiary mt-3'
                        : 'flex-col justify-center items-center gap-0 p-[14px] rounded-[24px_24px_24px_0] border border-tertiary bg-primary backdrop-blur-[4px] mt-3',
                      {
                        'bg-gradient-to-b from-bolt-elements-messages-background from-30% to-transparent':
                          isStreaming && isLast,
                      },
                    )}
                  >
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
                  </div>

                  {isEnabledGitbasePersistence && !isUserMessage && (
                    <div className="flex justify-between items-center px-2 mt-0.5">
                      <div className="flex items-start gap-3">
                        <CustomIconButton
                          variant="secondary-transparent"
                          size="sm"
                          icon={<DiffIcon size={20} />}
                          onClick={() => onViewDiff?.(message)}
                          title="View diff"
                        />
                        <CustomIconButton
                          variant="secondary-transparent"
                          size="sm"
                          icon={<CopyLineIcon size={20} />}
                          onClick={() => {
                            navigator.clipboard.writeText(messageText);
                            toast.success('Copied to clipboard');
                          }}
                          title="Copy response"
                        />
                        {index > 0 && messages[index - 1]?.role === 'user' && (
                          <CustomIconButton
                            variant="secondary-transparent"
                            size="sm"
                            icon={<RefreshIcon size={20} />}
                            onClick={() => {
                              const prevUserMessage = messages[index - 1];
                              const prevPrevMessage = index > 1 ? messages[index - 2] : undefined;
                              onRetry?.(prevUserMessage, prevPrevMessage);
                            }}
                            title="Retry chat"
                          />
                        )}
                      </div>
                      {messageId &&
                        isCommitHash(messageId.split('-').pop() as string) &&
                        (() => {
                          const commitHash = messageId.split('-').pop() as string;
                          const savedTitle = savedVersions?.get(commitHash);

                          return savedTitle ? (
                            <CustomButton
                              variant="primary-text"
                              size="sm"
                              onClick={() => onRestoreVersion?.(commitHash, savedTitle)}
                            >
                              Restore
                            </CustomButton>
                          ) : (
                            <CustomButton
                              variant="secondary-text"
                              size="sm"
                              onClick={() => onSaveVersion?.(message)}
                              title="Save as version"
                            >
                              <StarLineIcon size={20} />
                              Save
                            </CustomButton>
                          );
                        })()}
                    </div>
                  )}
                </Fragment>
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
