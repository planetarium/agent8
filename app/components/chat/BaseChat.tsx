import type { JSONValue, UIMessage } from 'ai';
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
import { handleChatError } from '~/utils/errorNotification';
import { motion } from 'framer-motion';

import { useMobileView } from '~/lib/hooks/useMobileView';
import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';

import FilePreview from './FilePreview';
import MainBackground from '~/components/ui/MainBackground';
import { ModelSelector } from '~/components/chat/ModelSelector';
import type { ProviderInfo } from '~/types/model';
import type { ActionAlert } from '~/types/actions';
import ChatAlert from './ChatAlert';
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

import { ColorTab } from '~/components/ui/ColorTab';
import {
  TopDownIcon,
  TpsIcon,
  StoryIcon,
  PuzzleIcon,
  ChevronDoubleDownIcon,
  PauseCircleIcon,
  PlayCircleIcon,
} from '~/components/ui/Icons';

const TEXTAREA_MIN_HEIGHT = 40;
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
  messages?: UIMessage[];
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
  handleRetry?: (message: UIMessage) => void;
  handleFork?: (message: UIMessage) => void;
  handleRevert?: (message: UIMessage) => void;
  handleSaveVersion?: (message: UIMessage) => void;
  handleRestoreVersion?: (commitHash: string, commitTitle: string) => void;
  savedVersions?: Map<string, string>;
  onViewDiff?: (message: UIMessage) => void;
  hasMore?: boolean;
  loadBefore?: () => Promise<void>;
  loadingBefore?: boolean;
  customProgressAnnotations?: ProgressAnnotation[];
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  textareaExpanded?: boolean;
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
      handleSaveVersion,
      handleRestoreVersion,
      savedVersions,
      onViewDiff,
      hasMore,
      loadBefore,
      loadingBefore,
      customProgressAnnotations = [],
      isAuthenticated = true,
      onAuthRequired,
      textareaExpanded = false,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = 200;
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [autoFixChance, setAutoFixChance] = useState(3);
    const repo = useStore(repoStore);
    const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState<boolean>(false);
    const [attachmentHovered, setAttachmentHovered] = useState<boolean>(false);
    const [importProjectModalOpen, setImportProjectModalOpen] = useState<boolean>(false);
    const [modelSelectorDropdownOpen, setModelSelectorDropdownOpen] = useState<boolean>(false);

    const [selectedVideoTab, setSelectedVideoTab] = useState<'top-down' | 'tps' | 'story' | 'puzzle'>('top-down');
    const [isVideoHovered, setIsVideoHovered] = useState<boolean>(false);
    const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false);

    const isMobileView = useMobileView();

    // Optimized color tab handlers
    const handleColorTabClick = useCallback(
      (tab: 'top-down' | 'tps' | 'story' | 'puzzle', prompt: string) => {
        // Prevent unnecessary re-renders if same tab is clicked AND input already matches
        if (selectedVideoTab === tab && input === prompt) {
          return;
        }

        // Use startTransition to mark this as a non-urgent update
        React.startTransition(() => {
          setSelectedVideoTab(tab);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: prompt },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        });
      },
      [handleInputChange, selectedVideoTab],
    );

    // Define video sources for each tab
    const videoSources = {
      'top-down': '/videos/top-down-game.mp4',
      tps: '/videos/tps-game.mp4',
      story: '/videos/story-game.mp4',
      puzzle: '/videos/puzzle-game.mp4',
    };

    // Toggle video play/pause function
    const handleVideoClick = (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();

      const video = event.currentTarget;

      if (isVideoPaused) {
        video.play();
        setIsVideoPaused(false);
      } else {
        video.pause();
        setIsVideoPaused(true);
      }
    };

    // Reset pause state when video tab changes
    useEffect(() => {
      setIsVideoPaused(false);
    }, [selectedVideoTab]);

    useEffect(() => {
      const progressFromData = data
        ? (data.filter((x) => typeof x === 'object' && (x as any).type === 'progress') as ProgressAnnotation[])
        : [];

      // Merge custom progress annotations with data progress annotations
      const allProgressAnnotations = [...customProgressAnnotations, ...progressFromData];
      setProgressAnnotations(allProgressAnnotations);
    }, [data, customProgressAnnotations]);

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

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

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
          // Prevent default event behavior only for image files
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            await uploadFileAndAddToAttachmentList(file);
          }

          break;
        }

        // Allow default paste behavior for non-image files (don't call preventDefault)
      }
    };

    const uploadFileAndAddToAttachmentList = async (file: File) => {
      try {
        if (attachmentList?.length >= MAX_ATTACHMENTS) {
          handleChatError(`Attachments are limited to ${MAX_ATTACHMENTS} files.`, {
            context: 'uploadFileAndAddToAttachmentList - attachment limit',
            sendChatError: false,
          });
          return;
        }

        const fileName = file.name;
        const fileExt = `.${fileName.split('.').pop()?.toLowerCase()}`;

        if (fileExt === '.zip') {
          onProjectZipImport?.(fileName, file);
          return;
        }

        if (!ATTACHMENT_EXTS.includes(fileExt)) {
          handleChatError('Not allowed file type', {
            context: 'uploadFileAndAddToAttachmentList - file type validation',
          });
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
          handleChatError('Only media files are allowed', {
            context: 'uploadFileAndAddToAttachmentList - media file validation',
          });
          return;
        }

        // Generate temporary ID
        const tempId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Create temporary attachment object (uploading state)
        const tempAttachment: ChatAttachment = {
          filename: fileName,
          url: `uploading://${tempId}`, // Use special protocol
          features: `Uploading ${fileType} file...`,
          details: `Uploading ${fileName}`,
          ext: fileExt,
        };

        // Add temporary attachment to list
        setAttachmentList?.((prev) => [...prev, tempAttachment]);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', 'chat-uploads');

        const verse = 'current';
        formData.append('verse', verse);

        // toast.info(`Uploading ${file.name}...`);

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
            // Create actual attachment object on successful upload
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

            // Replace temporary attachment with actual attachment
            setAttachmentList?.((prev) =>
              prev.map((attachment) => (attachment.url === `uploading://${tempId}` ? finalAttachment : attachment)),
            );

            // toast.success(`Uploaded ${file.name}`);
          } else {
            throw new Error(result.error || 'Unknown error during upload');
          }
        } catch (error: any) {
          // Change temporary attachment to error state on upload failure
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
          handleChatError(`Upload failed: ${error.message}`, {
            error,
            context: 'uploadFileAndAddToAttachmentList - upload error',
          });

          // Remove error state attachment after 3 seconds
          setTimeout(() => {
            setAttachmentList?.((prev) => prev.filter((attachment) => attachment.url !== `error://${tempId}`));
          }, 3000);
        }
      } catch (error: any) {
        console.error('Error handling file:', error);
        handleChatError(`Upload failed: ${error.message}`, {
          error,
          context: 'uploadFileAndAddToAttachmentList - general error',
        });
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

        <div className="flex flex-col lg:flex-row w-full h-full bg-primary">
          <div
            ref={(node) => {
              setScrollElement(node);

              if (scrollRef) {
                scrollRef(node);
              }
            }}
            className={classNames(
              styles.Chat,
              'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full chat-container',
              {
                'overflow-y-auto': chatStarted,
                [styles.chatStarted]: chatStarted,
              },
            )}
          >
            {!chatStarted && (
              <MainBackground zIndex={1} isMobileView={isMobileView} opacity={0.8} chatStarted={chatStarted} />
            )}
            {!chatStarted && (
              <div className="flex flex-col items-center max-w-[632px] w-full gap-4 flex-shrink-0 tablet:h-[85vh] tablet:px-0 relative tablet:max-w-none mx-auto">
                {/* Background Image */}
                <div
                  className={`fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[url('/background-image.webp')] bg-cover bg-no-repeat opacity-60`}
                  style={{
                    backgroundPosition: '50% -25%',
                    animation: isMobileView
                      ? 'slideDownBackground 1s ease-in-out'
                      : 'slideDownBackgroundDesktop 1s ease-in-out',
                  }}
                />
                <div id="intro" className="max-w-chat-before-start mx-auto px-2 tablet:px-0 text-center z-2">
                  <div className="flex justify-center">
                    <span
                      className="text-heading-lg tablet:text-heading-4xl"
                      style={{
                        background: 'linear-gradient(90deg, var(--color-text-primary, #FFF) 0%, #72E7F8 100%)',
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                    >
                      Game Creation, Simplified
                    </span>
                  </div>
                </div>
                <span className="flex justify-center text-heading-xs text-center tablet:text-heading-sm px-2 tablet:px-0 text-secondary self-stretch z-2">
                  Start here — or make your own.{isMobileView && <br />} What do you want to create?
                </span>

                {/* Mobile: ColorTabs above video */}
                <div className="flex max-w-[632px] px-4 w-full tablet:hidden items-start justify-center tablet:px-0 gap-2 self-stretch z-1">
                  <ColorTab
                    color="cyan"
                    size="sm"
                    selected={selectedVideoTab === 'top-down'}
                    onClick={() =>
                      handleColorTabClick(
                        'top-down',
                        'Create a top-down action game with a character controlled by WASD keys and mouse clicks.',
                      )
                    }
                  >
                    <TopDownIcon size={24} className="flex-shrink-0" />
                    <span>Top-Down</span>
                  </ColorTab>
                  <ColorTab
                    color="brown"
                    size="sm"
                    selected={selectedVideoTab === 'tps'}
                    onClick={() =>
                      handleColorTabClick(
                        'tps',
                        'Build a simple third-person shooter like Fortnite, with a camera following behind a character moving and shooting in a 3D world.',
                      )
                    }
                  >
                    <TpsIcon size={24} />
                    <span className="uppercase">tps</span>
                  </ColorTab>
                  <ColorTab
                    color="magenta"
                    size="sm"
                    selected={selectedVideoTab === 'story'}
                    onClick={() =>
                      handleColorTabClick(
                        'story',
                        'A simple Japanese-style visual novel about everyday life in a high school.',
                      )
                    }
                  >
                    <StoryIcon size={24} />
                    <span>Story</span>
                  </ColorTab>
                  <ColorTab
                    color="green"
                    size="sm"
                    selected={selectedVideoTab === 'puzzle'}
                    onClick={() =>
                      handleColorTabClick(
                        'puzzle',
                        'Create a simple match-3 puzzle game like Candy Crush, where players swap tiles on a colorful 2D grid with smooth animations.',
                      )
                    }
                  >
                    <PuzzleIcon size={24} />
                    <span>Puzzle</span>
                  </ColorTab>
                </div>

                <div className="w-full max-w-[632px] px-4 tablet:w-auto tablet:max-w-[1151px]">
                  <div
                    className={classNames('flex flex-col items-start flex-shrink-0 relative cursor-pointer z-1', {
                      'aspect-[16/9] max-h-[58vh] border border-primary rounded-[24px]': !isMobileView,
                      'aspect-[16/9] rounded-[8px]': isMobileView,
                    })}
                    onMouseEnter={() => setIsVideoHovered(true)}
                    onMouseLeave={() => setIsVideoHovered(false)}
                  >
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      className={classNames('w-full h-full object-cover', {
                        'rounded-[24px]': !isMobileView,
                        'rounded-[8px]': isMobileView,
                      })}
                      src={videoSources[selectedVideoTab]}
                      onClick={handleVideoClick}
                    >
                      Your browser does not support the video tag.
                    </video>

                    {/* Video icon overlay */}
                    {(isVideoHovered || isVideoPaused) && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="flex items-center justify-center w-25 h-25 flex-shrink-0 aspect-square opacity-90">
                          {isVideoPaused ? (
                            <PlayCircleIcon color="#FFFFFF" size={100} />
                          ) : (
                            <PauseCircleIcon color="#FFFFFF" size={100} />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tablet+: ColorTabs on video overlay */}
                    <div className="hidden tablet:block">
                      <div
                        className={classNames('absolute top-0 left-0 w-full h-[100px] flex-shrink-0 opacity-80', {
                          'rounded-t-[24px]': !isMobileView,
                          'rounded-t-[8px]': isMobileView,
                        })}
                        style={{
                          background:
                            'linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.98) 4.7%, rgba(0, 0, 0, 0.96) 8.9%, rgba(0, 0, 0, 0.93) 12.8%, rgba(0, 0, 0, 0.90) 16.56%, rgba(0, 0, 0, 0.86) 20.37%, rgba(0, 0, 0, 0.82) 24.4%, rgba(0, 0, 0, 0.77) 28.83%, rgba(0, 0, 0, 0.71) 33.84%, rgba(0, 0, 0, 0.65) 39.6%, rgba(0, 0, 0, 0.57) 46.3%, rgba(0, 0, 0, 0.48) 54.1%, rgba(0, 0, 0, 0.38) 63.2%, rgba(0, 0, 0, 0.27) 73.76%, rgba(0, 0, 0, 0.14) 85.97%, rgba(0, 0, 0, 0.00) 100%)',
                        }}
                      />
                      <div className="absolute flex items-center justify-center gap-3 top-4 left-1/2 -translate-x-1/2">
                        <ColorTab
                          color="cyan"
                          size="md"
                          selected={selectedVideoTab === 'top-down'}
                          onClick={() =>
                            handleColorTabClick(
                              'top-down',
                              'Create a top-down action game with a character controlled by WASD keys and mouse clicks.',
                            )
                          }
                        >
                          <TopDownIcon size={24} className="flex-shrink-0" />
                          <span>Top-Down</span>
                        </ColorTab>
                        <ColorTab
                          color="brown"
                          size="md"
                          selected={selectedVideoTab === 'tps'}
                          onClick={() =>
                            handleColorTabClick(
                              'tps',
                              'Build a simple third-person shooter like Fortnite, with a camera following behind a character moving and shooting in a 3D world.',
                            )
                          }
                        >
                          <TpsIcon size={24} />
                          <span className="uppercase">tps</span>
                        </ColorTab>
                        <ColorTab
                          color="magenta"
                          size="md"
                          selected={selectedVideoTab === 'story'}
                          onClick={() =>
                            handleColorTabClick(
                              'story',
                              'A simple Japanese-style visual novel about everyday life in a high school.',
                            )
                          }
                        >
                          <StoryIcon size={24} />
                          <span>Story</span>
                        </ColorTab>
                        <ColorTab
                          color="green"
                          size="md"
                          selected={selectedVideoTab === 'puzzle'}
                          onClick={() =>
                            handleColorTabClick(
                              'puzzle',
                              'Create a simple match-3 puzzle game like Candy Crush, where players swap tiles on a colorful 2D grid with smooth animations.',
                            )
                          }
                        >
                          <PuzzleIcon size={24} />
                          <span>Puzzle</span>
                        </ColorTab>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div
              className={classNames('pt-0 tablet:pt-4 tablet:px-6 relative', {
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
                          className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                          messages={messages}
                          annotations={data}
                          isStreaming={isStreaming}
                          progressAnnotations={progressAnnotations}
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
                          className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                          messages={messages}
                          annotations={data}
                          isStreaming={isStreaming}
                          progressAnnotations={progressAnnotations}
                          onRetry={handleRetry}
                          onFork={handleFork}
                          onRevert={handleRevert}
                          onSaveVersion={handleSaveVersion}
                          onRestoreVersion={handleRestoreVersion}
                          savedVersions={savedVersions}
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
                className={classNames(
                  'flex flex-col gap-3 w-full mx-auto z-prompt transition-[bottom,max-width,padding] duration-300 ease-out',
                  {
                    'sticky bottom-4': chatStarted,
                    'tablet:max-w-chat': chatStarted,
                    'tablet:max-w-chat-before-start': !chatStarted,
                    'px-4 max-w-[632px]': !chatStarted, // Before starting the chat, there is a 600px limit on mobile devices.
                    'tablet:absolute tablet:bottom-[200%] tablet:left-1/2 tablet:transform tablet:-translate-x-1/2':
                      !chatStarted,
                    'fixed bottom-[5%] z-[9999] translate-x-[-50%] left-1/2':
                      !chatStarted && (attachmentList.length > 0 || textareaExpanded) && isMobileView,
                  },
                )}
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
                    'flex flex-col self-stretch px-4 pt-[6px] pb-4 relative w-full mx-auto z-prompt',
                    {
                      'tablet:max-w-chat': chatStarted,
                      'tablet:max-w-chat-before-start': !chatStarted,
                      'bg-primary': !chatStarted,
                      [styles.promptInputActive]: chatStarted,
                    },
                  )}
                  style={
                    !chatStarted
                      ? {
                          borderRadius: 'var(--border-radius-16, 16px)',
                          boxShadow: isMobileView
                            ? '0 1px 4px 1px rgba(26, 220, 217, 0.12), 0 2px 20px 4px rgba(148, 250, 239, 0.16)'
                            : '0 2px 8px 2px rgba(26, 220, 217, 0.12), 0 8px 56px 8px rgba(148, 250, 239, 0.16)',
                        }
                      : {}
                  }
                >
                  <div className="mb-[6px] relative">
                    <McpServerManager chatStarted={chatStarted} />
                  </div>

                  <div className="border-b border-tertiary mx-[-16px] mb-4" />

                  <FilePreview
                    attachmentUrlList={attachmentList ? attachmentList.map((attachment) => attachment.url) : []}
                    attachments={attachmentList}
                    onRemove={(index) => {
                      setAttachmentList?.((prev) => prev?.filter((_, i) => i !== index) || []);
                    }}
                  />

                  <div className={classNames('relative shadow-xs backdrop-blur rounded-lg flex-1', 'flex')}>
                    <textarea
                      ref={textareaRef}
                      className={classNames(
                        'w-full outline-none resize-none bg-transparent text-[14px] font-medium text-primary placeholder-text-subtle',
                        'transition-all duration-200',
                        'hover:border-bolt-elements-focus',
                        {
                          'flex-1': !isMobileView,
                        },
                      )}
                      style={{
                        fontFamily: '"Instrument Sans"',
                        fontSize: '14px',
                        fontStyle: 'normal',
                        fontWeight: 500,
                        lineHeight: '142.9%',
                        minHeight: `${TEXTAREA_MIN_HEIGHT}px`,
                        maxHeight: `${TEXTAREA_MAX_HEIGHT}px`,
                        border: '1px solid transparent',
                        overflowY: 'scroll',
                        resize: 'none',
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
                              autoClose: 5000,
                              hideProgressBar: false,
                              closeOnClick: true,
                              pauseOnHover: true,
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
                      placeholder="What kind of game do you want to make?"
                      translate="no"
                    />
                  </div>
                  <div className="flex justify-between items-center self-stretch text-sm mt-4">
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
                              side="top"
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
                            <Tooltip.Root open={modelSelectorDropdownOpen ? false : undefined}>
                              <Tooltip.Trigger asChild>
                                <div>
                                  <ModelSelector
                                    model={model}
                                    setModel={setModel}
                                    provider={provider}
                                    setProvider={setProvider}
                                    providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                                    onDropdownOpenChange={setModelSelectorDropdownOpen}
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
                            isAuthenticated={isAuthenticated}
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

            <div className="flex flex-col justify-center gap-5">
              {!chatStarted &&
                ExamplePrompts((event, messageInput) => {
                  if (isStreaming) {
                    handleStop?.();
                    return;
                  }

                  handleSendMessage?.(event, messageInput);
                })}
            </div>

            {!chatStarted && (
              <motion.div
                className="fixed bottom-0 left-1/2 transform -translate-x-1/2 z-10 hidden tablet:block"
                animate={{
                  y: [0, -6, 0],
                }}
                transition={{
                  duration: 1.5,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  repeatType: 'loop',
                }}
              >
                <ChevronDoubleDownIcon size={24} color="rgba(255, 255, 255, 0.4)" />
              </motion.div>
            )}
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
