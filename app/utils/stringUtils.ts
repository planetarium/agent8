/**
 * String utility functions for text processing and manipulation
 */

const MARKDOWN_CODE_BLOCK_REGEX = /^\s*```\w*\n([\s\S]*?)\n\s*```\s*$/;

/**
 * Extracts content from CDATA tags
 * @param content - The string that may contain CDATA tags
 * @returns The extracted content without CDATA tags, or the original content if no CDATA tags found
 */
export function extractFromCDATA(content: string): string {
  // CDATA regex: captures content between tags, handling newlines at both ends
  const xmlCodeBlockRegex = /^\s*<\!\[CDATA\[\n?([\s\S]*?)\n?\]\]>\s*$/;

  const cdataMatch = content.match(xmlCodeBlockRegex);

  if (cdataMatch) {
    return cdataMatch[1];
  }

  return content;
}

/**
 * Cleans HTML-escaped tags and special characters
 * @param content - The string that may contain escaped HTML entities
 * @returns The unescaped content
 */
export function cleanEscapedTags(content: string): string {
  return content
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

/**
 * Sanitizes content for safe use in XML attribute values
 * @param content - The string to sanitize
 * @returns The sanitized content safe for XML attributes
 */
export function sanitizeXmlAttributeValue(content?: string): string {
  return content
    ? content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '';
}

/**
 * Normalizes content by extracting from markdown code blocks, CDATA tags, and decoding escaped characters
 * @param content - The string to normalize
 * @returns The normalized content
 */
export function normalizeContent(content: string): string {
  let normalized = content;

  // Remove markdown code block syntax if present
  const markdownMatch = normalized.match(MARKDOWN_CODE_BLOCK_REGEX);

  if (markdownMatch) {
    normalized = markdownMatch[1];
  } else {
    // Try to extract from CDATA
    normalized = extractFromCDATA(normalized);
  }

  // Decode escaped tags
  normalized = cleanEscapedTags(normalized);

  return normalized;
}

/**
 * Checks if the content is empty
 * @param content - The content to check
 * @returns True if the content is empty, false otherwise
 */
export function isEmpty(content: string | null | undefined): boolean {
  return !content || content.trim().length === 0;
}
