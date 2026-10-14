import { createContext } from 'react';
import type { ArtifactContent } from '@/lib/api';
import type { ToolApprovalAnswer } from '@/lib/api/endpoints';

export type ChatActionAdapter = {
  decide_approval: (request_id: string, answer: ToolApprovalAnswer) => Promise<unknown>;
  read_artifact?: (artifact_id: string) => Promise<ArtifactContent>;
  download_artifact: (artifact_id: string) => Promise<void>;
};

export const ChatActionAdapterContext = createContext<ChatActionAdapter | null>(null);
