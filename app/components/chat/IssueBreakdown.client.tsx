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
import { useNavigate, useMatches } from '@remix-run/react';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { useIssueBreakdown } from '~/lib/hooks/useIssueBreakdown';
import { selectStarterTemplate } from '~/utils/selectStarterTemplate';
import type { Template } from '~/types/template';
import type { FileMap } from '~/lib/stores/files';
import { getProjectCommits } from '~/lib/persistenceGitbase/api.client';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('IssueBreakdown');

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  commitId: string;
  shortId: string;
}

function parseUserMessage(content: string): string {
  const attachmentsMatch = content.match(/\[Attachments:\s*\[.*?\]\]\s*\n\n([\s\S]*)/);

  if (attachmentsMatch) {
    return attachmentsMatch[1].trim();
  }

  const providerMatch = content.match(/\[Provider:\s*.*?\]\s*\n\n([\s\S]*)/);

  if (providerMatch) {
    return providerMatch[1].trim();
  }

  return content.trim();
}

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
  const navigate = useNavigate();

  let projectPathFromLoader: string | undefined;

  try {
    const matches = useMatches();
    const currentMatch = matches.find((match) => match.id === 'routes/issue.$user.$repo');

    projectPathFromLoader = (currentMatch?.data as any)?.projectPath;
  } catch {
    projectPathFromLoader = undefined;
  }

  const [chatStarted, setChatStarted] = useState(() => {
    return initialMessages.length > 0 || !!projectPathFromLoader;
  });
  const [attachmentList, setAttachmentList] = useState<ChatAttachment[]>([]);
  const [fakeLoading, setFakeLoading] = useState(false);
  const files = useStore(workbenchStore.files);
  const actionAlert = useStore(workbenchStore.alert);
  const { promptId, contextOptimizationEnabled } = useSettings();

  const [selectedProject, setSelectedProject] = useState<string | null>(() => {
    return projectPathFromLoader || null;
  });
  const [projectHistory, setProjectHistory] = useState<ChatMessage[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(() => {
    return !!projectPathFromLoader;
  });
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [existingProjectPath, setExistingProjectPath] = useState(() => {
    return projectPathFromLoader || '';
  });

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

  useEffect(() => {
    if (projectPathFromLoader !== selectedProject) {
      setSelectedProject(projectPathFromLoader || null);
      setExistingProjectPath(projectPathFromLoader || '');
      setShowHistoryPanel(!!projectPathFromLoader);

      if (projectPathFromLoader) {
        setChatStarted(true);
      }
    }
  }, [projectPathFromLoader, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectHistory([]);

      return;
    }

    if (!chatStarted && selectedProject && !projectPathFromLoader) {
      return;
    }

    const loadProjectHistory = async () => {
      try {
        setLoadingHistory(true);

        const response = await getProjectCommits(selectedProject, { branch: 'issue' });

        if (response.success) {
          const commitsData = response.data.commits || [];

          const messages: ChatMessage[] = [];

          commitsData.forEach((commit: any) => {
            const userMessageMatch = commit.message.match(/<V8UserMessage>\n([\s\S]*?)\n<\/V8UserMessage>/);
            const assistantMessageMatch = commit.message.match(
              /<V8AssistantMessage>\n([\s\S]*?)\n<\/V8AssistantMessage>/,
            );

            if (userMessageMatch) {
              const rawUserContent = userMessageMatch[1];
              const parsedUserContent = parseUserMessage(rawUserContent);

              messages.push({
                id: `${commit.id}-user`,
                role: 'user',
                content: parsedUserContent,
                timestamp: commit.created_at,
                commitId: commit.id,
                shortId: commit.short_id,
              });

              if (assistantMessageMatch) {
                messages.push({
                  id: `${commit.id}-assistant`,
                  role: 'assistant',
                  content: assistantMessageMatch[1],
                  timestamp: commit.created_at,
                  commitId: commit.id,
                  shortId: commit.short_id,
                });
              }
            }
          });

          messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          setProjectHistory(messages);

          if (messages.length > 0) {
            setChatStarted(true);
          }
        }
      } catch (error) {
        console.error('Failed to load project history:', error);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadProjectHistory();
  }, [selectedProject, chatStarted, projectPathFromLoader]);

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
    onFinish: async (message, response) => {
      logStore.logProvider('Issue breakdown response completed', {
        component: 'IssueBreakdown',
        action: 'response',
        model,
        provider: provider.name,
        messageLength: message.content.length,
      });

      setFakeLoading(false);
      logger.debug('Issue breakdown completed');

      const projectPathFromResponse = response?.data?.gitlab?.projectPath;

      if (!selectedProject && projectPathFromResponse) {
        setProjectHistory([]);
        setSelectedProject(projectPathFromResponse);
        setShowHistoryPanel(true);

        const [user, repo] = projectPathFromResponse.split('/');
        navigate(`/issue/${user}/${repo}`);

        setExistingProjectPath(projectPathFromResponse);
      }

      if (selectedProject || existingProjectPath || projectPathFromResponse) {
        const projectToLoad = selectedProject || existingProjectPath || projectPathFromResponse;

        setTimeout(() => {
          const loadProjectHistory = async () => {
            try {
              const response = await getProjectCommits(projectToLoad!, { branch: 'issue' });

              if (response.success) {
                const commitsData = response.data.commits || [];
                const messages: ChatMessage[] = [];

                commitsData.forEach((commit: any) => {
                  const userMessageMatch = commit.message.match(/<V8UserMessage>\n([\s\S]*?)\n<\/V8UserMessage>/);
                  const assistantMessageMatch = commit.message.match(
                    /<V8AssistantMessage>\n([\s\S]*?)\n<\/V8AssistantMessage>/,
                  );

                  if (userMessageMatch) {
                    const rawUserContent = userMessageMatch[1];
                    const parsedUserContent = parseUserMessage(rawUserContent);

                    messages.push({
                      id: `${commit.id}-user`,
                      role: 'user',
                      content: parsedUserContent,
                      timestamp: commit.created_at,
                      commitId: commit.id,
                      shortId: commit.short_id,
                    });

                    if (assistantMessageMatch) {
                      messages.push({
                        id: `${commit.id}-assistant`,
                        role: 'assistant',
                        content: assistantMessageMatch[1],
                        timestamp: commit.created_at,
                        commitId: commit.id,
                        shortId: commit.short_id,
                      });
                    }
                  }
                });

                messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                setProjectHistory(messages);

                if (messages.length > 0) {
                  setChatStarted(true);
                }
              }
            } catch (error) {
              console.error('Failed to refresh project history:', error);
            }
          };

          loadProjectHistory();
        }, 2000);
      }
    },
  });

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
          const { template, title, projectRepo } = await selectStarterTemplate({
            message: messageContent,
          });

          if (!template) {
            throw new Error('No suitable template found');
          }

          templateResponse = await fetchTemplateFromAPI(template, title, projectRepo).catch((_error: Error) => {
            toast.warning('Failed to create template project\nPlease try again later');
            return null;
          });

          if (!templateResponse?.fileMap || Object.keys(templateResponse.fileMap).length === 0) {
            templateResponse = null;
          } else {
            const projectPath = templateResponse?.project?.path;

            if (projectPath) {
              projectPathToUse = projectPath;
              setExistingProjectPath(projectPath);
            }

            filesForRequest = templateResponse.fileMap;
            toast.success(`Project created successfully: ${projectPath || projectRepo}`);
          }
        } catch (_error) {
          console.log('Failed to create template project', _error);
        }
      } else if (existingProjectPath) {
        filesForRequest = await fetchGitlabProjectFiles(existingProjectPath).catch((_error) => {
          return {};
        });
      }

      const requestOptions = {
        createGitlabIssues: true,
        existingProjectPath: projectPathToUse || undefined,
        projectName: templateResponse?.project?.name || '',
        files: filesForRequest,
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

  const hasHistory = showHistoryPanel && selectedProject;

  const allMessages = useMemo(() => {
    if (!hasHistory) {
      return [];
    }

    if (messages.length > 0 || isStreaming) {
      const currentMessages: ChatMessage[] = messages.map((message, index) => ({
        id: `current-${index}`,
        role: message.role as 'user' | 'assistant',
        content: message.role === 'user' ? parseUserMessage(message.content) : parsedMessages[index] || message.content,
        timestamp: new Date().toISOString(),
        commitId: 'current',
        shortId: 'current',
      }));

      const combined = [...projectHistory];

      currentMessages.forEach((currentMsg) => {
        const isDuplicate = projectHistory.some(
          (historyMsg) =>
            historyMsg.role === currentMsg.role && historyMsg.content.trim() === currentMsg.content.trim(),
        );

        if (!isDuplicate) {
          combined.push(currentMsg);
        }
      });

      return combined.sort((a, b) => {
        if (a.commitId === 'current' && b.commitId !== 'current') {
          return 1;
        }

        if (a.commitId !== 'current' && b.commitId === 'current') {
          return -1;
        }

        if (a.commitId === 'current' && b.commitId === 'current') {
          const aIndex = parseInt(a.id.split('-')[1]);
          const bIndex = parseInt(b.id.split('-')[1]);

          return aIndex - bIndex;
        }

        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    }

    return projectHistory;
  }, [hasHistory, projectHistory, messages, parsedMessages, isStreaming]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        {hasHistory ? (
          <div className="w-[650px] border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-col">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-auto p-4" ref={scrollRef}>
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Loading history...</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`p-3 rounded-lg text-sm ${
                          message.role === 'user'
                            ? 'bg-blue-100 dark:bg-blue-900/30 ml-4'
                            : 'bg-gray-100 dark:bg-gray-800 mr-4'
                        }`}
                        ref={message.id === allMessages[allMessages.length - 1]?.id ? messageRef : undefined}
                      >
                        {message.role === 'user' ? (
                          <div className="text-gray-900 dark:text-white">{message.content}</div>
                        ) : (
                          <div>
                            <div className="text-gray-900 dark:text-white">{message.content}</div>
                          </div>
                        )}
                      </div>
                    ))}
                    {isStreaming && messages.length > 0 && (
                      <div className="p-3 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 mr-4">
                        <div className="text-gray-900 dark:text-white">
                          <div className="flex items-center space-x-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                            <span>Issue generating...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <BaseChat
                ref={animationScope}
                textareaRef={textareaRef}
                input={input}
                showChat={showChat}
                chatStarted={true}
                isStreaming={false}
                onStreamingChange={(streaming) => {
                  streamingState.set(streaming);
                }}
                enhancingPrompt={enhancingPrompt}
                promptEnhanced={promptEnhanced}
                enabledTaskMode={false}
                setEnabledTaskMode={() => {}}
                taskBranches={[]}
                reloadTaskBranches={() => Promise.resolve([])}
                sendMessage={sendMessage}
                model={model}
                setModel={handleModelChange}
                provider={provider}
                setProvider={handleProviderChange}
                providerList={PROVIDER_LIST.map((p) => ({
                  name: p.name,
                  staticModels: p.staticModels,
                  getApiKeyLink: p.getApiKeyLink,
                  labelForGetApiKey: p.labelForGetApiKey,
                  icon: p.icon,
                }))}
                messageRef={messageRef}
                scrollRef={scrollRef}
                handleInputChange={(e) => {
                  onTextareaChange(e);
                  debouncedCachePrompt(e);
                }}
                handleStop={abort}
                handleRetry={() => {}}
                handleFork={() => {}}
                handleRevert={() => {}}
                onViewDiff={() => {}}
                description={description}
                messages={[]}
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
                onProjectZipImport={undefined}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
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
              setEnabledTaskMode={() => {}}
              taskBranches={[]}
              reloadTaskBranches={() => Promise.resolve([])}
              sendMessage={sendMessage}
              model={model}
              setModel={handleModelChange}
              provider={provider}
              setProvider={handleProviderChange}
              providerList={PROVIDER_LIST.map((p) => ({
                name: p.name,
                staticModels: p.staticModels,
                getApiKeyLink: p.getApiKeyLink,
                labelForGetApiKey: p.labelForGetApiKey,
                icon: p.icon,
              }))}
              messageRef={messageRef}
              scrollRef={scrollRef}
              handleInputChange={(e) => {
                onTextareaChange(e);
                debouncedCachePrompt(e);
              }}
              handleStop={abort}
              handleRetry={() => {}}
              handleFork={() => {}}
              handleRevert={() => {}}
              onViewDiff={() => {}}
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
              onProjectZipImport={undefined}
            />
          </div>
        )}

        {hasHistory && (
          <div className="flex-1 bg-white dark:bg-gray-900 flex flex-col">
            <div className="flex-1 overflow-auto p-4">
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
                Issue list from GitLab will be displayed here
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
