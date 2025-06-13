import { useStore } from '@nanostores/react';
import { type Message } from 'ai';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST, PROMPT_COOKIE_KEY } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger } from '~/utils/logger';
import { BaseChat, type ChatAttachment } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { useIssueBreakdown } from '~/lib/hooks/useIssueBreakdown';
import { selectStarterTemplate } from '~/utils/selectStarterTemplate';
import type { Template } from '~/types/template';
import type { FileMap } from '~/lib/stores/files';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('IssueBreakdown');

async function fetchTemplateFromAPI(
  template: Template,
  title?: string,
  projectRepo?: string,
): Promise<{
  fileMap: FileMap;
  project?: { id: number; name: string; path: string; description: string };
  commit?: { id: string };
}> {
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
      project?: { id: number; name: string; path: string; description: string };
      commit?: { id: string };
    };

    return result;
  } catch (error) {
    throw error;
  }
}

// Function to retrieve project files from GitLab
async function fetchGitlabProjectFiles(projectPath: string): Promise<FileMap> {
  try {
    if (!projectPath) {
      throw new Error('Project path cannot be empty');
    }

    const params = new URLSearchParams();
    params.append('projectPath', projectPath);

    const response = await fetch(`/api/gitlab/files?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch GitLab files: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      files: FileMap;
      error?: string;
      projectInfo?: {
        id: number;
        name: string;
        path: string;
        description: string;
      };
    };

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch GitLab files');
    }

    return result.files;
  } catch (error) {
    throw error;
  }
}

export function IssueBreakdown() {
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);

  return (
    <>
      <IssueBreakdownImpl
        description="Issue Breakdown"
        initialMessages={initialMessages}
        setInitialMessages={setInitialMessages}
      />
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface IssueBreakdownImplProps {
  initialMessages: Message[];
  setInitialMessages: (messages: Message[]) => void;
  description?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IssueBreakdownImpl = memo(({ description, initialMessages, setInitialMessages }: IssueBreakdownImplProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSendMessageTime = useRef(0);
  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
  const [attachmentList, setAttachmentList] = useState<ChatAttachment[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [fakeLoading, setFakeLoading] = useState(false);
  const files = useStore(workbenchStore.files);
  const actionAlert = useStore(workbenchStore.alert);
  const { promptId, contextOptimizationEnabled } = useSettings();

  const [existingProjectPath, setExistingProjectPath] = useState('');

  const [model, setModel] = useState(() => {
    const savedModel = Cookies.get('SelectedModel');
    return savedModel || DEFAULT_MODEL;
  });
  const [provider, setProvider] = useState<ProviderInfo>(() => {
    const savedProvider = Cookies.get('SelectedProvider');
    return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
  });

  const { showChat } = useStore(chatStore);
  const [animationScope, animate] = useAnimate();

  const requestBody = useMemo(
    () => ({
      files,
      promptId,
      contextOptimization: contextOptimizationEnabled,
      existingProjectPath: existingProjectPath.trim() || undefined,
    }),
    [files, promptId, contextOptimizationEnabled, existingProjectPath],
  );

  const {
    messages,
    isLoading,
    input,
    handleInputChange,
    setInput,
    stop,
    append,
    setMessages,
    error,
    data: issueData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData,
  } = useIssueBreakdown({
    api: '/api/issue',
    body: requestBody,
    initialMessages,
    initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    onError: (e) => {
      logger.error('Request failed\n\n', e, error);
      logStore.logError('Issue breakdown request failed', e, {
        component: 'IssueBreakdown',
        action: 'request',
        error: e.message,
      });
      toast.error(
        'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
      );
      setFakeLoading(false);
    },
    onFinish: async (message) => {
      logStore.logProvider('Issue breakdown response completed', {
        component: 'IssueBreakdown',
        action: 'response',
        model,
        provider: provider.name,
        messageLength: message.content.length,
      });

      setFakeLoading(false);
      logger.debug('Issue breakdown completed');
    },
  });

  useEffect(() => {
    const prompt = searchParams.get('prompt');

    if (prompt) {
      setSearchParams({});
      runAnimation();
      append({
        content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
      });
    }
  }, [model, provider, searchParams]);

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (parseMessages && typeof parseMessages === 'function') {
      parseMessages(messages);
    }
  }, [messages, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    setFakeLoading(false);
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();

    logStore.logProvider('Issue breakdown response aborted', {
      component: 'IssueBreakdown',
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
    if (lastSendMessageTime.current && Date.now() - lastSendMessageTime.current < 1000) {
      return;
    }

    lastSendMessageTime.current = Date.now();

    const messageContent = messageInput || input;

    if (!messageContent?.trim()) {
      return;
    }

    if (isLoading) {
      abort();
      return;
    }

    setFakeLoading(true);
    runAnimation();
    workbenchStore.currentView.set('code');

    try {
      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      chatStore.setKey('aborted', false);

      let templateResponse = null;
      let projectPathToUse = existingProjectPath || '';
      let filesForRequest: FileMap = {};

      if (!chatStarted) {
        try {
          // Select an appropriate template
          const { template, title, projectRepo } = await selectStarterTemplate({
            message: messageContent,
          });

          if (!template) {
            throw new Error('No suitable template found');
          }

          // Get template and create project
          templateResponse = await fetchTemplateFromAPI(template, title, projectRepo).catch((_error: Error) => {
            toast.warning('Failed to create template project\nPlease try again later');
            return null;
          });

          if (!templateResponse?.fileMap || Object.keys(templateResponse.fileMap).length === 0) {
            templateResponse = null;
          } else {
            // Get project path and save it
            const projectPath = templateResponse?.project?.path;

            if (projectPath) {
              projectPathToUse = projectPath;

              // Save project path for subsequent requests
              setExistingProjectPath(projectPath);
            }

            // Use template files for the first request
            filesForRequest = templateResponse.fileMap;
            toast.success(`Project created successfully: ${projectPath || projectRepo}`);
          }
        } catch (_error) {
          // Continue with empty template response
          console.log('Failed to create template project', _error);
        }
      } else if (existingProjectPath) {
        // Subsequent requests: Get latest files from GitLab
        filesForRequest = await fetchGitlabProjectFiles(existingProjectPath).catch((_error) => {
          return {};
        });
      }

      // Prepare API request parameters
      const requestOptions = {
        createGitlabIssues: true, // Always enable GitLab integration
        existingProjectPath: projectPathToUse || undefined,
        projectName: templateResponse?.project?.name || '',
        files: filesForRequest, // Send retrieved files (template files for first request, GitLab files for subsequent ones)
      };

      append(
        {
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
            attachmentList,
          )}]\n\n${messageContent}`,
        },
        requestOptions,
      );

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);
      setAttachmentList([]);
      resetEnhancer();
      textareaRef.current?.blur();
    } catch (error) {
      logger.error('Error sending message:', error);

      if (error instanceof Error) {
        toast.error('Error:' + error?.message);
      }
    }
  };

  const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(event);
  };

  const debouncedCachePrompt = useCallback(
    debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const trimmedValue = event.target.value.trim();
      Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
    }, 1000),
    [],
  );

  const [messageRef, scrollRef] = useSnapScroll();

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    Cookies.set('SelectedModel', newModel, { expires: 1 });
  };

  const handleProviderChange = (newProvider: ProviderInfo) => {
    setProvider(newProvider);
    Cookies.set('SelectedProvider', newProvider.name, { expires: 1 });
  };

  const isStreaming = isLoading || fakeLoading;

  const getSimpleProgressData = useMemo(() => {
    if (!issueData) {
      return [];
    }

    const progressItems = [];

    progressItems.push({
      type: 'progress',
      label: 'total',
      message: `Total Tasks: ${issueData.totalIssues || 0}`,
      status: 'complete',
      order: 1,
    });

    // Add GitLab project information
    if (issueData.gitlab && issueData.gitlab.projectPath) {
      progressItems.push({
        type: 'progress',
        label: 'gitlab',
        message: `GitLab Project: ${issueData.gitlab.projectPath}`,
        status: 'complete',
        order: 2,
      });
    }

    return progressItems;
  }, [issueData]);

  return (
    <div className="flex flex-col h-full">
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
        enabledTaskMode={false}
        setEnabledTaskMode={() => {
          /* Not implemented for IssueBreakdown */
        }}
        taskBranches={[]}
        reloadTaskBranches={() => Promise.resolve([])}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={PROVIDER_LIST as unknown as ProviderInfo[]}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        handleRetry={() => {
          /* Retry not implemented for IssueBreakdown */
        }}
        handleFork={() => {
          /* Fork not implemented for IssueBreakdown */
        }}
        handleRevert={() => {
          /* Revert not implemented for IssueBreakdown */
        }}
        onViewDiff={() => {
          /* Diff view not implemented for IssueBreakdown */
        }}
        description={description}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
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
          );
        }}
        attachmentList={attachmentList}
        setAttachmentList={setAttachmentList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        data={getSimpleProgressData}
        onProjectZipImport={() => {}}
      />
    </div>
  );
});
