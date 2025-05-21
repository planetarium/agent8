/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
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
import { ImportProjectZip } from './ImportProjectZip';
import McpServerManager from '~/components/chat/McpServerManager';
import { FaCheckSquare, FaSquare } from 'react-icons/fa';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { useStore } from '@nanostores/react';
import { TaskMessages } from './TaskMessages.client';
import { TaskBranches } from './TaskBranches.client';
import { lastActionStore } from '~/lib/stores/lastAction';
import { shouldIgnorePreviewError } from '~/utils/previewErrorFilters';

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
      enabledTaskMode,
      setEnabledTaskMode,
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
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [autoFixChance, setAutoFixChance] = useState(1);
    const repo = useStore(repoStore);

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

        setAutoFixChance(1);

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

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div ref={scrollRef} className="flex flex-col lg:flex-row w-full h-full">
          <div
            className={classNames(
              styles.Chat,
              'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full overflow-y-auto chat-container',
            )}
          >
            {!chatStarted && (
              <div id="intro" className="mt-[16vh] max-w-chat mx-auto text-center px-4 lg:px-0">
                <h1 className="text-3xl lg:text-6xl font-bold text-bolt-elements-textPrimary mb-4 animate-fade-in">
                  Where ideas begin
                </h1>
                <p className="text-md lg:text-xl mb-8 text-bolt-elements-textSecondary animate-fade-in animation-delay-200">
                  Bring ideas to life in seconds or get help on existing projects.
                </p>
              </div>
            )}
            <div
              className={classNames('pt-6 px-2 sm:px-6 relative', {
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
                          className="flex flex-col w-full flex-1 max-w-chat pb-6 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          onRetry={handleRetry}
                          onFork={handleFork}
                          onRevert={handleRevert}
                          onViewDiff={onViewDiff}
                        />
                      ) : (
                        <Messages
                          ref={messageRef}
                          className="flex flex-col w-full flex-1 max-w-chat pb-6 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          onRetry={handleRetry}
                          onFork={handleFork}
                          onRevert={handleRevert}
                          onViewDiff={onViewDiff}
                        />
                      )}
                      {!isStreaming && currentTaskBranch === DEFAULT_TASK_BRANCH && (
                        <TaskBranches taskBranches={taskBranches} reloadTaskBranches={reloadTaskBranches} />
                      )}
                    </>
                  ) : null;
                }}
              </ClientOnly>

              <div
                className={classNames('flex flex-col gap-2 w-full max-w-chat mx-auto z-prompt', {
                  'sticky bottom-8': chatStarted,
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

                <McpServerManager />

                <div
                  className={classNames(
                    'bg-bolt-elements-background-depth-2 p-3 rounded-lg relative w-full max-w-chat mx-auto z-prompt mt-1 relative',
                  )}
                  style={{ boxShadow: '0 0 15px rgba(63, 210, 232, 0.05)' }}
                >
                  <div className={classNames(styles.PromptEffectContainer)}>
                    <span className={classNames(styles.PromptEffectInner)}></span>
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
                      'relative shadow-xs border border-bolt-elements-borderColor backdrop-blur rounded-lg',
                    )}
                  >
                    <textarea
                      ref={textareaRef}
                      className={classNames(
                        'w-full pl-4 pt-4 pr-16 outline-none resize-none text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent text-sm',
                        'transition-all duration-200',
                        'hover:border-bolt-elements-focus',
                      )}
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
                        e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';

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
                      style={{
                        minHeight: TEXTAREA_MIN_HEIGHT + (!chatStarted ? 30 : 0),
                        maxHeight: TEXTAREA_MAX_HEIGHT,
                      }}
                      placeholder="Create your own game here"
                      translate="no"
                    />
                    <ClientOnly>
                      {() => (
                        <SendButton
                          show={input.length > 0 || isStreaming || attachmentList.length > 0}
                          isStreaming={isStreaming}
                          disabled={!providerList || providerList.length === 0}
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
                    <div className="flex justify-between items-center text-sm p-4 pt-2">
                      <div className="flex gap-1 items-center">
                        <IconButton title="Upload file" className="transition-all" onClick={() => handleFileUpload()}>
                          <div className="i-ph:paperclip text-xl"></div>
                        </IconButton>

                        {chatStarted && <ClientOnly>{() => <ExportChatButton exportChat={exportChat} />}</ClientOnly>}

                        <div className="ml-1 flex items-center">
                          <ClientOnly>
                            {() => (
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
                            )}
                          </ClientOnly>
                        </div>
                      </div>
                      {input.length > 3 ? (
                        <div className="text-xs text-bolt-elements-textTertiary">
                          Use <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Shift</kbd>{' '}
                          + <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Return</kbd>{' '}
                          a new line
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <div
                            className="text-xs text-bolt-elements-textSecondary flex items-center gap-1 pointer hover:text-bolt-elements-textPrimary cursor-pointer"
                            onClick={() => setEnabledTaskMode?.(!enabledTaskMode)}
                          >
                            {enabledTaskMode ? <FaCheckSquare /> : <FaSquare />}
                            Task Mode
                          </div>
                          {!chatStarted && <ImportProjectZip onImport={onProjectZipImport} />}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
