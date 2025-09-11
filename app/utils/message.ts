import type { UIMessage } from 'ai';

/**
 * Unified function to extract text content from messages
 *
 * @param message - UIMessage object
 * @param options - Extraction options
 * @returns Extracted text string
 */
export interface ExtractOptions {
  /** Part types to extract */
  types?: ('text' | 'data')[];

  /** Filter specific data- types (e.g., 'data-prompt', 'data-progress') */
  dataTypes?: string[];

  /** Separator (default: '') */
  separator?: string;
}

export const extractContent = (message: UIMessage, options: ExtractOptions = {}): string => {
  const { types = ['text'], dataTypes = [], separator = '' } = options;

  try {
    if (!message.parts || !Array.isArray(message.parts)) {
      return '';
    }

    return message.parts
      .filter((part) => {
        // Check text type
        if (types.includes('text') && part.type === 'text') {
          return true;
        }

        // Check data type
        if (types.includes('data')) {
          if (dataTypes.length > 0) {
            // Filter specific data types only
            return dataTypes.some((dataType) => part.type === dataType);
          } else {
            // Allow all data- types
            return part.type?.startsWith('data-');
          }
        }

        return false;
      })
      .map((part) => {
        if ('text' in part) {
          return part.text || '';
        } else if ('data' in part && part.data && typeof part.data === 'object' && 'text' in part.data) {
          return (part.data as { text?: string }).text || '';
        }

        return '';
      })
      .join(separator);
  } catch (error) {
    console.error('Failed to extract content from message:', error, message);
    return '';
  }
};

/** Extract text type only */
export const extractTextContent = (message: UIMessage): string => extractContent(message, { types: ['text'] });

/** Extract data- type only */
export const extractDataContent = (message: UIMessage): string => extractContent(message, { types: ['data'] });

/** Extract both text and data- types */
export const extractAllTextContent = (message: UIMessage): string =>
  extractContent(message, { types: ['text', 'data'] });
