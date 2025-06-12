import { useState } from 'react';
import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import { generateId } from 'ai';

const logger = createScopedLogger('useIssueBreakdown');

interface IssueBreakdownOptions {
  api: string;
  initialMessages?: Message[];
  initialInput?: string;
  body?: Record<string, any>;
  onError?: (error: Error) => void;
  onFinish?: (message: Message, response: any) => void;
}

interface IssueBreakdownResponse {
  success: boolean;
  data?: {
    summary: string;
    issues: Array<{
      id: string;
      title: string;
      description: string;
      details: string;
      testStrategy: string;
      priority: 'high' | 'medium' | 'low';
      dependencies: string[];
    }>;
    totalIssues: number;
    generatedAt: string;
    originalPrompt: string;
    metadata: {
      projectName: string;
      sourceFile: string;
      totalIssues: number;
    };
    conversationId: string;
    messages: Message[];
    gitlab?: {
      project: any;
      projectPath: string;
    };
    apiKeysConfigured: Record<string, boolean>;
  };
  error?: string;
}

export function useIssueBreakdown({
  api,
  initialMessages = [],
  initialInput = '',
  body = {},
  onError,
  onFinish,
}: IssueBreakdownOptions) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<any>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const append = async (
    userMessage: Partial<Message>,
    options?: {
      createGitlabIssues?: boolean;
      existingProjectPath?: string;
      projectName?: string;
      projectDescription?: string;
      files?: Record<string, any>;
    },
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      // Ensure message has an ID
      const message: Message = {
        id: userMessage.id || generateId(),
        role: userMessage.role || 'user',
        content: userMessage.content || '',
      };

      // Add user message to the conversation
      const newMessages = [...messages, message];
      setMessages(newMessages);

      // Merge base body and new options
      const requestBody: Record<string, any> = {
        ...body,
        messages: newMessages,
        createGitlabIssues: options?.createGitlabIssues,
        existingProjectPath: options?.existingProjectPath,
        projectName: options?.projectName,
        projectDescription: options?.projectDescription,
      };

      // If new files are provided, use them with priority
      if (options?.files) {
        requestBody.files = options.files;
      }

      logger.info('Request details sent to API', {
        endpoint: api,
        hasFiles: !!requestBody.files && Object.keys(requestBody.files).length > 0,
        filesCount: requestBody.files ? Object.keys(requestBody.files).length : 0,
        createGitlabIssues: requestBody.createGitlabIssues,
        existingProjectPath: requestBody.existingProjectPath,
        messagesCount: newMessages.length,
      });

      // Call the API
      const response = await fetch(api, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      logger.info('API response received', {
        status: response.status,
        statusText: response.statusText,
      });

      const responseData = (await response.json()) as IssueBreakdownResponse;

      if (!response.ok || !responseData.success) {
        const errorMessage = responseData.error || `HTTP error: ${response.status} ${response.statusText}`;
        logger.error('API returned error:', errorMessage);
        throw new Error(errorMessage);
      }

      // Update messages and data
      if (responseData.data) {
        setData(responseData.data);
        setMessages(responseData.data.messages);

        // Call onFinish with the assistant's response message
        const assistantMessage = responseData.data.messages[responseData.data.messages.length - 1];

        if (onFinish && assistantMessage.role === 'assistant') {
          onFinish(assistantMessage, responseData);
        }
      }
    } catch (err) {
      const error = err as Error;
      logger.error('Error calling issue breakdown API:', error);
      setError(error);

      if (onError) {
        onError(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const reload = () => {
    // No-op for this implementation since we don't need to reload
  };

  const stop = () => {
    // No-op since this is not a streaming API
  };

  return {
    messages,
    isLoading,
    input,
    handleInputChange,
    setInput,
    setMessages,
    append,
    reload,
    stop,
    error,
    data,
    setData,
  };
}
