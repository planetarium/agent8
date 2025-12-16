import { Fragment, forwardRef, useState, useEffect } from 'react';
import type { ForwardedRef } from 'react';
import Lottie from 'lottie-react';
import { toast } from 'react-toastify';
import * as Tooltip from '@radix-ui/react-tooltip';

import type { JSONValue, UIMessage } from 'ai';
import type { ProgressAnnotation } from '~/types/context';

import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { workbenchStore } from '~/lib/stores/workbench';
import { isEnabledGitbasePersistence } from '~/lib/persistenceGitbase/api.client';
import { classNames } from '~/utils/classNames';
import { extractAllTextContent } from '~/utils/message';
import { loadingAnimationData } from '~/utils/animationData';

import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { StarLineIcon, DiffIcon, RefreshIcon, CopyLineIcon, PlayIcon, ChevronRightIcon } from '~/components/ui/Icons';
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
      progressAnnotations = [],
      onRetry,
      onViewDiff,
      onSaveVersion,
      onRestoreVersion,
      savedVersions,
      hasMore,
      loadingBefore,
      loadBefore,
    } = props;

    // Check if response is being generated (same condition as "Generating Response" UI)
    const isGenerating = progressAnnotations.some((p) => p.label === 'response' && p.status === 'in-progress');

    // Track expanded state for each message
    const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

    // Auto-expand last message when it's being generated or just completed
    const lastAssistantIndex = messages.reduce((lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx), -1);

    useEffect(() => {
      if (lastAssistantIndex >= 0) {
        setExpandedMessages((prev) => new Set(prev).add(lastAssistantIndex));
      }
    }, [lastAssistantIndex]);

    const toggleExpanded = (index: number) => {
      setExpandedMessages((prev) => {
        const newSet = new Set(prev);

        if (newSet.has(index)) {
          newSet.delete(index);
        } else {
          newSet.add(index);
        }

        return newSet;
      });
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
                        : 'flex-col justify-center items-center gap-0 pt-[14px] px-[14px] rounded-[24px_24px_24px_0] border border-tertiary bg-primary backdrop-blur-[4px] mt-3 animate-text-fade',
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
                          expanded={expandedMessages.has(index)}
                        />
                      )}
                    </div>

                    {/* Response status indicator for AI messages */}
                    {!isUserMessage && (
                      <div
                        className={classNames(
                          'flex items-center justify-between p-[14px] w-[calc(100%+28px)] mx-[-14px] bg-primary rounded-b-[23px] rounded-bl-none',
                          { 'border-t border-tertiary': messageText.trim() !== '' },
                        )}
                      >
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
                        {!(isLast && isGenerating) && (
                          <button
                            onClick={() => toggleExpanded(index)}
                            className="flex text-interactive-neutral text-heading-xs bg-primary gap-0.5 items-center"
                          >
                            {expandedMessages.has(index) ? 'Hide' : 'Show All'}
                            <ChevronRightIcon
                              width={16}
                              height={16}
                              fill="currentColor"
                              className={`${expandedMessages.has(index) ? '-rotate-90' : ''}`}
                            />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEnabledGitbasePersistence && !isUserMessage && !(isLast && isGenerating) && (
                    <div className="flex justify-between items-center px-2 mt-0.5">
                      <div className="flex items-start gap-3">
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
                              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-lg-medium"
                              side="bottom"
                            >
                              View diff
                              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                        <Tooltip.Root delayDuration={100}>
                          <Tooltip.Trigger asChild>
                            <CustomIconButton
                              variant="secondary-transparent"
                              size="sm"
                              icon={<CopyLineIcon size={20} />}
                              onClick={() => {
                                navigator.clipboard.writeText(messageText);
                                toast.success('Copied to clipboard');
                              }}
                              disabled={isGenerating}
                            />
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-lg-medium"
                              side="bottom"
                            >
                              Copy
                              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                        {index > 0 && messages[index - 1]?.role === 'user' && (
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
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-lg-medium"
                                side="bottom"
                              >
                                Retry
                                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        )}
                      </div>
                      <div className="flex items-center">
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
                        {isLast && (
                          <Tooltip.Root delayDuration={100}>
                            <Tooltip.Trigger asChild>
                              <CustomButton
                                variant="primary-text"
                                size="sm"
                                onClick={() => workbenchStore.runPreview()}
                              >
                                <PlayIcon color="currentColor" size={20} />
                                Preview
                              </CustomButton>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-lg-medium"
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
      </div>
    );
  },
);
