import type { DownloadItem, PluginAPI, PluginState, SearchResult, SeerRequest, ServiceStatus, TautulliSession } from '../shared/types.js';
import type { PlexClient, PlexLibraryItem } from './clients/plex.js';
import type { RadarrClient } from './clients/radarr.js';
import type { SonarrClient } from './clients/sonarr.js';
import type { TautulliClient } from './clients/tautulli.js';
import type { SabnzbdClient } from './clients/sabnzbd.js';
import type { QbittorrentClient } from './clients/qbittorrent.js';
import type { SeerClient } from './clients/seer.js';
import type { ProwlarrClient } from './clients/prowlarr.js';
import type { TdarrClient } from './clients/tdarr.js';
import type { BazarrClient } from './clients/bazarr.js';
import type { WizarrClient } from './clients/wizarr.js';

export interface Clients {
  plex?: PlexClient;
  radarr?: RadarrClient;
  sonarr?: SonarrClient;
  tautulli?: TautulliClient;
  sabnzbd?: SabnzbdClient;
  qbittorrent?: QbittorrentClient;
  seer?: SeerClient;
  prowlarr?: ProwlarrClient;
  tdarr?: TdarrClient;
  bazarr?: BazarrClient;
  wizarr?: WizarrClient;
}

type PlexCatalogIndex = {
  movieByTmdb: Map<number, PlexLibraryItem>;
  showByTvdb: Map<number, PlexLibraryItem>;
  titleYear: Map<string, PlexLibraryItem>;
  titleOnly: Map<string, PlexLibraryItem | null>;
};

function normalizeCatalogTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleKey(type: SearchResult['type'], title: string, year?: number): string {
  return `${type}:${normalizeCatalogTitle(title)}:${year ?? ''}`;
}

function titleOnlyKey(type: SearchResult['type'], title: string): string {
  return `${type}:${normalizeCatalogTitle(title)}`;
}

function buildPlexCatalogIndex(items: PlexLibraryItem[]): PlexCatalogIndex {
  const index: PlexCatalogIndex = {
    movieByTmdb: new Map(),
    showByTvdb: new Map(),
    titleYear: new Map(),
    titleOnly: new Map(),
  };

  for (const item of items) {
    if (item.type === 'movie' && item.tmdbId) index.movieByTmdb.set(item.tmdbId, item);
    if (item.type === 'show' && item.tvdbId) index.showByTvdb.set(item.tvdbId, item);
    if (item.title) {
      index.titleYear.set(titleKey(item.type, item.title, item.year), item);
      const simpleKey = titleOnlyKey(item.type, item.title);
      const existing = index.titleOnly.get(simpleKey);
      index.titleOnly.set(simpleKey, existing && existing.sectionId !== item.sectionId ? null : item);
    }
  }

  return index;
}

function attachPlexLibrarySection(item: SearchResult, index: PlexCatalogIndex): SearchResult {
  let match: PlexLibraryItem | undefined;
  if (item.type === 'movie' && item.tmdbId) match = index.movieByTmdb.get(item.tmdbId);
  if (!match && item.type === 'show' && item.tvdbId) match = index.showByTvdb.get(item.tvdbId);
  if (!match) {
    match = index.titleYear.get(titleKey(item.type, item.title, item.year)) ??
      index.titleOnly.get(titleOnlyKey(item.type, item.title)) ??
      undefined;
  }

  if (!match) return item;
  return {
    ...item,
    plexLibrarySectionId: match.sectionId,
    plexLibrarySectionName: match.sectionName,
  };
}

function streamEventPayload(s: TautulliSession): Record<string, unknown> {
  return {
    sessionKey: s.sessionKey, user: s.user, title: s.title,
    parentTitle: s.parentTitle, grandparentTitle: s.grandparentTitle,
    mediaType: s.mediaType, player: s.player, state: s.state,
    transcodeDecision: s.transcodeDecision, qualityProfile: s.qualityProfile,
    ipAddress: s.ipAddress, progressPercent: s.progressPercent,
  };
}

function requestEventPayload(r: SeerRequest): Record<string, unknown> {
  return {
    id: r.id, type: r.type, title: r.title, year: r.year,
    requestedBy: r.requestedBy, status: r.status,
    tmdbId: r.tmdbId, tvdbId: r.tvdbId, createdAt: r.createdAt,
  };
}

function downloadEventPayload(d: DownloadItem): Record<string, unknown> {
  return {
    id: d.id, source: d.source, name: d.name, status: d.status,
    category: d.category, sizeBytes: d.sizeBytes, progress: d.progress,
  };
}

function mediaEventPayload(source: 'radarr' | 'sonarr', item: SearchResult): Record<string, unknown> {
  return {
    source, id: source === 'radarr' ? item.radarrId : item.sonarrId,
    type: item.type, title: item.title, year: item.year, status: item.status,
    monitored: item.monitored, hasFile: item.hasFile,
    tmdbId: item.tmdbId, tvdbId: item.tvdbId,
  };
}

// Overseerr/Jellyseerr request status codes
const SEER_STATUS_APPROVED = 2;
const SEER_STATUS_DECLINED = 3;

// A queue item that disappears at/above this progress is treated as completed
// (SAB items move to history at 100%, but the last 30s poll may lag slightly);
// below it, as removed/deleted.
const DOWNLOAD_COMPLETE_THRESHOLD = 90;

// Both queue fetches are capped at this many items; at the cap, items entering
// or leaving the snapshot may just be page churn, not real queue changes.
const DOWNLOAD_PAGE_LIMIT = 50;

// progress is rounded to an integer (a qBit torrent at 99.5% reports 100),
// so completion also requires no bytes remaining.
function isDownloadComplete(d: DownloadItem): boolean {
  return d.progress >= 100 && d.sizeLeftBytes <= 0;
}

export class Poller {
  private api: PluginAPI;
  private clients: Clients;
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;
  private fastPollInFlight: Promise<void> | null = null;
  private slowPollInFlight: Promise<void> | null = null;
  private lifecycleId = 0;
  private state: PluginState = {
    streams: [],
    streamThumbnails: {},
    downloads: [],
    serviceStatus: {},
    libraryStats: [],
    libraryItems: [],
    libraryLoading: false,
    pendingRequestCount: 0,
    pendingRequests: [],
    allRequests: [],
    lastRefresh: 0,
    searchResults: [],
    searchLoading: false,
    prowlarrIndexerCount: 0,
    prowlarrIndexers: [],
    prowlarrIndexerStatus: [],
    prowlarrIndexerStats: [],
    prowlarrHealth: [],
    prowlarrDownloadClients: [],
    prowlarrHistory: [],
    prowlarrSearchResults: [],
    prowlarrSearchLoading: false,
    tdarrNodes: [],
    tdarrActiveWorkers: [],
    tdarrStagedJobs: [],
    tdarrDbStatuses: {},
    tdarrLibraries: [],
    bazarrHealth: [],
    bazarrWantedMovies: [],
    bazarrWantedEpisodes: [],
    bazarrWantedMovieCount: 0,
    bazarrWantedEpisodeCount: 0,
    bazarrProviders: [],
    bazarrTasks: [],
    bazarrSubtitleSearchResults: [],
    bazarrSubtitleSearchLoading: false,
    sabHistory: [],
    qualityProfiles: { radarr: [], sonarr: [] },
    rootFolders: { radarr: [], sonarr: [] },
    diskSpace: [],
    versions: {},
    wizarrUsers: [],
    wizarrInvitations: [],
    wizarrLibraries: [],
    wizarrServers: [],
  };

  // Event-diff baselines. `null` means "not yet primed": the first successful
  // fetch of each domain seeds the baseline without emitting, so an app launch
  // with active streams/requests doesn't fire a burst of stale events.
  private prevStreams: Map<string, TautulliSession> | null = null;
  private prevDownloads: Record<'sabnzbd' | 'qbittorrent', Map<string, DownloadItem> | null> = {
    sabnzbd: null,
    qbittorrent: null,
  };
  private prevRequests: Map<number, number> | null = null;
  private maxKnownRequestId = 0;
  private prevLibrary: Record<'radarr' | 'sonarr', Map<number, { hasFile: boolean; item: SearchResult }> | null> = {
    radarr: null,
    sonarr: null,
  };

  constructor(api: PluginAPI, clients: Clients) {
    this.api = api;
    this.clients = clients;
  }

  private emitEvent(event: string, payload: Record<string, unknown>): void {
    try {
      this.api.events?.emit(event, payload);
    } catch (e) {
      this.api.log.warn(`Event emit failed (${event}): ${e}`);
    }
  }

  private diffStreams(next: TautulliSession[]): void {
    const nextMap = new Map(next.map(s => [String(s.sessionKey), s]));
    const prev = this.prevStreams;
    this.prevStreams = nextMap;
    if (!prev) return;
    for (const [key, s] of nextMap) {
      if (!prev.has(key)) this.emitEvent('stream:started', streamEventPayload(s));
    }
    for (const [key, s] of prev) {
      if (!nextMap.has(key)) this.emitEvent('stream:stopped', streamEventPayload(s));
    }
  }

  private diffDownloads(source: 'sabnzbd' | 'qbittorrent', items: DownloadItem[]): void {
    const nextMap = new Map(items.map(d => [d.id, d]));
    const prev = this.prevDownloads[source];
    this.prevDownloads[source] = nextMap;
    if (!prev) return;
    // At the fetch cap we can't tell page churn from real adds/removes, so only
    // emit progress-transition completions (ids present in both snapshots).
    const paginated = prev.size >= DOWNLOAD_PAGE_LIMIT || nextMap.size >= DOWNLOAD_PAGE_LIMIT;
    for (const [id, d] of nextMap) {
      const before = prev.get(id);
      if (!before) {
        if (!paginated) {
          this.emitEvent('download:added', downloadEventPayload(d));
          // Small items can be added and finish within one poll interval
          if (isDownloadComplete(d)) this.emitEvent('download:completed', downloadEventPayload(d));
        }
      } else if (!isDownloadComplete(before) && isDownloadComplete(d)) {
        this.emitEvent('download:completed', downloadEventPayload(d));
      }
    }
    if (paginated) return;
    for (const [id, d] of prev) {
      if (nextMap.has(id) || isDownloadComplete(d)) continue; // still queued, or completion already emitted
      if (d.progress >= DOWNLOAD_COMPLETE_THRESHOLD) {
        this.emitEvent('download:completed', { ...downloadEventPayload(d), removedFromQueue: true });
      } else {
        this.emitEvent('download:removed', downloadEventPayload(d));
      }
    }
  }

  private diffRequests(requests: SeerRequest[]): void {
    const prev = this.prevRequests;
    const nextStatus = new Map(requests.map(r => [r.id, r.status]));
    this.prevRequests = nextStatus;
    // Requests come from a windowed "latest 100" fetch; ids are auto-increment,
    // so only ids above the previous max are genuinely new submissions (an old
    // request sliding back into the window must not re-emit "submitted").
    const maxKnown = this.maxKnownRequestId;
    for (const id of nextStatus.keys()) {
      if (id > this.maxKnownRequestId) this.maxKnownRequestId = id;
    }
    if (!prev) return;
    for (const r of requests) {
      const before = prev.get(r.id);
      if (before == null) {
        if (r.id <= maxKnown) continue;
        this.emitEvent('request:submitted', requestEventPayload(r));
        // Auto-approval can land before we ever see the request as pending
        if (r.status === SEER_STATUS_APPROVED) this.emitEvent('request:approved', requestEventPayload(r));
        if (r.status === SEER_STATUS_DECLINED) this.emitEvent('request:denied', requestEventPayload(r));
        continue;
      }
      if (before === r.status) continue;
      if (r.status === SEER_STATUS_APPROVED) this.emitEvent('request:approved', requestEventPayload(r));
      else if (r.status === SEER_STATUS_DECLINED) this.emitEvent('request:denied', requestEventPayload(r));
    }
  }

  private diffLibrary(source: 'radarr' | 'sonarr', items: SearchResult[]): void {
    const nextMap = new Map<number, { hasFile: boolean; item: SearchResult }>();
    for (const item of items) {
      const id = source === 'radarr' ? item.radarrId : item.sonarrId;
      if (id != null) nextMap.set(id, { hasFile: Boolean(item.hasFile), item });
    }
    const prev = this.prevLibrary[source];
    this.prevLibrary[source] = nextMap;
    if (!prev) return;
    for (const [id, entry] of nextMap) {
      const before = prev.get(id);
      if (!before) {
        this.emitEvent('media:added', mediaEventPayload(source, entry.item));
        // Imported with an existing file, or downloaded within one poll interval
        if (entry.hasFile) this.emitEvent('media:available', mediaEventPayload(source, entry.item));
      } else if (!before.hasFile && entry.hasFile) {
        this.emitEvent('media:available', mediaEventPayload(source, entry.item));
      }
    }
    for (const [id, entry] of prev) {
      if (!nextMap.has(id)) this.emitEvent('media:removed', mediaEventPayload(source, entry.item));
    }
  }

  /** Merge freshly-determined statuses (only the services a poll actually checked). */
  private applyServiceStatus(updates: Record<string, ServiceStatus>): void {
    const prev = this.state.serviceStatus;
    for (const [svc, st] of Object.entries(updates)) {
      const before = prev[svc];
      // Only up/down transitions are events; initial loading→ok/error is not.
      if ((before === 'ok' || before === 'error') && (st === 'ok' || st === 'error') && before !== st) {
        this.emitEvent('service:status-changed', { service: svc, from: before, to: st });
      }
    }
    this.state.serviceStatus = { ...prev, ...updates };
  }

  updateClients(clients: Clients): void {
    if (this.clients.tautulli && this.clients.tautulli !== clients.tautulli) {
      this.clients.tautulli.clearThumbnailCache();
    }
    // A rebuilt client may point at a different server (URL/key change), so its
    // event baseline is no longer comparable — re-prime instead of diffing
    // the new server's snapshot against the old one.
    if (this.clients.tautulli !== clients.tautulli) this.prevStreams = null;
    if (this.clients.sabnzbd !== clients.sabnzbd) this.prevDownloads.sabnzbd = null;
    if (this.clients.qbittorrent !== clients.qbittorrent) this.prevDownloads.qbittorrent = null;
    if (this.clients.seer !== clients.seer) {
      this.prevRequests = null;
      this.maxKnownRequestId = 0;
    }
    if (this.clients.radarr !== clients.radarr) this.prevLibrary.radarr = null;
    if (this.clients.sonarr !== clients.sonarr) this.prevLibrary.sonarr = null;
    // Reset status for swapped services too: the new server's first poll is an
    // initial check, not an up/down transition of the old one.
    const status = { ...this.state.serviceStatus };
    let anySwapped = false;
    const services = new Set([...Object.keys(this.clients), ...Object.keys(clients)]) as Set<keyof Clients>;
    for (const svc of services) {
      if (this.clients[svc] !== clients[svc]) {
        status[svc] = clients[svc] ? 'loading' : 'unconfigured';
        anySwapped = true;
      }
    }
    if (anySwapped) {
      this.state.serviceStatus = status;
      this.api.state.set('serviceStatus', status);
      // Discard in-flight polls: a response from an old client landing after
      // this point would prime the fresh baselines with old-server data.
      this.lifecycleId += 1;
      this.fastPollInFlight = null;
      this.slowPollInFlight = null;
      // An invalidated slow poll can no longer clear the loading flag itself
      if (this.state.libraryLoading) {
        this.state.libraryLoading = false;
        this.api.state.set('libraryLoading', false);
      }
    }
    this.clients = clients;
    // Poll the swapped clients right away rather than waiting out the interval
    if (anySwapped && (this.fastTimer || this.slowTimer)) {
      void this.pollFast().catch(() => undefined);
      void this.pollSlow().catch(() => undefined);
    }
  }

  initStatus(statuses: Record<string, ServiceStatus>): void {
    this.state.serviceStatus = { ...statuses };
    this.api.state.set('serviceStatus', this.state.serviceStatus);
  }

  setServiceStatus(service: string, status: ServiceStatus): void {
    this.applyServiceStatus({ ...this.state.serviceStatus, [service]: status });
    this.api.state.set('serviceStatus', this.state.serviceStatus);
  }

  start(): void {
    if (this.fastTimer || this.slowTimer) return;
    this.lifecycleId += 1;
    void this.pollFast().catch(() => undefined);
    void this.pollSlow().catch(() => undefined);
    this.fastTimer = setInterval(() => { void this.pollFast().catch(() => undefined); }, 30_000);
    this.slowTimer = setInterval(() => { void this.pollSlow().catch(() => undefined); }, 5 * 60_000);
  }

  stop(): void {
    this.lifecycleId += 1;
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null; }
    if (this.slowTimer) { clearInterval(this.slowTimer); this.slowTimer = null; }
    this.fastPollInFlight = null;
    this.slowPollInFlight = null;
    this.clearClientCaches();
  }

  getState(): PluginState {
    return this.state;
  }

  private publish(): void {
    for (const [key, value] of Object.entries(this.state)) {
      // Search result states are driven by action handlers on demand;
      // publishing the poller's stale [] would wipe active search results.
      if (
        key === 'searchResults' ||
        key === 'searchLoading' ||
        key === 'streamThumbnails' ||
        key === 'prowlarrSearchResults' ||
        key === 'prowlarrSearchLoading' ||
        key === 'bazarrSubtitleSearchResults' ||
        key === 'bazarrSubtitleSearchLoading' ||
        key === 'bazarrSubtitleSearchContext'
      ) continue;
      this.api.state.set(key, value);
    }
  }

  async refreshFast(): Promise<void> { return this.pollFast(); }
  async refreshAll(): Promise<void> { await Promise.all([this.pollFast(), this.pollSlow()]); }

  private pollFast(): Promise<void> {
    if (this.fastPollInFlight) return this.fastPollInFlight;
    const lifecycleId = this.lifecycleId;
    let poll: Promise<void>;
    poll = this.runFastPoll(lifecycleId).finally(() => {
      if (this.fastPollInFlight === poll) this.fastPollInFlight = null;
    });
    this.fastPollInFlight = poll;
    return poll;
  }

  private pollSlow(): Promise<void> {
    if (this.slowPollInFlight) return this.slowPollInFlight;
    const lifecycleId = this.lifecycleId;
    let poll: Promise<void>;
    poll = this.runSlowPoll(lifecycleId).finally(() => {
      if (this.slowPollInFlight === poll) this.slowPollInFlight = null;
    });
    this.slowPollInFlight = poll;
    return poll;
  }

  private async runFastPoll(lifecycleId: number): Promise<void> {
    // Collects only the services this poll checks; merged into serviceStatus at the end
    const status: Record<string, ServiceStatus> = {};

    const [tautulliR, sabR, qbitR, tdarrNodesR, tdarrStagedR, sabStatusR, qbitTransferR] = await Promise.allSettled([
      this.clients.tautulli    ? this.clients.tautulli.getActivity({ includeThumbnails: false }) : Promise.resolve(null),
      this.clients.sabnzbd     ? this.clients.sabnzbd.getQueue()       : Promise.resolve(null),
      this.clients.qbittorrent ? this.clients.qbittorrent.getTorrents(): Promise.resolve(null),
      this.clients.tdarr       ? this.clients.tdarr.getNodes()          : Promise.resolve(null),
      this.clients.tdarr       ? this.clients.tdarr.getStagedJobs()     : Promise.resolve(null),
      this.clients.sabnzbd     ? this.clients.sabnzbd.getFullStatus()   : Promise.resolve(null),
      this.clients.qbittorrent ? this.clients.qbittorrent.getTransferInfo() : Promise.resolve(null),
    ]);

    if (lifecycleId !== this.lifecycleId) return;

    if (this.clients.tautulli) {
      if (tautulliR.status === 'fulfilled' && tautulliR.value) {
        this.state.streams = (tautulliR.value as any).sessions;
        this.diffStreams(this.state.streams);
        status.tautulli = 'ok';
      }
      else { this.state.streams = []; status.tautulli = 'error'; }
    }

    const sabItems = (this.clients.sabnzbd && sabR.status === 'fulfilled' && sabR.value) ? sabR.value as any[] : [];
    if (this.clients.sabnzbd) status.sabnzbd = sabR.status === 'fulfilled' && sabR.value ? 'ok' : 'error';
    if (this.clients.sabnzbd && sabR.status === 'fulfilled' && sabR.value) this.diffDownloads('sabnzbd', sabItems as DownloadItem[]);
    if (sabStatusR.status === 'fulfilled' && sabStatusR.value) this.state.sabFullStatus = sabStatusR.value as any;

    const qbitItems = (this.clients.qbittorrent && qbitR.status === 'fulfilled' && qbitR.value) ? qbitR.value as any[] : [];
    if (this.clients.qbittorrent) status.qbittorrent = qbitR.status === 'fulfilled' && qbitR.value ? 'ok' : 'error';
    if (this.clients.qbittorrent && qbitR.status === 'fulfilled' && qbitR.value) this.diffDownloads('qbittorrent', qbitItems as DownloadItem[]);
    if (qbitTransferR.status === 'fulfilled' && qbitTransferR.value) this.state.qbitTransferInfo = qbitTransferR.value as any;

    if (this.clients.tdarr) {
      if (tdarrNodesR.status === 'fulfilled' && tdarrNodesR.value) {
        this.state.tdarrNodes = tdarrNodesR.value as any;
        this.state.tdarrActiveWorkers = flattenTdarrWorkers(tdarrNodesR.value as any[]);
        status.tdarr = 'ok';
      } else {
        status.tdarr = 'error';
      }
      if (tdarrStagedR.status === 'fulfilled' && tdarrStagedR.value) {
        this.state.tdarrStagedJobs = (tdarrStagedR.value as any[]).slice(0, 50);
      }
    }

    this.state.downloads = [...sabItems, ...qbitItems];
    this.applyServiceStatus(status);
    this.state.lastRefresh = Date.now();
    this.publish();
  }

  private async runSlowPoll(lifecycleId: number): Promise<void> {
    // Collects only the services this poll checks; merged into serviceStatus at the end
    const status: Record<string, ServiceStatus> = {};

    // Show loading indicator for the library while fetching
    this.state.libraryLoading = true;
    this.api.state.set('libraryLoading', true);

    // Run all slow-poll calls in parallel
    const [plexR, radarrR, sonarrR, seerPendingR, seerAllR, prowlarrR, tdarrR, bazarrR, wizarrR,
           radarrQpR, sonarrQpR, radarrRfR, sonarrRfR, radarrDsR, sonarrDsR,
           wizarrUsersR, wizarrInvsR, wizarrLibrariesR, wizarrServersR,
           plexVerR, radarrVerR, sonarrVerR, tautulliVerR, seerVerR, sabVerR, qbitVerR, prowlarrVerR, bazarrVerR, wizarrVerR,
           sabDsR, qbitStatsR, sabHistoryR] =
      await Promise.allSettled([
        this.clients.plex      ? this.clients.plex.getLibraryIndex()             : Promise.resolve(null),
        this.clients.radarr    ? this.clients.radarr.getMovies()                 : Promise.resolve(null),
        this.clients.sonarr    ? this.clients.sonarr.getSeries()                 : Promise.resolve(null),
        this.clients.seer      ? this.clients.seer.getRequests(50, 0, 'pending') : Promise.resolve(null),
        this.clients.seer      ? this.clients.seer.getRequests(100, 0, 'all')    : Promise.resolve(null),
        this.clients.prowlarr  ? this.clients.prowlarr.getIndexerStats()         : Promise.resolve(null),
        this.clients.tdarr     ? this.clients.tdarr.getStatus()                  : Promise.resolve(null),
        this.clients.bazarr    ? this.clients.bazarr.getStatus()                 : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.ping()                      : Promise.resolve(null),
        this.clients.radarr    ? this.clients.radarr.getQualityProfiles()        : Promise.resolve(null),
        this.clients.sonarr    ? this.clients.sonarr.getQualityProfiles()        : Promise.resolve(null),
        this.clients.radarr    ? this.clients.radarr.getRootFolders()            : Promise.resolve(null),
        this.clients.sonarr    ? this.clients.sonarr.getRootFolders()            : Promise.resolve(null),
        this.clients.radarr    ? this.clients.radarr.getDiskSpace()              : Promise.resolve(null),
        this.clients.sonarr    ? this.clients.sonarr.getDiskSpace()              : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.getUsers()                  : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.getInvitations()            : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.getLibraries()              : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.getServers()                : Promise.resolve(null),
        this.clients.plex      ? this.clients.plex.getVersion()                  : Promise.resolve(null),
        this.clients.radarr    ? this.clients.radarr.getVersion()                : Promise.resolve(null),
        this.clients.sonarr    ? this.clients.sonarr.getVersion()                : Promise.resolve(null),
        this.clients.tautulli  ? this.clients.tautulli.getVersion()              : Promise.resolve(null),
        this.clients.seer      ? this.clients.seer.getVersion()                  : Promise.resolve(null),
        this.clients.sabnzbd   ? this.clients.sabnzbd.getVersion()               : Promise.resolve(null),
        this.clients.qbittorrent ? this.clients.qbittorrent.getVersion()         : Promise.resolve(null),
        this.clients.prowlarr  ? this.clients.prowlarr.getVersion()              : Promise.resolve(null),
        this.clients.bazarr    ? this.clients.bazarr.getVersion()                : Promise.resolve(null),
        this.clients.wizarr    ? this.clients.wizarr.getVersion()                : Promise.resolve(null),
        this.clients.sabnzbd   ? this.clients.sabnzbd.getDiskSpace()             : Promise.resolve(null),
        this.clients.qbittorrent ? this.clients.qbittorrent.getGlobalStats()     : Promise.resolve(null),
        this.clients.sabnzbd   ? this.clients.sabnzbd.getHistory(20)             : Promise.resolve(null),
      ]);

    if (lifecycleId !== this.lifecycleId) return;

    let plexCatalogIndex = buildPlexCatalogIndex([]);
    if (this.clients.plex) {
      if (plexR.status === 'fulfilled' && plexR.value) {
        const plexData = plexR.value as { libraries: import('../shared/types.js').LibraryStat[]; media: PlexLibraryItem[] };
        this.state.libraryStats = plexData.libraries;
        plexCatalogIndex = buildPlexCatalogIndex(plexData.media);
        status.plex = 'ok';
      }
      else { status.plex = 'error'; }
    }

    const libraryItems: SearchResult[] = [];
    if (this.clients.radarr) {
      if (radarrR.status === 'fulfilled' && radarrR.value) {
        const radarrItems = this.clients.radarr.moviesAsSearchResults(radarrR.value as any).map(item => attachPlexLibrarySection(item, plexCatalogIndex));
        libraryItems.push(...radarrItems);
        this.diffLibrary('radarr', radarrItems);
        status.radarr = 'ok';
      } else { status.radarr = 'error'; }
    }
    if (this.clients.sonarr) {
      if (sonarrR.status === 'fulfilled' && sonarrR.value) {
        const sonarrItems = this.clients.sonarr.seriesAsSearchResults(sonarrR.value as any).map(item => attachPlexLibrarySection(item, plexCatalogIndex));
        libraryItems.push(...sonarrItems);
        this.diffLibrary('sonarr', sonarrItems);
        status.sonarr = 'ok';
      } else { status.sonarr = 'error'; }
    }
    if (libraryItems.length > 0 || this.clients.radarr || this.clients.sonarr) {
      this.state.libraryItems = libraryItems;
    }

    if (this.clients.seer) {
      if (seerPendingR.status === 'fulfilled' && seerPendingR.value) {
        const reqs = seerPendingR.value as any;
        this.state.pendingRequests = reqs;
        this.state.pendingRequestCount = reqs.length;
        status.seer = 'ok';
      } else { status.seer = 'error'; }
      if (seerAllR.status === 'fulfilled' && seerAllR.value) {
        this.state.allRequests = seerAllR.value as any;
        this.diffRequests(this.state.allRequests);
      }
    }

    if (radarrQpR.status === 'fulfilled' && radarrQpR.value) {
      this.state.qualityProfiles.radarr = radarrQpR.value as any;
    }
    if (sonarrQpR.status === 'fulfilled' && sonarrQpR.value) {
      this.state.qualityProfiles.sonarr = sonarrQpR.value as any;
    }
    if (radarrRfR.status === 'fulfilled' && radarrRfR.value) {
      this.state.rootFolders.radarr = (radarrRfR.value as any[]).map((f: any) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace ?? 0, totalSpace: f.totalSpace ?? 0 }));
    }
    if (sonarrRfR.status === 'fulfilled' && sonarrRfR.value) {
      this.state.rootFolders.sonarr = (sonarrRfR.value as any[]).map((f: any) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace ?? 0, totalSpace: f.totalSpace ?? 0 }));
    }

    const diskSpace: PluginState['diskSpace'] = [];
    if (radarrDsR.status === 'fulfilled' && radarrDsR.value) {
      for (const d of radarrDsR.value as any[]) {
        diskSpace.push({ source: 'radarr', path: d.path, freeSpace: d.freeSpace ?? 0, totalSpace: d.totalSpace ?? 0 });
      }
    }
    if (sonarrDsR.status === 'fulfilled' && sonarrDsR.value) {
      for (const d of sonarrDsR.value as any[]) {
        diskSpace.push({ source: 'sonarr', path: d.path, freeSpace: d.freeSpace ?? 0, totalSpace: d.totalSpace ?? 0 });
      }
    }
    if (diskSpace.length > 0) this.state.diskSpace = diskSpace;

    if (this.clients.prowlarr) {
      if (prowlarrR.status === 'fulfilled' && prowlarrR.value) {
        this.state.prowlarrIndexerSummary = prowlarrR.value as any;
        this.state.prowlarrIndexerCount = (prowlarrR.value as any).enabled;
        status.prowlarr = 'ok';
      } else { status.prowlarr = 'error'; }

      const [indexersR, indexerStatusR, indexerStatsR, healthR, clientsR, historyR] = await Promise.allSettled([
        this.clients.prowlarr.getIndexers(),
        this.clients.prowlarr.getIndexerStatus(),
        this.clients.prowlarr.getIndexerStatsDetailed(),
        this.clients.prowlarr.getHealth(),
        this.clients.prowlarr.getDownloadClients(),
        this.clients.prowlarr.getHistory(25),
      ]);
      if (indexersR.status === 'fulfilled') this.state.prowlarrIndexers = indexersR.value as any;
      if (indexerStatusR.status === 'fulfilled') this.state.prowlarrIndexerStatus = indexerStatusR.value as any;
      if (indexerStatsR.status === 'fulfilled') this.state.prowlarrIndexerStats = ((indexerStatsR.value as any).indexers ?? []) as any;
      if (healthR.status === 'fulfilled') this.state.prowlarrHealth = healthR.value as any;
      if (clientsR.status === 'fulfilled') this.state.prowlarrDownloadClients = clientsR.value as any;
      if (historyR.status === 'fulfilled') this.state.prowlarrHistory = ((historyR.value as any).records ?? []) as any;
    }

    if (this.clients.tdarr) {
      // status.tdarr is owned by the fast poll (getNodes); setting it here too
      // could flip-flop every cycle if only one of the two endpoints fails.
      if (tdarrR.status === 'fulfilled' && tdarrR.value) {
        this.state.tdarrStatus = (tdarrR.value as any).status;
      }

      const [resourceR, dbR, librariesR] = await Promise.allSettled([
        this.clients.tdarr.getResourceStats(),
        this.clients.tdarr.getDbStatuses(),
        this.clients.tdarr.getLibraries(),
      ]);
      if (resourceR.status === 'fulfilled') this.state.tdarrResourceStats = resourceR.value as any;
      if (dbR.status === 'fulfilled') this.state.tdarrDbStatuses = dbR.value as any;
      if (librariesR.status === 'fulfilled') this.state.tdarrLibraries = librariesR.value as any;
    }

    if (this.clients.bazarr) {
      if (bazarrR.status === 'fulfilled' && bazarrR.value) {
        this.state.bazarrVersion = (bazarrR.value as any).bazarr_version;
        status.bazarr = 'ok';
      } else { status.bazarr = 'error'; }

      const [healthR, badgesR, providersR, tasksR, wantedMoviesR, wantedEpisodesR] = await Promise.allSettled([
        this.clients.bazarr.getHealth(),
        this.clients.bazarr.getBadges(),
        this.clients.bazarr.getProviders(),
        this.clients.bazarr.getTasks(),
        this.clients.bazarr.getWantedMovies(0, 50),
        this.clients.bazarr.getWantedEpisodes(0, 50),
      ]);
      if (healthR.status === 'fulfilled') this.state.bazarrHealth = healthR.value as any;
      if (badgesR.status === 'fulfilled') this.state.bazarrBadges = badgesR.value as any;
      if (providersR.status === 'fulfilled') this.state.bazarrProviders = providersR.value as any;
      if (tasksR.status === 'fulfilled') this.state.bazarrTasks = tasksR.value as any;
      if (wantedMoviesR.status === 'fulfilled') {
        this.state.bazarrWantedMovies = (wantedMoviesR.value as any).data ?? [];
        this.state.bazarrWantedMovieCount = (wantedMoviesR.value as any).total ?? this.state.bazarrWantedMovies.length;
      }
      if (wantedEpisodesR.status === 'fulfilled') {
        this.state.bazarrWantedEpisodes = (wantedEpisodesR.value as any).data ?? [];
        this.state.bazarrWantedEpisodeCount = (wantedEpisodesR.value as any).total ?? this.state.bazarrWantedEpisodes.length;
      }
    }

    if (this.clients.wizarr) {
      if (wizarrR.status === 'fulfilled' && wizarrR.value) { status.wizarr = 'ok'; }
      else { status.wizarr = 'error'; }
      if (wizarrUsersR.status === 'fulfilled' && wizarrUsersR.value) {
        this.state.wizarrUsers = wizarrUsersR.value as any;
      }
      if (wizarrInvsR.status === 'fulfilled' && wizarrInvsR.value) {
        this.state.wizarrInvitations = wizarrInvsR.value as any;
      }
      if (wizarrLibrariesR.status === 'fulfilled' && wizarrLibrariesR.value) {
        this.state.wizarrLibraries = wizarrLibrariesR.value as any;
      }
      if (wizarrServersR.status === 'fulfilled' && wizarrServersR.value) {
        this.state.wizarrServers = wizarrServersR.value as any;
      }
    }

    // Collect versions
    const versions: Record<string, string> = { ...this.state.versions };
    const setVer = (svc: string, r: PromiseSettledResult<unknown>) => {
      if (r.status === 'fulfilled' && r.value && typeof r.value === 'string') versions[svc] = r.value as string;
    };
    setVer('plex',        plexVerR);
    setVer('radarr',      radarrVerR);
    setVer('sonarr',      sonarrVerR);
    setVer('tautulli',    tautulliVerR);
    setVer('seer',        seerVerR);
    setVer('sabnzbd',     sabVerR);
    setVer('qbittorrent', qbitVerR);
    setVer('prowlarr',    prowlarrVerR);
    setVer('bazarr',      bazarrVerR);
    setVer('wizarr',      wizarrVerR);
    if (tdarrR.status === 'fulfilled' && tdarrR.value) {
      const v = (tdarrR.value as any).version;
      if (v) versions['tdarr'] = String(v);
    }
    this.state.versions = versions;

    // SABnzbd disk space
    if (sabDsR.status === 'fulfilled' && sabDsR.value) {
      this.state.sabDiskSpace = sabDsR.value as any;
    }
    // qBit free space
    if (qbitStatsR.status === 'fulfilled' && qbitStatsR.value) {
      this.state.qbitFreeSpace = (qbitStatsR.value as any).freeSpace ?? 0;
    }
    if (sabHistoryR.status === 'fulfilled' && sabHistoryR.value) {
      this.state.sabHistory = sabHistoryR.value as any;
    }

    if (lifecycleId !== this.lifecycleId) return;

    this.applyServiceStatus(status);
    this.state.libraryLoading = false;
    this.publish();
  }

  async testConnection(service: string): Promise<boolean> {
    const client = (this.clients as Record<string, { ping?: () => Promise<boolean> }>)[service];
    if (!client || typeof client.ping !== 'function') return false;
    return client.ping();
  }

  private clearClientCaches(): void {
    this.clients.tautulli?.clearThumbnailCache();
    this.state.streamThumbnails = {};
    this.api.state.set('streamThumbnails', {});
  }

  setStreamThumbnail(thumb: string, dataUrl: string): void {
    if (this.state.streamThumbnails[thumb] === dataUrl) return;
    this.state.streamThumbnails = { ...this.state.streamThumbnails, [thumb]: dataUrl };
    this.api.state.set('streamThumbnails', this.state.streamThumbnails);
  }
}

function flattenTdarrWorkers(nodes: Array<{ workerList?: any[]; workers?: Record<string, any>; id?: string; _id?: string; nodeName?: string }>): any[] {
  const workers: any[] = [];
  for (const node of nodes) {
    if (Array.isArray(node.workerList)) {
      workers.push(...node.workerList);
      continue;
    }
    for (const [workerId, worker] of Object.entries(node.workers ?? {})) {
      workers.push({
        ...(worker as any),
        id: workerId,
        _id: (worker as any)._id ?? workerId,
        nodeId: node.id ?? node._id,
        nodeName: node.nodeName,
      });
    }
  }
  return workers;
}
