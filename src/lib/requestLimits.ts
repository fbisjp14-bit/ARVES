export const MAX_AI_ATTACHMENTS = 3;
export const MAX_AI_FILE_BYTES = 2_500_000;
export const MAX_AI_FILES_TOTAL_BYTES = 2_800_000;
export const MAX_HISTORY_CHARACTERS = 120_000;
export const MAX_HISTORY_MESSAGES = 60;

interface FileLike {
  name: string;
  size: number;
}

export const selectAiAttachments = <T extends FileLike>(
  existing: T[],
  incoming: T[]
): { accepted: T[]; rejected: T[] } => {
  const accepted = existing.slice(0, MAX_AI_ATTACHMENTS);
  const rejected: T[] = [];
  let totalBytes = accepted.reduce((sum, file) => sum + file.size, 0);

  for (const file of incoming) {
    if (
      file.size > MAX_AI_FILE_BYTES ||
      accepted.length >= MAX_AI_ATTACHMENTS ||
      totalBytes + file.size > MAX_AI_FILES_TOTAL_BYTES
    ) {
      rejected.push(file);
      continue;
    }
    accepted.push(file);
    totalBytes += file.size;
  }

  return { accepted, rejected };
};

const truncateMessage = (content: string): string => {
  const maxPerMessage = 24_000;
  if (content.length <= maxPerMessage) return content;
  const half = Math.floor(maxPerMessage / 2);
  return `${content.slice(0, half)}\n\n[… trecho reduzido para caber na requisição …]\n\n${content.slice(-half)}`;
};

export const buildRecentTextHistory = (
  messages: Array<{ role: string; content?: string }>
): Array<{ role: 'model' | 'user'; parts: Array<{ text: string }> }> => {
  const selected: Array<{ role: 'model' | 'user'; parts: Array<{ text: string }> }> = [];
  let totalCharacters = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < MAX_HISTORY_MESSAGES;
    index--
  ) {
    const text = truncateMessage(String(messages[index]?.content || ''));
    if (!text) continue;
    if (selected.length > 0 && totalCharacters + text.length > MAX_HISTORY_CHARACTERS) {
      break;
    }
    selected.unshift({
      role: messages[index]?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }]
    });
    totalCharacters += text.length;
  }

  return selected;
};
