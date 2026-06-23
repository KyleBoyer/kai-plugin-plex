export class BazarrClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private endpoint(path: string, params: QueryParams = {}): string {
    const normalizedPath = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
    const p = new URLSearchParams({ apikey: this.apiKey });
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item != null) p.append(key, String(item));
        }
        continue;
      }
      p.append(key, String(value));
    }
    return `${this.url}${normalizedPath}?${p}`;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    params: QueryParams = {},
    body?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    const init: RequestInit = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchFn(this.endpoint(path, params), init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Bazarr ${method} ${path}: ${res.status}${text ? ` ${text}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, params: QueryParams = {}, timeoutMs?: number): Promise<T> {
    return this.request<T>('GET', path, params, undefined, timeoutMs);
  }

  private async post<T>(path: string, params: QueryParams = {}, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>('POST', path, params, body, timeoutMs);
  }

  private async patch<T>(path: string, params: QueryParams = {}, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>('PATCH', path, params, body, timeoutMs);
  }

  private async delete<T>(path: string, params: QueryParams = {}, timeoutMs?: number): Promise<T> {
    return this.request<T>('DELETE', path, params, undefined, timeoutMs);
  }

  async ping(): Promise<boolean> {
    try {
      await this.get('/api/system/status');
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<BazarrStatus> {
    const data = await this.get<{ data: BazarrStatus }>('/api/system/status');
    return data.data;
  }

  async getStats(): Promise<BazarrStats> {
    try {
      const data = await this.get<{ data: BazarrHealthIssue[] | BazarrStats }>('/api/system/health');
      const issues = Array.isArray(data.data) ? data.data : (data.data.issues ?? []);
      return { issues };
    } catch {
      return { issues: [] };
    }
  }

  async getHealth(): Promise<BazarrHealthIssue[]> {
    return (await this.getStats()).issues;
  }

  async getBadges(): Promise<BazarrBadges> {
    return this.get<BazarrBadges>('/api/badges');
  }

  async getProviders(): Promise<BazarrProvider[]> {
    const data = await this.get<{ data: BazarrProvider[] | Record<string, BazarrProvider> }>('/api/providers');
    if (Array.isArray(data.data)) return data.data;
    return Object.entries(data.data ?? {}).map(([name, provider]) => ({ name, ...provider }));
  }

  async resetProviders(): Promise<unknown> {
    return this.post('/api/providers', { action: 'reset' });
  }

  async getTasks(): Promise<BazarrTask[]> {
    const data = await this.get<{ data: BazarrTask[] }>('/api/system/tasks');
    return data.data ?? [];
  }

  async runTask(taskId: string): Promise<unknown> {
    return this.post('/api/system/tasks', { taskid: taskId });
  }

  async getWantedMovies(start = 0, length = 50): Promise<BazarrWantedResponse<BazarrWantedMovie>> {
    return this.getWanted<BazarrWantedMovie>('/api/movies/wanted', start, length);
  }

  async getWantedEpisodes(start = 0, length = 50): Promise<BazarrWantedResponse<BazarrWantedEpisode>> {
    return this.getWanted<BazarrWantedEpisode>('/api/episodes/wanted', start, length);
  }

  async searchMovieSubtitles(radarrId: number): Promise<BazarrSubtitleCandidate[]> {
    const data = await this.get<BazarrApiData<BazarrSubtitleCandidate[]>>('/api/providers/movies', { radarrid: radarrId }, 30000);
    return normalizeDataArray(data);
  }

  async searchEpisodeSubtitles(episodeId: number): Promise<BazarrSubtitleCandidate[]> {
    const data = await this.get<BazarrApiData<BazarrSubtitleCandidate[]>>('/api/providers/episodes', { episodeid: episodeId }, 30000);
    return normalizeDataArray(data);
  }

  async downloadMovieSubtitle(input: BazarrMovieSubtitleDownload): Promise<unknown> {
    return this.post('/api/providers/movies', {
      radarrid: input.radarrId,
      hi: String(Boolean(input.hi)),
      forced: String(Boolean(input.forced)),
      original_format: String(Boolean(input.originalFormat ?? false)),
      provider: input.provider,
      subtitle: input.subtitle,
    }, undefined, 30000);
  }

  async downloadEpisodeSubtitle(input: BazarrEpisodeSubtitleDownload): Promise<unknown> {
    return this.post('/api/providers/episodes', {
      seriesid: input.seriesId,
      episodeid: input.episodeId,
      hi: String(Boolean(input.hi)),
      forced: String(Boolean(input.forced)),
      original_format: String(Boolean(input.originalFormat ?? false)),
      provider: input.provider,
      subtitle: input.subtitle,
    }, undefined, 30000);
  }

  async downloadMissingMovieSubtitle(input: BazarrMissingMovieSubtitleDownload): Promise<unknown> {
    return this.patch('/api/movies/subtitles', {
      radarrid: input.radarrId,
      language: input.language,
      forced: String(Boolean(input.forced)),
      hi: String(Boolean(input.hi)),
    }, undefined, 30000);
  }

  async downloadMissingEpisodeSubtitle(input: BazarrMissingEpisodeSubtitleDownload): Promise<unknown> {
    return this.patch('/api/episodes/subtitles', {
      seriesid: input.seriesId,
      episodeid: input.episodeId,
      language: input.language,
      forced: String(Boolean(input.forced)),
      hi: String(Boolean(input.hi)),
    }, undefined, 30000);
  }

  async deleteMovieSubtitle(input: BazarrDeleteMovieSubtitle): Promise<unknown> {
    return this.delete('/api/movies/subtitles', {
      radarrid: input.radarrId,
      language: input.language,
      forced: String(Boolean(input.forced)),
      hi: String(Boolean(input.hi)),
      path: input.path,
    });
  }

  async deleteEpisodeSubtitle(input: BazarrDeleteEpisodeSubtitle): Promise<unknown> {
    return this.delete('/api/episodes/subtitles', {
      seriesid: input.seriesId,
      episodeid: input.episodeId,
      language: input.language,
      forced: String(Boolean(input.forced)),
      hi: String(Boolean(input.hi)),
      path: input.path,
    });
  }

  async applySubtitleTool(input: BazarrSubtitleToolInput): Promise<unknown> {
    return this.patch('/api/subtitles', {
      action: input.action,
      language: input.language,
      path: input.path,
      type: input.type,
      id: input.id,
      forced: input.forced == null ? undefined : String(Boolean(input.forced)),
      hi: input.hi == null ? undefined : String(Boolean(input.hi)),
      original_format: input.originalFormat == null ? undefined : String(Boolean(input.originalFormat)),
      reference: input.reference,
      max_offset_seconds: input.maxOffsetSeconds,
      no_fix_framerate: input.noFixFramerate == null ? undefined : String(Boolean(input.noFixFramerate)),
      gss: input.gss,
    }, undefined, 30000);
  }

  async runMovieAction(radarrId: number, action: string): Promise<unknown> {
    return this.patch('/api/movies', { radarrid: radarrId, action }, undefined, 30000);
  }

  async runSeriesAction(seriesId: number, action: string): Promise<unknown> {
    return this.patch('/api/series', { seriesid: seriesId, action }, undefined, 30000);
  }

  async getVersion(): Promise<string> {
    try {
      const s = await this.getStatus();
      return s.bazarr_version;
    } catch { return 'unknown'; }
  }

  private async getWanted<T>(path: string, start: number, length: number): Promise<BazarrWantedResponse<T>> {
    const data = await this.get<{ data: T[]; total?: number }>(path, { start, length });
    return { data: data.data ?? [], total: Number(data.total ?? data.data?.length ?? 0) };
  }
}

type QueryPrimitive = string | number | boolean;
type QueryParams = Record<string, QueryPrimitive | QueryPrimitive[] | null | undefined>;
type BazarrApiData<T> = { data?: T } | T;

function normalizeDataArray<T>(value: BazarrApiData<T[]>): T[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && 'data' in value && Array.isArray(value.data)) return value.data;
  return [];
}

export interface BazarrStatus {
  bazarr_version: string;
  package_version?: string;
  sonarr_version?: string;
  radarr_version?: string;
  operating_system?: string;
  python_version?: string;
  database_engine?: string;
  start_time?: string;
  timezone?: string;
}

export interface BazarrStats {
  issues: BazarrHealthIssue[];
}

export interface BazarrHealthIssue {
  object?: string;
  issue?: string;
  message?: string;
  type?: string;
  wikiUrl?: string;
}

export interface BazarrBadges {
  episodes?: number;
  movies?: number;
  providers?: number;
  status?: number;
  sonarr_signalr?: string;
  radarr_signalr?: string;
  announcements?: number;
}

export interface BazarrLanguage {
  name?: string;
  code2?: string;
  code3?: string;
  forced?: boolean;
  hi?: boolean;
}

export interface BazarrWantedResponse<T> {
  data: T[];
  total: number;
}

export interface BazarrWantedMovie {
  title: string;
  missing_subtitles?: BazarrLanguage[];
  radarrId: number;
  sceneName?: string;
  tags?: string[];
}

export interface BazarrWantedEpisode {
  seriesTitle: string;
  episode_number?: string;
  episodeTitle?: string;
  missing_subtitles?: BazarrLanguage[];
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  sceneName?: string;
  tags?: string[];
  seriesType?: string;
}

export interface BazarrProvider {
  name?: string;
  provider?: string;
  status?: string;
  enabled?: boolean;
  failures?: number;
  retry?: string;
  [key: string]: unknown;
}

export interface BazarrTask {
  id?: string;
  taskid?: string;
  name?: string;
  interval?: string;
  next_run?: string;
  running?: boolean;
  [key: string]: unknown;
}

export interface BazarrSubtitleCandidate {
  provider?: string;
  subtitle?: string;
  id?: string;
  title?: string;
  language?: string | BazarrLanguage;
  score?: number;
  hearing_impaired?: boolean;
  forced?: boolean;
  matches?: string[];
  [key: string]: unknown;
}

export interface BazarrMovieSubtitleDownload {
  radarrId: number;
  provider: string;
  subtitle: string;
  forced?: boolean;
  hi?: boolean;
  originalFormat?: boolean;
}

export interface BazarrEpisodeSubtitleDownload {
  seriesId: number;
  episodeId: number;
  provider: string;
  subtitle: string;
  forced?: boolean;
  hi?: boolean;
  originalFormat?: boolean;
}

export interface BazarrMissingMovieSubtitleDownload {
  radarrId: number;
  language: string;
  forced?: boolean;
  hi?: boolean;
}

export interface BazarrMissingEpisodeSubtitleDownload {
  seriesId: number;
  episodeId: number;
  language: string;
  forced?: boolean;
  hi?: boolean;
}

export interface BazarrDeleteMovieSubtitle extends BazarrMissingMovieSubtitleDownload {
  path: string;
}

export interface BazarrDeleteEpisodeSubtitle extends BazarrMissingEpisodeSubtitleDownload {
  path: string;
}

export interface BazarrSubtitleToolInput {
  action: string;
  language: string;
  path: string;
  type: 'movie' | 'episode' | string;
  id: number;
  forced?: boolean;
  hi?: boolean;
  originalFormat?: boolean;
  reference?: string;
  maxOffsetSeconds?: string | number;
  noFixFramerate?: boolean;
  gss?: string;
}
