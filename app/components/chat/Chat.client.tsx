/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import { type UIMessage, DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import {
  useWorkbenchFiles,
  useWorkbenchActionAlert,
  useWorkbenchStore,
  useWorkbenchContainer,
  useWorkbenchIsDeploying,
} from '~/lib/hooks/useWorkbenchStore';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ERROR_NAMES,
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
import { ServiceOutagePage } from '~/components/ui/ServiceOutagePage';
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
import { extractTextContent } from '~/utils/message';
import { changeChatUrl } from '~/utils/url';
import { get2DStarterPrompt, get3DStarterPrompt } from '~/lib/common/prompts/agent8-prompts';
import { stripMetadata } from './UserMessage';
import type { ProgressAnnotation } from '~/types/context';
import { handleChatError, type HandleChatErrorOptions } from '~/utils/errorNotification';
import { getElapsedTime } from '~/utils/performance';
import ToastContainer from '~/components/ui/ToastContainer';
import type { WorkbenchStore } from '~/lib/stores/workbench';
import type { ServerErrorData } from '~/types/stream-events';
import { getEnvContent } from '~/utils/envUtils';
import { V8_ACCESS_TOKEN_KEY, verifyV8AccessToken } from '~/lib/verse8/userAuth';
import { logManager } from '~/lib/debug/LogManager';
import { FetchError, getErrorStatus, isAbortError } from '~/utils/errors';

const logger = createScopedLogger('Chat');

const MAX_COMMIT_RETRIES = 2;
const WORKBENCH_CONNECTION_TIMEOUT_MS = 10000;
const WORKBENCH_INIT_DELAY_MS = 100; // 100ms is an empirically determined value that is sufficient for asynchronous initialization tasks to complete, while minimizing unnecessary delays
const WORKBENCH_MESSAGE_IDLE_TIMEOUT_MS = 35000;

let prevDebugLog: string | null = null;
let duplicatedDebugCount: number = 1;

function clearDebugLog(): void {
  logManager.clear();
  prevDebugLog = null;
  duplicatedDebugCount = 1;
}

function addDebugLog(value: string): void {
  let log = value;

  if (prevDebugLog === value) {
    duplicatedDebugCount++;
    log = `x${duplicatedDebugCount}`;
  } else {
    prevDebugLog = value;
    duplicatedDebugCount = 1;
  }

  logManager.add(log);
}

function isServerError(data: unknown): data is ServerErrorData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'error' && 'message' in data;
}

/**
 * Checks if the error requires showing a full error page (401/404).
 * @returns true if error page should be shown, false otherwise
 */
function shouldShowErrorPage(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 401 || status === 404;
}

async function fetchTemplateFromAPI(template: Template, title?: string, projectRepo?: string, signal?: AbortSignal) {
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

    const response = await fetch(`/api/select-template?${params.toString()}`, { signal });

    if (!response.ok) {
      const serverMessage = await response.text();
      throw new FetchError((serverMessage ?? 'unknown error').trim(), response.status, 'import_starter_template');
    }

    const result = (await response.json()) as {
      fileMap: FileMap;
      project: { id: number; name: string; path: string; description: string };
      commit: { id: number };
    };

    return result;
  } catch (error) {
    if (isAbortError(error)) {
      logger.info('Template fetch aborted by user');
    } else {
      logger.error('Error fetching template from API:', error);
    }

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
    error: gitbaseError,
  } = useGitbaseChatHistory();

  const [componentError, setComponentError] = useState<{
    message: string;
    status?: number;
    context?: string;
  } | null>(null);

  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const title = repoStore.get().title;
  const workbench = useWorkbenchStore();
  const actionAlert = useWorkbenchActionAlert();

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

  const error = componentError || gitbaseError;
  const errorStatus = getErrorStatus(error);

  // Check for 404 error (project not found or access denied)
  if (errorStatus === 404) {
    return <NotFoundPage />;
  }

  // Check for 401 error (unauthorized)
  if (errorStatus === 401) {
    return <UnauthorizedPage />;
  }

  // Check for 503 error (service unavailable) from container initialization
  const is503Error = (() => {
    if (!actionAlert?.description?.includes('Machine API request failed')) {
      return false;
    }

    const parts = actionAlert.description.split(':');
    const lastPart = parts[parts.length - 1]?.trim();

    return lastPart === '503';
  })();

  if (is503Error) {
    return <ServiceOutagePage />;
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
          setComponentError={setComponentError}
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
  setComponentError: (error: { message: string; status?: number; context?: string } | null) => void;
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
    setComponentError,
  }: ChatProps) => {
    useShortcuts();

    const workbench = useWorkbenchStore();
    const container = useWorkbenchContainer();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const chatRequestStartTimeRef = useRef<number>(undefined);
    const lastUserPromptRef = useRef<string>(undefined);
    const isPageUnloadingRef = useRef<boolean>(false);
    const sendMessageAbortControllerRef = useRef<AbortController | null>(null);

    /*
     * Processes errors and routes them appropriately.
     * For errors requiring full error page (401 Unauthorized, 404 Not Found),
     * redirects to UnauthorizedPage or NotFoundPage.
     * For other errors, reports via Toast and Slack.
     */
    const processError = (
      message: string,
      startTime: number,
      options?: Partial<Omit<HandleChatErrorOptions, 'elapsedTime'>>,
    ) => {
      if (shouldShowErrorPage(options?.error)) {
        const status = getErrorStatus(options?.error) || 400;

        logger.warn(`Error requires full page redirect (${status}) - showing error page`);

        setComponentError({
          message: options?.error instanceof Error ? options.error.message : message,
          status,
          context: options?.context || 'unknown',
        });

        return;
      }

      const processlog = logManager.logs.join(',');

      // Other errors: handle within component
      handleChatError(message, {
        prompt: lastUserPromptRef.current,
        ...options,
        elapsedTime: getElapsedTime(startTime),
        process: options?.process ?? processlog,
      });

      return;
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
    const isDeploying = useWorkbenchIsDeploying();
    const isDeployingRef = useRef(isDeploying);
    useEffect(() => {
      isDeployingRef.current = isDeploying;
    }, [isDeploying]);

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
    const chatStateRef = useRef({ model, provider });

    useEffect(() => {
      bodyRef.current = { apiKeys, files, promptId, contextOptimization: contextOptimizationEnabled };
    }, [apiKeys, files, promptId, contextOptimizationEnabled]);

    useEffect(() => {
      chatStateRef.current = { model, provider };
    }, [model, provider]);

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

        // Custom fetch to preserve HTTP status codes in errors
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fetch(input, init);

          // If response is not ok, throw error with status code
          if (!response.ok) {
            const serverMessage = await response.text();
            throw new FetchError((serverMessage ?? 'unknown error').trim(), response.status);
          }

          return response;
        },
      }),
      onData: (data) => {
        // Ignore empty data
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
          return;
        }

        // Extract the inner 'data' property if it exists
        const extractedData = data.data || data;

        // Handle data-log (server-side logs)
        if (data.type === 'data-log') {
          if (extractedData && typeof extractedData === 'object' && 'message' in extractedData) {
            addDebugLog(`data:${(extractedData as { message: string }).message}`);
          }

          return;
        }

        // Handle server-side errors (data-error with reason and message)
        if (data.type === 'data-error' && isServerError(extractedData)) {
          processError(extractedData.reason, chatRequestStartTimeRef.current ?? 0, {
            error: extractedData.message,
            context: `useChat onData callback, model: ${model}, provider: ${provider.name}`,
            prompt: lastUserPromptRef.current,
            metadata: extractedData.metadata,
          });

          return;
        }

        // Keep only the latest data of each type to prevent memory bloat
        setChatData((prev) => {
          const hasType = (obj: any): obj is { type: string } => obj && typeof obj === 'object' && 'type' in obj;
          const extractedType = hasType(extractedData) ? extractedData.type : null;
          const filtered = prev.filter((item) => !hasType(item) || item.type !== extractedType);

          return [...filtered, extractedData];
        });
      },
      onError: (e) => {
        if (isPageUnloadingRef.current) {
          logger.debug('Skipping error notification, page is unloading');
          return;
        }

        setFakeLoading(false);

        logger.error('Request failed\n\n', e, error);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: e.message,
        });

        const currentModel = chatStateRef.current.model;
        const currentProvider = chatStateRef.current.provider;
        const reportProvider = currentModel === 'auto' ? 'auto' : currentProvider.name;

        processError(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
          chatRequestStartTimeRef.current ?? 0,
          {
            error: e,
            context: 'useChat onError callback, model: ' + currentModel + ', provider: ' + reportProvider,
            prompt: lastUserPromptRef.current,
          },
        );

        if (shouldShowErrorPage(e)) {
          return;
        }
      },

      onFinish: async ({ message }) => {
        if (isDeployingRef.current) {
          addDebugLog('onFinish: isDeploying, skipping');
          return;
        }

        addDebugLog('onFinish');

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
          addDebugLog('onMessageClose');
          addDebugLog('Start:runAndPreview');
          await runAndPreview(message);
          addDebugLog('Complete:runAndPreview');
          await new Promise((resolve) => setTimeout(resolve, 1000));
          addDebugLog('Start:handleCommit');
          await handleCommit(message);
          addDebugLog('Complete:handleCommit');
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

    // Detect page reload/unload and abort in-progress operations
    useEffect(() => {
      const handleBeforeUnload = () => {
        isPageUnloadingRef.current = true;

        // Abort all in-progress operations (sendMessage, streaming, workbench actions)
        abortAllOperations();
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }, []);

    // Refs to hold latest function references for cleanup
    const stopRef = useRef(stop);
    const workbenchRef = useRef(workbench);

    useEffect(() => {
      stopRef.current = stop;
      workbenchRef.current = workbench;
    }, [stop, workbench]);

    /**
     * Aborts all in-progress operations (first chat preparation, streaming, workbench actions).
     * Used by both user-initiated abort and component unmount cleanup.
     */
    const abortAllOperations = () => {
      if (sendMessageAbortControllerRef.current) {
        sendMessageAbortControllerRef.current.abort();
        sendMessageAbortControllerRef.current = null;
      }

      stopRef.current();
      workbenchRef.current.abortAllActions();
    };

    /*
     * Cleanup on unmount - abort all in-progress operations
     * useEffect(() => {
     *   return () => {
     *     abortAllOperations();
     *   };
     * }, []);
     */

    // Stop chat when deploy starts
    useEffect(() => {
      if (isDeploying && (isLoading || fakeLoading)) {
        logger.info('Stop chat when deploy starts');
        abort();
      }
    }, [isDeploying, fakeLoading]);

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
        const startTime = performance.now();
        setInstallNpm(true);

        const boltShell = workbench.boltTerminal;
        boltShell.ready
          .then(async () => {
            await workbench.setupDeployConfig(boltShell);
          })
          .catch((error) => {
            processError(error instanceof Error ? error.message : 'Failed to setup deploy config', startTime, {
              error: error instanceof Error ? error : String(error),
              context: 'setupDeployConfig - useEffect',
            });
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
        processError(`Code commit failed`, startTime, {
          error: lastError instanceof Error ? lastError : String(lastError),
          context: 'handleCommit',
        });

        return;
      }
    };

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      abortAllOperations();

      setFakeLoading(false);
      setChatData([]);
      chatStore.setKey('aborted', true);

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    /**
     * Resets the first chat state when the first prompt is aborted.
     * Clears files, workbench, chat store, and repo store.
     */
    const resetFirstChatState = () => {
      setChatStarted(false);
      workbenchRef.current.resetFiles();
      workbenchRef.current.showWorkbench.set(false);
      chatStore.setKey('started', false);
      repoStore.set({
        name: '',
        path: '',
        title: '',
        taskBranch: DEFAULT_TASK_BRANCH,
      });
    };

    /**
     * Initializes the first chat session with template selection and project setup.
     * This function can be aborted via AbortSignal.
     */
    const prepareFirstChat = async (
      messageContent: string,
      currentAttachmentList: ChatAttachment[],
      signal: AbortSignal,
    ): Promise<void> => {
      const checkAborted = () => {
        if (signal.aborted) {
          throw new DOMException('First chat initialization aborted', ERROR_NAMES.ABORT);
        }
      };

      const templateSelectionStartTime = performance.now();

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

      checkAborted();
      addDebugLog('Start:selectStarterTemplate');

      const { template, title, projectRepo } = await selectStarterTemplate({
        message: messageContent,
        signal,
      });

      addDebugLog('Complete:selectStarterTemplate');
      checkAborted();

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

      checkAborted();
      addDebugLog('Start:fetchTemplateFromAPI');

      const temResp = await fetchTemplateFromAPI(template!, title, projectRepo, signal).catch((e) => {
        checkAborted();

        if (shouldShowErrorPage(e)) {
          throw e;
        }

        if (e.message.includes('rate limit')) {
          toast.warning('Rate limit exceeded. Skipping starter template\nRetry again after a few minutes.');
        } else {
          toast.warning('Failed to import starter template\nRetry again after a few minutes.');
        }
      });

      addDebugLog('Complete:fetchTemplateFromAPI');
      checkAborted();

      const projectPath = temResp?.project?.path;
      const projectName = temResp?.project?.name;
      const templateCommitId = temResp?.commit?.id;
      workbench.showWorkbench.set(true);

      if (!temResp?.fileMap || Object.keys(temResp.fileMap).length === 0) {
        addDebugLog('Not Found Template Data');
        throw new Error('Not Found Template Data');
      }

      // Inject .env into fileMap so Agent can read it in the first response
      const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY);

      if (accessToken) {
        try {
          checkAborted();
          addDebugLog('Start:verifyV8AccessToken');

          const user = await verifyV8AccessToken(import.meta.env.VITE_V8_API_ENDPOINT, accessToken, signal);

          addDebugLog('Complete:verifyV8AccessToken');
          checkAborted();

          if (user.isActivated && user.walletAddress) {
            temResp.fileMap['.env'] = {
              type: 'file',
              content: getEnvContent(user.walletAddress),
              isBinary: false,
            };
          }
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          if (getErrorStatus(error) === 401) {
            logger.error('Authentication failed during .env generation:', error);
            throw error;
          }

          logger.warn('Failed to generate .env for first message:', error);
          addDebugLog('Failed to generate .env for first message');
        }
      }

      checkAborted();

      const processedFileMap = Object.entries(temResp.fileMap).reduce(
        (acc, [key, value]) => {
          acc[WORK_DIR + '/' + key] = value;
          return acc;
        },
        {} as Record<string, any>,
      );
      workbench.files.set(processedFileMap);

      checkAborted();

      const containerInstance = await workbench.container;

      checkAborted();
      await containerInstance.mount(convertFileMapToFileSystemTree(processedFileMap));

      checkAborted();

      if (isEnabledGitbasePersistence) {
        if (!projectPath || !projectName || !templateCommitId) {
          throw new Error('Cannot create project');
        }

        let branchName = 'develop';

        if (enabledTaskMode) {
          checkAborted();
          addDebugLog('Start:createTaskBranch');

          const { success, message, data } = await createTaskBranch(projectPath, signal);
          addDebugLog('Complete:createTaskBranch');
          checkAborted();

          if (!success) {
            addDebugLog('Failed to create task branch');
            processError(message, templateSelectionStartTime, {
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
          addDebugLog('Failed to record prompt activity - projectPath');
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
          addDebugLog('Failed to record prompt activity - projectRepo');
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
      checkAborted();

      setMessages([
        {
          id: `1-${new Date().getTime()}`,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `[Model: ${firstChatModel.model}]\n\n[Provider: ${firstChatModel.provider.name}]\n\n[Attachments: ${JSON.stringify(
                currentAttachmentList,
              )}]\n\n${messageContent}\n<think>${starterPrompt}</think>`,
            },
          ],
        },
      ]);
      checkAborted();

      regenerate();

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      sendEventToParent('EVENT', { name: 'START_EDITING' });

      setAttachmentList([]);
      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Recovers files when chatStarted is true but files are empty.
     * This is a defensive measure for edge cases like page refresh or container restart.
     * Returns true if recovery successful, false otherwise.
     */
    const recoverFiles = async (signal: AbortSignal): Promise<boolean> => {
      const checkAborted = () => {
        if (signal.aborted) {
          throw new DOMException('File recovery aborted', ERROR_NAMES.ABORT);
        }
      };

      const containerInstance = await workbench.container;
      checkAborted();

      const fileRecoveryStrategies = [
        {
          name: 'Workbench',
          getFiles: () => workbench.files.get(),
        },
        {
          name: 'Gitbase',
          getFiles: async () => {
            const projectPath = repoStore.get().path;

            if (projectPath) {
              return await fetchProjectFiles(projectPath);
            }

            return {};
          },
        },
      ];

      for (const strategy of fileRecoveryStrategies) {
        try {
          checkAborted();

          const files = await strategy.getFiles();
          checkAborted();

          if (Object.keys(files).length > 0) {
            checkAborted();
            await containerInstance.mount(convertFileMapToFileSystemTree(files));
            checkAborted();

            return true;
          }
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
        }
      }

      return false;
    };

    /**
     * Generates descriptions for image attachments using AI.
     * Updates the attachment objects with features and details.
     */
    const generateImageDescriptions = async (
      messageContent: string,
      imageAttachments: ChatAttachment[],
      signal: AbortSignal,
    ): Promise<void> => {
      const checkAborted = () => {
        if (signal.aborted) {
          throw new DOMException('Image description generation aborted', ERROR_NAMES.ABORT);
        }
      };

      const urls = imageAttachments.map((item) => item.url);
      const descriptionResponse = await fetch('/api/image-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: messageContent,
          imageUrls: urls,
        }),
        signal,
      });
      checkAborted();

      if (!descriptionResponse.ok) {
        const serverMessage = await descriptionResponse.text();
        checkAborted();

        throw new FetchError(
          (serverMessage ?? 'unknown error').trim(),
          descriptionResponse.status,
          'generate_image_description',
        );
      }

      const descriptions = await descriptionResponse.json();
      checkAborted();

      if (Array.isArray(descriptions) && imageAttachments.length === descriptions.length) {
        for (let i = 0; i < imageAttachments.length; i++) {
          imageAttachments[i].features = descriptions[i].features;
          imageAttachments[i].details = descriptions[i].details;
        }
      }
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
      // Clear logs from previous request
      clearDebugLog();
      addDebugLog('sendMessage');

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
        sendMessageAbortControllerRef.current = new AbortController();

        const fileRecoveryStartTime = performance.now();

        try {
          const recovered = await recoverFiles(sendMessageAbortControllerRef.current.signal);

          if (!recovered) {
            processError('Files are not loaded. Please try again later.', fileRecoveryStartTime, {
              context: 'sendMessage - files check',
            });

            return;
          }
        } catch (error) {
          if (isAbortError(error)) {
            logger.info('File recovery aborted by user');
            return;
          }

          throw error;
        } finally {
          sendMessageAbortControllerRef.current = null;
        }
      }

      if (isLoading) {
        abort();
        return;
      }

      setFakeLoading(true);
      runAnimation();
      workbench.currentView.set('code');

      const wasFirstChat = !chatStarted;
      const startTime = performance.now();
      sendMessageAbortControllerRef.current = new AbortController();

      try {
        // Generate image descriptions if needed
        const imageAttachments = attachmentList.filter((item) =>
          ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(item.ext),
        );

        if (imageAttachments.length > 0) {
          try {
            addDebugLog('Start:generateImageDescriptions');
            await generateImageDescriptions(
              messageContent,
              imageAttachments,
              sendMessageAbortControllerRef.current.signal,
            );
            addDebugLog('Complete:generateImageDescriptions');
          } catch (descError) {
            addDebugLog('Fail:generateImageDescriptions');

            // AbortError should propagate to outer catch
            if (isAbortError(descError)) {
              throw descError;
            }

            // shouldShowErrorPage errors should propagate to outer catch (will be handled there)
            if (shouldShowErrorPage(descError)) {
              throw descError;
            }

            // Non-critical errors only: log and continue with default
            processError(
              descError instanceof Error ? descError.message : 'Image description failed',
              chatRequestStartTimeRef.current ?? 0,
              {
                error: descError instanceof Error ? descError : String(descError),
                context: 'image-description API',
                skipToast: true,
              },
            );
            toast.warning('Could not generate image description, using default');
          }
        }

        if (wasFirstChat) {
          addDebugLog('Start:prepareFirstChat');
          await prepareFirstChat(messageContent, attachmentList, sendMessageAbortControllerRef.current.signal);
          addDebugLog('Complete:prepareFirstChat');

          return;
        }

        // Record prompt activity for subsequent requests
        if (repoStore.get().path) {
          sendActivityPrompt(repoStore.get().path);
        }

        if (error != null) {
          setMessages(messages.slice(0, -1));
        }

        chatStore.setKey('aborted', false);

        if (repoStore.get().path) {
          addDebugLog('Start:commitModifiedFiles');

          const commit = await workbench.commitModifiedFiles(sendMessageAbortControllerRef.current.signal);
          addDebugLog('Complete:commitModifiedFiles');

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
            addDebugLog('Start:createTaskBranch');

            const { success, message, data } = await createTaskBranch(
              repoStore.get().path,
              sendMessageAbortControllerRef.current.signal,
            );
            addDebugLog('Complete:createTaskBranch');

            if (!success) {
              processError(message, createTaskBranchStartTime, {
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
        addDebugLog('Start:sendChatMessage');
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
        addDebugLog('Complete:sendChatMessage');
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setAttachmentList([]);

        resetEnhancer();

        textareaRef.current?.blur();
      } catch (error) {
        addDebugLog('Fail:sendMessage');

        // Clean up on any error
        setCustomProgressAnnotations([]);
        setFakeLoading(false);

        // Reset first chat state for any error
        if (wasFirstChat) {
          resetFirstChatState();
        }

        // AbortError is a normal cancellation - handle gracefully
        if (isAbortError(error)) {
          logger.info('Send message aborted by user');
          return;
        }

        logger.error('Error in sendMessage:', error);

        const errorObj = error instanceof Error ? error : String(error);
        const context = wasFirstChat ? 'starter template selection' : 'sendMessage function';

        let displayMessage: string;
        let toastType: 'error' | 'warning' = 'error';

        if (wasFirstChat) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to import starter template';
          const isMeaningful =
            errorMessage.trim() && errorMessage !== 'Not Found Template' && errorMessage !== 'Not Found Template Data';

          displayMessage = isMeaningful
            ? errorMessage
            : 'Failed to import starter template\nRetry again after a few minutes.';

          if (!isMeaningful) {
            toastType = 'warning';
          }
        } else {
          displayMessage = 'Error:' + (error instanceof Error ? error.message : String(error));
        }

        processError(displayMessage, startTime, {
          error: errorObj,
          context,
          toastType,
        });
      } finally {
        sendMessageAbortControllerRef.current = null;
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
        processError(`Failed to import ${source.type === 'github' ? 'repository' : 'project'}`, startTime, {
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
        processError('No commit hash found', startTime, {
          context: 'handleFork - commit hash validation',
        });

        return;
      }

      const nameWords = repoStore
        .get()
        .name.split(/[^a-zA-Z0-9]+/)
        .filter((word) => word.length > 0);
      const lastWord = nameWords[nameWords.length - 1];
      const cleanWords = Number.isInteger(Number(lastWord)) ? nameWords.slice(0, -1) : nameWords;
      const newRepoName = (cleanWords.length > 0 ? cleanWords.join('-') : 'project').toLowerCase();

      const toastId = toast.loading('Forking project...');

      try {
        const forkedProject = await forkProject(repoStore.get().path, newRepoName, commitHash, repoStore.get().title);

        // Dismiss the loading toast
        toast.dismiss(toastId);

        if (forkedProject && forkedProject.success) {
          toast.success('Forked project successfully');
          window.location.href = '/chat/' + forkedProject.project.path;
        } else {
          processError('Failed to fork project', startTime, {
            context: 'handleFork - fork result check',
          });

          return;
        }
      } catch (error) {
        // Dismiss the loading toast and show error
        toast.dismiss(toastId);

        processError('Failed to fork project', startTime, {
          error: error instanceof Error ? error : String(error),
          context: 'handleFork - catch block',
        });

        return;
      }
    };

    const handleRevert = async (message: UIMessage) => {
      const startTime = performance.now();

      workbench.currentView.set('code');
      await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

      const commitHash = message.id.split('-').pop();

      if (!commitHash || !isCommitHash(commitHash)) {
        processError('No commit hash found', startTime, {
          context: 'handleRevert - commit hash validation',
        });

        return;
      }

      revertTo(commitHash);
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
                processError('No parent commit found', startTime, {
                  context: 'handleRetry - parent commit check',
                });

                return;
              }
            } catch (error) {
              processError('Failed to get commit data', startTime, {
                error: error instanceof Error ? error : String(error),
                context: 'handleRetry - getCommit',
              });

              return;
            }
          }
        }
      }

      if (!commitHash || !isCommitHash(commitHash)) {
        processError('No commit hash found', startTime, {
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
          processError('Invalid commit information', startTime, {
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

        processError('Error displaying diff view', startTime, {
          error: error instanceof Error ? error : String(error),
          context: 'handleViewDiff - catch block',
        });

        return;
      }
    };

    const isStreaming = isLoading || fakeLoading || loading;

    return (
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
    );
  },
);
