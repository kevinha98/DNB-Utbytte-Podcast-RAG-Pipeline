import type {
  EpisodeDetail,
  EpisodeSummary,
  PipelineStatus,
  QAFilters,
  QAResponse,
  TopicsResponse,
} from "@/types";

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://utbytte-backend-production.up.railway.app";

export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("utbytte_api_url");
    if (stored) return stored.replace(/\/$/, "");
  }
  return DEFAULT_API_URL;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json();
}

// --- QA ---

export async function askQuestion(
  question: string,
  filters?: QAFilters,
  model?: string,
  useWeb?: boolean
): Promise<QAResponse> {
  return fetchJSON<QAResponse>(`${getApiUrl()}/api/qa`, {
    method: "POST",
    body: JSON.stringify({
      question,
      filters,
      model: model || undefined,
      use_web: useWeb || undefined,
    }),
  });
}

export interface StreamCallbacks {
  onSources: (sources: QAResponse["sources"], confidence: number) => void;
  onToken: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export async function askQuestionStream(
  question: string,
  callbacks: StreamCallbacks,
  filters?: QAFilters,
  model?: string,
  useWeb?: boolean,
  userId?: string
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers["X-User-ID"] = userId;

  const res = await fetch(`${getApiUrl()}/api/qa/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      question,
      filters,
      model: model || undefined,
      use_web: useWeb || undefined,
      user_id: userId || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    callbacks.onError(new Error(`API error ${res.status}: ${body}`));
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            switch (currentEvent) {
              case "sources":
                callbacks.onSources(parsed.sources, parsed.confidence);
                break;
              case "token":
                callbacks.onToken(parsed.text);
                break;
              case "done":
                callbacks.onDone();
                return;
              case "error":
                callbacks.onError(new Error(parsed.error || "Stream error"));
                return;
            }
          } catch {
            // skip malformed JSON lines
          }
          currentEvent = "";
        }
      }
    }
    // Stream ended without done event
    callbacks.onDone();
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// --- User instructions ---

export interface UserInstructions {
  preset_tone: string | null;
  preset_language: string | null;
  preset_focus: string | null;
  free_text: string | null;
}

function userHeaders(userId: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-User-ID": userId };
}

export async function getUserInstructions(userId: string): Promise<UserInstructions> {
  return fetchJSON<UserInstructions>(`${getApiUrl()}/api/user/instructions`, {
    headers: userHeaders(userId),
  });
}

export async function saveUserInstructions(
  userId: string,
  instructions: UserInstructions
): Promise<UserInstructions> {
  return fetchJSON<UserInstructions>(`${getApiUrl()}/api/user/instructions`, {
    method: "PUT",
    headers: userHeaders(userId),
    body: JSON.stringify(instructions),
  });
}

// --- Feedback ---

export interface FeedbackEntry {
  id: string;
  question: string;
  answer: string;
  thumbs: number;
  correction: string | null;
  created_at: string;
}

export async function postFeedback(
  userId: string,
  question: string,
  answer: string,
  thumbs: 0 | 1,
  correction?: string
): Promise<{ id: string }> {
  return fetchJSON<{ id: string }>(`${getApiUrl()}/api/feedback`, {
    method: "POST",
    headers: userHeaders(userId),
    body: JSON.stringify({ question, answer, thumbs, correction: correction || null }),
  });
}

export async function getUserFeedback(userId: string): Promise<FeedbackEntry[]> {
  return fetchJSON<FeedbackEntry[]>(`${getApiUrl()}/api/user/feedback`, {
    headers: userHeaders(userId),
  });
}

export async function deleteFeedback(userId: string, feedbackId: string): Promise<void> {
  await fetch(`${getApiUrl()}/api/user/feedback/${feedbackId}`, {
    method: "DELETE",
    headers: userHeaders(userId),
  });
}

// --- Global memory ---

export interface GlobalPattern {
  id: string;
  pattern: string;
  example_question: string | null;
  example_correction: string | null;
  score: number;
}

export async function getGlobalMemory(): Promise<GlobalPattern[]> {
  return fetchJSON<GlobalPattern[]>(`${getApiUrl()}/api/global/memory`);
}

// --- Episodes ---

export async function getEpisodes(params?: {
  search?: string;
  date_from?: string;
  date_to?: string;
}): Promise<EpisodeSummary[]> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set("search", params.search);
  if (params?.date_from) sp.set("date_from", params.date_from);
  if (params?.date_to) sp.set("date_to", params.date_to);

  const qs = sp.toString();
  return fetchJSON<EpisodeSummary[]>(
    `${getApiUrl()}/api/episodes${qs ? `?${qs}` : ""}`
  );
}

export async function getEpisode(
  episodeNumber: number
): Promise<EpisodeDetail> {
  return fetchJSON<EpisodeDetail>(
    `${getApiUrl()}/api/episodes/${episodeNumber}`
  );
}

// --- Pipeline ---

export async function startPipeline(
  maxEpisodes?: number
): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${getApiUrl()}/api/pipeline/start`, {
    method: "POST",
    body: JSON.stringify({ max_episodes: maxEpisodes ?? null }),
  });
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  return fetchJSON<PipelineStatus>(`${getApiUrl()}/api/pipeline/status`);
}

// --- Topics ---

export async function getTopics(): Promise<TopicsResponse> {
  return fetchJSON<TopicsResponse>(`${getApiUrl()}/api/topics`);
}

// --- Health ---

export async function checkHealth(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${getApiUrl()}/api/health`);
}
