import type { SearchResult } from '../../shared/types.js';

export class SonarrClient {
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
    if (!res.ok) throw new Error(`Sonarr ${path}: ${res.status}`);
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

  async getSeries(): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>('/api/v3/series');
  }

  async lookupSeries(term: string): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>('/api/v3/series/lookup', { term });
  }

  async addSeries(tvdbId: number, title: string, options: SonarrAddSeriesOptions): Promise<SonarrSeries> {
    const res = await this.fetchFn(this.endpoint('/api/v3/series'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tvdbId,
        title,
        qualityProfileId: options.qualityProfileId,
        rootFolderPath: options.rootFolderPath,
        monitored: options.monitored ?? true,
        seasonFolder: options.seasonFolder ?? true,
        seriesType: options.seriesType ?? 'standard',
        seasons: options.seasons,
        addOptions: { searchForMissingEpisodes: options.searchOnAdd ?? true },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Sonarr add series: ${res.status} ${text}`);
    }
    return res.json() as Promise<SonarrSeries>;
  }

  async removeSeries(seriesId: number, deleteFiles = false): Promise<void> {
    const res = await this.fetchFn(this.endpoint(`/api/v3/series/${seriesId}`, { deleteFiles: String(deleteFiles) }), {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Sonarr remove series: ${res.status}`);
  }

  async toggleMonitor(seriesId: number, monitored: boolean): Promise<void> {
    const existing = await this.get<SonarrSeries>(`/api/v3/series/${seriesId}`);
    const res = await this.fetchFn(this.endpoint(`/api/v3/series/${seriesId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...existing, monitored }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Sonarr toggle monitor: ${res.status}`);
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

  async searchSeries(seriesId: number): Promise<void> {
    const res = await this.fetchFn(this.endpoint('/api/v3/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SeriesSearch', seriesId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Sonarr searchSeries: ${res.status}`);
  }

  async editSeries(seriesId: number, changes: { qualityProfileId?: number; rootFolderPath?: string }, moveFiles = false): Promise<void> {
    const existing = await this.get<SonarrSeries & Record<string, unknown>>(`/api/v3/series/${seriesId}`);
    const updated: Record<string, unknown> = { ...existing, ...changes };
    // When the root folder changes, recompute the full `path`. Sonarr only relocates
    // files when the submitted `path` differs from the stored one; updating
    // `rootFolderPath` alone leaves `path` stale and the move is silently skipped.
    if (changes.rootFolderPath) {
      const folderName = basename(String(existing.path ?? ''));
      if (folderName) updated.path = joinPath(changes.rootFolderPath, folderName);
    }
    const url = moveFiles
      ? this.endpoint(`/api/v3/series/${seriesId}`, { moveFiles: 'true' })
      : this.endpoint(`/api/v3/series/${seriesId}`);
    const res = await this.fetchFn(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Sonarr editSeries: ${res.status}`);
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.get<{ version: string }>('/api/v3/system/status');
      return data.version;
    } catch { return 'unknown'; }
  }

  seriesAsSearchResults(series: SonarrSeries[]): SearchResult[] {
    return series.map(s => {
      const episodeFileCount = s.episodeFileCount ?? 0;
      const episodeCount = s.episodeCount ?? 0;
      const hasFiles = episodeFileCount > 0;
      const status: SearchResult['status'] = s.id
        ? (hasFiles ? (episodeFileCount < episodeCount ? 'monitored' : 'in-library') : (s.monitored ? 'monitored' : 'missing-file'))
        : 'not-added';
      return {
        id: `sonarr-${s.id ?? s.tvdbId}`,
        source: 'sonarr' as const,
        type: 'show' as const,
        title: s.title,
        year: s.year,
        overview: s.overview,
        poster: s.images?.find(i => i.coverType === 'poster')?.remoteUrl,
        status,
        monitored: s.monitored,
        hasFile: hasFiles,
        tvdbId: s.tvdbId,
        sonarrId: s.id,
        qualityProfileId: s.qualityProfileId,
        rootFolderPath: s.rootFolderPath,
      };
    });
  }
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
}

function joinPath(root: string, child: string): string {
  return `${root.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

export interface SonarrSeries {
  id?: number;
  title: string;
  year: number;
  overview?: string;
  tvdbId: number;
  monitored: boolean;
  status?: string;
  certification?: string;
  contentRating?: string;
  episodeCount?: number;
  episodeFileCount?: number;
  qualityProfileId?: number;
  rootFolderPath?: string;
  images?: { coverType: string; remoteUrl: string }[];
}

export interface SonarrAddSeriesOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  searchOnAdd?: boolean;
  seasonFolder?: boolean;
  seriesType?: 'standard' | 'daily' | 'anime' | string;
  seasons?: { seasonNumber: number; monitored: boolean }[];
}
