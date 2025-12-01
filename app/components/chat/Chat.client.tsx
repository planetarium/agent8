/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import { type UIMessage, DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import {
  useWorkbenchFiles,
  useWorkbenchActionAlert,
  useWorkbenchStore,
  useWorkbenchContainer,
} from '~/lib/hooks/useWorkbenchStore';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  FIXED_MODELS,
  PROMPT_COOKIE_KEY,
  PROVIDER_LIST,
  WORK_DIR,
} from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat, type ChatAttachment } from './BaseChat';
import { NotFoundPage } from '~/components/ui/NotFoundPage';
import { UnauthorizedPage } from '~/components/ui/UnauthorizedPage';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { selectStarterTemplate, getZipTemplates } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { convertFileMapToFileSystemTree } from '~/utils/fileUtils';
import type { Template } from '~/types/template';
import { playCompletionSound } from '~/utils/sound';
import {
  commitChanges,
  createTaskBranch,
  fetchProjectFiles,
  forkProject,
  getCommit,
  isEnabledGitbasePersistence,
} from '~/lib/persistenceGitbase/api.client';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { sendActivityPrompt } from '~/lib/verse8/api';
import type { FileMap } from '~/lib/.server/llm/constants';
import { useGitbaseChatHistory } from '~/lib/persistenceGitbase/useGitbaseChatHistory';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import type { VersionEntry } from '~/lib/persistenceGitbase/gitlabService';
import { versionEventStore } from '~/lib/stores/versionEvent';
import { extractTextContent } from '~/utils/message';
import { changeChatUrl } from '~/utils/url';
import { get2DStarterPrompt, get3DStarterPrompt } from '~/lib/common/prompts/agent8-prompts';
import { stripMetadata } from './UserMessage';
import type { ProgressAnnotation } from '~/types/context';
import { handleChatError, type HandleChatErrorOptions } from '~/utils/errorNotification';
import { getElapsedTime } from '~/utils/performance';
import ToastContainer from '~/components/ui/ToastContainer';
import CustomButton from '~/components/ui/CustomButton';
import { CloseIcon } from '~/components/ui/Icons';
import type { WorkbenchStore } from '~/lib/stores/workbench';

const logger = createScopedLogger('Chat');

const MAX_COMMIT_RETRIES = 2;
const WORKBENCH_CONNECTION_TIMEOUT_MS = 10000;
const WORKBENCH_INIT_DELAY_MS = 100; // 100ms is an empirically determined value that is sufficient for asynchronous initialization tasks to complete, while minimizing unnecessary delays
const WORKBENCH_MESSAGE_IDLE_TIMEOUT_MS = 35000;

async function fetchTemplateFromAPI(template: Template, title?: string, projectRepo?: string) {
  try {
    const params = new URLSearchParams();
    params.append('templateName', template.name);
    params.append('repo', template.githubRepo || '');
    params.append('path', template.path || '');

    if (title) {
      params.append('title', title);
    }

    if (projectRepo) {
      params.append('projectRepo', projectRepo);
    }

    const response = await fetch(`/api/select-template?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch template: ${response.status}`);
    }

    const result = (await response.json()) as {
      fileMap: FileMap;
      project: { id: number; name: string; path: string; description: string };
      commit: { id: number };
    };

    return result;
  } catch (error) {
    logger.error('Error fetching template from API:', error);
    throw error;
  }
}

function sendEventToParent(type: string, payload: any) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type,
          payload,
        },
        '*',
      );

      logger.info('Sent deployment info to parent window');
    }
  } catch (error) {
    logger.error('Error sending message to parent:', error);
  }
}

async function waitForWorkbenchConnection(workbench: WorkbenchStore, timeoutMs: number = 10000): Promise<void> {
  const currentState = workbench.connectionState.get();

  if (currentState === 'failed') {
    throw new Error('Container connection failed - manual recovery required');
  }

  if (currentState === 'connected') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = workbench.connectionState.subscribe((state) => {
      if (state === 'connected') {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve();
      } else if (state === 'failed') {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(new Error('Connection failed during wait'));
      }
    });
  });
}

// Save Version Confirmation Modal Component
interface SaveVersionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string, description: string) => void;
  commitTitle: string | null;
}

function SaveVersionConfirmModal({ isOpen, onClose, onConfirm, commitTitle }: SaveVersionConfirmModalProps) {
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  // Reset fields when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
    }
  }, [isOpen]);

  if (!isOpen || !commitTitle) {
    return null;
  }

  const handleConfirm = () => {
    // Title is required
    if (!title.trim()) {
      return;
    }

    onConfirm(title.trim(), description.trim());
  };

  // Check if form is valid (title is required)
  const isFormValid = title.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="flex flex-col items-start gap-[12px] border border-[rgba(255,255,255,0.22)] bg-[#111315] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)] w-[500px] p-[32px] rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 self-stretch">
          <span className="text-primary text-heading-md flex-[1_0_0]">Save to Version History</span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-start gap-4 self-stretch">
          <span className="text-body-md-medium text-tertiary self-stretch">
            Save versions to easily compare and restore them
          </span>

          {/* Version Title Input */}
          <div className="flex flex-col items-start gap-2 self-stretch">
            <label className="text-body-md-medium text-primary">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)]"
            />
          </div>

          {/* Description Input */}
          <div className="flex flex-col items-start gap-2 self-stretch">
            <label className="text-body-md-medium text-primary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what changed"
              rows={1}
              className="w-full px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)] resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-start gap-[10px] self-stretch mt-4">
          <div className="flex justify-end items-center gap-3 self-stretch">
            <CustomButton variant="secondary-ghost" size="lg" onClick={onClose}>
              Cancel
            </CustomButton>
            <CustomButton variant="primary-filled" size="lg" onClick={handleConfirm} disabled={!isFormValid}>
              Save
            </CustomButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ChatComponentProps {
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
}

export function Chat({ isAuthenticated, onAuthRequired }: ChatComponentProps = {}) {
  renderLogger.trace('Chat');

  const {
    loaded,
    loading,
    chats,
    files,
    project,
    taskBranches,
    enabledTaskMode,
    setEnabledTaskMode,
    reloadTaskBranches,
    revertTo,
    hasMore,
    loadBefore,
    loadingBefore,
    error,
  } = useGitbaseChatHistory();

  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [isSaveVersionModalOpen, setIsSaveVersionModalOpen] = useState<boolean>(false);
  const [selectedMessageForVersion, setSelectedMessageForVersion] = useState<UIMessage | null>(null);
  const [savedVersionHashes, setSavedVersionHashes] = useState<Set<string>>(new Set());
  const title = repoStore.get().title;
  const workbench = useWorkbenchStore();

  useEffect(() => {
    if (repoStore.get().path) {
      sendEventToParent('EVENT', { name: 'START_EDITING' });
    }

    const timeoutId = setTimeout(() => {
      changeChatUrl(repoStore.get().path, { replace: true, searchParams: {}, ignoreChangeEvent: true });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (loaded) {
      setReady(true);
    }
  }, [initialMessages, loaded]);

  // Fetch saved version hashes when project loads
  useEffect(() => {
    const fetchSavedVersions = async () => {
      if (repoStore.get().path && isEnabledGitbasePersistence) {
        try {
          const { getVersionHistory } = await import('~/lib/persistenceGitbase/api.client');
          const versions = await getVersionHistory(repoStore.get().path);
          const hashes = new Set<string>(versions.map((v: VersionEntry) => v.commitHash));
          setSavedVersionHashes(hashes);
        } catch (error) {
          console.error('Failed to fetch version history:', error);
        }
      }
    };

    fetchSavedVersions();
  }, [repoStore.get().path, loaded]);

  // Listen to version events (save/delete)
  useEffect(() => {
    const unsubscribe = versionEventStore.subscribe((event) => {
      if (event) {
        if (event.type === 'save') {
          // Add to savedVersionHashes
          setSavedVersionHashes((prev) => new Set([...prev, event.commitHash]));
        } else if (event.type === 'delete') {
          // Remove from savedVersionHashes
          setSavedVersionHashes((prev) => {
            const newSet = new Set(prev);
            newSet.delete(event.commitHash);

            return newSet;
          });
        }
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (loaded) {
      if (chats.length > 0) {
        setInitialMessages(chats);
      }

      if (Object.keys(files).length > 0) {
        workbench.container.then(async (containerInstance) => {
          try {
            await containerInstance.fs.rm('/src', { recursive: true, force: true });
            await containerInstance.fs.rm('/PROJECT', { recursive: true, force: true });
          } catch {
            logger.warn('Failed to remove /src directory');
          }

          try {
            const previews = workbench.previews.get();
            const currentPreview = previews.find((p: any) => p.ready);

            if (currentPreview) {
              workbench.previews.set([]);
            }

            await containerInstance.mount(convertFileMapToFileSystemTree(files));
            workbench.resetAllFileModifications();

            if (currentPreview) {
              workbench.previews.set(
                previews.map((p: any) => {
                  if (p.baseUrl === currentPreview.baseUrl) {
                    return { ...p, refreshAt: Date.now() };
                  }

                  return p;
                }),
              );
            }
          } catch (error) {
            logger.error('Error mounting container:', error);
          }

          workbench.showWorkbench.set(true);
        });
      }

      if (project.description) {
        repoStore.set({
          ...repoStore.get(),
          title: project.description.split('\n')[0],
        });
      }
    } else {
      setInitialMessages([]);
    }
  }, [loaded, files, chats, project, workbench]);

  const errorStatus = error && typeof error === 'object' ? (error as any).status : null;

  // Check for 404 error (project not found or access denied)
  if (errorStatus === 404) {
    return <NotFoundPage />;
  }

  // Check for 401 error (unauthorized)
  if (errorStatus === 401) {
    return <UnauthorizedPage />;
  }

  return (
    <>
      {ready && (
        <ChatImpl
          loading={loading}
          description={title}
          initialMessages={initialMessages}
          setInitialMessages={setInitialMessages}
          enabledTaskMode={enabledTaskMode}
          setEnabledTaskMode={setEnabledTaskMode}
          taskBranches={taskBranches}
          reloadTaskBranches={reloadTaskBranches}
          revertTo={revertTo}
          hasMore={hasMore}
          loadBefore={loadBefore}
          loadingBefore={loadingBefore}
          isAuthenticated={isAuthenticated}
          onAuthRequired={onAuthRequired}
          isSaveVersionModalOpen={isSaveVersionModalOpen}
          setIsSaveVersionModalOpen={setIsSaveVersionModalOpen}
          selectedMessageForVersion={selectedMessageForVersion}
          setSelectedMessageForVersion={setSelectedMessageForVersion}
          savedVersionHashes={savedVersionHashes}
        />
      )}
      <ToastContainer />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: UIMessage[];
    isLoading: boolean;
    parseMessages: (messages: UIMessage[], isLoading: boolean) => void;
  }) => {
    const { messages, isLoading, parseMessages } = options;
    parseMessages(messages, isLoading);
  },
  50,
);

interface ChatProps {
  loading: boolean;
  initialMessages: UIMessage[];
  setInitialMessages: (messages: UIMessage[]) => void;
  description?: string;
  taskBranches: any[];
  enabledTaskMode: boolean;
  setEnabledTaskMode: (enabled: boolean) => void;
  reloadTaskBranches: (projectPath: string) => Promise<void>;
  revertTo: (hash: string) => void;
  hasMore: boolean;
  loadBefore: () => Promise<void>;
  loadingBefore: boolean;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  isSaveVersionModalOpen: boolean;
  setIsSaveVersionModalOpen: (open: boolean) => void;
  selectedMessageForVersion: UIMessage | null;
  setSelectedMessageForVersion: (message: UIMessage | null) => void;
  savedVersionHashes: Set<string>;
}

export const ChatImpl = memo(
  ({
    loading,
    description,
    initialMessages,
    setInitialMessages,
    taskBranches,
    enabledTaskMode,
    setEnabledTaskMode,
    reloadTaskBranches,
    revertTo,
    hasMore,
    loadBefore,
    loadingBefore,
    isAuthenticated,
    onAuthRequired,
    isSaveVersionModalOpen,
    setIsSaveVersionModalOpen,
    selectedMessageForVersion,
    setSelectedMessageForVersion,
    savedVersionHashes,
  }: ChatProps) => {
    useShortcuts();

    const workbench = useWorkbenchStore();
    const container = useWorkbenchContainer();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const chatRequestStartTimeRef = useRef<number>(undefined);
    const lastUserPromptRef = useRef<string>(undefined);

    // Helper function to report errors with automatic prompt and elapsed time injection
    const reportError = (
      message: string,
      startTime: number,
      options?: Partial<Omit<HandleChatErrorOptions, 'elapsedTime'>>,
    ) => {
      handleChatError(message, {
        prompt: lastUserPromptRef.current,
        ...options,
        elapsedTime: getElapsedTime(startTime),
      });
    };

    const runAndPreview = async (message: UIMessage) => {
      workbench.clearAlert();

      const content = extractTextContent(message);

      const isServerUpdated = /<boltAction[^>]*filePath="server.js"[^>]*>/g.test(content);
      const isPackageJsonUpdated = /<boltAction[^>]*filePath="package.json"[^>]*>/g.test(content);

      const previews = workbench.previews.get();

      if (!isServerUpdated && !isPackageJsonUpdated && previews.find((p: any) => p.ready)) {
        playCompletionSound();
        workbench.currentView.set('preview');

        return;
      }

      const shell = workbench.boltTerminal;
      await shell.ready;

      for (let retry = 0; retry < 15; retry++) {
        const state = await shell.executionState.get();

        if (state?.active) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        break;
      }

      await workbench.runPreview();
    };

    const lastSendMessageTime = useRef(0);
    const promptProcessed = useRef(false);

    // Check for run=auto in URL at initialization
    const initialAutorun = (() => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const runParam = urlParams.get('run');
        const hasPrompt = !!urlParams.get('prompt');

        return runParam === 'auto' && hasPrompt;
      }

      return false;
    })();

    const autorunRequested = useRef(initialAutorun);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [attachmentList, setAttachmentList] = useState<ChatAttachment[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState<boolean>(false);
    const [installNpm, setInstallNpm] = useState<boolean>(false);
    const [customProgressAnnotations, setCustomProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [textareaExpanded, setTextareaExpanded] = useState<boolean>(false);
    const files = useWorkbenchFiles();
    const actionAlert = useWorkbenchActionAlert();
    const { activeProviders, promptId, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('SelectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('SelectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [input, setInput] = useState(() => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlPrompt = urlParams.get('prompt');

        if (urlPrompt) {
          try {
            const decoded = decodeURIComponent(urlPrompt);

            return decoded;
          } catch {
            return urlPrompt;
          }
        }
      }

      const result =
        initialMessages.length > 0
          ? Cookies.get(PROMPT_COOKIE_KEY) || ''
          : 'Create a top-down action game with a character controlled by WASD keys and mouse clicks.';

      return result;
    });
    const [chatData, setChatData] = useState<any[]>([]);

    const bodyRef = useRef({ apiKeys, files, promptId, contextOptimization: contextOptimizationEnabled });

    useEffect(() => {
      bodyRef.current = { apiKeys, files, promptId, contextOptimization: contextOptimizationEnabled };
    }, [apiKeys, files, promptId, contextOptimizationEnabled]);

    const {
      messages,
      status,
      stop,
      sendMessage: sendChatMessage,
      setMessages,
      regenerate,
      error,
    } = useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        body: () => bodyRef.current,
      }),
      onData: (data) => {
        // Ignore empty data
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
          return;
        }

        // Extract the inner 'data' property if it exists
        const extractedData = data?.data || data;

        // Keep only the latest data of each type to prevent memory bloat
        setChatData((prev) => {
          const hasType = (obj: any): obj is { type: string } => obj && typeof obj === 'object' && 'type' in obj;
          const extractedType = hasType(extractedData) ? extractedData.type : null;
          const filtered = prev.filter((item) => !hasType(item) || item.type !== extractedType);

          return [...filtered, extractedData];
        });
      },
      onError: (e) => {
        logger.error('Request failed\n\n', e, error);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: e.message,
        });

        const reportProvider = model === 'auto' ? 'auto' : provider.name;
        handleChatError(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
          {
            error: e,
            context: 'useChat onError callback, model: ' + model + ', provider: ' + reportProvider,
            prompt: lastUserPromptRef.current,
            elapsedTime: getElapsedTime(chatRequestStartTimeRef.current),
          },
        );
        setFakeLoading(false);
      },

      onFinish: async ({ message }) => {
        const usage =
          message.metadata &&
          typeof message.metadata === 'object' &&
          'type' in message.metadata &&
          message.metadata.type === 'usage' &&
          'value' in message.metadata
            ? message.metadata.value
            : null;

        logStore.logProvider('Chat response completed', {
          component: 'Chat',
          action: 'response',
          model,
          provider: provider.name,
          usage,
          messageLength: message.parts?.find((part) => part.type === 'text' && 'text' in part)?.text?.length || 0,
        });

        workbench.onMessageClose(message.id, async () => {
          await runAndPreview(message);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await handleCommit(message);
        });

        setFakeLoading(false);

        logger.debug('Finished streaming');
      },
    });

    // Derived state for loading status
    const isLoading = status === 'streaming' || status === 'submitted';

    useEffect(() => {
      const prompt = searchParams.get('prompt');
      const autorun = searchParams.get('run');

      // Process if prompt exists in URL
      if (prompt && !promptProcessed.current) {
        const defaultPrompt =
          'Create a top-down action game with a character controlled by WASD keys and mouse clicks.';

        // Apply URL prompt only if input is empty or matches default prompt
        if (!input || input === defaultPrompt) {
          try {
            const decodedPrompt = decodeURIComponent(prompt);

            setInput(decodedPrompt);

            if (autorun === 'auto') {
              autorunRequested.current = true;
            }
          } catch (error) {
            console.error('Error decoding prompt parameter:', error);
            setInput(prompt);

            if (autorun === 'auto') {
              autorunRequested.current = true;
            }
          }

          promptProcessed.current = true;
        }
      }
    }, [searchParams, input, setInput, setSearchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      if (!isLoading) {
        setMessages(initialMessages);

        // Set lastUserPromptRef from the last user message in initialMessages
        if (initialMessages.length > 0) {
          const lastUserMessage = [...initialMessages].reverse().find((m) => m.role === 'user');

          if (lastUserMessage) {
            lastUserPromptRef.current = extractTextContent(lastUserMessage);
          }
        }
      }
    }, [initialMessages]);

    useEffect(() => {
      processSampledMessages({
        messages,
        isLoading,
        parseMessages,
      });
    }, [messages, isLoading, parseMessages]);

    useEffect(() => {
      setInstallNpm(false);
    }, [container]);

    useEffect(() => {
      if (Object.keys(files).length > 0 && !installNpm) {
        setInstallNpm(true);

        const boltShell = workbench.boltTerminal;
        boltShell.ready.then(async () => {
          await workbench.setupDeployConfig(boltShell);
        });
      }
    }, [files, installNpm]);

    const handleCommit = async (message: UIMessage) => {
      if (!isEnabledGitbasePersistence) {
        return;
      }

      if (!workbench.hasMessageArtifacts(message.id)) {
        logger.info(`Message has no artifacts, skipping commit`);
        return;
      }

      const startTime = performance.now();
      let attempt = 0;
      let commitSucceeded = false;
      let lastError: unknown;

      while (!commitSucceeded && attempt <= MAX_COMMIT_RETRIES) {
        try {
          logger.info(`Commit attempt ${attempt + 1}/${MAX_COMMIT_RETRIES + 1}`);

          await waitForWorkbenchConnection(workbench, WORKBENCH_CONNECTION_TIMEOUT_MS);
          await new Promise((resolve) => setTimeout(resolve, WORKBENCH_INIT_DELAY_MS));
          await workbench.waitForMessageIdle(message.id, { timeoutMs: WORKBENCH_MESSAGE_IDLE_TIMEOUT_MS });

          await commitChanges(message, (commitHash) => {
            setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, id: commitHash } : m)));
            reloadTaskBranches(repoStore.get().path);
          });

          logger.info('✅ Commit succeeded');
          commitSucceeded = true;
        } catch (error) {
          lastError = error;
          logger.warn(`❌ Commit attempt ${attempt + 1} failed:`, error);
          attempt++;
        }
      }

      if (!commitSucceeded) {
        reportError(`Code commit failed`, startTime, {
          error: lastError instanceof Error ? lastError : String(lastError),
          context: 'handleCommit',
        });
      }
    };

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      setFakeLoading(false);
      setChatData([]);
      chatStore.setKey('aborted', true);
      workbench.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';

        // Check if textarea is expanded beyond minimum height
        const isExpanded = scrollHeight > 40; // TEXTAREA_MIN_HEIGHT = 40
        setTextareaExpanded(isExpanded);
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      // Auth check - notify parent and return if not authenticated
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      if (lastSendMessageTime.current && Date.now() - lastSendMessageTime.current < 1000) {
        return;
      }

      lastSendMessageTime.current = Date.now();

      // Clear chat data at the start of new message
      setChatData([]);

      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      chatRequestStartTimeRef.current = performance.now();
      lastUserPromptRef.current = messageContent;

      if (chatStarted && Object.keys(files).length === 0) {
        const fileRecoveryStartTime = performance.now();
        let recoverySuccessful = false;
        const containerInstance = await workbench.container;

        const fileRecoveryStrategies = [
          {
            name: 'Workbench',
            getFiles: () => workbench.files.get(),
            logSuccess: () => console.log('files recovery from workbench successful'),
          },
          {
            name: 'Gitbase',
            getFiles: async () => {
              const projectPath = repoStore.get().path;
              return projectPath ? await fetchProjectFiles(projectPath) : {};
            },
            logSuccess: () => console.log('files recovery from gitbase successful'),
          },
        ];

        for (const strategy of fileRecoveryStrategies) {
          try {
            const files = await strategy.getFiles();

            if (Object.keys(files).length > 0) {
              await containerInstance.mount(convertFileMapToFileSystemTree(files));
              strategy.logSuccess();
              recoverySuccessful = true;
              break;
            }
          } catch (error) {
            console.error(`${strategy.name} recovery failed:`, error);
          }
        }

        if (!recoverySuccessful) {
          reportError('Files are not loaded. Please try again later.', fileRecoveryStartTime, {
            context: 'sendMessage - files check',
          });

          return;
        }
      }

      if (isLoading) {
        abort();
        return;
      }

      setFakeLoading(true);
      runAnimation();
      workbench.currentView.set('code');

      if (attachmentList.length > 0) {
        const imageAttachments = attachmentList.filter((item) =>
          ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(item.ext),
        );

        if (imageAttachments.length > 0) {
          setFakeLoading(true);

          const urls = imageAttachments.map((item) => item.url);

          try {
            const descriptionResponse = await fetch('/api/image-description', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: messageContent,
                imageUrls: urls,
              }),
            });

            if (descriptionResponse.ok) {
              const descriptions = await descriptionResponse.json();

              if (Array.isArray(descriptions) && imageAttachments.length === descriptions.length) {
                for (let i = 0; i < imageAttachments.length; i++) {
                  imageAttachments[i].features = descriptions[i].features;
                  imageAttachments[i].details = descriptions[i].details;
                }
              }
            }
          } catch (descError) {
            logger.error('Error generating image description:', descError);
            toast.warning('Could not generate image description, using default');
          }
        }
      }

      if (!chatStarted) {
        const templateSelectionStartTime = performance.now();

        try {
          // Set progress annotation for analyzing request
          setCustomProgressAnnotations([
            {
              type: 'progress',
              label: 'analyze',
              status: 'in-progress',
              order: 1,
              message: 'Analyzing your request...',
            },
          ]);

          const { template, title, projectRepo } = await selectStarterTemplate({
            message: messageContent,
          });

          if (!template) {
            throw new Error('Not Found Template');
          }

          // Update progress annotation for selecting template
          setCustomProgressAnnotations([
            {
              type: 'progress',
              label: 'analyze',
              status: 'complete',
              order: 1,
              message: 'Request analyzed',
            },
            {
              type: 'progress',
              label: 'template',
              status: 'in-progress',
              order: 2,
              message: 'Setting up base project...',
            },
          ]);

          const temResp = await fetchTemplateFromAPI(template!, title, projectRepo).catch((e) => {
            if (e.message.includes('rate limit')) {
              toast.warning('Rate limit exceeded. Skipping starter template\nRetry again after a few minutes.');
            } else {
              toast.warning('Failed to import starter template\nRetry again after a few minutes.');
            }
          });

          const projectPath = temResp?.project?.path;
          const projectName = temResp?.project?.name;
          const templateCommitId = temResp?.commit?.id;
          workbench.showWorkbench.set(true);

          if (!temResp?.fileMap || Object.keys(temResp.fileMap).length === 0) {
            throw new Error('Not Found Template Data');
          }

          const processedFileMap = Object.entries(temResp.fileMap).reduce(
            (acc, [key, value]) => {
              acc[WORK_DIR + '/' + key] = value;
              return acc;
            },
            {} as Record<string, any>,
          );
          workbench.files.set(processedFileMap);

          const containerInstance = await workbench.container;
          await containerInstance.mount(convertFileMapToFileSystemTree(processedFileMap));

          if (isEnabledGitbasePersistence) {
            if (!projectPath || !projectName || !templateCommitId) {
              throw new Error('Cannot create project');
            }

            let branchName = 'develop';

            if (enabledTaskMode) {
              const { success, message, data } = await createTaskBranch(projectPath);

              if (!success) {
                reportError(message, templateSelectionStartTime, {
                  context: 'createTaskBranch - starter template',
                });
                return;
              }

              branchName = data.branchName;
            }

            repoStore.set({
              name: projectName,
              path: projectPath,
              title,
              taskBranch: branchName,
            });

            // Record prompt activity for first request
            sendActivityPrompt(projectPath).catch((error) => {
              logger.warn('Failed to record prompt activity:', error);
            });

            changeChatUrl(projectPath, { replace: true });
          } else {
            repoStore.set({
              name: projectRepo,
              path: projectRepo,
              title,
              taskBranch: 'develop',
            });

            // Record prompt activity for first request
            sendActivityPrompt(projectRepo).catch((error) => {
              logger.warn('Failed to record prompt activity:', error);
            });

            changeChatUrl(projectRepo, { replace: true });
          }

          const firstChatModel =
            model === 'auto'
              ? template.name.includes('3d')
                ? FIXED_MODELS.FIRST_3D_CHAT
                : FIXED_MODELS.FIRST_2D_CHAT
              : {
                  model,
                  provider,
                };

          const starterPrompt = template.name.includes('3d') ? get3DStarterPrompt() : get2DStarterPrompt();

          // Complete template selection
          setCustomProgressAnnotations([
            {
              type: 'progress',
              label: 'analyze',
              status: 'complete',
              order: 1,
              message: 'Request analyzed',
            },
            {
              type: 'progress',
              label: 'template',
              status: 'complete',
              order: 2,
              message: 'Template selected',
            },
          ]);

          // Clear progress annotations after a short delay
          setTimeout(() => {
            setCustomProgressAnnotations([]);
          }, 1000);

          setMessages([
            {
              id: `1-${new Date().getTime()}`,
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: `[Model: ${firstChatModel.model}]\n\n[Provider: ${firstChatModel.provider.name}]\n\n[Attachments: ${JSON.stringify(
                    attachmentList,
                  )}]\n\n${messageContent}\n<think>${starterPrompt}</think>`,
                },
              ],
            },
          ]);
          regenerate();

          setInput('');
          Cookies.remove(PROMPT_COOKIE_KEY);

          sendEventToParent('EVENT', { name: 'START_EDITING' });

          setAttachmentList([]);

          resetEnhancer();

          textareaRef.current?.blur();

          return;
        } catch (error) {
          // Clear progress annotations on error
          setCustomProgressAnnotations([]);

          const errorMessage = error instanceof Error ? error.message : 'Failed to import starter template';

          // Check if error message has meaningful content
          const isMeaningfulErrorMessage =
            errorMessage.trim() && errorMessage !== 'Not Found Template' && errorMessage !== 'Not Found Template Data';

          reportError(
            isMeaningfulErrorMessage
              ? errorMessage
              : 'Failed to import starter template\nRetry again after a few minutes.',
            templateSelectionStartTime,
            {
              error: error instanceof Error ? error : String(error),
              context: 'starter template selection',
              toastType: isMeaningfulErrorMessage ? 'error' : 'warning',
            },
          );

          setChatStarted(false);
          setFakeLoading(false);

          return;
        }
      }

      const sendMessageFinalStartTime = performance.now();

      try {
        // Record prompt activity for subsequent requests
        if (repoStore.get().path) {
          sendActivityPrompt(repoStore.get().path).catch((error) => {
            logger.warn('Failed to record prompt activity:', error);
          });
        }

        if (error != null) {
          setMessages(messages.slice(0, -1));
        }

        chatStore.setKey('aborted', false);

        if (repoStore.get().path) {
          const commit = await workbench.commitModifiedFiles();

          if (commit) {
            setMessages((prev: UIMessage[]) => [
              ...prev,
              {
                id: commit.id,
                role: 'assistant',
                parts: [
                  {
                    type: 'text',
                    text: commit.message || 'The user changed the files.',
                  },
                ],
              },
            ]);
          }

          if (enabledTaskMode && repoStore.get().taskBranch === DEFAULT_TASK_BRANCH) {
            const createTaskBranchStartTime = performance.now();
            const { success, message, data } = await createTaskBranch(repoStore.get().path);

            if (!success) {
              reportError(message, createTaskBranchStartTime, {
                context: 'createTaskBranch - subsequent message',
              });
              return;
            }

            repoStore.set({
              ...repoStore.get(),
              taskBranch: data.branchName,
            });

            setMessages(() => []);
          }
        }

        // Send new message immediately - useChat will use the latest state
        sendChatMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
                attachmentList,
              )}]\n\n${messageContent}`,
            },
          ],
        });

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setAttachmentList([]);

        resetEnhancer();

        textareaRef.current?.blur();
      } catch (error) {
        logger.error('Error sending message:', error);

        if (error instanceof Error) {
          reportError('Error:' + error?.message, sendMessageFinalStartTime, {
            error,
            context: 'sendMessage function',
          });
        }
      }
    };

    // Auto-run effect: automatically send message when everything is ready
    useEffect(() => {
      if (
        autorunRequested.current &&
        input &&
        !isLoading &&
        !fakeLoading &&
        provider &&
        model &&
        !enhancingPrompt &&
        (!chatStarted || Object.keys(files).length > 0) // For existing chats, ensure workbenchFiles are loaded
      ) {
        // Wait for authentication before auto-run (flag is preserved for retry)
        if (!isAuthenticated) {
          return;
        }

        autorunRequested.current = false;

        // Use setTimeout to ensure UI is ready
        setTimeout(() => {
          sendMessage({} as React.UIEvent);
        }, 100);
      }
    }, [
      input,
      isLoading,
      fakeLoading,
      provider,
      model,
      enhancingPrompt,
      sendMessage,
      chatStarted,
      files,
      isAuthenticated,
    ]);

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     * Only saves to cookies after chat has started.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (chatStarted) {
          const trimmedValue = event.target.value.trim();
          Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
        }
      }, 1000),
      [chatStarted],
    );

    // Reset input to default prompt when returning to pre-chat state
    useEffect(() => {
      if (!chatStarted && initialMessages.length === 0) {
        Cookies.remove(PROMPT_COOKIE_KEY);
        setInput('Create a top-down action game with a character controlled by WASD keys and mouse clicks.');
      }
    }, [chatStarted, initialMessages.length, setInput]);

    const [messageRef, scrollRef] = useSnapScroll();

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      console.log('handleModelChange', newModel);
      setModel(newModel);
      Cookies.set('SelectedModel', newModel, { expires: 1 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      console.log('handleProviderChange', newProvider);
      setProvider(newProvider);
      Cookies.set('SelectedProvider', newProvider.name, { expires: 1 });
    };

    const handleTemplateImport = async (source: { type: 'github' | 'zip'; title: string }, files: FileMap) => {
      const startTime = performance.now();

      try {
        setFakeLoading(true);
        runAnimation();

        const containerInstance = await workbench.container;
        await containerInstance.mount(convertFileMapToFileSystemTree(files));

        if (!chatStarted) {
          repoStore.set({
            name: source.title,
            path: '',
            title: source.title,
            taskBranch: DEFAULT_TASK_BRANCH,
          });

          // GitLab persistence가 비활성화된 경우에만 즉시 URL 변경
          if (!isEnabledGitbasePersistence) {
            changeChatUrl(source.title, { replace: true });
          }

          const messages = [
            {
              id: `1-${new Date().getTime()}`,
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
                    attachmentList,
                  )}]\n\nI want to import the following files from the ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}`,
                },
              ],
            },
            {
              id: `2-${new Date().getTime()}`,
              role: 'assistant',
              parts: [
                {
                  type: 'text',
                  text: `I will import the files from the ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}`,
                },
              ],
            },
          ] as UIMessage[];

          setInitialMessages(messages);

          setChatStarted(true);
          workbench.showWorkbench.set(true);
          sendEventToParent('EVENT', { name: 'START_EDITING' });
        }

        toast.success(`Successfully imported ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}`);
      } catch (error) {
        logger.error(`Error importing ${source.type === 'github' ? 'repository' : 'project'}:`, error);
        reportError(`Failed to import ${source.type === 'github' ? 'repository' : 'project'}`, startTime, {
          error: error instanceof Error ? error : String(error),
          context: 'handleTemplateImport',
          prompt: undefined, // Prompt not required (not a chat request)
        });
      } finally {
        setFakeLoading(false);
      }
    };

    const handleProjectZipImport = async (title: string, zipFile: File) => {
      const { fileMap } = await getZipTemplates(zipFile, title);
      await handleTemplateImport({ type: 'zip', title }, fileMap);
    };

    const handleFork = async (message: UIMessage) => {
      const startTime = performance.now();

      workbench.currentView.set('code');
      await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

      const commitHash = message.id.split('-').pop();

      if (!commitHash || !isCommitHash(commitHash)) {
        reportError('No commit hash found', startTime, {
          context: 'handleFork - commit hash validation',
        });

        return;
      }

      const nameWords = repoStore.get().name.split('-');

      let newRepoName = '';

      if (nameWords && Number.isInteger(Number(nameWords[nameWords.length - 1]))) {
        newRepoName = nameWords.slice(0, -1).join('-');
      } else {
        newRepoName = nameWords.join('-');
      }

      // Show loading toast while forking
      const toastId = toast.loading('Forking project...');

      try {
        const forkedProject = await forkProject(repoStore.get().path, newRepoName, commitHash, repoStore.get().title);

        // Dismiss the loading toast
        toast.dismiss(toastId);

        if (forkedProject && forkedProject.success) {
          toast.success('Forked project successfully');
          window.location.href = '/chat/' + forkedProject.project.path;
        } else {
          reportError('Failed to fork project', startTime, {
            context: 'handleFork - fork result check',
          });
        }
      } catch (error) {
        // Dismiss the loading toast and show error
        toast.dismiss(toastId);

        reportError('Failed to fork project', startTime, {
          error: error instanceof Error ? error : String(error),
          context: 'handleFork - catch block',
        });
        logger.error('Error forking project:', error);
      }
    };

    const handleRevert = async (message: UIMessage) => {
      const startTime = performance.now();

      workbench.currentView.set('code');
      await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

      const commitHash = message.id.split('-').pop();

      if (!commitHash || !isCommitHash(commitHash)) {
        reportError('No commit hash found', startTime, {
          context: 'handleRevert - commit hash validation',
        });

        return;
      }

      revertTo(commitHash);
    };

    // Open save version confirmation modal
    const handleSaveVersionClick = (message: UIMessage) => {
      setSelectedMessageForVersion(message);
      setIsSaveVersionModalOpen(true);
    };

    // Actual save version logic after confirmation
    const handleSaveVersionConfirm = async (title: string, description: string) => {
      if (!selectedMessageForVersion) {
        return;
      }

      const commitHash = selectedMessageForVersion.id.split('-').pop();

      if (!commitHash || !isCommitHash(commitHash)) {
        handleChatError('No commit hash found', undefined, 'handleSaveVersion - commit hash validation');
        setIsSaveVersionModalOpen(false);

        return;
      }

      const commitTitle =
        selectedMessageForVersion.parts[0]?.type === 'text'
          ? selectedMessageForVersion.parts[0].text.slice(0, 100)
          : 'Saved version';

      // Close modal first
      setIsSaveVersionModalOpen(false);

      // Show loading toast
      const toastId = toast.loading('Saving version...');

      try {
        const { saveVersion } = await import('~/lib/persistenceGitbase/api.client');
        await saveVersion(repoStore.get().path, commitHash, commitTitle, title || undefined, description || undefined);

        // Trigger version save event
        const { triggerVersionSave } = await import('~/lib/stores/versionEvent');
        triggerVersionSave(commitHash);

        // Dismiss loading toast and show success
        toast.dismiss(toastId);
        toast.success('Version saved successfully');
      } catch (error) {
        // Dismiss loading toast and show error
        toast.dismiss(toastId);
        handleChatError('Failed to save version', error instanceof Error ? error : String(error), 'handleSaveVersion');
      }
    };

    const handleRetry = async (message: UIMessage, prevMessage?: UIMessage) => {
      const startTime = performance.now();

      workbench.currentView.set('code');

      // Use prevMessage if provided, otherwise find the previous message
      let commitHash: string | undefined;

      if (prevMessage && prevMessage.id) {
        commitHash = prevMessage.id.split('-').pop();
      } else {
        const messageIndex = messages.findIndex((m) => m.id === message.id);

        // Check if next message exists
        if (messageIndex >= 0 && messageIndex + 1 < messages.length) {
          const nextCommitHash = messages[messageIndex + 1].id.split('-').pop();

          if (nextCommitHash && isCommitHash(nextCommitHash)) {
            try {
              const { data } = await getCommit(repoStore.get().path, nextCommitHash);

              if (data.commit.parent_ids.length > 0) {
                commitHash = data.commit.parent_ids[0];
              } else {
                reportError('No parent commit found', startTime, {
                  context: 'handleRetry - parent commit check',
                });

                return;
              }
            } catch (error) {
              reportError('Failed to get commit data', startTime, {
                error: error instanceof Error ? error : String(error),
                context: 'handleRetry - getCommit',
              });

              return;
            }
          }
        }
      }

      if (!commitHash || !isCommitHash(commitHash)) {
        reportError('No commit hash found', startTime, {
          context: 'handleRetry - commit hash validation',
        });

        return;
      }

      revertTo(commitHash);
      setInput(stripMetadata(extractTextContent(message)));
    };

    const handleViewDiff = async (message: UIMessage) => {
      const startTime = performance.now();

      try {
        const commitHash = message.id?.split('-').pop();

        if (!commitHash || !isCommitHash(commitHash)) {
          reportError('Invalid commit information', startTime, {
            context: 'handleViewDiff - commit validation',
          });

          return;
        }

        workbench.currentView.set('diff');
        workbench.showWorkbench.set(true);
        workbench.diffEnabled.set(true);
        workbench.diffCommitHash.set(commitHash);
      } catch (error) {
        console.error('Diff view error:', error);
        reportError('Error displaying diff view', startTime, {
          error: error instanceof Error ? error : String(error),
          context: 'handleViewDiff - catch block',
        });
      }
    };

    const isStreaming = isLoading || fakeLoading || loading;

    return (
      <>
        <BaseChat
          ref={animationScope}
          textareaRef={textareaRef}
          input={input}
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={isStreaming}
          onStreamingChange={(streaming) => {
            streamingState.set(streaming);
          }}
          enhancingPrompt={enhancingPrompt}
          promptEnhanced={promptEnhanced}
          enabledTaskMode={enabledTaskMode}
          setEnabledTaskMode={setEnabledTaskMode}
          taskBranches={taskBranches}
          reloadTaskBranches={reloadTaskBranches}
          sendMessage={sendMessage}
          model={model}
          setModel={handleModelChange}
          provider={provider}
          setProvider={handleProviderChange}
          providerList={activeProviders}
          messageRef={messageRef}
          scrollRef={scrollRef}
          handleInputChange={(e) => {
            onTextareaChange(e);
            debouncedCachePrompt(e);
          }}
          handleStop={abort}
          handleRetry={handleRetry}
          handleFork={handleFork}
          handleRevert={handleRevert}
          handleSaveVersion={handleSaveVersionClick}
          savedVersionHashes={savedVersionHashes}
          onViewDiff={handleViewDiff}
          description={description}
          messages={messages.map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            const parsedContent = parsedMessages[i];

            if (parsedContent) {
              return {
                ...message,
                parts: [
                  {
                    type: 'text' as const,
                    text: parsedContent,
                  },
                ],
              } satisfies UIMessage;
            }

            return message;
          })}
          enhancePrompt={() => {
            enhancePrompt(
              input,
              (input) => {
                setInput(input);
                scrollTextArea();
              },
              model,
              provider,
              apiKeys,
            );
          }}
          attachmentList={attachmentList}
          setAttachmentList={setAttachmentList}
          actionAlert={actionAlert}
          clearAlert={() => workbench.clearAlert()}
          data={chatData}
          onProjectZipImport={handleProjectZipImport}
          hasMore={hasMore}
          loadBefore={loadBefore}
          loadingBefore={loadingBefore}
          customProgressAnnotations={customProgressAnnotations}
          isAuthenticated={isAuthenticated}
          onAuthRequired={onAuthRequired}
          textareaExpanded={textareaExpanded}
        />

        {/* Save Version Confirmation Modal */}
        <SaveVersionConfirmModal
          isOpen={isSaveVersionModalOpen}
          onClose={() => setIsSaveVersionModalOpen(false)}
          onConfirm={handleSaveVersionConfirm}
          commitTitle={
            selectedMessageForVersion?.parts[0]?.type === 'text'
              ? selectedMessageForVersion.parts[0].text.slice(0, 100)
              : null
          }
        />
      </>
    );
  },
);
