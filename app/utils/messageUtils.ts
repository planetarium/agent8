/**
 * Extracts commit hash from a message ID.
 * Message IDs are formatted as "{timestamp}-{commitHash}",
 * so we split by '-' and take the last part to get the commit hash.
 *
 * @param messageId - The message ID string
 * @returns The commit hash extracted from the message ID
 */
export function getCommitHashFromMessageId(messageId: string): string {
  return messageId.split('-').pop() as string;
}
