import { Fragment, forwardRef, useState, useEffect } from 'react';
import type { ForwardedRef } from 'react';
import Lottie from 'lottie-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import * as Tooltip from '@radix-ui/react-tooltip';
import useViewport from '~/lib/hooks';
import { CHAT_MOBILE_BREAKPOINT } from '~/lib/constants/viewport';

import type { JSONValue, UIMessage } from 'ai';
import type { ProgressAnnotation } from '~/types/context';

import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { workbenchStore } from '~/lib/stores/workbench';
import { isEnabledGitbasePersistence } from '~/lib/persistenceGitbase/api.client';
import { classNames } from '~/utils/classNames';
import { extractAllTextContent } from '~/utils/message';
import { loadingAnimationData } from '~/utils/animationData';
import { gameCreationTips } from '~/constants/gameCreationTips';
import { getCommitHashFromMessageId } from '~/utils/messageUtils';

import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import {
  BookmarkLineIcon,
  BookmarkFillIcon,
  StarFillIcon,
  DiffIcon,
  RefreshIcon,
  CopyLineIcon,
  PlayIcon,
  ChevronRightIcon,
  RestoreIcon,
  CodeGenLoadingIcon,
} from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: UIMessage[];
  annotations?: JSONValue[];
  progressAnnotations?: ProgressAnnotation[];
  onRetry?: (message: UIMessage, prevMessage?: UIMessage) => void;
  onFork?: (message: UIMessage) => void;
  onViewDiff?: (message: UIMessage) => void;
  onSaveVersion?: (message: UIMessage) => void;
  onDeleteVersion?: (commitHash: string) => void;
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
      progressAnnotations = [],
      onRetry,
      onViewDiff,
      onSaveVersion,
      onDeleteVersion,
      onRestoreVersion,
      savedVersions,
      hasMore,
      loadingBefore,
      loadBefore,
    } = props;

    // Check if response is being generated (same condition as "Generating Response" UI)
    const isGenerating = progressAnnotations.some((p) => p.label === 'response' && p.status === 'in-progress');

    // Check for mobile viewport
    const isSmallViewport = useViewport(CHAT_MOBILE_BREAKPOINT);

    // Random game creation tip that changes every 5 seconds
    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setCurrentTipIndex((prev) => (prev + 1) % gameCreationTips.length);
      }, 5000);

      return () => clearInterval(interval);
    }, []);

    const randomTip = gameCreationTips[currentTipIndex];

    // Track expanded state for each message (AI messages only)
    const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

    // Auto-expand last message when it's being generated or just completed
    const lastAssistantIndex = messages.reduce((lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx), -1);

    useEffect(() => {
      if (lastAssistantIndex >= 0) {
        /*
         * On small viewport, keep all messages collapsed.
         * On larger viewport, only keep the last assistant message expanded.
         */
        if (isSmallViewport) {
          setExpandedMessages(new Set());
        } else {
          setExpandedMessages(new Set([lastAssistantIndex]));
        }
      }
    }, [lastAssistantIndex, isSmallViewport]);

    const toggleExpanded = (index: number, event: React.MouseEvent) => {
      const isExpanding = !expandedMessages.has(index);

      if (isExpanding) {
        // Get the message container element
        const button = event.currentTarget as HTMLElement;
        const messageContainer = button.closest('[data-message-index]') as HTMLElement;
        const scrollContainer = button.closest('.chat-container') as HTMLElement;

        if (messageContainer && scrollContainer) {
          const prevHeight = messageContainer.offsetHeight;

          setExpandedMessages((prev) => new Set(prev).add(index));

          // After state update, adjust scroll position to expand upward
          requestAnimationFrame(() => {
            const newHeight = messageContainer.offsetHeight;
            const heightDiff = newHeight - prevHeight;
            scrollContainer.scrollTop += heightDiff;
          });
        } else {
          setExpandedMessages((prev) => new Set(prev).add(index));
        }
      } else {
        setExpandedMessages((prev) => {
          const newSet = new Set(prev);
          newSet.delete(index);

          return newSet;
        });
      }
    };

    return (
      <div
        id={id}
        className={classNames(props.className, 'pr-1', isStreaming ? 'flex flex-col justify-end' : '')}
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

              /*
               * Only consider it the first assistant message if there are no more messages to load
               * and it's truly the first visible assistant message in the entire chat history
               */
              const isFirstAssistantMessage =
                !isUserMessage &&
                !hasMore &&
                messages.slice(0, index).filter((m) => {
                  const meta = m.metadata as any;
                  const isHiddenMsg = meta?.annotations?.includes('hidden');

                  return m.role === 'assistant' && !isHiddenMsg;
                }).length === 0;

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
                    <div className="flex items-center gap-2 self-stretch overflow-hidden">
                      <span className="text-body-md-medium text-secondary shrink-0">Restored</span>
                      <span className="text-heading-xs text-accent-primary flex-[1_0_0] truncate">{messageText}</span>
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
                      <span className="text-body-md-medium text-secondary">Copied from</span>
                      <span className="text-heading-xs text-accent-primary flex-[1_0_0]">{forkSource}</span>
                    </div>
                  </div>
                );
              }

              return (
                <Fragment key={index}>
                  {!isUserMessage && messageText.trim() === '' && isLast && isGenerating ? (
                    <div className="flex flex-col justify-start items-start gap-3 p-[14px] self-stretch rounded-[24px_24px_24px_0] border border-tertiary bg-primary backdrop-blur-[4px] mt-3">
                      <div className="flex items-center gap-3">
                        <div style={{ width: '24px', height: '24px' }}>
                          <Lottie animationData={loadingAnimationData} loop={true} />
                        </div>
                        <span className="text-heading-xs animate-text-color-wave">Generating Response...</span>
                      </div>
                    </div>
                  ) : (
                    <div
                      data-message-index={index}
                      className={classNames(
                        'flex self-stretch',
                        isUserMessage
                          ? 'items-start py-2 px-[14px] gap-[10px] rounded-[24px_0_24px_24px] bg-tertiary mt-3'
                          : 'flex-col justify-center items-center gap-0 pt-[14px] px-[14px] rounded-[24px_24px_24px_0] border border-tertiary bg-primary backdrop-blur-[4px] mt-3 animate-text-fade',

                        // Make AI response tappable on mobile when collapsed
                        !isUserMessage && isSmallViewport && !expandedMessages.has(index) ? 'cursor-pointer' : '',
                      )}
                      onClick={(e) => {
                        // On mobile, tap anywhere on collapsed AI response to expand
                        if (!isUserMessage && isSmallViewport && !expandedMessages.has(index)) {
                          toggleExpanded(index, e);
                        }
                      }}
                    >
                      <div className="grid grid-col-1 w-full">
                        {/* Show saved version name for AI responses */}
                        {!isUserMessage &&
                          messageId &&
                          isCommitHash(getCommitHashFromMessageId(messageId)) &&
                          (() => {
                            const commitHash = getCommitHashFromMessageId(messageId);
                            const savedTitle = savedVersions?.get(commitHash);

                            return savedTitle ? (
                              <div className="flex items-start gap-1 pb-2">
                                <StarFillIcon size={16} fill="var(--color-text-tertiary)" />
                                <span className="text-body-sm text-tertiary">{savedTitle}</span>
                              </div>
                            ) : null;
                          })()}
                        {isUserMessage ? (
                          <UserMessage content={messageText} isLast={isLast} />
                        ) : (
                          <AssistantMessage
                            content={messageText}
                            annotations={annotations}
                            expanded={expandedMessages.has(index)}
                            isSmallViewport={isSmallViewport}
                          />
                        )}
                      </div>

                      {/* Response status indicator for AI messages */}
                      {!isUserMessage && (
                        <div
                          className={classNames(
                            'relative flex items-center justify-between p-[14px] w-[calc(100%+28px)] mx-[-14px] bg-primary rounded-b-[23px] rounded-bl-none',
                            {
                              'border-t border-tertiary':
                                messageText.trim() !== '' &&
                                !(isSmallViewport && isLast && isGenerating && !expandedMessages.has(index)),
                            },
                          )}
                        >
                          {/* Gradient overlay when collapsed on mobile */}
                          {isSmallViewport && !expandedMessages.has(index) && (
                            <div
                              className="absolute left-0 right-0 pointer-events-none"
                              style={{
                                height: '40px',
                                bottom: 'calc(100% - 5px)',
                                background:
                                  'linear-gradient(180deg, rgba(17, 19, 21, 0.00) 0%, rgba(17, 19, 21, 0.14) 14.03%, rgba(17, 19, 21, 0.27) 26.24%, rgba(17, 19, 21, 0.38) 36.8%, rgba(17, 19, 21, 0.48) 45.9%, rgba(17, 19, 21, 0.57) 53.7%, rgba(17, 19, 21, 0.65) 60.4%, rgba(17, 19, 21, 0.71) 66.16%, rgba(17, 19, 21, 0.77) 71.17%, rgba(17, 19, 21, 0.82) 75.6%, rgba(17, 19, 21, 0.86) 79.63%, rgba(17, 19, 21, 0.90) 83.44%, rgba(17, 19, 21, 0.93) 87.2%, rgba(17, 19, 21, 0.96) 91.1%, rgba(17, 19, 21, 0.98) 95.3%, #111315 100%)',
                              }}
                            />
                          )}
                          <div className="flex items-center gap-3">
                            {isLast && isGenerating ? (
                              <>
                                <div style={{ width: '24px', height: '24px' }}>
                                  <Lottie animationData={loadingAnimationData} loop={true} />
                                </div>
                                <span className="text-heading-xs animate-text-color-wave">Generating Response...</span>
                              </>
                            ) : isLast ? (
                              <span
                                className="text-heading-xs"
                                style={{
                                  background:
                                    'linear-gradient(90deg, var(--color-text-accent-subtle-gradient-start, #72E7F8) 0%, var(--color-text-accent-subtle-gradient-end, #FFD876) 100%)',
                                  backgroundClip: 'text',
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                }}
                              >
                                Response Generated
                              </span>
                            ) : (
                              <span className="text-heading-xs text-subtle">Response Generated</span>
                            )}
                          </div>
                          {/* Show All/Hide button: always visible */}
                          <button
                            onClick={(e) => toggleExpanded(index, e)}
                            className="flex text-interactive-neutral text-heading-2xs bg-primary gap-0.5 items-center"
                          >
                            {expandedMessages.has(index) ? 'Hide' : 'Show All'}
                            <ChevronRightIcon
                              width={16}
                              height={16}
                              fill="currentColor"
                              className={`${expandedMessages.has(index) ? '-rotate-90' : ''}`}
                            />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {isEnabledGitbasePersistence && !isUserMessage && !(isLast && isGenerating) && (
                    <div className="flex justify-between items-center px-2 mt-0.5">
                      <div className="flex items-start gap-3">
                        {/* Show Bookmark button for assistant messages with commit hash */}
                        {role === 'assistant' &&
                          messageId &&
                          (() => {
                            const commitHash = getCommitHashFromMessageId(messageId);

                            return isCommitHash(commitHash);
                          })() &&
                          (() => {
                            const commitHash = getCommitHashFromMessageId(messageId);
                            const savedTitle = savedVersions?.get(commitHash);
                            const isSaved = !!savedTitle;

                            return (
                              <Tooltip.Root delayDuration={100}>
                                <Tooltip.Trigger asChild>
                                  <CustomIconButton
                                    variant="secondary-transparent"
                                    size="sm"
                                    icon={
                                      isSaved ? (
                                        <BookmarkFillIcon size={20} />
                                      ) : (
                                        <BookmarkLineIcon width={20} height={20} />
                                      )
                                    }
                                    onClick={() => {
                                      if (isSaved) {
                                        onDeleteVersion?.(commitHash);
                                      } else {
                                        onSaveVersion?.(message);
                                      }
                                    }}
                                    disabled={isGenerating}
                                  />
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content
                                    className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                                    side="bottom"
                                  >
                                    {isSaved ? (
                                      'Remove from Bookmarks'
                                    ) : (
                                      <>
                                        Save to Bookmarks
                                        <br />
                                        and restore when needed
                                      </>
                                    )}
                                    <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            );
                          })()}
                        <Tooltip.Root delayDuration={100}>
                          <Tooltip.Trigger asChild>
                            <CustomIconButton
                              variant="secondary-transparent"
                              size="sm"
                              icon={<CopyLineIcon size={20} />}
                              onClick={() => {
                                // Get rendered text from message content only (excludes UI buttons like Show All/Hide)
                                const messageElement = document.querySelector(
                                  `[data-message-index="${index}"]`,
                                ) as HTMLElement | null;
                                const contentElement = messageElement?.querySelector(
                                  '[data-message-content]',
                                ) as HTMLElement | null;
                                const textToCopy = contentElement?.innerText || messageText;
                                navigator.clipboard.writeText(textToCopy);
                                toast.success('Copied to clipboard');
                              }}
                              disabled={isGenerating}
                            />
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                              side="bottom"
                            >
                              Copy
                              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                        {/* Show Restore button for assistant messages with commit hash (except last message) */}
                        {messageId &&
                          isCommitHash(getCommitHashFromMessageId(messageId)) &&
                          role === 'assistant' &&
                          !isLast && (
                            <Tooltip.Root delayDuration={100}>
                              <Tooltip.Trigger asChild>
                                <CustomIconButton
                                  variant="secondary-transparent"
                                  size="sm"
                                  icon={<RestoreIcon size={20} color="currentColor" />}
                                  onClick={() => {
                                    const commitHash = getCommitHashFromMessageId(messageId);

                                    // Find the previous user message to use as title
                                    const prevUserMessage = messages
                                      .slice(0, index)
                                      .reverse()
                                      .find((m) => m.role === 'user');
                                    const userMessageText = prevUserMessage
                                      ? extractAllTextContent(prevUserMessage)
                                      : messageText;
                                    onRestoreVersion?.(commitHash, userMessageText);
                                  }}
                                  disabled={isGenerating}
                                />
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content
                                  className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                                  side="bottom"
                                >
                                  Restore
                                  <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          )}
                        {/* Show Retry button only for the last message */}
                        {index > 0 && messages[index - 1]?.role === 'user' && isLast && (
                          <Tooltip.Root delayDuration={100}>
                            <Tooltip.Trigger asChild>
                              <CustomIconButton
                                variant="secondary-transparent"
                                size="sm"
                                icon={<RefreshIcon size={20} />}
                                onClick={() => {
                                  const prevUserMessage = messages[index - 1];
                                  const prevPrevMessage = index > 1 ? messages[index - 2] : undefined;
                                  onRetry?.(prevUserMessage, prevPrevMessage);
                                }}
                                disabled={isGenerating}
                              />
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                                side="bottom"
                              >
                                Retry
                                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        )}
                        {/* Show View Diff button after Retry (if Retry exists) or after Revert (if no Retry) */}
                        {!isFirstAssistantMessage && !isSmallViewport && (
                          <Tooltip.Root delayDuration={100}>
                            <Tooltip.Trigger asChild>
                              <CustomIconButton
                                variant="secondary-transparent"
                                size="sm"
                                icon={<DiffIcon size={20} />}
                                onClick={() => onViewDiff?.(message)}
                                disabled={isGenerating}
                              />
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                                side="bottom"
                              >
                                View diff
                                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        )}
                      </div>
                      <div className="flex items-center">
                        {messageId &&
                          isCommitHash(getCommitHashFromMessageId(messageId)) &&
                          (() => {
                            const commitHash = getCommitHashFromMessageId(messageId);
                            const savedTitle = savedVersions?.get(commitHash);

                            /*
                             * If saved version exists and not the last message, show Restore button
                             * If last message, it's the current version so no need to restore
                             */
                            return savedTitle && !isLast ? (
                              <CustomButton
                                variant="primary-text"
                                size="sm"
                                onClick={() => onRestoreVersion?.(commitHash, savedTitle)}
                              >
                                Restore
                              </CustomButton>
                            ) : null;
                          })()}
                        {isLast && (
                          <Tooltip.Root delayDuration={100}>
                            <Tooltip.Trigger asChild>
                              <CustomButton
                                variant="primary-text"
                                size="sm"
                                onClick={() => {
                                  workbenchStore.runPreview();

                                  // On mobile, immediately show preview screen
                                  if (isSmallViewport) {
                                    workbenchStore.mobilePreviewMode.set(true);
                                  }
                                }}
                              >
                                <PlayIcon color="currentColor" size={20} />
                                Preview
                              </CustomButton>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
                                side="bottom"
                              >
                                Run Preview
                                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        )}
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })
          : null}

        {/* Show loading UI when streaming starts and no AI response yet */}
        {isStreaming &&
          (messages.length === 0 || messages[messages.length - 1]?.role === 'user') &&
          (isSmallViewport && messages.length === 0 ? (
            <div className="flex flex-col w-full h-full justify-center items-center gap-5">
              <div className="relative">
                <CodeGenLoadingIcon size={256} />
                <div className="absolute top-[calc(50%-16px)] left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12">
                  <Lottie animationData={loadingAnimationData} loop={true} />
                </div>
                <span className="absolute top-[calc(50%+48px)] left-1/2 -translate-x-1/2 text-body-lg-medium text-subtle animate-text-color-wave">
                  Generating code
                </span>
              </div>

              <div className="flex flex-col items-center justify-start py-2 max-w-md">
                <div className="flex flex-col justify-start items-center self-stretch">
                  <span className="text-body-lg-regular text-subtle mb-2">Tip</span>
                  <div className="min-h-[3.5rem] flex items-start justify-center">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={currentTipIndex}
                        className="text-body-lg-regular text-secondary text-center leading-relaxed"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                      >
                        {randomTip}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col justify-start items-start gap-3 p-[14px] self-stretch rounded-[24px_24px_24px_0] border border-tertiary bg-primary backdrop-blur-[4px] mt-3">
              <div className="flex items-center gap-3">
                <div style={{ width: '24px', height: '24px' }}>
                  <Lottie animationData={loadingAnimationData} loop={true} />
                </div>
                <span className="text-heading-xs animate-text-color-wave">Generating Response...</span>
              </div>
            </div>
          ))}
      </div>
    );
  },
);
