export class ProwlarrClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private endpoint(path: string, params: QueryParams = {}): string {
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
    return `${this.url}${path}?${p}`;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
      throw new Error(`Prowlarr ${method} ${path}: ${res.status}${text ? ` ${text}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, params: QueryParams = {}, timeoutMs?: number): Promise<T> {
    return this.request<T>('GET', path, params, undefined, timeoutMs);
  }

  private async post<T>(path: string, body?: unknown, params: QueryParams = {}, timeoutMs?: number): Promise<T> {
    return this.request<T>('POST', path, params, body, timeoutMs);
  }

  async ping(): Promise<boolean> {
    try {
      await this.get('/api/v1/system/status');
      return true;
    } catch {
      return false;
    }
  }

  async getSystemStatus(): Promise<ProwlarrSystemStatus> {
    return this.get<ProwlarrSystemStatus>('/api/v1/system/status');
  }

  async getIndexers(): Promise<ProwlarrIndexer[]> {
    return this.get<ProwlarrIndexer[]>('/api/v1/indexer');
  }

  async getIndexerStats(): Promise<ProwlarrIndexerSummary> {
    const indexers = await this.getIndexers();
    const protocols = indexers.reduce<Record<string, number>>((acc, indexer) => {
      const protocol = indexer.protocol ?? 'unknown';
      acc[protocol] = (acc[protocol] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: indexers.length,
      enabled: indexers.filter(i => i.enable).length,
      searchCapable: indexers.filter(i => i.enable && i.supportsSearch !== false).length,
      protocols,
    };
  }

  async getIndexerStatsDetailed(params: {
    startDate?: string;
    endDate?: string;
    indexers?: string;
    protocols?: string;
    tags?: string;
  } = {}): Promise<ProwlarrIndexerStats> {
    return this.get<ProwlarrIndexerStats>('/api/v1/indexerstats', params);
  }

  async getIndexerStatus(): Promise<ProwlarrIndexerStatus[]> {
    return this.get<ProwlarrIndexerStatus[]>('/api/v1/indexerstatus');
  }

  async getHealth(): Promise<ProwlarrHealthIssue[]> {
    return this.get<ProwlarrHealthIssue[]>('/api/v1/health');
  }

  async getDownloadClients(): Promise<ProwlarrDownloadClient[]> {
    return this.get<ProwlarrDownloadClient[]>('/api/v1/downloadclient');
  }

  async getHistory(pageSize = 25, page = 1): Promise<ProwlarrHistoryPage> {
    return this.get<ProwlarrHistoryPage>('/api/v1/history', {
      page,
      pageSize,
      sortKey: 'date',
      sortDirection: 'descending',
    });
  }

  async searchReleases(input: ProwlarrSearchInput): Promise<ProwlarrRelease[]> {
    const params: QueryParams = {
      query: input.query,
      type: input.type ?? 'search',
      indexerIds: input.indexerIds?.length ? input.indexerIds : [-2],
      categories: input.categories,
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    };
    return this.get<ProwlarrRelease[]>('/api/v1/search', params, input.timeoutMs ?? 45000);
  }

  async grabRelease(release: ProwlarrRelease): Promise<ProwlarrRelease> {
    return this.post<ProwlarrRelease>('/api/v1/search', release, {}, 30000);
  }

  async grabReleases(releases: ProwlarrRelease[]): Promise<ProwlarrRelease[]> {
    return this.post<ProwlarrRelease[]>('/api/v1/search/bulk', releases, {}, 45000);
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.getSystemStatus();
      return data.version;
    } catch { return 'unknown'; }
  }
}

type QueryPrimitive = string | number | boolean;
type QueryParams = Record<string, QueryPrimitive | QueryPrimitive[] | null | undefined>;

export interface ProwlarrSystemStatus {
  appName?: string;
  instanceName?: string;
  version: string;
  buildTime?: string;
  isProduction?: boolean;
  isDocker?: boolean;
  authentication?: string;
  urlBase?: string;
}

export interface ProwlarrIndexerSummary {
  total: number;
  enabled: number;
  searchCapable: number;
  protocols: Record<string, number>;
}

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  added: string;
  definitionName?: string;
  supportsRss?: boolean;
  supportsSearch?: boolean;
  supportsRedirect?: boolean;
  priority?: number;
  downloadClientId?: number;
  tags?: number[];
  categories?: { id: number; name: string }[];
  privacy?: string;
}

export interface ProwlarrIndexerStats {
  indexers?: ProwlarrIndexerStat[];
  userAgents?: { userAgent: string; numberOfQueries: number; numberOfGrabs: number }[];
  hosts?: { host: string; numberOfQueries: number; numberOfGrabs: number }[];
}

export interface ProwlarrIndexerStat {
  indexerId: number;
  indexerName: string;
  averageResponseTime?: number;
  averageGrabResponseTime?: number;
  numberOfQueries?: number;
  numberOfGrabs?: number;
  numberOfRssQueries?: number;
  numberOfAuthQueries?: number;
  numberOfFailedQueries?: number;
  numberOfFailedGrabs?: number;
  numberOfFailedRssQueries?: number;
  numberOfFailedAuthQueries?: number;
}

export interface ProwlarrIndexerStatus {
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  initialFailure?: string;
}

export interface ProwlarrHealthIssue {
  source?: string;
  type?: string;
  message?: string;
  wikiUrl?: string;
}

export interface ProwlarrDownloadClient {
  id: number;
  name: string;
  enable?: boolean;
  protocol?: string;
  priority?: number;
  implementationName?: string;
  implementation?: string;
  supportsCategories?: boolean;
  categories?: { name?: string; category?: string }[];
}

export interface ProwlarrSearchInput {
  query?: string;
  type?: 'search' | 'tvsearch' | 'moviesearch' | 'musicsearch' | 'booksearch' | string;
  indexerIds?: number[];
  categories?: number[];
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}

export interface ProwlarrRelease {
  id?: number;
  guid?: string;
  title: string;
  indexerId?: number;
  indexer?: string;
  protocol?: string;
  size?: number;
  files?: number;
  grabs?: number;
  publishDate?: string;
  downloadUrl?: string;
  infoUrl?: string;
  seeders?: number;
  leechers?: number;
  categories?: { id?: number; name?: string }[];
  downloadClientId?: number;
  magnetUrl?: string;
  infoHash?: string;
  [key: string]: unknown;
}

export interface ProwlarrHistoryPage {
  page?: number;
  pageSize?: number;
  sortKey?: string;
  sortDirection?: string;
  totalRecords?: number;
  records?: ProwlarrHistoryRecord[];
}

export interface ProwlarrHistoryRecord {
  id?: number;
  eventType?: string;
  successful?: boolean;
  sourceTitle?: string;
  indexerId?: number;
  indexer?: string;
  downloadId?: string;
  date?: string;
  data?: Record<string, unknown>;
}
