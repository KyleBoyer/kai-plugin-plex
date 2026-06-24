import type { SearchResult } from '../../shared/types.js';

export class RadarrClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private endpoint(path: string, params: Record<string, string> = {}): string {
    const p = new URLSearchParams({ apikey: this.apiKey, ...params });
    return `${this.url}${path}?${p}`;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(this.endpoint(path, params), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Radarr ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async ping(): Promise<boolean> {
    try {
      await this.get('/api/v3/system/status');
      return true;
    } catch {
      return false;
    }
  }

  async getMovies(): Promise<RadarrMovie[]> {
    return this.get<RadarrMovie[]>('/api/v3/movie');
  }

  async lookupMovies(term: string): Promise<RadarrMovie[]> {
    return this.get<RadarrMovie[]>('/api/v3/movie/lookup', { term });
  }

  async addMovie(tmdbId: number, title: string, year: number, options: RadarrAddMovieOptions): Promise<RadarrMovie> {
    const res = await this.fetchFn(this.endpoint('/api/v3/movie'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdbId,
        title,
        year,
        qualityProfileId: options.qualityProfileId,
        rootFolderPath: options.rootFolderPath,
        monitored: options.monitored ?? true,
        minimumAvailability: options.minimumAvailability ?? 'released',
        addOptions: { searchForMovie: options.searchOnAdd ?? true },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Radarr add movie: ${res.status} ${text}`);
    }
    return res.json() as Promise<RadarrMovie>;
  }

  async removeMovie(movieId: number, deleteFiles = false): Promise<void> {
    const res = await this.fetchFn(this.endpoint(`/api/v3/movie/${movieId}`, { deleteFiles: String(deleteFiles) }), {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Radarr remove movie: ${res.status}`);
  }

  async toggleMonitor(movieId: number, monitored: boolean): Promise<void> {
    const existing = await this.get<RadarrMovie & Record<string, unknown>>(`/api/v3/movie/${movieId}`);
    const res = await this.fetchFn(this.endpoint(`/api/v3/movie/${movieId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...existing, monitored }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Radarr toggle monitor: ${res.status}`);
  }

  async getRootFolders(): Promise<{ id: number; path: string; freeSpace: number }[]> {
    return this.get('/api/v3/rootfolder');
  }

  async getQualityProfiles(): Promise<{ id: number; name: string }[]> {
    return this.get('/api/v3/qualityprofile');
  }

  async getDiskSpace(): Promise<{ path: string; freeSpace: number; totalSpace: number }[]> {
    return this.get('/api/v3/diskspace');
  }

  async searchMovie(movieId: number): Promise<void> {
    const res = await this.fetchFn(this.endpoint('/api/v3/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Radarr searchMovie: ${res.status}`);
  }

  async editMovie(movieId: number, changes: { qualityProfileId?: number; rootFolderPath?: string }, moveFiles = false): Promise<void> {
    const existing = await this.get<RadarrMovie & Record<string, unknown>>(`/api/v3/movie/${movieId}`);
    const updated: Record<string, unknown> = { ...existing, ...changes };
    // When the root folder changes, recompute the full `path`. Radarr only relocates
    // files when the submitted `path` differs from the stored one; updating
    // `rootFolderPath` alone leaves `path` stale and the move is silently skipped.
    if (changes.rootFolderPath) {
      const folderName = basename(String(existing.path ?? ''));
      if (folderName) updated.path = joinPath(changes.rootFolderPath, folderName);
    }
    const url = moveFiles
      ? this.endpoint(`/api/v3/movie/${movieId}`, { moveFiles: 'true' })
      : this.endpoint(`/api/v3/movie/${movieId}`);
    const res = await this.fetchFn(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Radarr editMovie: ${res.status}`);
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.get<{ version: string }>('/api/v3/system/status');
      return data.version;
    } catch { return 'unknown'; }
  }

  moviesAsSearchResults(movies: RadarrMovie[]): SearchResult[] {
    return movies.map(m => ({
      id: `radarr-${m.id ?? m.tmdbId}`,
      source: 'radarr' as const,
      type: 'movie' as const,
      title: m.title,
      year: m.year,
      overview: m.overview,
      poster: m.images?.find(i => i.coverType === 'poster')?.remoteUrl,
      status: m.id ? (m.hasFile ? 'in-library' : m.monitored ? 'monitored' : 'missing-file') : 'not-added',
      monitored: m.monitored,
      hasFile: m.hasFile,
      tmdbId: m.tmdbId,
      radarrId: m.id,
      qualityProfileId: m.qualityProfileId,
      rootFolderPath: m.rootFolderPath,
    }));
  }
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
}

function joinPath(root: string, child: string): string {
  return `${root.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

export interface RadarrMovie {
  id?: number;
  title: string;
  year: number;
  overview?: string;
  tmdbId: number;
  monitored: boolean;
  hasFile: boolean;
  status?: string;
  certification?: string;
  contentRating?: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  images?: { coverType: string; remoteUrl: string }[];
}

export interface RadarrAddMovieOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  searchOnAdd?: boolean;
  minimumAvailability?: 'announced' | 'inCinemas' | 'released' | 'preDB' | string;
}
