export function isCommitHash(id: string) {
  return id.length === 40 && /^[0-9a-fA-F]+$/.test(id);
}
