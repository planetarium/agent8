/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import { type Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat, type ChatAttachment } from './BaseChat';
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
import {
  commitChanges,
  fetchProjectFiles,
  forkProject,
  isEnabledGitbasePersistence,
} from '~/lib/persistenceGitbase/api.client';
import { webcontainer } from '~/lib/webcontainer';
import { repoStore } from '~/lib/stores/repo';
import type { FileMap } from '~/lib/.server/llm/constants';
import { useGitbaseChatHistory } from '~/lib/persistenceGitbase/useGitbaseChatHistory';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { extractTextContent } from '~/utils/message';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

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
      data: { assistantMessage: string; userMessage: string };
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

export function Chat() {
  renderLogger.trace('Chat');

  const { loaded, chats, files, project } = useGitbaseChatHistory();
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const title = repoStore.get().title;

  useEffect(() => {
    if (initialMessages.length > 0) {
      workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
    }

    if (loaded) {
      setReady(true);
    }
  }, [initialMessages, loaded]);

  useEffect(() => {
    if (loaded) {
      if (chats.length > 0) {
        setInitialMessages(chats);
        webcontainer.then(async (wc) => {
          wc.mount(convertFileMapToFileSystemTree(files));
        });
        workbenchStore.showWorkbench.set(true);
      }

      if (project.description) {
        repoStore.set({
          ...repoStore.get(),
          title: project.description.split('\n')[0],
        });
      }
    }
  }, [loaded, files, chats, project]);

  return (
    <>
      {ready && (
        <ChatImpl description={title} initialMessages={initialMessages} setInitialMessages={setInitialMessages} />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
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

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
  }) => {
    const { messages, isLoading, parseMessages } = options;
    parseMessages(messages, isLoading);
  },
  50,
);

async function runAndPreview(message: Message) {
  workbenchStore.clearAlert();

  const content = extractTextContent(message);

  const isServerUpdated = /<boltAction[^>]*filePath="server.js"[^>]*>/g.test(content);
  const isPackageJsonUpdated = /<boltAction[^>]*filePath="package.json"[^>]*>/g.test(content);

  const previews = workbenchStore.previews.get();

  if (
    !isServerUpdated &&
    !isPackageJsonUpdated &&
    previews.length > 0 &&
    previews.find((p) => p.ready && p.port === 5173)
  ) {
    workbenchStore.currentView.set('preview');
    return;
  }

  const shell = workbenchStore.boltTerminal;
  await shell.ready();

  for (let retry = 0; retry < 60; retry++) {
    const state = await shell.executionState.get();

    if (state?.active) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    await shell.executeCommand(Date.now().toString(), 'npm install && npx -y @agent8/deploy && npm run dev');
    break;
  }
}

interface ChatProps {
  initialMessages: Message[];
  setInitialMessages: (messages: Message[]) => void;
  description?: string;
}

export const ChatImpl = memo(({ description, initialMessages, setInitialMessages }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
  const [attachmentList, setAttachmentList] = useState<ChatAttachment[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [fakeLoading, setFakeLoading] = useState(false);
  const files = useStore(workbenchStore.files);
  const actionAlert = useStore(workbenchStore.alert);
  const { activeProviders, promptId, contextOptimizationEnabled } = useSettings();

  const [model, setModel] = useState(() => {
    const savedModel = Cookies.get('selectedModel');
    return savedModel || DEFAULT_MODEL;
  });
  const [provider, setProvider] = useState(() => {
    const savedProvider = Cookies.get('selectedProvider');
    return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
  });

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  const {
    messages,
    isLoading,
    input,
    handleInputChange,
    setInput,
    stop,
    append,
    setMessages,
    reload,
    error,
    data: chatData,
    setData,
  } = useChat({
    api: '/api/chat',
    body: {
      apiKeys,
      files,
      promptId,
      contextOptimization: contextOptimizationEnabled,
    },
    sendExtraMessageFields: true,
    onError: (e) => {
      logger.error('Request failed\n\n', e, error);
      logStore.logError('Chat request failed', e, {
        component: 'Chat',
        action: 'request',
        error: e.message,
      });
      toast.error(
        'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
      );
      setFakeLoading(false);
    },
    onFinish: async (message, response) => {
      const usage = response.usage;
      setData(undefined);

      if (usage) {
        logStore.logProvider('Chat response completed', {
          component: 'Chat',
          action: 'response',
          model,
          provider: provider.name,
          usage,
          messageLength: message.content.length,
        });
      }

      setFakeLoading(false);
      await Promise.all([runAndPreview(message), handleCommit(message)]);

      logger.debug('Finished streaming');
    },
    initialMessages,
    initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
  });
  useEffect(() => {
    const prompt = searchParams.get('prompt');

    if (prompt) {
      setSearchParams({});
      runAnimation();
      append({
        role: 'user',
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
    processSampledMessages({
      messages,
      isLoading,
      parseMessages,
    });
  }, [messages, isLoading, parseMessages]);

  const handleCommit = async (message: Message) => {
    if (!isEnabledGitbasePersistence) {
      return;
    }

    try {
      await commitChanges(message, (commitHash) => {
        workbenchStore.setReloadedMessages([...messages.map((m) => m.id), commitHash]);
        setMessages((prev: Message[]) =>
          prev.map((m: Message) => {
            if (m.id === message.id) {
              return {
                ...m,
                id: commitHash,
              };
            }

            return m;
          }),
        );
      });
    } catch (e) {
      toast.error('The code commit has failed. You can download the code and restore it.');
      console.log(e);
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
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();

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
      try {
        const { template, title, projectRepo } = await selectStarterTemplate({
          message: messageContent,
          model,
          provider,
        });

        if (!template) {
          throw new Error('Not Found Template');
        }

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

        if (isEnabledGitbasePersistence) {
          if (!projectPath || !projectName || !templateCommitId) {
            throw new Error('Cannot create project');
          }

          repoStore.set({
            name: projectName,
            path: projectPath,
            title,
          });

          window.history.replaceState(null, '', '/chat/' + projectPath);
        } else {
          repoStore.set({
            name: projectRepo,
            path: projectRepo,
            title,
          });
          window.history.replaceState(null, '', '/chat/' + projectRepo);
        }

        if (!temResp?.data) {
          throw new Error('Not Found Template Data');
        }

        const { assistantMessage, userMessage } = temResp.data;

        setMessages([
          {
            id: `1-${new Date().getTime()}`,
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
            annotations: ['hidden'],
          },
          {
            id: `assistant-${templateCommitId || new Date().getTime()}`,
            role: 'assistant',
            content: assistantMessage,
          },
          {
            id: `3-${new Date().getTime()}`,
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
              attachmentList,
            )}]\n\n${messageContent}`,
          },
        ]);

        setTimeout(() => {
          // wait for the files to be loaded
          reload();
        }, 1000);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        sendEventToParent('EVENT', { name: 'START_EDITING' });

        setAttachmentList([]);

        resetEnhancer();

        textareaRef.current?.blur();
        setFakeLoading(false);

        return;
      } catch (error) {
        toast.warning(
          `${error instanceof Error ? error.message : 'Failed to import starter template'}\nRetry again after a few minutes.`,
        );
        setChatStarted(false);
        setFakeLoading(false);

        return;
      }
    }

    try {
      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      chatStore.setKey('aborted', false);

      const commit = await workbenchStore.commitModifiedFiles();

      if (commit) {
        setMessages((prev: Message[]) => [
          ...prev,
          {
            id: commit.id,
            role: 'assistant',
            content: commit.message || 'The user changed the files.',
            parts: [],
          },
        ]);
      }

      append({
        role: 'user',
        content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
          attachmentList,
        )}]\n\n${messageContent}`,
      });

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

  /**
   * Handles the change event for the textarea and updates the input state.
   * @param event - The change event from the textarea.
   */
  const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(event);
  };

  /**
   * Debounced function to cache the prompt in cookies.
   * Caches the trimmed value of the textarea input after a delay to optimize performance.
   */
  const debouncedCachePrompt = useCallback(
    debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const trimmedValue = event.target.value.trim();
      Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
    }, 1000),
    [],
  );

  const [messageRef, scrollRef] = useSnapScroll();

  useEffect(() => {
    const storedApiKeys = Cookies.get('apiKeys');

    if (storedApiKeys) {
      setApiKeys(JSON.parse(storedApiKeys));
    }
  }, []);

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    Cookies.set('selectedModel', newModel, { expires: 30 });
  };

  const handleProviderChange = (newProvider: ProviderInfo) => {
    setProvider(newProvider);
    Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
  };

  const handleTemplateImport = async (
    source: { type: 'github' | 'zip'; title: string },
    files: FileMap,
    templateData: { assistantMessage: string; userMessage: string },
  ) => {
    try {
      setFakeLoading(true);

      const toastId = toast.loading(
        `Importing ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}...`,
      );

      // 템플릿 데이터 가져오기
      const { assistantMessage, userMessage } = templateData;
      toast.done(toastId);

      const messages = [
        {
          id: `1-${new Date().getTime()}`,
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Attachments: ${JSON.stringify(
            attachmentList,
          )}]\n\nI want to import the following files from the ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}`,
        },
        {
          id: `2-${new Date().getTime()}`,
          role: 'assistant',
          content: assistantMessage,
        },
        {
          id: `3-${new Date().getTime()}`,
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
          annotations: ['hidden'],
        },
      ] as Message[];

      setInitialMessages(messages);
      webcontainer.then(async (wc) => {
        wc.mount(convertFileMapToFileSystemTree(files));
      });
      setChatStarted(true);
      workbenchStore.showWorkbench.set(true);
      reload();
      sendEventToParent('EVENT', { name: 'START_EDITING' });

      toast.success(`Successfully imported ${source.type === 'github' ? 'repository' : 'project'}: ${source.title}`);
    } catch (error) {
      logger.error(`Error importing ${source.type === 'github' ? 'repository' : 'project'}:`, error);
      toast.error(`Failed to import ${source.type === 'github' ? 'repository' : 'project'}`);
    } finally {
      setFakeLoading(false);
    }
  };

  const handleProjectZipImport = async (title: string, zipFile: File) => {
    const { fileMap, messages } = await getZipTemplates(zipFile, title);
    await handleTemplateImport({ type: 'zip', title }, fileMap, messages);
  };

  const handleFork = async (message: Message) => {
    workbenchStore.currentView.set('code');
    await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

    const commitHash = message.id.split('-').pop();

    if (!commitHash || !isCommitHash(commitHash)) {
      toast.error('No commit hash found');
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
        toast.error('Failed to fork project');
      }
    } catch (error) {
      // Dismiss the loading toast and show error
      toast.dismiss(toastId);
      toast.error('Failed to fork project');
      logger.error('Error forking project:', error);
    }
  };

  const handleRevert = async (message: Message) => {
    workbenchStore.currentView.set('code');
    await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

    const projectPath = repoStore.get().path;
    const commitHash = message.id.split('-').pop();

    if (!commitHash || !isCommitHash(commitHash)) {
      toast.error('No commit hash found');
      return;
    }

    const messageIndex = messages.findIndex((m) => m.id === message.id);

    // Show loading toast while retrying
    const toastId = toast.loading('Loading previous version...');

    try {
      const wc = await webcontainer;

      const retryFiles = await fetchProjectFiles(repoStore.get().path, commitHash);
      const deleteFiles = [];

      for (const name of Object.keys(files)) {
        const path = name.replace(WORK_DIR + '/', '');

        if (!retryFiles[path]) {
          deleteFiles.push(path);
        }
      }

      for (const name of deleteFiles) {
        await wc.fs.rm(name, { recursive: true, force: true });
      }

      await wc.mount(convertFileMapToFileSystemTree(retryFiles));
      window.history.replaceState(null, '', '/chat/' + projectPath + '?revertTo=' + commitHash);

      const newMessages = [...messages.slice(0, messageIndex + 1)];
      setMessages(newMessages);

      toast.dismiss(toastId);
    } catch (error) {
      toast.dismiss(toastId);
      toast.error('Failed to load previous version');
      logger.error('Error loading previous version:', error);
    }
  };

  const handleRetry = async (message: Message) => {
    workbenchStore.currentView.set('code');
    await new Promise((resolve) => setTimeout(resolve, 300)); // wait for the files to be loaded

    const messageIndex = messages.findIndex((m) => m.id === message.id);

    if (messageIndex <= 0) {
      toast.error('Retry failed');
      return;
    }

    const prevMessage = messages[messageIndex - 1];

    await handleRevert(prevMessage);

    const toastId = toast.loading('Loading previous version...');

    try {
      await handleRevert(prevMessage);
      setMessages((messages) => [...messages, message]);

      setTimeout(() => {
        reload();
      }, 1000);

      // Dismiss the loading toast on success
      toast.dismiss(toastId);
    } catch (error) {
      // Dismiss the loading toast and show error
      toast.dismiss(toastId);
      toast.error('Failed to load previous version');
      logger.error('Error loading previous version:', error);
    }
  };

  return (
    <BaseChat
      ref={animationScope}
      textareaRef={textareaRef}
      input={input}
      showChat={showChat}
      chatStarted={chatStarted}
      isStreaming={isLoading || fakeLoading}
      onStreamingChange={(streaming) => {
        streamingState.set(streaming);
      }}
      enhancingPrompt={enhancingPrompt}
      promptEnhanced={promptEnhanced}
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
          apiKeys,
        );
      }}
      attachmentList={attachmentList}
      setAttachmentList={setAttachmentList}
      actionAlert={actionAlert}
      clearAlert={() => workbenchStore.clearAlert()}
      data={chatData}
      onProjectZipImport={handleProjectZipImport}
    />
  );
});
