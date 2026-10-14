export type MemorySearchHit = {
  document: { slug: string; title: string };
  snippet: string;
};

export type MemoryView = {
  search(input: { query: string; limit: number }): Promise<{ hits: readonly MemorySearchHit[] }>;
};
