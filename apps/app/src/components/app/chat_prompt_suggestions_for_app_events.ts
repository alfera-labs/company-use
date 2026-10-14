import type { PromptSuggestionItem } from '@/components/app/chat_prompt_suggestions';

type PlacedSuggestion = { position: number; item: PromptSuggestionItem };

export const suggestions_that_start_on_an_app_event: Record<string, PlacedSuggestion[]> = {};
