import type { LibraryStat } from '../../shared/types.js';

export class PlexClient {
  private url: string;
  private token: string;
  private fetchFn: typeof fetch;

  constructor(url: string, token: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private endpoint(path: string): string {
    const sep = path.includes('?') ? '&' : '?';
    return `${this.url}${path}${sep}X-Plex-Token=${this.token}`;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchFn(this.endpoint('/identity'), { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const res = await this.fetchFn(this.endpoint('/identity'), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return 'unknown';
      const data = await res.json() as { MediaContainer?: { version?: string } };
      return data.MediaContainer?.version ?? 'unknown';
    } catch { return 'unknown'; }
  }

  async getLibraries(): Promise<LibraryStat[]> {
    const res = await this.fetchFn(this.endpoint('/library/sections'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Plex libraries: ${res.status}`);
    const data = await res.json() as { MediaContainer: { Directory: PlexDirectory[] } };
    const dirs = data.MediaContainer?.Directory ?? [];
    return dirs.map(d => ({
      id: String(d.key),
      name: d.title,
      type: d.type === 'movie' ? 'movie' : d.type === 'show' ? 'show' : d.type === 'artist' ? 'music' : 'photo',
      count: d.type === 'movie' || d.type === 'show' ? (d.totalSize ?? d.scannedAt ?? 0) : 0,
    }));
  }

  async getLibraryCounts(): Promise<LibraryStat[]> {
    const res = await this.fetchFn(this.endpoint('/library/sections'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Plex sections: ${res.status}`);
    const data = await res.json() as { MediaContainer: { Directory: PlexDirectory[] } };
    const dirs = data.MediaContainer?.Directory ?? [];

    const stats: LibraryStat[] = [];
    for (const d of dirs) {
      let count = 0;
      try {
        const all = await this.fetchFn(this.endpoint(`/library/sections/${d.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (all.ok) {
          const allData = await all.json() as { MediaContainer: { totalSize: number } };
          count = allData.MediaContainer?.totalSize ?? 0;
        }
      } catch { /* best effort */ }
      stats.push({
        id: String(d.key),
        name: d.title,
        type: d.type === 'movie' ? 'movie' : d.type === 'show' ? 'show' : d.type === 'artist' ? 'music' : 'photo',
        count,
      });
    }
    return stats;
  }

  async getLibraryIndex(): Promise<{ libraries: LibraryStat[]; media: PlexLibraryItem[] }> {
    const libraries = await this.getLibraryCounts();
    const media = await this.getLibraryMedia(libraries);
    return { libraries, media };
  }

  async getLibraryMedia(libraries?: LibraryStat[]): Promise<PlexLibraryItem[]> {
    const libs = libraries ?? await this.getLibraries();
    const media: PlexLibraryItem[] = [];
    for (const lib of libs) {
      if (lib.type !== 'movie' && lib.type !== 'show') continue;
      const mediaType = lib.type;
      const sectionItems = await this.getSectionMetadata(lib.id);
      for (const item of sectionItems) {
        const ids = this.externalIds(item);
        media.push({
          sectionId: lib.id,
          sectionName: lib.name,
          type: mediaType,
          title: item.title ?? '',
          year: this.itemYear(item),
          tmdbId: ids.tmdbId,
          tvdbId: ids.tvdbId,
          imdbId: ids.imdbId,
          ratingKey: item.ratingKey,
          contentRating: item.contentRating || undefined,
        });
      }
    }
    return media;
  }

  private async getSectionMetadata(sectionId: string): Promise<PlexMetadata[]> {
    const pageSize = 1000;
    let start = 0;
    let total = Number.POSITIVE_INFINITY;
    const items: PlexMetadata[] = [];

    while (start < total) {
      const res = await this.fetchFn(this.endpoint(`/library/sections/${encodeURIComponent(sectionId)}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Plex section ${sectionId}: ${res.status}`);
      const data = await res.json() as { MediaContainer?: { Metadata?: PlexMetadata[]; totalSize?: number; size?: number } };
      const container = data.MediaContainer;
      const page = container?.Metadata ?? [];
      total = container?.totalSize ?? (start + page.length);
      items.push(...page);
      if (page.length === 0) break;
      start += page.length;
    }

    return items;
  }

  private externalIds(item: PlexMetadata): { tmdbId?: number; tvdbId?: number; imdbId?: string } {
    const ids = [item.guid, ...(item.Guid ?? []).map(g => g.id)].filter((id): id is string => Boolean(id));
    let tmdbId: number | undefined;
    let tvdbId: number | undefined;
    let imdbId: string | undefined;

    for (const id of ids) {
      const tmdb = id.match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
      if (!tmdbId && tmdb) tmdbId = Number(tmdb[1]);

      const tvdb = id.match(/tvdb:\/\/(\d+)/i);
      if (!tvdbId && tvdb) tvdbId = Number(tvdb[1]);

      const imdb = id.match(/imdb:\/\/(tt\d+)/i);
      if (!imdbId && imdb) imdbId = imdb[1];
    }

    return { tmdbId, tvdbId, imdbId };
  }

  private itemYear(item: PlexMetadata): number | undefined {
    if (typeof item.year === 'number') return item.year;
    const year = item.originallyAvailableAt?.slice(0, 4);
    if (!year) return undefined;
    const numeric = Number(year);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  async refreshLibrary(sectionId: string | number): Promise<void> {
    const id = String(sectionId).trim();
    if (!id) throw new Error('Plex refreshLibrary: missing section id');
    const res = await this.fetchFn(this.endpoint(`/library/sections/${encodeURIComponent(id)}/refresh`), {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Plex refresh library ${id}: ${res.status}`);
  }

  async refreshAllLibraries(): Promise<{ refreshed: LibraryStat[] }> {
    const libraries = await this.getLibraries();
    await Promise.all(libraries.map(lib => this.refreshLibrary(lib.id)));
    return { refreshed: libraries };
  }
}

interface PlexDirectory {
  key: string;
  title: string;
  type: string;
  totalSize?: number;
  scannedAt?: number;
}

interface PlexMetadata {
  ratingKey?: string;
  title?: string;
  year?: number;
  originallyAvailableAt?: string;
  guid?: string;
  Guid?: { id: string }[];
  contentRating?: string;
}

export interface PlexLibraryItem {
  sectionId: string;
  sectionName: string;
  type: 'movie' | 'show';
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  ratingKey?: string;
  contentRating?: string;
}
