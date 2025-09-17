import React, { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { BundledLanguage } from 'shiki';
import { createScopedLogger } from '~/utils/logger';
import { rehypePlugins, remarkPlugins, allowedHTMLElements } from '~/utils/markdown';
import { Action } from './Action';
import { CodeBlock } from './CodeBlock';
import { ToolCall } from './ToolCall';
import { ToolResult } from './ToolResult';

import styles from './Markdown.module.scss';
import ThoughtBox from './ThoughtBox';

const logger = createScopedLogger('MarkdownComponent');

interface MarkdownProps {
  children: string;
  html?: boolean;
  limitedMarkdown?: boolean;
}

export const Markdown = memo(({ children, html = false, limitedMarkdown = false }: MarkdownProps) => {
  logger.trace('Render');

  const components = useMemo(() => {
    return {
      div: ({ className, children, node, ...props }) => {
        if (className?.includes('__boltAction__')) {
          const messageId = node?.properties.dataMessageId as string;
          const actionId = node?.properties.dataActionId as string;

          if (!messageId || !actionId) {
            logger.error(`Invalid message id ${messageId} or action id ${actionId}`);
            return null;
          }

          return <Action messageId={messageId} actionId={actionId} />;
        }

        if (className?.includes('__boltThought__')) {
          return <ThoughtBox title="Thought process">{children}</ThoughtBox>;
        }

        if (className?.includes('__toolCall__')) {
          try {
            let content: string;

            try {
              content = (children as React.ReactElement<any, 'code'>).props.children;
            } catch {
              // Fallback if the original approach fails
              if (typeof children === 'string') {
                content = children;
              } else {
                content = String(children);
              }
            }

            // Remove backticks if they wrap the JSON
            content = content.trim();

            if (content.startsWith('`') && content.endsWith('`')) {
              content = content.slice(1, -1);
            }

            return <ToolCall toolCall={JSON.parse(content)} id={props.id!} />;
          } catch (error) {
            logger.error(`Error parsing tool call: ${error}`);
            return <pre>{children}</pre>;
          }
        }

        if (className?.includes('__toolResult__')) {
          try {
            let content: string;

            try {
              content = (children as React.ReactElement<any, 'code'>).props.children;
            } catch {
              // Fallback if the original approach fails
              if (typeof children === 'string') {
                content = children;
              } else {
                content = String(children);
              }
            }

            // Remove backticks if they wrap the JSON
            content = content.trim();

            if (content.startsWith('`') && content.endsWith('`')) {
              content = content.slice(1, -1);
            }

            return <ToolResult toolResult={JSON.parse(content)} id={props.id!} />;
          } catch (error) {
            logger.error(`Error parsing tool result: ${error}`);
            return <pre>{children}</pre>;
          }
        }

        return (
          <div className={className} {...props}>
            {children}
          </div>
        );
      },
      pre: (props) => {
        const { children, node, ...rest } = props;

        const [firstChild] = node?.children ?? [];

        if (
          firstChild &&
          firstChild.type === 'element' &&
          firstChild.tagName === 'code' &&
          firstChild.children[0].type === 'text'
        ) {
          const { className, ...rest } = firstChild.properties;
          const [, language = 'plaintext'] = /language-(\w+)/.exec(String(className) || '') ?? [];

          return <CodeBlock code={firstChild.children[0].value} language={language as BundledLanguage} {...rest} />;
        }

        return <pre {...rest}>{children}</pre>;
      },
    } satisfies Components;
  }, []);

  return (
    <ReactMarkdown
      allowedElements={allowedHTMLElements}
      className={styles.MarkdownContent}
      components={components}
      remarkPlugins={remarkPlugins(limitedMarkdown)}
      rehypePlugins={rehypePlugins(html)}
    >
      {stripCodeFenceFromAction(children)}
    </ReactMarkdown>
  );
});

/**
 * Removes code fence markers (```) surrounding an artifact element while preserving the artifact content.
 * This is necessary because actions should not be wrapped in code blocks when rendered for rendering action list.
 *
 * @param content - The markdown content to process
 * @returns The processed content with code fence markers removed around artifacts
 *
 * @example
 * // Removes code fences around action
 * const input = "```xml\n<div class='__boltAction__'></div>\n```";
 * stripCodeFenceFromAction(input);
 * // Returns: "\n<div class='__boltAction__'></div>\n"
 *
 * @remarks
 * - Only removes code fences that directly wrap actions (marked with __boltAction__ class)
 * - Handles code fences with optional language specifications (e.g. ```xml, ```typescript)
 * - Preserves original content if no artifact is found
 * - Safely handles edge cases like empty input or artifacts at start/end of content
 */
export const stripCodeFenceFromAction = (content: string) => {
  if (!content || !content.includes('__boltAction__')) {
    return content;
  }

  const lines = content.split('\n');
  const actionLineIndex = lines.findIndex((line) => line.includes('__boltAction__'));

  // Return original content if action line not found
  if (actionLineIndex === -1) {
    return content;
  }

  // Check previous line for code fence
  if (actionLineIndex > 0 && lines[actionLineIndex - 1]?.trim().match(/^```\w*$/)) {
    lines[actionLineIndex - 1] = '';
  }

  if (actionLineIndex < lines.length - 1 && lines[actionLineIndex + 1]?.trim().match(/^```$/)) {
    lines[actionLineIndex + 1] = '';
  }

  if (actionLineIndex > 0 && lines[actionLineIndex - 1]?.trim().match(/^<!\[CDATA\[/)) {
    lines[actionLineIndex - 1] = '';
  }

  if (actionLineIndex < lines.length - 1 && lines[actionLineIndex + 1]?.trim().match(/^\]\]>$/)) {
    lines[actionLineIndex + 1] = '';
  }

  return lines.join('\n');
};
