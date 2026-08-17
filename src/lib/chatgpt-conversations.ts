export interface ConversationLore {
  totalConversations: number;
  totalMessages: number;
  themes: string[];
  recentTitles: string[];
}

type RecordValue = Record<string, unknown>;

const STOP_WORDS = new Set([
  "about", "and", "best", "can", "chat", "create", "for", "from", "help", "how", "make",
  "new", "please", "the", "this", "using", "what", "with", "you", "your",
]);

export function mapConversationLore(input: unknown): ConversationLore {
  const conversations = conversationRows(input);
  const titles: string[] = [];
  for (const conversation of conversations) {
    const title = text(conversation.title);
    if (title) titles.push(title);
  }
  const totalMessages = conversations.reduce((sum, conversation) => {
    if (typeof conversation.message_count === "number") return sum + conversation.message_count;
    return sum + (Array.isArray(conversation.messages) ? conversation.messages.length : 0);
  }, 0);

  return {
    totalConversations: conversations.length,
    totalMessages,
    themes: topThemes(titles),
    recentTitles: titles.slice(0, 4),
  };
}

function conversationRows(input: unknown, depth = 0): RecordValue[] {
  if (depth > 4) return [];
  if (Array.isArray(input)) return input.filter(isRecord);
  if (!isRecord(input)) return [];
  for (const key of ["conversations", "chatgpt.conversations", "data", "result"]) {
    if (key in input) {
      const rows = conversationRows(input[key], depth + 1);
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

function topThemes(titles: string[]): string[] {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const words = title.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? [];
    for (const word of new Set(words)) {
      if (STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
