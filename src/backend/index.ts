import { PlexClient } from '../main/clients/plex.js';
import { RadarrClient } from '../main/clients/radarr.js';
import { SonarrClient } from '../main/clients/sonarr.js';
import { TautulliClient } from '../main/clients/tautulli.js';
import { BazarrClient } from '../main/clients/bazarr.js';
import { ProwlarrClient } from '../main/clients/prowlarr.js';
import { SeerClient } from '../main/clients/seer.js';
import { SabnzbdClient } from '../main/clients/sabnzbd.js';
import { QbittorrentClient } from '../main/clients/qbittorrent.js';
import { TdarrClient } from '../main/clients/tdarr.js';
import { WizarrClient } from '../main/clients/wizarr.js';
import { Poller, type Clients } from '../main/poller.js';
import { buildPlexTools } from '../main/tools.js';
import type { PluginAPI, PluginConfig, ServiceConfig } from '../shared/types.js';

const PANEL_ID = 'plex-panel';
const NAV_ID = 'plex-nav';
const SETTINGS_ID = 'plex-settings';

const SAFE_PREFIX = 'safe:';
const SERVICE_NAMES: (keyof PluginConfig)[] = [
  'plex','radarr','sonarr','tautulli','bazarr','prowlarr',
  'seer','sabnzbd','qbittorrent','tdarr','wizarr',
];

function encryptKey(api: PluginAPI, plaintext: string): string {
  if (!api.safeStorage.isEncryptionAvailable()) return plaintext;
  return SAFE_PREFIX + api.safeStorage.encryptString(plaintext);
}

function decryptKey(api: PluginAPI, stored: string): string {
  if (!stored.startsWith(SAFE_PREFIX)) return stored;
  try {
    return api.safeStorage.decryptString(stored.slice(SAFE_PREFIX.length));
  } catch {
    return '';
  }
}

// Encrypt any plaintext API keys left in the config (e.g. from pre-populated settings.json)
function migrateKeys(api: PluginAPI): void {
  if (!api.safeStorage.isEncryptionAvailable()) return;
  const config = api.config.getPluginData() as PluginConfig;
  for (const svc of SERVICE_NAMES) {
    const sc = (config as Record<string, ServiceConfig>)[svc as string];
    if (sc?.apiKey && !sc.apiKey.startsWith(SAFE_PREFIX)) {
      api.config.setPluginData(`${svc}.apiKey`, encryptKey(api, sc.apiKey));
    }
  }
}

const PLEX_TV_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`;

let poller: Poller | null = null;
let unsubConfig: (() => void) | null = null;

function buildAllClients(api: PluginAPI, config: PluginConfig, fetchFn: typeof fetch): Clients {
  function make<T>(
    svc: ServiceConfig | undefined,
    Cls: new (url: string, key: string, f: typeof fetch) => T,
  ): T | undefined {
    if (svc?.enabled === false) return undefined;
    if (!svc?.url || !svc.apiKey) return undefined;
    const key = decryptKey(api, svc.apiKey);
    if (!key) return undefined;
    return new Cls(svc.url, key, fetchFn);
  }

  return {
    plex:         make(config.plex,         PlexClient),
    radarr:       make(config.radarr,       RadarrClient),
    sonarr:       make(config.sonarr,       SonarrClient),
    tautulli:     make(config.tautulli,     TautulliClient),
    bazarr:       make(config.bazarr,       BazarrClient),
    prowlarr:     make(config.prowlarr,     ProwlarrClient),
    seer:         make(config.seer,         SeerClient),
    sabnzbd:      make(config.sabnzbd,      SabnzbdClient),
    qbittorrent:  make(config.qbittorrent,  QbittorrentClient),
    tdarr:        make(config.tdarr,        TdarrClient),
    wizarr:       make(config.wizarr,       WizarrClient),
  };
}

export async function activate(api: PluginAPI): Promise<void> {
  api.log.info('Plex plugin activating');

  // Encrypt any plaintext keys left in settings (e.g. from pre-populated settings.json)
  migrateKeys(api);

  const config = api.config.getPluginData() as PluginConfig;
  const allClients = buildAllClients(api, config, api.fetch);

  poller = new Poller(api, allClients);

  // Immediately publish initial status: 'loading' for configured services, 'unconfigured' otherwise
  const serviceNames: (keyof typeof allClients)[] = [
    'plex','radarr','sonarr','tautulli','bazarr','prowlarr','seer','sabnzbd','qbittorrent','tdarr','wizarr',
  ];
  const initialStatus: Record<string, import('../shared/types.js').ServiceStatus> = {};
  for (const svc of serviceNames) {
    initialStatus[svc] = allClients[svc] ? 'loading' : 'unconfigured';
  }
  poller.initStatus(initialStatus);

  // Register UI
  api.ui.registerPanelView({
    id: PANEL_ID,
    title: 'Plex & Media Stack',
    visible: true,
    width: 'full',
  });

  api.ui.registerNavigationItem({
    id: NAV_ID,
    visible: true,
    priority: 30,
    target: { type: 'panel', panelId: PANEL_ID },
  });

  api.ui.registerSettingsView({
    id: SETTINGS_ID,
    label: 'Plex & Media Stack',
    priority: 30,
  });

  // Register action handlers
  api.onAction(`panel:${PANEL_ID}`, async (action, data) => {
    await handlePanelAction(api, allClients, action, data);
  });

  api.onAction(`settings:${SETTINGS_ID}`, async (action, data) => {
    await handleSettingsAction(api, action, data, allClients);
  });

  // Register AI tools
  api.tools.register(buildPlexTools(allClients));

  // Watch for config changes
  unsubConfig = api.config.onChanged(() => {
    const updated = api.config.getPluginData() as PluginConfig;
    const newClients = buildAllClients(api, updated, api.fetch);
    Object.assign(allClients, newClients);
    if (poller) poller.updateClients(newClients);
    api.log.info('Plex plugin config updated, clients reinitialized');
  });

  // Start polling
  poller.start();

  api.log.info('Plex plugin activated');
}

let _searchSeq = 0;

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => Number(v)).filter(Number.isFinite);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function optionalBool(value: unknown, fallback: boolean): boolean {
  return value == null ? fallback : Boolean(value);
}

async function requireAddSettings(
  qualityProfileId: unknown,
  rootFolderPath: unknown,
  profiles: { id: number; name: string }[],
  rootFolders: { path: string }[],
): Promise<{ qualityProfileId: number; rootFolderPath: string }> {
  const qp = Number(qualityProfileId);
  const rf = stringValue(rootFolderPath);
  const resolvedQp = Number.isFinite(qp) && qp > 0 ? qp : (profiles.length === 1 ? profiles[0].id : 0);
  const resolvedRf = rf || (rootFolders.length === 1 ? rootFolders[0].path : '');
  if (!resolvedQp) throw new Error('Choose a quality profile before adding this item.');
  if (!resolvedRf) throw new Error('Choose a root folder before adding this item.');
  return { qualityProfileId: resolvedQp, rootFolderPath: resolvedRf };
}

function releaseArray(value: unknown): any[] {
  return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
}

async function refreshFastPoller(): Promise<void> {
  if (poller) await poller.refreshFast();
}

async function refreshAllPoller(): Promise<void> {
  if (poller) await poller.refreshAll();
}

async function handlePanelAction(
  api: PluginAPI,
  clients: ReturnType<typeof buildAllClients>,
  action: string,
  data?: unknown,
): Promise<void> {
  const payload = (data ?? {}) as Record<string, unknown>;

  switch (action) {
    case 'search': {
      const query = String(payload.query ?? '').trim();
      const type = String(payload.type ?? 'all');
      if (!query) return;

      const seq = ++_searchSeq;
      api.state.set('searchLoading', true);
      // Run radarr + sonarr lookups in parallel; only publish if still the latest search
      const [radarrResults, sonarrResults] = await Promise.allSettled([
        (type === 'all' || type === 'movie') && clients.radarr
          ? clients.radarr.lookupMovies(query).then(m => clients.radarr!.moviesAsSearchResults(m.slice(0, 20)))
          : Promise.resolve([]),
        (type === 'all' || type === 'show') && clients.sonarr
          ? clients.sonarr.lookupSeries(query).then(s => clients.sonarr!.seriesAsSearchResults(s.slice(0, 20)))
          : Promise.resolve([]),
      ]);
      const results: unknown[] = [
        ...(radarrResults.status === 'fulfilled' ? radarrResults.value : []),
        ...(sonarrResults.status === 'fulfilled' ? sonarrResults.value : []),
      ];
      if (radarrResults.status === 'rejected') api.log.warn(`Radarr search error: ${radarrResults.reason}`);
      if (sonarrResults.status === 'rejected') api.log.warn(`Sonarr search error: ${sonarrResults.reason}`);

      // Only publish if this is still the latest search (discard stale results)
      if (seq === _searchSeq) {
        api.state.set('searchResults', results);
        api.state.set('searchLoading', false);
      }
      break;
    }

    case 'add-movie': {
      const { tmdbId, title, year } = payload;
      if (!clients.radarr) { api.log.warn('Radarr not configured'); return; }
      try {
        const [rootFolders, qualityProfiles] = await Promise.all([
          clients.radarr.getRootFolders(),
          clients.radarr.getQualityProfiles(),
        ]);
        const addSettings = await requireAddSettings(payload.qualityProfileId, payload.rootFolderPath, qualityProfiles, rootFolders);
        await clients.radarr.addMovie(Number(tmdbId), String(title), Number(year), {
          ...addSettings,
          monitored: optionalBool(payload.monitored, true),
          searchOnAdd: optionalBool(payload.searchOnAdd, true),
          minimumAvailability: stringValue(payload.minimumAvailability, 'released'),
        });
        api.notifications.show({
          id: `plex-add-movie-${tmdbId}`,
          title: 'Movie Added',
          body: `${title} (${year}) added to Radarr`,
          level: 'success',
          native: true,
          autoDismissMs: 5000,
        });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Add movie failed: ${e}`);
        api.notifications.show({
          id: `plex-add-movie-err-${tmdbId}`,
          title: 'Add Movie Failed',
          body: String(e),
          level: 'error',
          autoDismissMs: 8000,
        });
      }
      break;
    }

    case 'add-show': {
      const { tvdbId, title } = payload;
      if (!clients.sonarr) { api.log.warn('Sonarr not configured'); return; }
      try {
        const [rootFolders, qualityProfiles] = await Promise.all([
          clients.sonarr.getRootFolders(),
          clients.sonarr.getQualityProfiles(),
        ]);
        const addSettings = await requireAddSettings(payload.qualityProfileId, payload.rootFolderPath, qualityProfiles, rootFolders);
        await clients.sonarr.addSeries(Number(tvdbId), String(title), {
          ...addSettings,
          monitored: optionalBool(payload.monitored, true),
          searchOnAdd: optionalBool(payload.searchOnAdd, true),
          seasonFolder: optionalBool(payload.seasonFolder, true),
          seriesType: stringValue(payload.seriesType, 'standard'),
          seasons: Array.isArray(payload.seasons)
            ? payload.seasons.map((season: any) => ({
                seasonNumber: finiteNumber(season.seasonNumber ?? season, 0),
                monitored: optionalBool(season.monitored, true),
              })).filter(season => season.seasonNumber >= 0)
            : undefined,
        });
        api.notifications.show({
          id: `plex-add-show-${tvdbId}`,
          title: 'Show Added',
          body: `${title} added to Sonarr`,
          level: 'success',
          native: true,
          autoDismissMs: 5000,
        });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Add show failed: ${e}`);
        api.notifications.show({
          id: `plex-add-show-err-${tvdbId}`,
          title: 'Add Show Failed',
          body: String(e),
          level: 'error',
          autoDismissMs: 8000,
        });
      }
      break;
    }

    case 'remove-movie': {
      const { radarrId, title } = payload;
      if (!clients.radarr) return;
      try {
        await clients.radarr.removeMovie(Number(radarrId));
        api.notifications.show({
          id: `plex-remove-movie-${radarrId}`,
          title: 'Movie Removed',
          body: `${title} removed from Radarr`,
          level: 'info',
          autoDismissMs: 4000,
        });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Remove movie failed: ${e}`);
      }
      break;
    }

    case 'remove-show': {
      const { sonarrId, title } = payload;
      if (!clients.sonarr) return;
      try {
        await clients.sonarr.removeSeries(Number(sonarrId));
        api.notifications.show({
          id: `plex-remove-show-${sonarrId}`,
          title: 'Show Removed',
          body: `${title} removed from Sonarr`,
          level: 'info',
          autoDismissMs: 4000,
        });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Remove show failed: ${e}`);
      }
      break;
    }

    case 'toggle-monitor': {
      const { source, id, monitored } = payload;
      if (source === 'radarr' && clients.radarr) {
        await clients.radarr.toggleMonitor(Number(id), Boolean(monitored)).catch(e => api.log.error(String(e)));
      } else if (source === 'sonarr' && clients.sonarr) {
        await clients.sonarr.toggleMonitor(Number(id), Boolean(monitored)).catch(e => api.log.error(String(e)));
      }
      await refreshAllPoller();
      break;
    }

    case 'approve-request': {
      const { requestId } = payload;
      if (!clients.seer) return;
      try {
        await clients.seer.approveRequest(Number(requestId));
        api.notifications.show({
          id: `plex-approve-${requestId}`,
          title: 'Request Approved',
          body: 'Media request has been approved',
          level: 'success',
          autoDismissMs: 4000,
        });
      } catch (e) {
        api.log.error(`Approve request failed: ${e}`);
      }
      await refreshAllPoller();
      break;
    }

    case 'deny-request': {
      const { requestId } = payload;
      if (!clients.seer) return;
      try {
        await clients.seer.denyRequest(Number(requestId));
        api.notifications.show({
          id: `plex-deny-${requestId}`,
          title: 'Request Denied',
          body: 'Media request has been denied',
          level: 'info',
          autoDismissMs: 4000,
        });
      } catch (e) {
        api.log.error(`Deny request failed: ${e}`);
      }
      await refreshAllPoller();
      break;
    }

    case 'pause-download': {
      const { id, source } = payload;
      const rawId = String(id).replace(/^(sab|qbt)-/, '');
      if (source === 'sabnzbd' && clients.sabnzbd) {
        await clients.sabnzbd.pauseItem(rawId).catch(e => api.log.error(String(e)));
      } else if (source === 'qbittorrent' && clients.qbittorrent) {
        await clients.qbittorrent.pauseTorrent(rawId).catch(e => api.log.error(String(e)));
      }
      await refreshFastPoller();
      break;
    }

    case 'resume-download': {
      const { id, source } = payload;
      const rawId = String(id).replace(/^(sab|qbt)-/, '');
      if (source === 'sabnzbd' && clients.sabnzbd) {
        await clients.sabnzbd.resumeItem(rawId).catch(e => api.log.error(String(e)));
      } else if (source === 'qbittorrent' && clients.qbittorrent) {
        await clients.qbittorrent.resumeTorrent(rawId).catch(e => api.log.error(String(e)));
      }
      await refreshFastPoller();
      break;
    }

    case 'terminate-stream': {
      const { sessionKey, message } = payload;
      if (!clients.tautulli) { api.log.warn('Tautulli not configured'); return; }
      try {
        await clients.tautulli.terminateSession(String(sessionKey), String(message ?? 'Stream terminated by admin'));
        api.notifications.show({ id: `plex-terminate-${sessionKey}`, title: 'Stream Terminated', body: 'The stream has been stopped', level: 'info', autoDismissMs: 4000 });
      } catch (e) { api.log.error(`Terminate stream failed: ${e}`); }
      await refreshFastPoller();
      break;
    }

    case 'delete-download': {
      const { id, source, deleteFiles } = payload;
      const rawId = String(id).replace(/^(sab|qbt)-/, '');
      const delFiles = Boolean(deleteFiles);
      try {
        if (source === 'sabnzbd' && clients.sabnzbd) {
          await clients.sabnzbd.deleteItem(rawId, delFiles);
        } else if (source === 'qbittorrent' && clients.qbittorrent) {
          await clients.qbittorrent.deleteTorrent(rawId, delFiles);
        }
        api.notifications.show({ id: `plex-del-dl-${id}`, title: 'Download Removed', body: delFiles ? 'Job and files deleted' : 'Job removed from queue', level: 'info', autoDismissMs: 3000 });
      } catch (e) { api.log.error(`Delete download failed: ${e}`); }
      await refreshFastPoller();
      break;
    }

    case 'pause-all-downloads': {
      const source = String(payload.source ?? 'all');
      try {
        if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) await clients.sabnzbd.pauseAll();
        if ((source === 'all' || source === 'qbittorrent') && clients.qbittorrent) await clients.qbittorrent.pauseAll();
        api.notifications.show({ id: `plex-pause-all-${Date.now()}`, title: 'Downloads Paused', body: source === 'all' ? 'All download clients paused' : `${source} paused`, level: 'info', autoDismissMs: 3000 });
      } catch (e) {
        api.log.error(`Pause all downloads failed: ${e}`);
        api.notifications.show({ id: `plex-pause-all-err`, title: 'Pause Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      await refreshFastPoller();
      break;
    }

    case 'resume-all-downloads': {
      const source = String(payload.source ?? 'all');
      try {
        if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) await clients.sabnzbd.resumeAll();
        if ((source === 'all' || source === 'qbittorrent') && clients.qbittorrent) await clients.qbittorrent.resumeAll();
        api.notifications.show({ id: `plex-resume-all-${Date.now()}`, title: 'Downloads Resumed', body: source === 'all' ? 'All download clients resumed' : `${source} resumed`, level: 'success', autoDismissMs: 3000 });
      } catch (e) {
        api.log.error(`Resume all downloads failed: ${e}`);
        api.notifications.show({ id: `plex-resume-all-err`, title: 'Resume Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      await refreshFastPoller();
      break;
    }

    case 'set-qbit-limits': {
      if (!clients.qbittorrent) return;
      try {
        if (payload.downloadLimit != null) await clients.qbittorrent.setDownloadLimit(finiteNumber(payload.downloadLimit, 0));
        if (payload.uploadLimit != null) await clients.qbittorrent.setUploadLimit(finiteNumber(payload.uploadLimit, 0));
        api.notifications.show({ id: `plex-qbit-limits`, title: 'qBittorrent Limits Updated', body: 'Transfer limits saved', level: 'success', autoDismissMs: 3000 });
      } catch (e) {
        api.log.error(`qBit limits failed: ${e}`);
        api.notifications.show({ id: `plex-qbit-limits-err`, title: 'qBit Limits Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      await refreshFastPoller();
      break;
    }

    case 'search-media': {
      const { source, id, title } = payload;
      try {
        if (source === 'radarr' && clients.radarr) {
          await clients.radarr.searchMovie(Number(id));
        } else if (source === 'sonarr' && clients.sonarr) {
          await clients.sonarr.searchSeries(Number(id));
        }
        api.notifications.show({ id: `plex-search-${id}`, title: 'Search Triggered', body: `Searching for ${title}`, level: 'info', autoDismissMs: 3000 });
        await refreshAllPoller();
      } catch (e) { api.log.error(`Search media failed: ${e}`); }
      break;
    }

    case 'edit-media': {
      const { source, id, qualityProfileId, rootFolderPath, moveFiles, title } = payload;
      const changes: { qualityProfileId?: number; rootFolderPath?: string } = {};
      if (qualityProfileId != null) changes.qualityProfileId = Number(qualityProfileId);
      if (rootFolderPath != null) changes.rootFolderPath = String(rootFolderPath);
      try {
        if (source === 'radarr' && clients.radarr) {
          await clients.radarr.editMovie(Number(id), changes, Boolean(moveFiles));
        } else if (source === 'sonarr' && clients.sonarr) {
          await clients.sonarr.editSeries(Number(id), changes, Boolean(moveFiles));
        }
        api.notifications.show({ id: `plex-edit-${id}`, title: 'Updated', body: `${title} has been updated`, level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Edit media failed: ${e}`);
        api.notifications.show({ id: `plex-edit-err-${id}`, title: 'Update Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'create-invitation': {
      const { duration, expiresInDays, durationDays, unlimited } = payload;
      if (!clients.wizarr) { api.log.warn('Wizarr not configured'); return; }
      try {
        const legacyMinutes = Number(duration ?? 10080);
        const inviteExpiresInDays = Number(expiresInDays ?? Math.max(1, Math.round(legacyMinutes / 1440)));
        const inv = await clients.wizarr.createInvitation({
          expiresInDays: inviteExpiresInDays,
          durationDays: Number(durationDays ?? inviteExpiresInDays),
          unlimited: Boolean(unlimited),
          libraryIds: numericArray(payload.libraryIds ?? payload.specificLibraries),
          serverIds: numericArray(payload.serverIds),
        });
        api.notifications.show({ id: `plex-wizarr-inv-${Date.now()}`, title: 'Invitation Created', body: `Code: ${inv.code}`, level: 'success', autoDismissMs: 6000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Create invitation failed: ${e}`);
        api.notifications.show({ id: `plex-wizarr-inv-err`, title: 'Failed', body: String(e), level: 'error', autoDismissMs: 5000 });
      }
      break;
    }

    case 'delete-invitation': {
      const { id } = payload;
      if (!clients.wizarr) return;
      try {
        await clients.wizarr.deleteInvitation(id as string | number);
        api.notifications.show({ id: `plex-wizarr-del-inv-${id}`, title: 'Invitation Deleted', body: 'The invitation has been revoked', level: 'info', autoDismissMs: 3000 });
        await refreshAllPoller();
      } catch (e) { api.log.error(`Delete invitation failed: ${e}`); }
      break;
    }

    case 'delete-wizarr-user': {
      const { id, username } = payload;
      if (!clients.wizarr) return;
      try {
        await clients.wizarr.deleteUser(id as string | number);
        api.notifications.show({ id: `plex-wizarr-del-user-${id}`, title: 'User Removed', body: `${username ?? 'User'} has been removed`, level: 'info', autoDismissMs: 3000 });
        await refreshAllPoller();
      } catch (e) { api.log.error(`Delete Wizarr user failed: ${e}`); }
      break;
    }

    case 'refresh-plex-library': {
      const sectionId = String(payload.sectionId ?? payload.id ?? '').trim();
      const name = String(payload.name ?? sectionId);
      if (!clients.plex) { api.log.warn('Plex not configured'); return; }
      if (!sectionId) { api.log.warn('Plex refresh requested without a library section id'); return; }
      try {
        await clients.plex.refreshLibrary(sectionId);
        api.notifications.show({ id: `plex-scan-${sectionId}-${Date.now()}`, title: 'Library Refresh Started', body: `Refreshing ${name}`, level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Refresh Plex library failed: ${e}`);
        api.notifications.show({ id: `plex-scan-err-${sectionId}`, title: 'Refresh Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'refresh-all-plex-libraries': {
      if (!clients.plex) { api.log.warn('Plex not configured'); return; }
      try {
        const result = await clients.plex.refreshAllLibraries();
        api.notifications.show({ id: `plex-scan-all-${Date.now()}`, title: 'Library Refresh Started', body: `Refreshing ${result.refreshed.length} Plex libraries`, level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Refresh all Plex libraries failed: ${e}`);
        api.notifications.show({ id: `plex-scan-all-err`, title: 'Refresh Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'search-bazarr-subtitles': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      const mediaType = String(payload.mediaType ?? payload.type ?? 'movie');
      api.state.set('bazarrSubtitleSearchLoading', true);
      try {
        const results = mediaType === 'episode'
          ? await clients.bazarr.searchEpisodeSubtitles(finiteNumber(payload.episodeId ?? payload.sonarrEpisodeId))
          : await clients.bazarr.searchMovieSubtitles(finiteNumber(payload.radarrId));
        api.state.set('bazarrSubtitleSearchContext', { ...payload, mediaType, ts: Date.now() });
        api.state.set('bazarrSubtitleSearchResults', results);
      } catch (e) {
        api.log.error(`Bazarr subtitle search failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-search-err`, title: 'Subtitle Search Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      } finally {
        api.state.set('bazarrSubtitleSearchLoading', false);
      }
      break;
    }

    case 'download-bazarr-subtitle': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      const mediaType = String(payload.mediaType ?? payload.type ?? 'movie');
      try {
        if (mediaType === 'episode') {
          await clients.bazarr.downloadEpisodeSubtitle({
            seriesId: finiteNumber(payload.seriesId ?? payload.sonarrSeriesId),
            episodeId: finiteNumber(payload.episodeId ?? payload.sonarrEpisodeId),
            provider: stringValue(payload.provider),
            subtitle: stringValue(payload.subtitle ?? payload.id),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi ?? payload.hearing_impaired),
            originalFormat: Boolean(payload.originalFormat),
          });
        } else {
          await clients.bazarr.downloadMovieSubtitle({
            radarrId: finiteNumber(payload.radarrId),
            provider: stringValue(payload.provider),
            subtitle: stringValue(payload.subtitle ?? payload.id),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi ?? payload.hearing_impaired),
            originalFormat: Boolean(payload.originalFormat),
          });
        }
        api.notifications.show({ id: `plex-bazarr-download-${Date.now()}`, title: 'Subtitle Download Started', body: String(payload.title ?? 'Bazarr is downloading a subtitle'), level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr subtitle download failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-download-err`, title: 'Subtitle Download Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'download-bazarr-missing': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      const mediaType = String(payload.mediaType ?? payload.type ?? 'movie');
      try {
        if (mediaType === 'episode') {
          await clients.bazarr.downloadMissingEpisodeSubtitle({
            seriesId: finiteNumber(payload.seriesId ?? payload.sonarrSeriesId),
            episodeId: finiteNumber(payload.episodeId ?? payload.sonarrEpisodeId),
            language: stringValue(payload.language),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi),
          });
        } else {
          await clients.bazarr.downloadMissingMovieSubtitle({
            radarrId: finiteNumber(payload.radarrId),
            language: stringValue(payload.language),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi),
          });
        }
        api.notifications.show({ id: `plex-bazarr-missing-${Date.now()}`, title: 'Subtitle Search Started', body: `Bazarr is searching ${payload.language ?? ''}`, level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr missing subtitle download failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-missing-err`, title: 'Subtitle Search Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'delete-bazarr-subtitle': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      const mediaType = String(payload.mediaType ?? payload.type ?? 'movie');
      try {
        if (mediaType === 'episode') {
          await clients.bazarr.deleteEpisodeSubtitle({
            seriesId: finiteNumber(payload.seriesId ?? payload.sonarrSeriesId),
            episodeId: finiteNumber(payload.episodeId ?? payload.sonarrEpisodeId),
            language: stringValue(payload.language),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi),
            path: stringValue(payload.path),
          });
        } else {
          await clients.bazarr.deleteMovieSubtitle({
            radarrId: finiteNumber(payload.radarrId),
            language: stringValue(payload.language),
            forced: Boolean(payload.forced),
            hi: Boolean(payload.hi),
            path: stringValue(payload.path),
          });
        }
        api.notifications.show({ id: `plex-bazarr-delete-${Date.now()}`, title: 'Subtitle Deleted', body: String(payload.path ?? 'Subtitle removed'), level: 'info', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr subtitle delete failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-delete-err`, title: 'Subtitle Delete Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'apply-bazarr-subtitle-tool': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      try {
        await clients.bazarr.applySubtitleTool({
          action: stringValue(payload.tool ?? payload.actionName ?? payload.subtitleAction),
          language: stringValue(payload.language),
          path: stringValue(payload.path),
          type: stringValue(payload.mediaType ?? payload.type, 'movie'),
          id: finiteNumber(payload.id ?? payload.radarrId ?? payload.sonarrEpisodeId),
          forced: payload.forced == null ? undefined : Boolean(payload.forced),
          hi: payload.hi == null ? undefined : Boolean(payload.hi),
          originalFormat: payload.originalFormat == null ? undefined : Boolean(payload.originalFormat),
          reference: payload.reference == null ? undefined : String(payload.reference),
          maxOffsetSeconds: payload.maxOffsetSeconds as string | number | undefined,
          noFixFramerate: payload.noFixFramerate == null ? undefined : Boolean(payload.noFixFramerate),
          gss: payload.gss == null ? undefined : String(payload.gss),
        });
        api.notifications.show({ id: `plex-bazarr-tool-${Date.now()}`, title: 'Subtitle Tool Started', body: String(payload.tool ?? payload.actionName ?? 'Bazarr tool'), level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr subtitle tool failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-tool-err`, title: 'Subtitle Tool Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'run-bazarr-task': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      const taskId = stringValue(payload.taskId ?? payload.id);
      if (!taskId) return;
      try {
        await clients.bazarr.runTask(taskId);
        api.notifications.show({ id: `plex-bazarr-task-${taskId}`, title: 'Bazarr Task Started', body: String(payload.name ?? taskId), level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr task failed: ${e}`);
        api.notifications.show({ id: `plex-bazarr-task-err-${taskId}`, title: 'Bazarr Task Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'reset-bazarr-providers': {
      if (!clients.bazarr) { api.log.warn('Bazarr not configured'); return; }
      try {
        await clients.bazarr.resetProviders();
        api.notifications.show({ id: `plex-bazarr-providers-reset`, title: 'Providers Reset', body: 'Bazarr provider status has been reset', level: 'success', autoDismissMs: 4000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Bazarr provider reset failed: ${e}`);
      }
      break;
    }

    case 'search-prowlarr': {
      if (!clients.prowlarr) { api.log.warn('Prowlarr not configured'); return; }
      const query = String(payload.query ?? '').trim();
      if (!query) return;
      api.state.set('prowlarrSearchLoading', true);
      try {
        const results = await clients.prowlarr.searchReleases({
          query,
          type: stringValue(payload.type, 'search'),
          indexerIds: numericArray(payload.indexerIds),
          categories: numericArray(payload.categories),
          limit: finiteNumber(payload.limit, 50),
        });
        api.state.set('prowlarrSearchResults', results);
      } catch (e) {
        api.log.error(`Prowlarr search failed: ${e}`);
        api.notifications.show({ id: `plex-prowlarr-search-err`, title: 'Indexer Search Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      } finally {
        api.state.set('prowlarrSearchLoading', false);
      }
      break;
    }

    case 'grab-prowlarr-release': {
      if (!clients.prowlarr) { api.log.warn('Prowlarr not configured'); return; }
      const release = payload.release && typeof payload.release === 'object' ? payload.release as any : payload as any;
      try {
        await clients.prowlarr.grabRelease(release);
        api.notifications.show({ id: `plex-prowlarr-grab-${Date.now()}`, title: 'Release Grabbed', body: String(release.title ?? 'Sent to download client'), level: 'success', autoDismissMs: 5000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Prowlarr grab failed: ${e}`);
        api.notifications.show({ id: `plex-prowlarr-grab-err`, title: 'Grab Failed', body: String(e), level: 'error', autoDismissMs: 7000 });
      }
      break;
    }

    case 'bulk-grab-prowlarr-releases': {
      if (!clients.prowlarr) { api.log.warn('Prowlarr not configured'); return; }
      const releases = releaseArray(payload.releases);
      if (releases.length === 0) return;
      try {
        await clients.prowlarr.grabReleases(releases as any);
        api.notifications.show({ id: `plex-prowlarr-bulk-${Date.now()}`, title: 'Releases Grabbed', body: `${releases.length} releases sent to download clients`, level: 'success', autoDismissMs: 5000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Prowlarr bulk grab failed: ${e}`);
        api.notifications.show({ id: `plex-prowlarr-bulk-err`, title: 'Bulk Grab Failed', body: String(e), level: 'error', autoDismissMs: 7000 });
      }
      break;
    }

    case 'set-tdarr-node-paused': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      const nodeId = stringValue(payload.nodeId ?? payload.id);
      try {
        await clients.tdarr.setNodePaused(nodeId, Boolean(payload.paused));
        api.notifications.show({ id: `plex-tdarr-node-paused-${nodeId}`, title: Boolean(payload.paused) ? 'Node Paused' : 'Node Resumed', body: String(payload.nodeName ?? nodeId), level: 'info', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr node pause failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-node-pause-err`, title: 'Node Update Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'restart-tdarr-node': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      const nodeId = stringValue(payload.nodeId ?? payload.id);
      try {
        await clients.tdarr.restartNode(nodeId);
        api.notifications.show({ id: `plex-tdarr-node-restart-${nodeId}`, title: 'Node Restart Requested', body: String(payload.nodeName ?? nodeId), level: 'success', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr node restart failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-node-restart-err`, title: 'Node Restart Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'disconnect-tdarr-node': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      const nodeId = stringValue(payload.nodeId ?? payload.id);
      try {
        await clients.tdarr.disconnectNode(nodeId);
        api.notifications.show({ id: `plex-tdarr-node-disconnect-${nodeId}`, title: 'Node Disconnect Requested', body: String(payload.nodeName ?? nodeId), level: 'info', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr node disconnect failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-node-disconnect-err`, title: 'Node Disconnect Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'alter-tdarr-worker-limit': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      const nodeId = stringValue(payload.nodeId ?? payload.id);
      const process = stringValue(payload.process, 'increase') === 'decrease' ? 'decrease' : 'increase';
      const workerType = stringValue(payload.workerType, 'transcodecpu') as any;
      try {
        await clients.tdarr.alterWorkerLimit(nodeId, process, workerType);
        api.notifications.show({ id: `plex-tdarr-worker-limit-${Date.now()}`, title: 'Worker Limit Updated', body: `${process} ${workerType}`, level: 'success', autoDismissMs: 3000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr worker limit failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-worker-limit-err`, title: 'Worker Limit Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'cancel-tdarr-worker': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      try {
        await clients.tdarr.cancelWorkerItem(stringValue(payload.nodeId), stringValue(payload.workerId ?? payload.id), stringValue(payload.cause, 'user'));
        api.notifications.show({ id: `plex-tdarr-worker-cancel-${Date.now()}`, title: 'Worker Cancel Requested', body: String(payload.workerId ?? payload.id), level: 'info', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr worker cancel failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-worker-cancel-err`, title: 'Worker Cancel Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'kill-tdarr-worker': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      try {
        await clients.tdarr.killWorker(stringValue(payload.nodeId), stringValue(payload.workerId ?? payload.id), stringValue(payload.mode, 'single') as any);
        api.notifications.show({ id: `plex-tdarr-worker-kill-${Date.now()}`, title: 'Worker Kill Requested', body: String(payload.workerId ?? payload.id), level: 'warning', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr worker kill failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-worker-kill-err`, title: 'Worker Kill Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'scan-tdarr-file': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      try {
        await clients.tdarr.scanIndividualFile(payload.file ?? payload, payload.scanTypes as any);
        api.notifications.show({ id: `plex-tdarr-file-scan-${Date.now()}`, title: 'File Scan Started', body: String(payload.path ?? payload.file ?? 'Tdarr file'), level: 'success', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr file scan failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-file-scan-err`, title: 'File Scan Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'scan-tdarr-library': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      try {
        await clients.tdarr.scanFiles(payload.scanConfig ?? payload);
        api.notifications.show({ id: `plex-tdarr-library-scan-${Date.now()}`, title: 'Library Scan Started', body: String(payload.name ?? payload.libraryId ?? 'Tdarr library'), level: 'success', autoDismissMs: 4000 });
        await refreshFastPoller();
      } catch (e) {
        api.log.error(`Tdarr library scan failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-library-scan-err`, title: 'Library Scan Failed', body: String(e), level: 'error', autoDismissMs: 6000 });
      }
      break;
    }

    case 'requeue-tdarr-library': {
      if (!clients.tdarr) { api.log.warn('Tdarr not configured'); return; }
      const libraryId = stringValue(payload.libraryId ?? payload.id);
      try {
        await clients.tdarr.requeueLibrary(libraryId, stringValue(payload.queue, 'transcode'));
        api.notifications.show({ id: `plex-tdarr-library-requeue-${Date.now()}`, title: 'Library Requeued', body: String(payload.name ?? libraryId), level: 'success', autoDismissMs: 5000 });
        await refreshAllPoller();
      } catch (e) {
        api.log.error(`Tdarr library requeue failed: ${e}`);
        api.notifications.show({ id: `plex-tdarr-library-requeue-err`, title: 'Library Requeue Failed', body: String(e), level: 'error', autoDismissMs: 7000 });
      }
      break;
    }

    case 'refresh': {
      await refreshAllPoller();
      break;
    }
  }
}

async function handleSettingsAction(
  api: PluginAPI,
  action: string,
  data: unknown,
  clients: ReturnType<typeof buildAllClients>,
): Promise<void> {
  const payload = (data ?? {}) as Record<string, unknown>;

  if (action === 'save-apikey') {
    // Frontend sends plaintext key; backend encrypts before storing
    const service = String(payload.service ?? '');
    const plainKey = String(payload.key ?? '');
    if (!service || !plainKey) return;
    api.config.setPluginData(`${service}.apiKey`, encryptKey(api, plainKey));
    api.log.info(`Plex: saved encrypted API key for ${service}`);
    // Publish that this service has a key configured (boolean only — no plaintext to frontend)
    api.state.set('keyConfigured', {
      ...(poller?.getState() as any)?.keyConfigured,
      [service]: true,
    });
  }

  if (action === 'test-connection') {
    const service = String(payload.service ?? '');
    const client = (clients as Record<string, { ping?: () => Promise<boolean> }>)[service];
    let ok = false;
    if (client && typeof client.ping === 'function') {
      ok = await client.ping().catch(() => false);
    }
    const result: 'ok' | 'error' = ok ? 'ok' : 'error';
    // Update poller internal state so next poll doesn't overwrite
    if (poller) poller.setServiceStatus(service, result);
    // Explicit signal so frontend doesn't have to rely on status-change detection
    api.state.set('lastTestResult', { service, result, ts: Date.now() });
    api.notifications.show({
      id: `plex-test-${service}`,
      title: ok ? `${service} connected` : `${service} failed`,
      body: ok ? 'Connection successful' : 'Could not connect — check URL and API key',
      level: ok ? 'success' : 'error',
      autoDismissMs: 4000,
    });
  }
}

export async function deactivate(): Promise<void> {
  if (unsubConfig) { unsubConfig(); unsubConfig = null; }
  if (poller) { poller.stop(); poller = null; }
}
