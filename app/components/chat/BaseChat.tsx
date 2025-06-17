/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { ATTACHMENT_EXTS, PROVIDER_LIST } from '~/utils/constants';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast } from 'react-toastify';

import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';

import FilePreview from './FilePreview';
import { ModelSelector } from '~/components/chat/ModelSelector';
import type { ProviderInfo } from '~/types/model';
import type { ActionAlert } from '~/types/actions';
import ChatAlert from './ChatAlert';
import type { ModelInfo } from '~/lib/modules/llm/types';
import ProgressCompilation from './ProgressCompilation';
import type { ProgressAnnotation } from '~/types/context';
import type { ActionRunner } from '~/lib/runtime/action-runner';
import McpServerManager from '~/components/chat/McpServerManager';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { useStore } from '@nanostores/react';
import { TaskMessages } from './TaskMessages.client';
import { TaskBranches } from './TaskBranches.client';
import { lastActionStore } from '~/lib/stores/lastAction';
import { shouldIgnorePreviewError } from '~/utils/previewErrorFilters';
import { AttachmentSelector } from './AttachmentSelector';

const TEXTAREA_MIN_HEIGHT = 76;
const MAX_ATTACHMENTS = 10;

export interface ChatAttachment {
  filename: string;
  url: string;
  features: string;
  details: string;
  ext: string;
  metadata?: Record<string, any>;
}

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  enabledTaskMode?: boolean;
  setEnabledTaskMode?: (enabled: boolean) => void;
  taskBranches?: any[];
  reloadTaskBranches?: (projectPath: string) => void;
  currentTaskBranch?: any;
  setCurrentTaskBranch?: (branch: any) => void;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  attachmentList?: ChatAttachment[];
  setAttachmentList?: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  data?: JSONValue[] | undefined;
  actionRunner?: ActionRunner;
  onProjectZipImport?: (title: string, zipFile: File) => void;
  handleRetry?: (message: Message) => void;
  handleFork?: (message: Message) => void;
  handleRevert?: (message: Message) => void;
  onViewDiff?: (message: Message) => void;
  hasMore?: boolean;
  loadBefore?: () => Promise<void>;
  loadingBefore?: boolean;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',

      /*
       * enabledTaskMode,
       * setEnabledTaskMode,
       */

      taskBranches,
      reloadTaskBranches,
      handleInputChange,

      sendMessage,
      handleStop,
      attachmentList = [],
      setAttachmentList,
      messages,
      actionAlert,
      clearAlert,
      data,
      actionRunner,
      onProjectZipImport,
      handleRetry,
      handleFork,
      handleRevert,
      onViewDiff,
      hasMore,
      loadBefore,
      loadingBefore,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = 200;
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [autoFixChance, setAutoFixChance] = useState(3);
    const repo = useStore(repoStore);
    const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState<boolean>(false);
    const [attachmentHovered, setAttachmentHovered] = useState<boolean>(false);
    const [importProjectModalOpen, setImportProjectModalOpen] = useState<boolean>(false);

    const prompts = [
      'Create a basic Three.js FPS game inspired by Call of Duty, where the player navigates a 3D maze and shoots targets from a first-person view.',
      'Build a simple Three.js third-person shooter like Fortnite, with a camera following behind a character moving and shooting in a 3D world.',
      'Make a basic Three.js top-down game like League of Legends, where the player controls a character from above and clicks to move and attack.',
      'Create a simple match-3 puzzle game like Candy Crush, where players swap tiles on a colorful 2D grid with smooth animations.',
      'Build a voxel-based sandbox game like Minecraft in Three.js, with procedural terrain generation, block placement, and first-person movement.',
      'Make a minimalist flight simulator in Three.js inspired by Peter Levels game, with a low-poly plane.',
    ];
    const [currentPromptIndex, setCurrentPromptIndex] = useState<number>(0);
    const [animationDirection, setAnimationDirection] = useState('in');

    useEffect(() => {
      if (!chatStarted) {
        const rotatePrompt = () => {
          setAnimationDirection('out');

          setTimeout(() => {
            setCurrentPromptIndex((prevIndex) => {
              return (prevIndex + 1) % prompts.length;
            });
            setAnimationDirection('in');
          }, 500);
        };

        const promptTimer = setInterval(rotatePrompt, 4000);

        return () => clearInterval(promptTimer);
      }

      return undefined;
    }, [chatStarted, prompts.length]);

    useEffect(() => {
      if (data) {
        const progressList = data.filter(
          (x) => typeof x === 'object' && (x as any).type === 'progress',
        ) as ProgressAnnotation[];
        setProgressAnnotations(progressList);
      }
    }, [data]);
    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    // State to store scroll container ref
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    // State to track auto-scroll mode
    const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);

    // Check if scroll is at bottom
    const isScrollAtBottom = useCallback((element: HTMLDivElement): boolean => {
      const threshold = 1;
      return Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) <= threshold;
    }, []);

    // Handle scroll events to detect user manual scrolling
    useEffect(() => {
      if (!scrollElement) {
        return;
      }

      const handleScroll = () => {
        const atBottom = isScrollAtBottom(scrollElement);
        setAutoScrollEnabled(atBottom);
      };

      scrollElement.addEventListener('scroll', handleScroll);

      // eslint-disable-next-line consistent-return
      return () => {
        scrollElement.removeEventListener('scroll', handleScroll);
      };
    }, [scrollElement, isScrollAtBottom]);

    // Auto-scroll to bottom when messages update (only if auto-scroll is enabled)
    useEffect(() => {
      if (scrollElement && autoScrollEnabled) {
        // Use requestAnimationFrame to ensure DOM updates are complete
        requestAnimationFrame(() => {
          scrollElement.scrollTop = scrollElement.scrollHeight;
        });
      }
    }, [messages, isStreaming, scrollElement, autoScrollEnabled]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
        };

        setRecognition(recognition);
      }
    }, []);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        setIsModelLoading('all');
        fetch('/api/models')
          .then((response) => response.json())
          .then((data) => {
            const typedData = data as { modelList: ModelInfo[] };
            setModelList(typedData.modelList);
          })
          .catch((error) => {
            console.error('Error fetching model list:', error);
          })
          .finally(() => {
            setIsModelLoading(undefined);
          });
      }
    }, [providerList, provider]);

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        lastActionStore.set({ action: 'SEND_MESSAGE' });
        sendMessage(event, messageInput);

        setAutoFixChance(3);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*, video/*, audio/*, .glb, .gltf, .vrm, .json, .ttf, .zip';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          await uploadFileAndAddToAttachmentList(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          // 이미지 파일인 경우만 이벤트 기본 동작 방지
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            await uploadFileAndAddToAttachmentList(file);
          }

          break;
        }

        // 이미지가 아닌 경우에는 기본 붙여넣기 동작 허용 (preventDefault 호출 안 함)
      }
    };

    const uploadFileAndAddToAttachmentList = async (file: File) => {
      try {
        if (attachmentList?.length >= MAX_ATTACHMENTS) {
          toast.error(`Attachments are limited to ${MAX_ATTACHMENTS} files.`);
          return;
        }

        const fileName = file.name;
        const fileExt = `.${fileName.split('.').pop()?.toLowerCase()}`;

        if (fileExt === '.zip') {
          onProjectZipImport?.(fileName, file);
          return;
        }

        if (!ATTACHMENT_EXTS.includes(fileExt)) {
          toast.error('Not allowed file type');
          return;
        }

        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
        const modelExtensions = ['.glb', '.gltf', '.vrm'];
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a'];
        const videoExtensions = ['.mp4', '.webm', '.mov'];

        let fileType = 'unknown';

        if (imageExtensions.includes(fileExt)) {
          fileType = 'image';
        } else if (modelExtensions.includes(fileExt)) {
          fileType = '3D model';
        } else if (audioExtensions.includes(fileExt)) {
          fileType = 'audio';
        } else if (videoExtensions.includes(fileExt)) {
          fileType = 'video';
        } else {
          toast.error('Only media files are allowed');
          return;
        }

        // 생성한 임시 ID
        const tempId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // 임시 첨부 파일 객체 생성 (업로드 중 상태)
        const tempAttachment: ChatAttachment = {
          filename: fileName,
          url: `uploading://${tempId}`, // 특수 프로토콜 사용
          features: `Uploading ${fileType} file...`,
          details: `Uploading ${fileName}`,
          ext: fileExt,
        };

        // 임시 첨부 파일을 리스트에 추가
        setAttachmentList?.((prev) => [...prev, tempAttachment]);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', 'chat-uploads');

        const verse = 'current';
        formData.append('verse', verse);

        toast.info(`Uploading ${file.name}...`);

        // For image files, get dimensions before uploading
        let imageMetadata = undefined;

        if (fileType === 'image' && !fileExt.includes('svg')) {
          try {
            imageMetadata = await getImageDimensions(file);
          } catch (error) {
            console.error('Error getting image dimensions:', error);
          }
        }

        try {
          const response = await fetch('/api/upload-attachment', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed: ${response.status} ${errorText}`);
          }

          const result = (await response.json()) as { success: boolean; url: string; error?: string };

          if (result.success && result.url) {
            // 업로드 성공 시 실제 첨부 파일 객체 생성
            const finalAttachment: ChatAttachment = {
              filename: fileName,
              url: result.url,
              features: `Type: ${fileType} Ext: ${fileExt}`,
              details: `Type: ${fileType} Ext: ${fileExt}`,
              ext: fileExt,
              metadata: imageMetadata,
            };

            // Add dimensions to features if available
            if (imageMetadata?.width && imageMetadata?.height) {
              finalAttachment.features = `Type: ${fileType} Ext: ${fileExt} Size: ${imageMetadata.width}x${imageMetadata.height}`;
              finalAttachment.details = `Type: ${fileType} Ext: ${fileExt} Size: ${imageMetadata.width}x${imageMetadata.height}`;
            }

            // 임시 첨부 파일을 실제 첨부 파일로 교체
            setAttachmentList?.((prev) =>
              prev.map((attachment) => (attachment.url === `uploading://${tempId}` ? finalAttachment : attachment)),
            );

            toast.success(`Uploaded ${file.name}`);
          } else {
            throw new Error(result.error || 'Unknown error during upload');
          }
        } catch (error: any) {
          // 업로드 실패 시 임시 첨부 파일을 에러 상태로 변경
          setAttachmentList?.((prev) =>
            prev.map((attachment) =>
              attachment.url === `uploading://${tempId}`
                ? {
                    ...attachment,
                    url: `error://${tempId}`,
                    features: `Upload failed: ${error.message}`,
                    details: `Failed to upload ${fileName}`,
                  }
                : attachment,
            ),
          );

          console.error('Error uploading file:', error);
          toast.error(`Upload failed: ${error.message}`);

          // 3초 후 에러 상태의 첨부 파일 제거
          setTimeout(() => {
            setAttachmentList?.((prev) => prev.filter((attachment) => attachment.url !== `error://${tempId}`));
          }, 3000);
        }
      } catch (error: any) {
        console.error('Error handling file:', error);
        toast.error(`Upload failed: ${error.message}`);
      }
    };

    // Helper function to get image dimensions
    const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
      return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
          resolve({
            width: img.width,
            height: img.height,
          });
          URL.revokeObjectURL(img.src); // Clean up to avoid memory leaks
        };

        img.onerror = () => {
          reject(new Error('Failed to load image'));
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
      });
    };

    const exportChat = () => {
      const chatData = {
        messages,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const handleImportProjectModalChange = (isOpen: boolean) => {
      setImportProjectModalOpen(isOpen);
      setAttachmentHovered(false);
    };

    const shouldShowAttachmentTooltip = () => {
      return attachmentHovered && !attachmentDropdownOpen && !importProjectModalOpen;
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(
          styles.BaseChat,
          'relative flex flex-col items-center gap-12 w-full h-full overflow-hidden',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        <div className="flex flex-col lg:flex-row w-full h-full">
          <div
            ref={(node) => {
              setScrollElement(node);

              if (scrollRef) {
                scrollRef(node);
              }
            }}
            className={classNames(
              styles.Chat,
              'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full overflow-y-auto chat-container',
            )}
          >
            {!chatStarted && (
              <div id="intro" className="mt-[30px] max-w-chat-before-start mx-auto text-center px-4 lg:px-0">
                <div className="flex justify-center mb-4">
                  <img src="/title/Title.svg" alt="Agent8 Title" className="max-w-full h-auto" />
                </div>
              </div>
            )}
            <div
              className={classNames('pt-4 px-2 sm:px-6 relative', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  const currentTaskBranch = repo.taskBranch;

                  return chatStarted ? (
                    <>
                      {currentTaskBranch !== DEFAULT_TASK_BRANCH ? (
                        <TaskMessages
                          ref={messageRef}
                          taskBranches={taskBranches}
                          currentTaskBranch={currentTaskBranch}
                          reloadTaskBranches={reloadTaskBranches}
                          className="flex flex-col w-full flex-1 max-w-chat pb-10 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          onRetry={handleRetry}
                          onFork={handleFork}
                          onRevert={handleRevert}
                          onViewDiff={onViewDiff}
                          hasMore={hasMore}
                          loadBefore={loadBefore}
                          loadingBefore={loadingBefore}
                        />
                      ) : (
                        <Messages
                          ref={messageRef}
                          className="flex flex-col w-full flex-1 max-w-chat pb-10 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          onRetry={handleRetry}
                          onFork={handleFork}
                          onRevert={handleRevert}
                          onViewDiff={onViewDiff}
                          hasMore={hasMore}
                          loadBefore={loadBefore}
                          loadingBefore={loadingBefore}
                        />
                      )}
                      {!isStreaming && currentTaskBranch === DEFAULT_TASK_BRANCH && (
                        <div className="mb-5">
                          <TaskBranches taskBranches={taskBranches} reloadTaskBranches={reloadTaskBranches} />
                        </div>
                      )}
                    </>
                  ) : null;
                }}
              </ClientOnly>

              <div
                className={classNames('flex flex-col gap-3 w-full mx-auto z-prompt', {
                  'sticky bottom-8': chatStarted,
                  'max-w-chat': chatStarted,
                  'max-w-chat-before-start': !chatStarted,
                })}
              >
                <div className="bg-bolt-elements-background-depth-2">
                  {!isStreaming &&
                    actionAlert &&
                    actionAlert.content &&
                    !shouldIgnorePreviewError(actionAlert.content) && (
                      <ChatAlert
                        autoFixChance={autoFixChance}
                        alert={actionAlert}
                        clearAlert={() => clearAlert?.()}
                        postMessage={(message, isAutoFix = false) => {
                          if (isStreaming) {
                            return;
                          }

                          if (isAutoFix && lastActionStore.get().action !== 'SEND_MESSAGE') {
                            return;
                          }

                          sendMessage?.({} as any, message);
                          clearAlert?.();

                          if (isAutoFix) {
                            setAutoFixChance(autoFixChance - 1);
                          }
                        }}
                      />
                    )}
                </div>

                {progressAnnotations && <ProgressCompilation data={progressAnnotations} />}

                <div
                  className={classNames(
                    'flex flex-col self-stretch p-5 relative w-full mx-auto z-prompt relative min-h-53',
                    {
                      'max-w-chat': chatStarted,
                      'max-w-chat-before-start': !chatStarted,
                      'bg-primary': !chatStarted,
                      [styles.promptInputActive]: chatStarted,
                    },
                  )}
                  style={
                    !chatStarted
                      ? {
                          boxShadow: '0 0 15px rgba(63, 210, 232, 0.05)',
                        }
                      : {}
                  }
                >
                  {!chatStarted && (
                    <div className={classNames(styles.PromptEffectContainer)}>
                      <span className={classNames(styles.PromptEffectInner)}></span>
                    </div>
                  )}

                  <div className="mb-3 relative">
                    <McpServerManager chatStarted={chatStarted} />
                  </div>

                  <FilePreview
                    attachmentUrlList={attachmentList ? attachmentList.map((attachment) => attachment.url) : []}
                    attachments={attachmentList}
                    onRemove={(index) => {
                      setAttachmentList?.((prev) => prev?.filter((_, i) => i !== index) || []);
                    }}
                  />

                  <div
                    className={classNames(
                      'relative shadow-xs backdrop-blur rounded-lg flex-1',
                      attachmentList && attachmentList.length > 0 ? 'mb-12 mt-4' : '',
                      'flex',
                    )}
                  >
                    <textarea
                      ref={textareaRef}
                      className={classNames(
                        'w-full outline-none resize-none bg-transparent font-primary text-[16px] font-medium font-feature-stylistic text-bolt-color-textPrimary placeholder-bolt-color-textTertiary',
                        'transition-all duration-200',
                        'hover:border-bolt-elements-focus',
                        'flex-1',
                      )}
                      style={{
                        // fontStyle: 'normal',
                        lineHeight: '160%',
                        minHeight: `${TEXTAREA_MIN_HEIGHT}px`,
                        maxHeight: `${TEXTAREA_MAX_HEIGHT}px`,
                        border: '1px solid transparent',
                        overflowY: 'scroll',
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '2px solid #1488fc';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '2px solid #1488fc';
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '1px solid transparent';
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '1px solid transparent';

                        const files = Array.from(e.dataTransfer.files);

                        if (attachmentList.length + files.length > MAX_ATTACHMENTS) {
                          toast.info(
                            <div>
                              <p>
                                <strong>Attachments are limited to {MAX_ATTACHMENTS} files in chat.</strong>
                              </p>
                              <p className="mt-1">
                                You can upload additional assets to the{' '}
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent relative">
                                  <span className="relative z-10">Resources</span>
                                </span>{' '}
                                panel in the workbench.
                              </p>
                            </div>,
                            {
                              position: 'bottom-center',
                              autoClose: 5000,
                              hideProgressBar: false,
                              closeOnClick: true,
                              pauseOnHover: true,
                              draggable: true,
                              icon: () => <div className="i-ph:arrow-fat-lines-right text-xl" />,
                            },
                          );

                          return;
                        }

                        await Promise.all(
                          files.map(async (file) => {
                            return uploadFileAndAddToAttachmentList(file);
                          }),
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (event.shiftKey) {
                            return;
                          }

                          event.preventDefault();

                          if (isStreaming) {
                            handleStop?.();
                            return;
                          }

                          // ignore if using input method engine
                          if (event.nativeEvent.isComposing) {
                            return;
                          }

                          handleSendMessage?.(event);
                        }
                      }}
                      value={input}
                      onChange={(event) => {
                        handleInputChange?.(event);
                      }}
                      onPaste={handlePaste}
                      placeholder=""
                      translate="no"
                    />

                    {!chatStarted && input.length === 0 && (
                      <div
                        className={classNames(
                          'absolute left-0 top-0 w-full font-primary text-[16px] font-semibold font-feature-stylistic text-bolt-color-textTertiary pointer-events-none p-[inherit]',
                          animationDirection === 'in' ? styles.placeholderAnimationIn : styles.placeholderAnimationOut,
                        )}
                        style={{
                          lineHeight: '160%',
                          padding: 'inherit',
                        }}
                      >
                        {prompts[currentPromptIndex]}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between items-center self-stretch text-sm mt-auto">
                    <div className="flex items-center gap-[4.8px]">
                      <div
                        className="hover:bg-bolt-elements-item-backgroundActive rounded-radius-4 transition-all duration-200"
                        onMouseEnter={() => setAttachmentHovered(true)}
                        onMouseLeave={() => setAttachmentHovered(false)}
                      >
                        <Tooltip.Root open={shouldShowAttachmentTooltip()}>
                          <Tooltip.Trigger asChild>
                            <div>
                              <AttachmentSelector
                                onImportProject={onProjectZipImport}
                                onUploadFile={handleFileUpload}
                                chatStarted={chatStarted}
                                onDropdownOpenChange={setAttachmentDropdownOpen}
                                onImportProjectModalChange={handleImportProjectModalChange}
                              />
                            </div>
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
                              sideOffset={5}
                              side={chatStarted ? 'top' : 'bottom'}
                            >
                              {chatStarted ? 'Upload a file' : 'Upload a file or import a project'}
                              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      </div>

                      {chatStarted && (
                        <div className="hover:bg-bolt-elements-item-backgroundActive rounded-radius-4 transition-all duration-200">
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <div>
                                <ClientOnly>{() => <ExportChatButton exportChat={exportChat} />}</ClientOnly>
                              </div>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
                                sideOffset={5}
                                side="top"
                              >
                                Export chat
                                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        </div>
                      )}

                      <div className="flex items-center hover:bg-bolt-elements-item-backgroundActive rounded-radius-4 transition-all duration-200">
                        <ClientOnly>
                          {() => (
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <div>
                                  <ModelSelector
                                    key={provider?.name + ':' + modelList.length}
                                    model={model}
                                    setModel={setModel}
                                    modelList={modelList}
                                    provider={provider}
                                    setProvider={setProvider}
                                    providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                                    modelLoading={isModelLoading}
                                  />
                                </div>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content
                                  className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
                                  sideOffset={5}
                                  side={'bottom'}
                                >
                                  Select model
                                  <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          )}
                        </ClientOnly>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <ClientOnly>
                        {() => (
                          <SendButton
                            show={true}
                            isStreaming={isStreaming}
                            disabled={
                              !providerList ||
                              providerList.length === 0 ||
                              (input.length === 0 && attachmentList.length === 0 && !isStreaming)
                            }
                            onClick={(event) => {
                              if (isStreaming) {
                                handleStop?.();
                                return;
                              }

                              if (input.length > 0 || attachmentList.length > 0) {
                                handleSendMessage?.(event);
                              }
                            }}
                          />
                        )}
                      </ClientOnly>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {!chatStarted && (
              <div className="flex flex-col justify-center items-start gap-3 self-stretch w-full mx-auto max-w-chat-before-start mt-[36px] mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-left font-primary text-secondary text-sm font-medium leading-[142.9%] not-italic">
                    What do you want to create? Try it
                  </p>
                  <img src="/icons/Magic.svg" alt="Magic" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 self-stretch w-full">
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Create a basic Three.js FPS game inspired by Call of Duty, where the player navigates a 3D maze and shoots targets from a first-person view.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Fps.svg" alt="Fps" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      First-Person Shooter
                    </span>
                  </button>
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Build a simple Three.js third-person shooter like Fortnite, with a camera following behind a character moving and shooting in a 3D world.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Tps.svg" alt="Tps" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      Third-Person Shooter
                    </span>
                  </button>
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Make a basic Three.js top-down game like League of Legends, where the player controls a character from above and clicks to move and attack.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Topdown.svg" alt="Topdown" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      Top-Down Action
                    </span>
                  </button>
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Create a simple match-3 puzzle game like Candy Crush, where players swap tiles on a colorful 2D grid with smooth animations.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Puzzle.svg" alt="Puzzle" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      Puzzle & Logic
                    </span>
                  </button>
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Build a voxel-based sandbox game like Minecraft in Three.js, with procedural terrain generation, block placement, and first-person movement.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Voxel.svg" alt="Voxel" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      Voxel Sandbox Builder
                    </span>
                  </button>
                  <button
                    className="flex py-spacing-20 px-spacing-8 justify-center items-center gap-spacing-8 rounded-radius-8 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed transition-colors duration-200 cursor-pointer"
                    onClick={() => {
                      const prompt =
                        'Make a minimalist flight simulator in Three.js inspired by Peter Levels game, with a low-poly plane.';

                      if (handleInputChange) {
                        const syntheticEvent = {
                          target: { value: prompt },
                        } as React.ChangeEvent<HTMLTextAreaElement>;
                        handleInputChange(syntheticEvent);
                      }
                    }}
                  >
                    <img src="/icons/Flight.svg" alt="Flight" />
                    <span className="text-interactive-neutral font-feature-stylistic font-primary text-[12.5px] not-italic font-semibold leading-[142.9%]">
                      Flight Simulator
                    </span>
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col justify-center gap-5">
              {!chatStarted &&
                ExamplePrompts((event, messageInput) => {
                  if (isStreaming) {
                    handleStop?.();
                    return;
                  }

                  handleSendMessage?.(event, messageInput);
                })}
              {/* <StarterTemplates /> */}
            </div>
          </div>
          <ClientOnly>
            {() => (
              <Workbench
                actionRunner={actionRunner ?? ({} as ActionRunner)}
                chatStarted={chatStarted}
                isStreaming={isStreaming}
              />
            )}
          </ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);
