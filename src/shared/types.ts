export interface PluginAPI {
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  config: {
    getPluginData(): Record<string, unknown>;
    setPluginData(path: string, value: unknown): void;
    onChanged(cb: () => void): () => void;
  };
  safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plaintext: string): string;
    decryptString(base64Cipher: string): string;
  };
  state: {
    set(key: string, value: unknown): void;
    replace(next: Record<string, unknown>): void;
  };
  ui: {
    registerPanelView(desc: PanelDescriptor): void;
    registerNavigationItem(desc: NavDescriptor): void;
    registerSettingsView(desc: SettingsSectionDescriptor): void;
  };
  onAction(scope: string, handler: (action: string, data?: unknown) => void | Promise<void>): void;
  notifications: {
    show(desc: NotificationDescriptor): void;
  };
  tools: {
    register(tools: ToolDefinition[]): void;
  };
  fetch: typeof fetch;
}

export interface PanelDescriptor {
  id: string;
  title: string;
  visible: boolean;
  width?: 'default' | 'wide' | 'full';
  props?: Record<string, unknown>;
}

export interface NavDescriptor {
  id: string;
  label?: string;
  icon?: { lucide: string } | { svg: string };
  visible: boolean;
  priority?: number;
  badge?: number;
  target: { type: 'panel'; panelId: string };
}

export interface SettingsSectionDescriptor {
  id: string;
  label: string;
  priority?: number;
}

export interface NotificationDescriptor {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'success' | 'warning' | 'error';
  native?: boolean;
  autoDismissMs?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface ServiceConfig {
  url?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface PluginConfig {
  plex?: ServiceConfig;
  radarr?: ServiceConfig;
  sonarr?: ServiceConfig;
  tautulli?: ServiceConfig;
  bazarr?: ServiceConfig;
  prowlarr?: ServiceConfig;
  seer?: ServiceConfig;
  sabnzbd?: ServiceConfig;
  qbittorrent?: ServiceConfig;
  tdarr?: ServiceConfig;
  wizarr?: ServiceConfig;
}

export type ServiceName = keyof PluginConfig;
export type ServiceStatus = 'ok' | 'error' | 'unconfigured' | 'loading';

export interface TautulliSession {
  sessionKey: string;
  user: string;
  title: string;
  parentTitle: string;
  grandparentTitle: string;
  mediaType: string;
  state: string;
  viewOffset: number;
  duration: number;
  progressPercent: number;
  transcodeDecision: string;
  qualityProfile: string;
  bandwidth: number;
  ipAddress: string;
  player: string;
  thumb?: string;
  thumbDataUrl?: string;
}

export interface DownloadItem {
  id: string;
  source: 'sabnzbd' | 'qbittorrent';
  name: string;
  status: string;
  sizeBytes: number;
  sizeLeftBytes: number;
  speed: number;
  eta: string;
  progress: number;
  category?: string;
}

export interface LibraryStat {
  id: string;
  name: string;
  type: 'movie' | 'show' | 'music' | 'photo';
  count: number;
  childCount?: number;
}

export interface WizarrServer {
  id: number;
  name: string;
  serverType?: string;
  verified?: boolean;
  allowDownloads?: boolean;
  allowLiveTv?: boolean;
}

export interface WizarrLibrary {
  id: number;
  name: string;
  externalId?: string;
  serverId?: number | null;
  serverName?: string;
  enabled?: boolean;
}

export interface SearchResult {
  id: string;
  source: 'radarr' | 'sonarr';
  type: 'movie' | 'show';
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  status: 'in-library' | 'monitored' | 'missing-file' | 'not-added';
  monitored?: boolean;
  hasFile?: boolean;
  tmdbId?: number;
  tvdbId?: number;
  radarrId?: number;
  sonarrId?: number;
  qualityProfileId?: number;
  rootFolderPath?: string;
  plexLibrarySectionId?: string;
  plexLibrarySectionName?: string;
}

export interface SeerRequest {
  id: number;
  type: 'movie' | 'tv';
  status: number;
  title: string;
  year?: number;
  requestedBy?: string;
  createdAt: string;
  mediaId?: number;
  tmdbId?: number;
  tvdbId?: number;
  posterUrl?: string;
}

export interface QualityProfile { id: number; name: string; }
export interface RootFolder { id?: number; path: string; freeSpace: number; totalSpace?: number; }

export interface WizarrUser {
  id: number | string;
  username: string;
  email?: string;
  token?: string;
  expires?: string;
  auth?: string;
  server?: string;
  serverType?: string;
  createdAt?: string;
}

export interface WizarrInvitation {
  id?: number | string;
  code: string;
  url?: string;
  status?: string;
  used?: boolean;
  usesLeft?: number;
  duration?: number | string;
  specificLibraries?: number[] | string;
  unlimited?: boolean;
  createdAt?: string;
  expiresAt?: string;
  usedAt?: string;
  usedBy?: string;
  displayName?: string;
  serverNames?: string[];
}

export interface BazarrLanguage {
  name?: string;
  code2?: string;
  code3?: string;
  forced?: boolean;
  hi?: boolean;
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

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  added?: string;
  definitionName?: string;
  supportsRss?: boolean;
  supportsSearch?: boolean;
  priority?: number;
  downloadClientId?: number;
  privacy?: string;
}

export interface ProwlarrIndexerSummary {
  total: number;
  enabled: number;
  searchCapable: number;
  protocols: Record<string, number>;
}

export interface ProwlarrIndexerStatus {
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  initialFailure?: string;
}

export interface ProwlarrIndexerStat {
  indexerId: number;
  indexerName: string;
  averageResponseTime?: number;
  averageGrabResponseTime?: number;
  numberOfQueries?: number;
  numberOfGrabs?: number;
  numberOfFailedQueries?: number;
  numberOfFailedGrabs?: number;
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
}

export interface ProwlarrRelease {
  id?: number;
  guid?: string;
  title: string;
  indexerId?: number;
  indexer?: string;
  protocol?: string;
  size?: number;
  publishDate?: string;
  downloadUrl?: string;
  infoUrl?: string;
  seeders?: number;
  leechers?: number;
  categories?: { id?: number; name?: string }[];
  downloadClientId?: number;
  [key: string]: unknown;
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

export type TdarrWorkerType = 'healthcheckcpu' | 'healthcheckgpu' | 'transcodecpu' | 'transcodegpu';

export interface TdarrResourceStats {
  process?: { uptime?: number; heapUsedMB?: string | number; heapTotalMB?: string | number };
  os?: { cpuPerc?: string | number; memUsedGB?: string | number; memTotalGB?: string | number };
}

export interface TdarrWorker {
  id?: string;
  _id?: string;
  nodeId?: string;
  nodeName?: string;
  workerType?: TdarrWorkerType | string;
  percentage?: number;
  fps?: number;
  eta?: string;
  status?: string;
  step?: string;
  title?: string;
  plugin?: string;
  job?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TdarrNode {
  id: string;
  _id?: string;
  nodeName: string;
  remoteAddress?: string;
  status?: string;
  workerCount?: number;
  workerLimits?: Partial<Record<TdarrWorkerType, number>>;
  queueLengths?: Partial<Record<TdarrWorkerType, number>>;
  nodePaused?: boolean;
  scheduleEnabled?: boolean;
  resStats?: TdarrResourceStats;
  workerList?: TdarrWorker[];
  nodeEngine?: string;
  protocolVersion?: string;
  priority?: number;
}

export interface TdarrDbStatus {
  activity?: string;
  type?: string;
  count?: number;
  totalCount?: number;
}

export interface TdarrLibrary {
  _id: string;
  name?: string;
  folder?: string;
  output?: string;
  cache?: string;
  processLibrary?: boolean;
  processTranscodes?: boolean;
  processHealthChecks?: boolean;
  totalTranscodeCount?: number;
  totalHealthCheckCount?: number;
  [key: string]: unknown;
}

export interface TdarrStagedJob {
  _id: string;
  workerType?: string;
  start?: number;
  job?: Record<string, unknown>;
  originalLibraryFile?: Record<string, unknown>;
  status?: string;
  handling?: boolean;
  nodeID?: string;
  inLimbo?: boolean;
  stagedLog?: string;
  [key: string]: unknown;
}

export interface SabFullStatus {
  status: string;
  paused: boolean;
  speedLimit: string;
  speed: string;
  speedMb: number;
  sizeLeft: string;
  slots: DownloadItem[];
}

export interface SabHistoryItem {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  size?: string;
  completed?: number | string;
  failMessage?: string;
}

export interface QbitTransferInfo {
  connection_status?: string;
  dht_nodes?: number;
  dl_info_data?: number;
  dl_info_speed?: number;
  dl_rate_limit?: number;
  up_info_data?: number;
  up_info_speed?: number;
  up_rate_limit?: number;
}

export interface PluginState {
  streams: TautulliSession[];
  downloads: DownloadItem[];
  serviceStatus: Record<string, ServiceStatus>;
  libraryStats: LibraryStat[];
  libraryItems: SearchResult[];
  libraryLoading: boolean;
  pendingRequestCount: number;
  pendingRequests: SeerRequest[];
  allRequests: SeerRequest[];
  lastRefresh: number;
  searchResults: SearchResult[];
  searchLoading: boolean;
  prowlarrIndexerCount: number;
  prowlarrIndexerSummary?: ProwlarrIndexerSummary;
  prowlarrIndexers: ProwlarrIndexer[];
  prowlarrIndexerStatus: ProwlarrIndexerStatus[];
  prowlarrIndexerStats: ProwlarrIndexerStat[];
  prowlarrHealth: ProwlarrHealthIssue[];
  prowlarrDownloadClients: ProwlarrDownloadClient[];
  prowlarrHistory: ProwlarrHistoryRecord[];
  prowlarrSearchResults: ProwlarrRelease[];
  prowlarrSearchLoading: boolean;
  tdarrStatus?: string;
  tdarrNodes: TdarrNode[];
  tdarrActiveWorkers: TdarrWorker[];
  tdarrStagedJobs: TdarrStagedJob[];
  tdarrResourceStats?: TdarrResourceStats;
  tdarrDbStatuses: Record<string, TdarrDbStatus>;
  tdarrLibraries: TdarrLibrary[];
  bazarrVersion?: string;
  bazarrHealth: BazarrHealthIssue[];
  bazarrBadges?: BazarrBadges;
  bazarrWantedMovies: BazarrWantedMovie[];
  bazarrWantedEpisodes: BazarrWantedEpisode[];
  bazarrWantedMovieCount: number;
  bazarrWantedEpisodeCount: number;
  bazarrProviders: BazarrProvider[];
  bazarrTasks: BazarrTask[];
  bazarrSubtitleSearchResults: BazarrSubtitleCandidate[];
  bazarrSubtitleSearchContext?: Record<string, unknown>;
  bazarrSubtitleSearchLoading: boolean;
  sabFullStatus?: SabFullStatus;
  sabHistory: SabHistoryItem[];
  qbitTransferInfo?: QbitTransferInfo;
  lastTestResult?: { service: string; result: 'ok' | 'error'; ts: number };
  qualityProfiles: { radarr: QualityProfile[]; sonarr: QualityProfile[] };
  rootFolders: { radarr: RootFolder[]; sonarr: RootFolder[] };
  diskSpace: { source: 'radarr' | 'sonarr'; path: string; freeSpace: number; totalSpace: number }[];
  versions: Record<string, string>;
  wizarrUsers: WizarrUser[];
  wizarrInvitations: WizarrInvitation[];
  wizarrLibraries: WizarrLibrary[];
  wizarrServers: WizarrServer[];
  sabDiskSpace?: { path: string; freeSpace: number; totalSpace: number }[];
  qbitFreeSpace?: number;
}
