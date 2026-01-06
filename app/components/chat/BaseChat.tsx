import type { JSONValue, UIMessage } from 'ai';
import React, { type RefCallback, useCallback, useEffect, useRef, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { Workbench } from '~/components/workbench/Workbench.client';
import { ResizeHandle } from '~/components/ui/ResizeHandle';
import { useWorkbenchShowWorkbench, useWorkbenchMobilePreviewMode } from '~/lib/hooks/useWorkbenchStore';
import { classNames } from '~/utils/classNames';
import { ATTACHMENT_EXTS, PROVIDER_LIST } from '~/utils/constants';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast } from 'react-toastify';
import { handleChatError } from '~/utils/errorNotification';
import { motion } from 'framer-motion';

import { useMobileView } from '~/lib/hooks/useMobileView';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT, CHAT_MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';

import FilePreview from './FilePreview';
import MainBackground from '~/components/ui/MainBackground';
import { ModelSelector } from '~/components/chat/ModelSelector';
import type { ProviderInfo } from '~/types/model';
import type { ActionAlert } from '~/types/actions';
import ChatAlert from './ChatAlert';
import type { ProgressAnnotation } from '~/types/context';
import type { ActionRunner } from '~/lib/runtime/action-runner';
import McpServerManager from '~/components/chat/McpServerManager';
import { lastActionStore } from '~/lib/stores/lastAction';
import { AttachmentSelector } from './AttachmentSelector';

import {
  TopDownIcon,
  TpsIcon,
  StoryIcon,
  ChevronDoubleDownIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  SurvivorsLikeIcon,
  ShootEmUpIcon,
  StartGuideMobileIcon,
  StartGuideDesktopIcon,
} from '~/components/ui/Icons';
import V8AppBanner from '~/components/chat/V8AppBanner';

const TEXTAREA_MIN_HEIGHT = 40;
const MAX_ATTACHMENTS = 10;
export const VIDEO_GUIDE_TABS = {
  mobile: {
    icon: StartGuideMobileIcon,
    list: {
      story: {
        label: 'Story',
        prompt:
          'I want to create a Japanese visual novel about a blonde heroine in a sunset. Keep it in portrait view so that I can play it on a smartphone.',
        icon: StoryIcon,
        video: '/videos/Story_New.mp4',
      },
      survivorslike: {
        label: 'Survivorslike',
        prompt:
          'Create a Vampire Survivors like 2D action game that a magician shoots spells to eliminate enemies, utilizing sprite sheets. Make it playable on a mobile device in a portrait view screen.',
        icon: SurvivorsLikeIcon,
        video: '/videos/Survivorslike.mp4',
      },
      'shoot-em-up': {
        label: "Shoot 'em up",
        prompt:
          "Let's make a vertical scroller shooting game in a dark fantasy dungeon crawler concept. Use sprite sheets. Make it in mobile screen resolution for portrait mode.",
        icon: ShootEmUpIcon,
        video: '/videos/Scroller.mp4',
      },
    },
  },
  desktop: {
    icon: StartGuideDesktopIcon,
    list: {
      'top-down': {
        label: 'Top-Down',
        prompt: 'Create a top-down action game with a character controlled by WASD keys and mouse clicks.',
        icon: TopDownIcon,
        video: '/videos/top-down-game.mp4',
      },
      tps: {
        label: 'TPS',
        prompt:
          'Build a simple third-person shooter like Fortnite, with a camera following behind a character moving and shooting in a 3D world.',
        icon: TpsIcon,
        video: '/videos/tps-game.mp4',
      },
    },
  },
} as const;

type VideoGuideTabItemType =
  | (typeof VIDEO_GUIDE_TABS)['mobile']['list'][keyof (typeof VIDEO_GUIDE_TABS)['mobile']['list']]
  | (typeof VIDEO_GUIDE_TABS)['desktop']['list'][keyof (typeof VIDEO_GUIDE_TABS)['desktop']['list']];

type VideoGuideTabType = {
  item: VideoGuideTabItemType;
  type: 'mobile' | 'desktop';
};

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
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = 200;
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [autoFixChance, setAutoFixChance] = useState(3);
    const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState<boolean>(false);
    const [attachmentHovered, setAttachmentHovered] = useState<boolean>(false);
    const [importProjectModalOpen, setImportProjectModalOpen] = useState<boolean>(false);
    const [modelSelectorDropdownOpen, setModelSelectorDropdownOpen] = useState<boolean>(false);

    const [selectedVideoTab, setSelectedVideoTab] = useState<VideoGuideTabType>({
      item: VIDEO_GUIDE_TABS.mobile.list.story,
      type: 'mobile',
    });
    const [isVideoHovered, setIsVideoHovered] = useState<boolean>(false);
    const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false);
    const mobileVideoRef = useRef<HTMLVideoElement>(null);
    const desktopVideoRef = useRef<HTMLVideoElement>(null);

    const isMobileView = useMobileView();
    const showWorkbench = useWorkbenchShowWorkbench();
    const mobilePreviewMode = useWorkbenchMobilePreviewMode();
    const isSmallViewportForWorkbench = useViewport(MOBILE_BREAKPOINT); // When workbench is visible
    const isSmallViewportForChat = useViewport(CHAT_MOBILE_BREAKPOINT); // When workbench is not mounted yet

    // Use different breakpoint based on whether workbench is visible
    const isSmallViewport = showWorkbench ? isSmallViewportForWorkbench : isSmallViewportForChat;

    // Hide chat when mobilePreviewMode is active on small viewport
    const hideChatForMobilePreview = isSmallViewport && mobilePreviewMode;

    // Optimized color tab handlers
    const handleColorTabClick = useCallback(
      (tab: VideoGuideTabType) => {
        // Prevent unnecessary re-renders if same tab is clicked AND input already matches
        if (selectedVideoTab.item.label === tab.item.label && input === tab.item.prompt) {
          return;
        }

        // Use startTransition to mark this as a non-urgent update
        React.startTransition(() => {
          setSelectedVideoTab(tab);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: tab.item.prompt },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        });
      },
      [handleInputChange, selectedVideoTab],
    );

    // Toggle video play/pause function
    const handleVideoClick = (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();

      if (isVideoPaused) {
        mobileVideoRef.current?.play();
        desktopVideoRef.current?.play();
        setIsVideoPaused(false);
      } else {
        mobileVideoRef.current?.pause();
        desktopVideoRef.current?.pause();
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

      let scrollTimeout: NodeJS.Timeout;

      const handleScroll = () => {
        const atBottom = isScrollAtBottom(scrollElement);
        setAutoScrollEnabled(atBottom);

        // Show scrollbar while scrolling
        scrollElement.classList.add('scrolling');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          scrollElement.classList.remove('scrolling');
        }, 500);
      };

      scrollElement.addEventListener('scroll', handleScroll);

      // eslint-disable-next-line consistent-return
      return () => {
        scrollElement.removeEventListener('scroll', handleScroll);
        clearTimeout(scrollTimeout);
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

    useEffect(() => {
      let lastHeight = 0;
      let timeoutId: ReturnType<typeof setTimeout> | undefined; // 또는 number | undefined
      let rafId: number | null = null;

      if (chatStarted) {
        window.parent.postMessage({ type: 'IFRAME_HEIGHT', payload: { chatStarted: true, height: 0 } }, '*');

        return;
      }

      const sendHeight = () => {
        if (!ref || typeof ref === 'function' || !('current' in ref) || !ref.current) {
          return;
        }

        const height = chatStarted ? 0 : Math.ceil(ref.current.getBoundingClientRect().bottom + 30 || 0);

        // 30px 이상 변경되었을 때만 전송
        if (Math.abs(height - lastHeight) < 30) {
          return;
        }

        lastHeight = height;

        if (window.parent) {
          window.parent.postMessage({ type: 'IFRAME_HEIGHT', payload: { chatStarted: false, height } }, '*');
        }
      };
      const scheduleUpdate = () => {
        if (rafId !== null) {
          return;
        }

        rafId = requestAnimationFrame(() => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          timeoutId = setTimeout(sendHeight, 500);
          rafId = null;
        });
      };

      // 초기 전송
      sendHeight();

      const resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(
        ref && typeof ref === 'object' && 'current' in ref && ref.current ? ref.current : document.body,
      );

      // eslint-disable-next-line consistent-return
      return () => {
        resizeObserver.disconnect();

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      };
    }, [chatStarted]);

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex flex-col items-center gap-12 w-full', {
          'h-full overflow-hidden': chatStarted,
          'xl:h-full xl:overflow-hidden': !chatStarted,
        })}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        <div
          className={classNames('flex w-full h-full bg-primary', isSmallViewport ? 'flex-col' : 'flex-row', {
            'xl:h-full flex-col': !chatStarted,
          })}
        >
          <div
            ref={(node) => {
              setScrollElement(node);

              if (scrollRef) {
                scrollRef(node);
              }
            }}
            className={classNames(styles.Chat, 'flex flex-col h-full chat-container', {
              'w-[var(--chat-width)]': chatStarted && !isSmallViewport,
              '!w-full !mr-0': isSmallViewport && !hideChatForMobilePreview,
              hidden: hideChatForMobilePreview,
              '!px-4 md:!px-5 xl:justify-center xl:pb-[100px] xl:h-full': !chatStarted,
              'overflow-y-auto': chatStarted,
              [styles.chatStarted]: chatStarted && !isSmallViewport,
            })}
          >
            {!chatStarted && (
              <MainBackground zIndex={1} isMobileView={isMobileView} opacity={0.8} chatStarted={chatStarted} />
            )}
            {!chatStarted && (
              <div className="flex flex-col items-center w-full mx-auto md:w-[727px] xl:w-full xl:max-h-[85svh] xl:min-h-0 xl:max-w-[1400px]">
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
                <div className="xl:hidden w-full relative z-2 mt-3">
                  <V8AppBanner />
                </div>
                <div id="intro" className="max-w-chat-before-start mx-auto text-center z-2 mt-2">
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
                <span className="flex justify-center text-heading-xs text-center tablet:text-heading-sm text-secondary self-stretch z-2 mt-2">
                  Start here — or make your own.{isMobileView && <br />} What do you want to create?
                </span>
                <div className="relative z-2 mt-5 md:mt-4 md:relative rounded-[8px] xl:rounded-[24px] xl:aspect-[16/9] xl:w-full xl:max-w-[min(1400px,calc(61svh*16/9))] xl:min-h-[500px] overflow-hidden">
                  <div
                    className="md:absolute md:left-[1px] md:right-[1px] md:top-[1px] md:z-1 flex flex-col md:items-center md:justify-center gap-2 md:flex-row md:gap-4 xl:gap-7 rounded-[8px] xl:rounded-t-[24px] overflow-hidden"
                    style={
                      !isMobileView
                        ? {
                            background:
                              'linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.98) 4.7%, rgba(0, 0, 0, 0.96) 8.9%, rgba(0, 0, 0, 0.93) 12.8%, rgba(0, 0, 0, 0.90) 16.56%, rgba(0, 0, 0, 0.86) 20.37%, rgba(0, 0, 0, 0.82) 24.4%, rgba(0, 0, 0, 0.77) 28.83%, rgba(0, 0, 0, 0.71) 33.84%, rgba(0, 0, 0, 0.65) 39.6%, rgba(0, 0, 0, 0.57) 46.3%, rgba(0, 0, 0, 0.48) 54.1%, rgba(0, 0, 0, 0.38) 63.2%, rgba(0, 0, 0, 0.27) 73.76%, rgba(0, 0, 0, 0.14) 85.97%, rgba(0, 0, 0, 0.00) 100%)',
                          }
                        : undefined
                    }
                  >
                    {Object.entries(VIDEO_GUIDE_TABS).map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-6 gap-2 md:flex md:items-center md:gap-2 md:pt-3 xl:gap-3"
                      >
                        <value.icon size={28} color="#99A2B0" className="hidden xl:block xl:flex-shrink-0" />
                        {Object.entries(value.list).map(([listKey, listValue], listIndex) => (
                          <button
                            key={listKey}
                            className={classNames(
                              'col-span-2 flex flex-col gap-[2px] items-center justify-between md:justify-start md:flex-row md:gap-2 rounded-[8px] text-heading-2xs md:py-0 md:px-3 md:h-8 xl:px-4 xl:h-9 xl:text-heading-xs',
                              selectedVideoTab.item.label === listValue.label
                                ? 'p-[6px] text-interactive-selected border border-interactive-primary bg-gradient-to-t from-[rgba(17,185,210,0.20)] to-[rgba(17,185,210,0.20)] bg-interactive-neutral'
                                : 'p-2 text-interactive-neutral bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed',
                              Object.entries(value.list).length === 2 && listIndex === 0 ? 'col-start-2' : '',
                            )}
                            onClick={() => handleColorTabClick({ item: listValue, type: key as 'mobile' | 'desktop' })}
                          >
                            <listValue.icon
                              size={20}
                              color={selectedVideoTab.item.label === listValue.label ? '#3fd2e8' : '#F3F5F8'}
                            />
                            {listValue.label}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div
                    className={classNames(
                      'flex flex-col items-start relative cursor-pointer md:aspect-[16/9] border border-primary rounded-[8px] xl:rounded-[24px] xl:max-h-full overflow-hidden mt-3 md:mt-0',
                      selectedVideoTab.type === 'mobile' ? 'aspect-[10/9]' : 'aspect-[16/9]',
                    )}
                    onMouseEnter={() => setIsVideoHovered(true)}
                    onMouseLeave={() => setIsVideoHovered(false)}
                  >
                    <video
                      ref={desktopVideoRef}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className={classNames('w-full h-full object-cover')}
                      src={selectedVideoTab.item.video}
                      onClick={handleVideoClick}
                    >
                      Your browser does not support the video tag.
                    </video>
                    {selectedVideoTab.type === 'mobile' && (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-black/80 backdrop-blur-[10px] pointer-events-none rounded-[8px] xl:rounded-[24px] overflow-hidden" />
                        <div className="absolute top-[-1px] bottom-[-1px] left-1/2 md:top-[52px] md:bottom-[121px] xl:top-[10.7%] xl:bottom-[15%] -translate-x-1/2 elevation-light-3 aspect-[266/473] rounded-[8px] overflow-hidden">
                          <video
                            ref={mobileVideoRef}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className={classNames('w-full h-full object-cover')}
                            src={selectedVideoTab.item.video}
                            onClick={handleVideoClick}
                          >
                            Your browser does not support the video tag.
                          </video>
                        </div>
                      </>
                    )}

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
                  </div>
                </div>
              </div>
            )}

            <div
              className={classNames(`pt-0 pt-4 relative`, {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className={classNames('flex flex-col w-full flex-1 max-w-chat pr-4 mx-auto z-1', {
                        'pl-6 pb-4': !isSmallViewport,
                        'pl-4': isSmallViewport, // Reduced padding for mobile
                      })}
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
                  ) : null;
                }}
              </ClientOnly>

              <div
                className={classNames(
                  'flex flex-col gap-3 w-full mx-auto z-prompt transition-[bottom,max-width,padding] duration-300 ease-out',
                  {
                    'sticky bottom-4 pr-4': chatStarted && !isSmallViewport,
                    'sticky bottom-0': chatStarted && isSmallViewport,
                    'pl-6': !isSmallViewport,
                    'tablet:max-w-chat': chatStarted,
                    'md:relative md:-translate-y-[calc(50%+16px)] xl:absolute xl:left-1/2 xl:translate-x-[-50%] max-w-[632px] !pl-0':
                      !chatStarted, // Before starting the chat, there is a 600px limit on mobile devices.
                  },
                )}
              >
                <div className="bg-bolt-elements-background-depth-2">
                  {!isStreaming && actionAlert && actionAlert.content && (
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
                <div
                  className={classNames(
                    'flex flex-col self-stretch px-4 pt-[6px] pb-4 relative w-full mx-auto z-prompt',
                    {
                      'tablet:max-w-chat': chatStarted,
                      'tablet:max-w-chat-before-start': !chatStarted,
                      'bg-primary': !chatStarted,
                      [styles.promptInputActive]: chatStarted && !isSmallViewport,
                      [styles.promptInputActiveSmallViewport]: chatStarted && isSmallViewport,
                    },
                  )}
                  style={
                    !chatStarted
                      ? {
                          borderRadius: 'var(--border-radius-16, 16px)',
                          boxShadow: '0 2px 4px 0 rgba(26, 220, 217, 0.08), 0 2px 24px 4px rgba(148, 250, 239, 0.12)',
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
                              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-body-md-medium"
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
                                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-body-md-medium"
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
                                  className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-body-md-medium"
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
          {showWorkbench && !isSmallViewport && <ResizeHandle minChatWidth={426} minWorkbenchWidth={747} />}
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
