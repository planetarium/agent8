/**
 * String utility functions for text processing and manipulation
 */

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
