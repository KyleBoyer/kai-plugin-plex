import type { SeerRequest, SearchResult } from '../../shared/types.js';

export class SeerClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private headers(): Record<string, string> {
    return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const p = new URLSearchParams(params);
    const url = `${this.url}${path}${Object.keys(params).length ? '?' + p : ''}`;
    const res = await this.fetchFn(url, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Seer ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async ping(): Promise<boolean> {
    try {
      await this.get('/api/v1/status');
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.get<{ version?: string }>('/api/v1/status');
      return data.version ?? 'unknown';
    } catch { return 'unknown'; }
  }

  async search(query: string): Promise<SearchResult[]> {
    const data = await this.get<{ results: SeerSearchItem[] }>('/api/v1/search', { query, page: '1' });
    return (data.results ?? []).map(normalizeSearchItem);
  }

  async getRequests(take = 20, skip = 0, filter: 'all' | 'pending' | 'approved' = 'all'): Promise<SeerRequest[]> {
    const data = await this.get<{ results: SeerRequestRaw[] }>('/api/v1/request', {
      take: String(take),
      skip: String(skip),
      sort: 'added',
      filter,
    });
    const rawRequests = data.results ?? [];
    const requests = rawRequests.map(normalizeRequest);

    // Enrich requests by fetching media details (gets titles + posters)
    await Promise.allSettled(
      requests.map(async (req, i) => {
        const raw = rawRequests[i];
        const tmdbId = raw.media?.tmdbId;
        if (!tmdbId) return;
        try {
          const endpoint = raw.type === 'tv' ? `/api/v1/tv/${tmdbId}` : `/api/v1/movie/${tmdbId}`;
          const detail = await this.get<SeerMediaDetail>(endpoint);
          if (!req.title || req.title === 'Unknown') {
            req.title = detail.title ?? detail.name ?? detail.originalTitle ?? detail.originalName ?? req.title;
          }
          if (!req.year) {
            const d = detail.releaseDate ?? detail.firstAirDate ?? '';
            if (d) req.year = new Date(d).getFullYear();
          }
          if (detail.posterPath) {
            req.posterUrl = `https://image.tmdb.org/t/p/w92${detail.posterPath}`;
          }
          req.tmdbId = tmdbId;
          req.tvdbId = raw.media?.tvdbId;
        } catch { /* best effort */ }
      })
    );

    return requests;
  }

  async approveRequest(requestId: number): Promise<void> {
    const res = await this.fetchFn(`${this.url}/api/v1/request/${requestId}/approve`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Seer approve: ${res.status}`);
  }

  async denyRequest(requestId: number): Promise<void> {
    const res = await this.fetchFn(`${this.url}/api/v1/request/${requestId}/decline`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Seer deny: ${res.status}`);
  }

  async requestMovie(tmdbId: number): Promise<void> {
    const res = await this.fetchFn(`${this.url}/api/v1/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ mediaType: 'movie', mediaId: tmdbId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Seer request movie: ${res.status} ${text}`);
    }
  }

  async requestTv(tmdbId: number, seasons: number[] = []): Promise<void> {
    const res = await this.fetchFn(`${this.url}/api/v1/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ mediaType: 'tv', mediaId: tmdbId, seasons }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Seer request tv: ${res.status} ${text}`);
    }
  }
}

function normalizeRequest(r: SeerRequestRaw): SeerRequest {
  const media = r.media ?? {};
  const title = media.title ?? media.name ?? media.originalTitle ?? media.originalName ?? 'Unknown';
  const posterPath = media.posterPath;
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w92${posterPath}` : undefined;
  const dateStr = media.releaseDate ?? media.firstAirDate;
  const year = dateStr ? new Date(dateStr).getFullYear() : undefined;
  const requestedBy = r.requestedBy?.displayName ?? r.requestedBy?.plexUsername
    ?? r.requestedBy?.jellyfinUsername ?? r.requestedBy?.username;
  return {
    id: r.id,
    type: r.type === 'tv' ? 'tv' : 'movie',
    status: r.status,
    title,
    year,
    requestedBy,
    createdAt: r.createdAt,
    mediaId: media.id,
    tmdbId: media.tmdbId,
    tvdbId: media.tvdbId,
    posterUrl,
  };
}

function normalizeSearchItem(item: SeerSearchItem): SearchResult {
  return {
    id: `seer-${item.mediaType}-${item.id}`,
    source: item.mediaType === 'tv' ? 'sonarr' : 'radarr',
    type: item.mediaType === 'tv' ? 'show' : 'movie',
    title: item.title ?? item.name ?? 'Unknown',
    year: item.releaseDate ? new Date(item.releaseDate).getFullYear()
      : item.firstAirDate ? new Date(item.firstAirDate).getFullYear() : undefined,
    overview: item.overview,
    poster: item.posterPath ? `https://image.tmdb.org/t/p/w92${item.posterPath}` : undefined,
    status: item.mediaInfo?.status === 5 ? 'in-library' : item.mediaInfo?.status === 3 ? 'monitored' : 'not-added',
    tmdbId: item.id,
  };
}

interface SeerSearchItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title?: string;
  name?: string;
  overview?: string;
  posterPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
  mediaInfo?: { status: number };
}

interface SeerRequestRaw {
  id: number;
  type: string;
  status: number;
  createdAt: string;
  media?: {
    id?: number;
    tmdbId?: number;
    tvdbId?: number;
    title?: string;
    name?: string;
    originalTitle?: string;
    originalName?: string;
    releaseDate?: string;
    firstAirDate?: string;
    posterPath?: string;
    mediaType?: string;
  };
  requestedBy?: {
    displayName?: string;
    plexUsername?: string;
    jellyfinUsername?: string;
    username?: string;
  };
}

interface SeerMediaDetail {
  title?: string;
  name?: string;
  originalTitle?: string;
  originalName?: string;
  releaseDate?: string;
  firstAirDate?: string;
  posterPath?: string;
}
