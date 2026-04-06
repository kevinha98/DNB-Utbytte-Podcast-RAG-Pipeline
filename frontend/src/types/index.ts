// Shared TypeScript types matching backend API schemas

export interface QAFilters {
  episode_numbers?: number[];
  date_from?: string;
  date_to?: string;
}

export interface QARequest {
  question: string;
  filters?: QAFilters;
  model?: string;
  use_web?: boolean;
}

export interface SourceReference {
  episode_number: number;
  title: string;
  date: string;
  url: string;
  relevant_text: string;
  similarity: number;
  guest?: string | null;
}

export interface QAResponse {
  answer: string;
  sources: SourceReference[];
  confidence: number;
}

export interface EpisodeSummary {
  episode_number: number;
  title: string;
  date: string;
  duration: string;
  description: string;
  keywords: string[];
  status: string;
}

export interface EpisodeDetail extends EpisodeSummary {
  url: string;
  transcript: string | null;
}

export interface PipelineStatus {
  total_episodes: number;
  completed: number;
  failed: number;
  current_step: string;
  errors: Record<string, unknown>[];
  started_at: string | null;
  finished_at: string | null;
  is_running: boolean;
}

export interface TopicEntry {
  episode_number: number;
  title: string;
  keywords: string[];
}

export interface TopicsResponse {
  topics: TopicEntry[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  confidence?: number;
  timestamp: Date;
}
