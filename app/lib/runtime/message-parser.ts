import type { ActionType, BoltAction, BoltActionData, FileAction, ShellAction, ModifyAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { extractFromCDATA } from '~/utils/stringUtils';
import { unreachable } from '~/utils/unreachable';

const ACTION_TAG_OPEN = '<boltAction';
const ACTION_TAG_CLOSE = '</boltAction>';

const logger = createScopedLogger('MessageParser');

export interface ActionCallbackData {
  messageId: string;
  actionId: string;
  action: BoltAction;
}

export type ActionCallback = (data: ActionCallbackData) => void;

export interface ParserCallbacks {
  onActionOpen?: ActionCallback;
  onActionStream?: ActionCallback;
  onActionClose?: ActionCallback;
}

export interface StreamingMessageParserOptions {
  callbacks?: ParserCallbacks;
}

interface MessageState {
  position: number;
  insideAction: boolean;
  currentAction: BoltActionData;
  actionId: number;
}

export function cleanoutFileContent(content: string, filePath: string): string {
  let processedContent = content.trim();

  logger.trace(`cleanoutFileContent: ${filePath}`);
  processedContent = cleanoutCodeblockSyntax(processedContent);
  processedContent += '\n';

  return processedContent;
}

function cleanoutCodeblockSyntax(content: string) {
  const markdownCodeBlockRegex = /^\s*```\w*\n([\s\S]*?)\n\s*```\s*$/;

  const markdownMatch = content.match(markdownCodeBlockRegex);

  if (markdownMatch) {
    return markdownMatch[1];
  }

  return extractFromCDATA(content);
}

export class StreamingMessageParser {
  #messages = new Map<string, MessageState>();

  constructor(private _options: StreamingMessageParserOptions = {}) {}

  parse(messageId: string, input: string) {
    let state = this.#messages.get(messageId);

    if (!state) {
      state = {
        position: 0,
        insideAction: false,
        currentAction: { content: '' },
        actionId: 0,
      };

      this.#messages.set(messageId, state);
    }

    let output = '';
    let i = state.position;
    let earlyBreak = false;

    while (i < input.length) {
      if (state.insideAction) {
        // Inside an action tag, look for the closing tag
        const closeIndex = input.indexOf(ACTION_TAG_CLOSE, i);
        const currentAction = state.currentAction;

        if (currentAction === undefined) {
          unreachable('Action not initialized');
        }

        if (closeIndex !== -1) {
          // Found closing tag - capture content and process action
          currentAction.content += input.slice(i, closeIndex);

          let content = currentAction.content.trim();

          if ('type' in currentAction && currentAction.type === 'file') {
            content = cleanoutFileContent(content, currentAction.filePath);
          } else if ('type' in currentAction && currentAction.type === 'modify') {
            content = extractFromCDATA(content);
          } else {
            content = extractFromCDATA(content);
          }

          currentAction.content = content;

          const actionId = `${messageId}:action-${state.actionId}`;

          // Notify that action is complete
          this._options.callbacks?.onActionClose?.({
            messageId,
            actionId,
            action: currentAction as BoltAction,
          });

          // Add a marker div for this individual action to be rendered
          output += `<div class="__boltAction__" data-message-id="${messageId}" data-action-id="${actionId}"></div>\n`;

          state.insideAction = false;
          state.currentAction = { content: '' };
          state.actionId++;

          i = closeIndex + ACTION_TAG_CLOSE.length;
        } else {
          // No closing tag found yet, accumulate content
          currentAction.content += input.slice(i);
          break;
        }
      } else if (input[i] === '<' && input[i + 1] !== '/') {
        // Check for boltAction opening tag
        let j = i;
        let potentialTag = '';

        while (j < input.length && potentialTag.length < ACTION_TAG_OPEN.length) {
          potentialTag += input[j];

          if (potentialTag === ACTION_TAG_OPEN) {
            const nextChar = input[j + 1];

            if (nextChar && nextChar !== '>' && nextChar !== ' ') {
              // Not a valid tag, continue
              output += input.slice(i, j + 1);
              i = j + 1;
              break;
            }

            // Found boltAction opening tag
            const openTagEnd = input.indexOf('>', j);

            if (openTagEnd !== -1) {
              // Parse the action tag
              state.insideAction = true;
              state.currentAction = this.#parseActionTag(input, i, openTagEnd);

              const actionId = `${messageId}:action-${state.actionId}`;

              // Notify that action has started
              this._options.callbacks?.onActionOpen?.({
                messageId,
                actionId,
                action: state.currentAction as BoltAction,
              });

              i = openTagEnd + 1;
            } else {
              // Incomplete tag, wait for more input
              earlyBreak = true;
            }

            break;
          } else if (!ACTION_TAG_OPEN.startsWith(potentialTag)) {
            // Not a potential action tag
            output += input.slice(i, j + 1);
            i = j + 1;
            break;
          }

          j++;
        }

        if (j === input.length && ACTION_TAG_OPEN.startsWith(potentialTag)) {
          // Potential tag but need more input
          break;
        }
      } else {
        output += input[i];
        i++;
      }

      if (earlyBreak) {
        break;
      }
    }

    state.position = i;

    return output;
  }

  reset() {
    this.#messages.clear();
  }

  #parseActionTag(input: string, actionOpenIndex: number, actionEndIndex: number) {
    const actionTag = input.slice(actionOpenIndex, actionEndIndex + 1);

    const actionType = this.#extractAttribute(actionTag, 'type') as ActionType;

    const actionAttributes = {
      type: actionType,
      content: '',
    };

    if (actionType === 'file' || actionType === 'modify') {
      const filePath = this.#extractAttribute(actionTag, 'filePath') as string;

      if (!filePath) {
        logger.debug('File path not specified');
      }

      if (actionType === 'file') {
        (actionAttributes as FileAction).filePath = filePath;
      } else {
        (actionAttributes as ModifyAction).filePath = filePath;
      }
    } else if (!['shell', 'start'].includes(actionType)) {
      logger.warn(`Unknown action type '${actionType}'`);
    }

    return actionAttributes as FileAction | ShellAction | ModifyAction;
  }

  #extractAttribute(tag: string, attributeName: string): string | undefined {
    const match = tag.match(new RegExp(`${attributeName}="([^"]*)"`, 'i'));
    return match ? match[1] : undefined;
  }
}
