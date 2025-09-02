import { type Message } from 'ai';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  MODEL_REGEX,
  PROVIDER_REGEX,
  ATTACHMENTS_REGEX,
  DEV_TAG_REGEX,
} from '~/utils/constants';

const USEDIFF_REGEX = /\[UseDiff:\s*(.+?)\]/;
import { IGNORE_PATTERNS, type FileMap } from './constants';
import ignore from 'ignore';
import type { ContextAnnotation } from '~/types/context';

function stripMetadata(content?: string) {
  return content
    ?.replace(MODEL_REGEX, '')
    .replace(PROVIDER_REGEX, '')
    .replace(ATTACHMENTS_REGEX, '')
    .replace(DEV_TAG_REGEX, '')
    .replace(USEDIFF_REGEX, '');
}

export function extractPropertiesFromMessage(message: Omit<Message, 'id'>): {
  model: string;
  provider: string;
  content: any;
  parts: any;
  useDiff?: boolean;
} {
  const textContent = Array.isArray(message.content)
    ? message.content.find((item) => item.type === 'text')?.text || ''
    : message.content;

  const modelMatch = textContent.match(MODEL_REGEX);
  const providerMatch = textContent.match(PROVIDER_REGEX);
  const attachmentsMatch = textContent.match(ATTACHMENTS_REGEX);
  const useDiffMatch = textContent.match(USEDIFF_REGEX);

  /*
   * Extract model
   * const modelMatch = message.content.match(MODEL_REGEX);
   */
  const model = modelMatch ? modelMatch[1] : DEFAULT_MODEL;

  /*
   * Extract provider
   * const providerMatch = message.content.match(PROVIDER_REGEX);
   */
  const provider = providerMatch ? providerMatch[1] : DEFAULT_PROVIDER.name;

  /*
   * Extract useDiff
   */
  const useDiff = useDiffMatch ? useDiffMatch[1] === 'true' : undefined;

  let attachments = [];
  let attachmentsText = '';

  try {
    if (attachmentsMatch) {
      attachments = JSON.parse(attachmentsMatch[1]);

      if (attachments?.length > 0) {
        attachmentsText = `\n\n<Attachments>${JSON.stringify(attachments)}</Attachments>`;
      }
    }
  } catch {}

  const cleanedContent = Array.isArray(message.content)
    ? message.content.map((item) => {
        if (item.type === 'text') {
          return {
            type: 'text',
            text: stripMetadata(item.text) + attachmentsText,
          };
        }

        return item; // Preserve image_url and other types as is
      })
    : stripMetadata(textContent) + attachmentsText;

  const parts =
    message.parts?.map((part) => {
      if (part.type === 'text') {
        return {
          type: part.type,
          text: stripMetadata(part.text) + attachmentsText,
        };
      }

      return part;
    }) || [];

  return { model, provider, content: cleanedContent, parts, useDiff };
}

export function simplifyBoltActions(input: string): string {
  // Using regex to match boltAction tags that have type="file"
  const regex = /(<boltAction[^>]*type="file"[^>]*>)([\s\S]*?)(<\/boltAction>)/g;

  // Replace each matching occurrence
  return input.replace(regex, (_0, openingTag, _2, closingTag) => {
    return `${openingTag}\n          ...\n        ${closingTag}`;
  });
}

export function createFilesContext(files: FileMap, useRelativePath?: boolean) {
  const ig = ignore().add(IGNORE_PATTERNS);
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  const fileContexts = filePaths
    .filter((x) => files[x] && files[x].type == 'file')
    .map((path) => {
      const dirent = files[path];

      if (!dirent || dirent.type == 'folder') {
        return '';
      }

      const codeWithLinesNumbers = dirent.content
        .split('\n')
        // .map((v, i) => `${i + 1}|${v}`)
        .join('\n');

      let filePath = path;

      if (useRelativePath) {
        filePath = path.replace('/home/project/', '');
      }

      return `<boltAction type="file" filePath="${filePath}">${codeWithLinesNumbers}</boltAction>`;
    });

  return `<boltArtifact id="code-content" title="Code Content" >\n${fileContexts.join('\n')}\n</boltArtifact>`;
}

export function extractCurrentContext(messages: Message[]) {
  const lastAssistantMessage = messages.filter((x) => x.role == 'assistant').slice(-1)[0];

  if (!lastAssistantMessage) {
    return { summary: undefined, codeContext: undefined };
  }

  let summary: ContextAnnotation | undefined;
  let codeContext: ContextAnnotation | undefined;

  if (!lastAssistantMessage.annotations?.length) {
    return { summary: undefined, codeContext: undefined };
  }

  for (let i = 0; i < lastAssistantMessage.annotations.length; i++) {
    const annotation = lastAssistantMessage.annotations[i];

    if (!annotation || typeof annotation !== 'object') {
      continue;
    }

    if (!(annotation as any).type) {
      continue;
    }

    const annotationObject = annotation as any;

    if (annotationObject.type === 'codeContext') {
      codeContext = annotationObject;
      break;
    } else if (annotationObject.type === 'chatSummary') {
      summary = annotationObject;
      break;
    }
  }

  return { summary, codeContext };
}
