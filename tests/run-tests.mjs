import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function importTs(path) {
  const source = await readFile(path, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function testQbitErrors() {
  const { QbittorrentClient } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/clients/qbittorrent.ts');
  const client = new QbittorrentClient('http://qbit', 'bad-token', async () => new Response('Forbidden', { status: 403 }));
  assert.equal(await client.ping(), false);
  await assert.rejects(() => client.pauseTorrent('abc'), /403/);

  let body = '';
  const okClient = new QbittorrentClient('http://qbit', 'ok-token', async (_url, init = {}) => {
    body = String(init.body ?? '');
    return new Response('', { status: 200 });
  });
  await okClient.deleteTorrent('hash&with=symbols', false);
  assert.match(body, /hashes=hash%26with%3Dsymbols/);
  assert.match(body, /deleteFiles=false/);
}

async function testRadarrFullToggle() {
  const { RadarrClient } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/clients/radarr.ts');
  let putBody;
  const client = new RadarrClient('http://radarr', 'key', async (url, init = {}) => {
    if (String(url).includes('/api/v3/movie/123') && init.method !== 'PUT') {
      return jsonResponse({ id: 123, title: 'Existing', tmdbId: 1, year: 2024, monitored: false, hasFile: false, qualityProfileId: 4, rootFolderPath: '/movies' });
    }
    if (init.method === 'PUT') {
      putBody = JSON.parse(String(init.body));
      return jsonResponse(putBody);
    }
    return new Response('', { status: 404 });
  });
  await client.toggleMonitor(123, true);
  assert.equal(putBody.title, 'Existing');
  assert.equal(putBody.monitored, true);
  assert.equal(putBody.qualityProfileId, 4);
}

async function testSeerTvUsesTmdb() {
  const { SeerClient } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/clients/seer.ts');
  let body;
  const client = new SeerClient('http://seer', 'key', async (_url, init = {}) => {
    body = JSON.parse(String(init.body));
    return jsonResponse({ ok: true });
  });
  await client.requestTv(136315, [1, 2]);
  assert.deepEqual(body, { mediaType: 'tv', mediaId: 136315, seasons: [1, 2] });
}

async function testTautulliNoApiKeyUrl() {
  const { TautulliClient } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/clients/tautulli.ts');
  let imageFetches = 0;
  const client = new TautulliClient('http://tautulli', 'secret-key', async url => {
    const s = String(url);
    if (s.includes('pms_image_proxy')) {
      imageFetches += 1;
      assert.match(s, /width=180/);
      assert.match(s, /height=270/);
      return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    return jsonResponse({
      response: {
        result: 'success',
        data: {
          stream_count: '1',
          total_bandwidth: '10',
          sessions: [{ session_key: 's1', title: 'Movie', media_type: 'movie', thumb: '/library/metadata/1/thumb', duration: '1000', view_offset: '500' }],
        },
      },
    });
  });
  const activity = await client.getActivity({ includeThumbnails: true });
  assert.equal(activity.sessions[0].thumb, '/library/metadata/1/thumb');
  assert.equal('thumbUrl' in activity.sessions[0], false);
  assert.match(activity.sessions[0].thumbDataUrl, /^data:image\/png;base64,/);
  assert.equal(activity.sessions[0].thumbDataUrl.includes('secret-key'), false);

  const secondActivity = await client.getActivity({ includeThumbnails: true });
  assert.equal(secondActivity.sessions[0].thumbDataUrl, activity.sessions[0].thumbDataUrl);
  assert.equal(imageFetches, 1);

  client.clearThumbnailCache();
  await client.getActivity({ includeThumbnails: true });
  assert.equal(imageFetches, 2);

  const thumbnailFreeActivity = await client.getActivity();
  assert.equal(imageFetches, 2);
  assert.equal(thumbnailFreeActivity.sessions[0].thumbDataUrl, undefined);
}

async function testPlexLibraryIndexExtractsSectionIds() {
  const { PlexClient } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/clients/plex.ts');
  const client = new PlexClient('http://plex', 'token', async url => {
    const s = String(url);
    if (s.includes('/library/sections?')) {
      return jsonResponse({
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie' },
            { key: '2', title: 'TV Shows', type: 'show' },
          ],
        },
      });
    }
    if (s.includes('/library/sections/1/all') && s.includes('X-Plex-Container-Size=0')) {
      return jsonResponse({ MediaContainer: { totalSize: 1 } });
    }
    if (s.includes('/library/sections/2/all') && s.includes('X-Plex-Container-Size=0')) {
      return jsonResponse({ MediaContainer: { totalSize: 1 } });
    }
    if (s.includes('/library/sections/1/all')) {
      return jsonResponse({
        MediaContainer: {
          totalSize: 1,
          Metadata: [{ title: 'Arrival', year: 2016, Guid: [{ id: 'tmdb://329865' }] }],
        },
      });
    }
    if (s.includes('/library/sections/2/all')) {
      return jsonResponse({
        MediaContainer: {
          totalSize: 1,
          Metadata: [{ title: 'Severance', year: 2022, Guid: [{ id: 'tvdb://371980' }] }],
        },
      });
    }
    return new Response('', { status: 404 });
  });

  const index = await client.getLibraryIndex();
  assert.equal(index.libraries.length, 2);
  assert.deepEqual(index.media.map(item => [item.title, item.sectionId]), [['Arrival', '1'], ['Severance', '2']]);
  assert.equal(index.media[0].tmdbId, 329865);
  assert.equal(index.media[1].tvdbId, 371980);
}

async function testPollerAttachesPlexLibrarySections() {
  const { Poller } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/poller.ts');
  const state = new Map();
  const api = { state: { set(key, value) { state.set(key, value); } } };
  const poller = new Poller(api, {
    plex: {
      getLibraryIndex: async () => ({
        libraries: [
          { id: '1', name: 'Movies', type: 'movie', count: 1 },
          { id: '2', name: 'TV Shows', type: 'show', count: 1 },
        ],
        media: [
          { sectionId: '1', sectionName: 'Movies', type: 'movie', title: 'Arrival', year: 2016, tmdbId: 329865 },
          { sectionId: '2', sectionName: 'TV Shows', type: 'show', title: 'Severance', year: 2022, tvdbId: 371980 },
        ],
      }),
      getVersion: async () => '1.0',
    },
    radarr: {
      getMovies: async () => [],
      moviesAsSearchResults: () => [{
        id: 'radarr-1',
        source: 'radarr',
        type: 'movie',
        title: 'Arrival',
        year: 2016,
        status: 'in-library',
        tmdbId: 329865,
      }],
      getQualityProfiles: async () => [],
      getRootFolders: async () => [],
      getDiskSpace: async () => [],
      getVersion: async () => '1.0',
    },
    sonarr: {
      getSeries: async () => [],
      seriesAsSearchResults: () => [{
        id: 'sonarr-1',
        source: 'sonarr',
        type: 'show',
        title: 'Severance',
        year: 2022,
        status: 'in-library',
        tvdbId: 371980,
      }],
      getQualityProfiles: async () => [],
      getRootFolders: async () => [],
      getDiskSpace: async () => [],
      getVersion: async () => '1.0',
    },
  });

  await poller.refreshAll();
  const items = poller.getState().libraryItems;
  assert.equal(items.find(item => item.id === 'radarr-1')?.plexLibrarySectionId, '1');
  assert.equal(items.find(item => item.id === 'sonarr-1')?.plexLibrarySectionId, '2');
}

async function testPollerEmitsAutomationEvents() {
  const { Poller } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/poller.ts');
  const events = [];
  const api = {
    state: { set() {} },
    log: { info() {}, warn() {}, error() {} },
    events: { emit(event, payload) { events.push({ event, payload }); } },
  };

  const session = (key, title) => ({ sessionKey: key, user: 'kyle', title, mediaType: 'movie', player: 'TV', state: 'playing', progressPercent: 10 });
  const dl = (id, progress, sizeLeftBytes = 100 - progress) => ({ id, source: 'sabnzbd', name: `job-${id}`, status: 'Downloading', sizeBytes: 100, sizeLeftBytes, speed: 1, eta: '1m', progress });

  let sessions = [session('a', 'Arrival')];
  let queue = [dl('sab-1', 95), dl('sab-3', 50), dl('sab-4', 10)];
  let requests = [{ id: 10, type: 'movie', status: 1, title: 'Dune', createdAt: '2026-07-01' }];
  let movies = [{ id: 'radarr-1', source: 'radarr', type: 'movie', title: 'Dune', year: 2021, status: 'monitored', monitored: true, hasFile: false, radarrId: 1 }];
  let tautulliDown = false;

  const makeTautulli = () => ({
    getActivity: async () => {
      if (tautulliDown) throw new Error('down');
      return { sessions };
    },
    getVersion: async () => '1.0',
    clearThumbnailCache: () => {},
  });

  const clients = {
    tautulli: makeTautulli(),
    sabnzbd: {
      getQueue: async () => queue,
      getFullStatus: async () => ({ status: 'Downloading', paused: false, slots: queue }),
      getVersion: async () => '1.0',
      getDiskSpace: async () => [],
      getHistory: async () => [],
    },
    seer: {
      getRequests: async (_take, _skip, filter) => (filter === 'pending' ? requests.filter(r => r.status === 1) : requests),
      getVersion: async () => '1.0',
    },
    radarr: {
      getMovies: async () => movies,
      moviesAsSearchResults: m => m,
      getQualityProfiles: async () => [],
      getRootFolders: async () => [],
      getDiskSpace: async () => [],
      getVersion: async () => '1.0',
    },
  };
  const poller = new Poller(api, clients);

  // First poll primes all baselines: no events for pre-existing streams/downloads/requests
  await poller.refreshAll();
  assert.deepEqual(events, []);

  // Stream a→b, sab-1 leaves queue at 95%, sab-3 hits 100%, sab-4 deleted at 10%,
  // sab-2 newly queued, request 11 submitted, request 10 approved,
  // movie 1 gets its file, movie 2 appears already downloaded
  sessions = [session('b', 'Severance')];
  queue = [dl('sab-2', 5), dl('sab-3', 100)];
  requests = [{ id: 11, type: 'tv', status: 1, title: 'Pluribus', createdAt: '2026-07-03' }, { id: 10, type: 'movie', status: 2, title: 'Dune', createdAt: '2026-07-01' }];
  movies = [
    { ...movies[0], hasFile: true, status: 'in-library' },
    { id: 'radarr-2', source: 'radarr', type: 'movie', title: 'Sicario', year: 2015, status: 'in-library', monitored: true, hasFile: true, radarrId: 2 },
  ];
  await poller.refreshAll();

  const names = events.map(e => e.event);
  assert.ok(names.includes('stream:started'), 'stream:started emitted');
  assert.ok(names.includes('stream:stopped'), 'stream:stopped emitted');
  assert.equal(events.find(e => e.event === 'stream:started').payload.title, 'Severance');
  assert.equal(events.find(e => e.event === 'stream:stopped').payload.title, 'Arrival');
  assert.equal(events.find(e => e.event === 'download:added').payload.id, 'sab-2');
  const completed = events.filter(e => e.event === 'download:completed');
  assert.deepEqual(completed.map(e => e.payload.id).sort(), ['sab-1', 'sab-3']);
  assert.equal(completed.find(e => e.payload.id === 'sab-1').payload.removedFromQueue, true);
  assert.equal(events.find(e => e.event === 'download:removed').payload.id, 'sab-4');
  assert.equal(events.find(e => e.event === 'request:submitted').payload.id, 11);
  assert.equal(events.find(e => e.event === 'request:approved').payload.id, 10);
  assert.ok(!names.includes('request:denied'));
  assert.ok(!names.includes('service:status-changed'));
  assert.equal(events.find(e => e.event === 'media:added').payload.id, 2);
  const available = events.filter(e => e.event === 'media:available');
  assert.deepEqual(available.map(e => e.payload.id).sort(), [1, 2]);
  assert.ok(!names.includes('media:removed'));

  // Tautulli failure: service down event, but no spurious stream:stopped
  events.length = 0;
  tautulliDown = true;
  await poller.refreshFast();
  assert.deepEqual(events.map(e => e.event), ['service:status-changed']);
  assert.deepEqual(events[0].payload, { service: 'tautulli', from: 'ok', to: 'error' });

  // Recovery with the stream gone: service up + stream:stopped from retained baseline
  events.length = 0;
  tautulliDown = false;
  sessions = [];
  await poller.refreshFast();
  assert.deepEqual(events.map(e => e.event).sort(), ['service:status-changed', 'stream:stopped']);
  assert.equal(events.find(e => e.event === 'stream:stopped').payload.title, 'Severance');

  // qBit-style rounding: progress shows 100 but bytes remain — not completed yet
  events.length = 0;
  queue = [dl('sab-2', 5), dl('sab-5', 100, 3)];
  await poller.refreshFast();
  assert.equal(events.find(e => e.event === 'download:added')?.payload.id, 'sab-5');
  assert.ok(!events.some(e => e.event === 'download:completed'), 'no completion while bytes remain');

  events.length = 0;
  queue = [dl('sab-2', 5), dl('sab-5', 100, 0)];
  await poller.refreshFast();
  assert.deepEqual(events.map(e => e.event), ['download:completed']);
  assert.equal(events[0].payload.id, 'sab-5');

  // An item that appears already finished (added + completed within one poll
  // interval) still gets a completion event
  events.length = 0;
  queue = [dl('sab-2', 5), dl('sab-5', 100, 0), dl('sab-6', 100, 0)];
  await poller.refreshFast();
  assert.deepEqual(events.map(e => e.event), ['download:added', 'download:completed']);
  assert.equal(events[1].payload.id, 'sab-6');

  // Reconfigured client (new instance) re-primes the baseline and resets the
  // service status: neither stream diffs nor an ok→error transition of the
  // old server may fire against the new one
  events.length = 0;
  sessions = [session('c', 'Andor')];
  tautulliDown = true;
  poller.updateClients({ ...clients, tautulli: makeTautulli() });
  await poller.refreshFast();
  assert.deepEqual(events, [], 'no events on first poll of swapped client');
  tautulliDown = false;
  await poller.refreshFast();
  assert.ok(!events.some(e => e.event.startsWith('stream:')), 'no stream events after client swap');
  assert.deepEqual(events.map(e => e.event), ['service:status-changed']); // genuine error→ok recovery

  // At the 50-item fetch cap, disappearance/addition diffing is suppressed
  events.length = 0;
  queue = Array.from({ length: 50 }, (_, i) => dl(`sab-bulk-${i}`, 10));
  await poller.refreshFast();
  await poller.refreshFast();
  queue = Array.from({ length: 50 }, (_, i) => dl(`sab-bulk-${i + 10}`, 10));
  await poller.refreshFast();
  assert.ok(!events.some(e => e.event.startsWith('download:')), 'no download events from page churn');

  // An in-flight poll of an old client resolving after a swap must not prime
  // the new client's baseline with old-server data
  events.length = 0;
  const gate = deferred();
  const slowTautulli = {
    getActivity: () => gate.promise.then(() => ({ sessions: [session('x', 'Old Server')] })),
    getVersion: async () => '1.0',
    clearThumbnailCache: () => {},
  };
  poller.updateClients({ ...clients, tautulli: slowTautulli });
  const inflight = poller.refreshFast();
  poller.updateClients({ ...clients, tautulli: makeTautulli() });
  gate.resolve();
  await inflight;
  sessions = [session('y', 'New Server')];
  await poller.refreshFast();
  await poller.refreshFast();
  assert.deepEqual(events.filter(e => e.event.startsWith('stream:')), [], 'stale in-flight poll must not prime or diff');
}

async function testPollerDoesNotOverlapFastPolls() {
  const { Poller } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/poller.ts');
  const gate = deferred();
  let activityCalls = 0;
  let cacheClears = 0;
  const api = { state: { set() {} } };
  const poller = new Poller(api, {
    tautulli: {
      getActivity: async () => {
        activityCalls += 1;
        await gate.promise;
        return { sessions: [] };
      },
      clearThumbnailCache: () => {
        cacheClears += 1;
      },
    },
  });

  const first = poller.refreshFast();
  const second = poller.refreshFast();
  assert.equal(activityCalls, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(activityCalls, 1);
  poller.stop();
  assert.equal(cacheClears, 1);
}

async function testPollerPublishesStreamThumbnailsSeparately() {
  const { Poller } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/poller.ts');
  const stateSets = [];
  let activityOptions;
  const api = { state: { set(key, value) { stateSets.push([key, value]); } } };
  const poller = new Poller(api, {
    tautulli: {
      getActivity: async (options) => {
        activityOptions = options;
        return {
        sessions: [{
          sessionKey: 's1',
          user: 'Kyle',
          title: 'Movie',
          mediaType: 'movie',
          state: 'playing',
          viewOffset: 0,
          duration: 1000,
          progressPercent: 0,
          transcodeDecision: 'direct play',
          qualityProfile: '',
          bandwidth: 0,
          ipAddress: '',
          player: 'Browser',
          thumb: '/library/metadata/1/thumb',
        }],
        streamCount: 1,
        bandwidth: 0,
      };
      },
      clearThumbnailCache: () => {},
    },
  });

  await poller.refreshFast();
  await poller.refreshFast();

  const thumbnailSets = stateSets.filter(([key]) => key === 'streamThumbnails');
  assert.equal(thumbnailSets.length, 0);
  assert.deepEqual(activityOptions, { includeThumbnails: false });
  assert.equal('thumbDataUrl' in poller.getState().streams[0], false);

  poller.setStreamThumbnail('/library/metadata/1/thumb', 'data:image/png;base64,abc');
  poller.setStreamThumbnail('/library/metadata/1/thumb', 'data:image/png;base64,abc');
  const thumbnailSetsAfterLoad = stateSets.filter(([key]) => key === 'streamThumbnails');
  assert.equal(thumbnailSetsAfterLoad.length, 1);
  assert.deepEqual(thumbnailSetsAfterLoad[0][1], { '/library/metadata/1/thumb': 'data:image/png;base64,abc' });
}

async function testBackendRejectsAmbiguousAddDefaults() {
  const backend = await import(pathToFileURL('/Users/kyleboyer/git/kai-plugin-plex/dist/backend.js').href);
  const handlers = new Map();
  const notifications = [];
  let postedMovie = false;
  const api = {
    log: { info() {}, warn() {}, error() {} },
    config: {
      getPluginData: () => ({ radarr: { url: 'http://radarr', apiKey: 'key', enabled: true } }),
      setPluginData() {},
      onChanged: () => () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: value => value,
      decryptString: value => value,
    },
    state: { set() {}, replace() {} },
    ui: { registerPanelView() {}, registerNavigationItem() {}, registerSettingsView() {} },
    onAction(scope, handler) { handlers.set(scope, handler); },
    notifications: { show(desc) { notifications.push(desc); } },
    tools: { register() {} },
    fetch: async (url, init = {}) => {
      const s = String(url);
      if (s.includes('/api/v3/rootfolder')) return jsonResponse([{ id: 1, path: '/movies-a' }, { id: 2, path: '/movies-b' }]);
      if (s.includes('/api/v3/qualityprofile')) return jsonResponse([{ id: 1, name: 'Any' }, { id: 4, name: 'HD' }]);
      if (s.includes('/api/v3/movie') && init.method === 'POST') {
        postedMovie = true;
        return jsonResponse({ id: 10, title: 'Test', year: 2024, tmdbId: 1, monitored: true, hasFile: false });
      }
      if (s.includes('/api/v3/movie')) return jsonResponse([]);
      if (s.includes('/api/v3/diskspace')) return jsonResponse([]);
      if (s.includes('/api/v3/system/status')) return jsonResponse({ version: 'test' });
      return jsonResponse({});
    },
  };
  await backend.activate(api);
  await handlers.get('panel:plex-panel')('add-movie', { tmdbId: 1, title: 'Test', year: 2024 });
  await backend.deactivate();
  assert.equal(postedMovie, false);
  assert.match(String(notifications.at(-1)?.body), /Choose a quality profile/);
}

async function testListLibraryFiltersAndPages() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: {
      getQualityProfiles: async () => [{ id: 10, name: 'Kids HD' }, { id: 11, name: 'Adults' }],
      getMovies: async () => [
        { id: 1, title: 'Paddington', year: 2014, tmdbId: 116149, monitored: true, hasFile: true, status: 'released', qualityProfileId: 10, rootFolderPath: '/media/kids/movies', certification: 'PG' },
        { id: 2, title: 'Heat', year: 1995, tmdbId: 949, monitored: true, hasFile: true, status: 'released', qualityProfileId: 11, rootFolderPath: '/media/movies', certification: 'R' },
      ],
    },
    sonarr: {
      getQualityProfiles: async () => [{ id: 20, name: 'Kids TV' }, { id: 21, name: 'General TV' }],
      getSeries: async () => [
        { id: 3, title: 'Bluey', year: 2018, tvdbId: 353546, monitored: true, status: 'continuing', episodeCount: 100, episodeFileCount: 100, qualityProfileId: 20, rootFolderPath: '/media/kids/tv', certification: 'TV-Y' },
        { id: 4, title: 'Severance', year: 2022, tvdbId: 371980, monitored: true, status: 'continuing', episodeCount: 19, episodeFileCount: 19, qualityProfileId: 21, rootFolderPath: '/media/tv', certification: 'TV-MA' },
      ],
    },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');
  const result = await listLibrary.execute({
    rootFolderPath: '/kids',
    qualityProfileName: 'kids',
    contentRating: ['PG', 'TV-Y'],
    limit: 1,
    sortBy: 'title',
  });

  assert.equal(result.movieTotal, 1);
  assert.equal(result.movieReturned, 1);
  assert.equal(result.movies[0].title, 'Paddington');
  assert.equal(result.movies[0].qualityProfileName, 'Kids HD');
  assert.equal(result.movies[0].contentRating, 'PG');
  assert.equal(result.seriesTotal, 1);
  assert.equal(result.series[0].title, 'Bluey');
  assert.equal(result.series[0].hasFile, true);
  assert.equal(result.limit, 1);
}

async function testListLibraryRatingOperatorAndPlexSectionCrossReference() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: {
      getQualityProfiles: async () => [],
      getMovies: async () => [
        { id: 1, title: 'Paddington', year: 2014, tmdbId: 116149, monitored: true, hasFile: true, status: 'released', rootFolderPath: '/media/kids/movies', certification: 'PG' },
        { id: 2, title: 'Heat', year: 1995, tmdbId: 949, monitored: true, hasFile: true, status: 'released', rootFolderPath: '/media/kids/movies', certification: 'R' },
      ],
    },
    sonarr: {
      getQualityProfiles: async () => [],
      getSeries: async () => [
        { id: 3, title: 'Bluey', year: 2018, tvdbId: 353546, monitored: true, status: 'continuing', episodeCount: 100, episodeFileCount: 100, rootFolderPath: '/media/tv', certification: 'TV-Y' },
        { id: 4, title: 'Severance', year: 2022, tvdbId: 371980, monitored: true, status: 'continuing', episodeCount: 19, episodeFileCount: 19, rootFolderPath: '/media/tv', certification: 'TV-MA' },
        { id: 5, title: 'Daniel Tiger', year: 2012, tvdbId: 222, monitored: true, status: 'continuing', episodeCount: 50, episodeFileCount: 50, rootFolderPath: '/media/kids/tv', certification: 'TV-Y7' },
      ],
    },
    plex: {
      getLibraryMedia: async () => [
        { sectionId: '1', sectionName: 'Kids Movies', type: 'movie', title: 'Paddington', year: 2014, tmdbId: 116149 },
        { sectionId: '1', sectionName: 'Kids Movies', type: 'movie', title: 'Heat', year: 1995, tmdbId: 949 },
        { sectionId: '2', sectionName: 'TV Shows', type: 'show', title: 'Bluey', year: 2018, tvdbId: 353546 },
        { sectionId: '2', sectionName: 'TV Shows', type: 'show', title: 'Severance', year: 2022, tvdbId: 371980 },
        { sectionId: '3', sectionName: 'Kids TV', type: 'show', title: 'Daniel Tiger', year: 2012, tvdbId: 222 },
      ],
    },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');

  // Adult-rated movie sitting in the kids library.
  const adultInKids = await listLibrary.execute({
    mediaType: 'movie',
    plexLibrarySectionName: 'Kids Movies',
    ratingOperator: 'gt',
    ratingValue: 'PG',
  });
  assert.equal(adultInKids.movieTotal, 1);
  assert.equal(adultInKids.movies[0].title, 'Heat');
  assert.equal(adultInKids.movies[0].plexLibrarySectionName, 'Kids Movies');

  // Kids-rated shows (TV-Y7 or below) that live outside the Kids TV library.
  const kidsOutsideKids = await listLibrary.execute({
    mediaType: 'show',
    excludePlexLibrarySectionName: 'Kids TV',
    ratingOperator: 'lte',
    ratingValue: 'TV-Y7',
  });
  assert.equal(kidsOutsideKids.seriesTotal, 1);
  assert.equal(kidsOutsideKids.series[0].title, 'Bluey');
  assert.equal(kidsOutsideKids.series[0].plexLibrarySectionName, 'TV Shows');
}

async function testListLibraryMediaFiltersBySectionAndRating() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    plex: {
      getLibraryMedia: async () => [
        { sectionId: '1', sectionName: 'Kids Movies', type: 'movie', title: 'Paddington', year: 2014, contentRating: 'PG' },
        { sectionId: '1', sectionName: 'Kids Movies', type: 'movie', title: 'Heat', year: 1995, contentRating: 'R' },
        { sectionId: '2', sectionName: 'Movies', type: 'movie', title: 'Dune', year: 2021, contentRating: 'PG-13' },
      ],
    },
  });
  const listLibraryMedia = tools.find(tool => tool.name === 'plex_list_library_media');

  const allInSection = await listLibraryMedia.execute({ sectionName: 'Kids Movies' });
  assert.equal(allInSection.total, 2);

  // mediaType must be scoped to 'movie' (or use movieRatingValue) since a bare "PG" isn't a
  // valid TV rating and mediaType defaults to 'all' — see rating validation tests below.
  const mismatched = await listLibraryMedia.execute({ sectionName: 'Kids Movies', mediaType: 'movie', ratingOperator: 'gt', ratingValue: 'PG' });
  assert.equal(mismatched.total, 1);
  assert.equal(mismatched.media[0].title, 'Heat');
}

async function testListLibraryContentRatingToleratesFormatting() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: {
      getQualityProfiles: async () => [],
      getMovies: async () => [{ id: 1, title: 'Dune', year: 2021, tmdbId: 1, monitored: true, hasFile: true, status: 'released', certification: 'PG-13' }],
    },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');

  // "PG13" (no dash) must still match a stored "PG-13" rating.
  const result = await listLibrary.execute({ mediaType: 'movie', contentRating: 'PG13' });
  assert.equal(result.movies.length, 1);
  assert.equal(result.movies[0].title, 'Dune');
}

async function testListLibraryRatingValidationRejectsInvalidInput() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: {
      getQualityProfiles: async () => [],
      getMovies: async () => [
        { id: 1, title: 'Heat', year: 1995, tmdbId: 949, monitored: true, hasFile: true, status: 'released', certification: 'R' },
        { id: 2, title: 'Paddington', year: 2014, tmdbId: 116149, monitored: true, hasFile: true, status: 'released', certification: 'PG' },
      ],
    },
    sonarr: { getQualityProfiles: async () => [], getSeries: async () => [{ id: 3, title: 'Bluey', year: 2018, tvdbId: 1, monitored: true, status: 'continuing', episodeCount: 1, episodeFileCount: 1, certification: 'TV-Y' }] },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');

  // Garbage operator: hard error, not a silent "matches everything".
  const badOperator = await listLibrary.execute({ ratingOperator: 'greater-than', ratingValue: 'PG' });
  assert.match(badOperator.error, /Unrecognized ratingOperator/);

  // Explicitly scoped (mediaType: 'movie') invalid value: hard error, not a silent empty result.
  const badExplicitValue = await listLibrary.execute({ mediaType: 'movie', ratingOperator: 'lte', ratingValue: 'TV-7' });
  assert.match(badExplicitValue.moviesError, /not a recognized movie rating/);

  // Shared ratingValue under the default mediaType 'all': "PG-13" is a valid movie rating but
  // not a valid TV rating (no code is ever valid on both ladders), so the show branch errors
  // out (plex_list_library:seriesError) while the independently-validated movie branch still
  // returns correctly filtered results (R excluded, PG kept) — no silent leakage either way.
  const sharedValue = await listLibrary.execute({ ratingOperator: 'lte', ratingValue: 'PG-13' });
  assert.equal(sharedValue.movies.length, 1);
  assert.equal(sharedValue.movies[0].title, 'Paddington');
  assert.match(sharedValue.seriesError, /not a recognized TV rating/);
  assert.equal(sharedValue.series, undefined);
}

async function testPlexSectionFiltersRejectUnknownSectionNames() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: { getQualityProfiles: async () => [], getMovies: async () => [{ id: 1, title: 'Heat', year: 1995, tmdbId: 949, monitored: true, hasFile: true, status: 'released' }] },
    plex: {
      getLibraries: async () => [{ id: '1', name: 'Kids Movies', type: 'movie', count: 1 }],
      getLibraryMedia: async () => [{ sectionId: '1', sectionName: 'Kids Movies', type: 'movie', title: 'Heat', year: 1995, tmdbId: 949 }],
    },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');
  const listLibraryMedia = tools.find(tool => tool.name === 'plex_list_library_media');

  // Typo'd section name: fails loudly with the real section names, instead of silently
  // matching zero items.
  const typo = await listLibrary.execute({ mediaType: 'movie', plexLibrarySectionName: 'Kidz Movies' });
  assert.match(typo.error, /No configured Plex library section matches/);
  assert.match(typo.error, /Kids Movies/);

  // Correct name: works normally.
  const correct = await listLibrary.execute({ mediaType: 'movie', plexLibrarySectionName: 'Kids Movies' });
  assert.equal(correct.movies.length, 1);

  // Same validation applies to plex_list_library_media's sectionName filter.
  const mediaTypo = await listLibraryMedia.execute({ sectionName: 'Kidz Movies' });
  assert.match(mediaTypo.error, /No configured Plex library section matches/);
}

async function testListLibrarySingleCallKidsRatingAcrossRootFolders() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    radarr: {
      getQualityProfiles: async () => [],
      getMovies: async () => [
        { id: 1, title: 'Paddington', year: 2014, tmdbId: 1, monitored: true, hasFile: true, status: 'released', rootFolderPath: '/Plex/Plex/Kids/Movies', certification: 'PG' },
        { id: 2, title: 'Encanto', year: 2021, tmdbId: 2, monitored: true, hasFile: true, status: 'released', rootFolderPath: '/Plex/Plex/Movies', certification: 'PG' },
        { id: 3, title: 'Heat', year: 1995, tmdbId: 3, monitored: true, hasFile: true, status: 'released', rootFolderPath: '/Plex/Plex/Movies', certification: 'R' },
      ],
    },
    sonarr: {
      getQualityProfiles: async () => [],
      getSeries: async () => [
        { id: 4, title: 'Daniel Tiger', year: 2012, tvdbId: 1, monitored: true, status: 'continuing', episodeCount: 1, episodeFileCount: 1, rootFolderPath: '/Plex/Plex/Kids/TV Shows', certification: 'TV-Y7' },
        { id: 5, title: 'Bluey', year: 2018, tvdbId: 2, monitored: true, status: 'continuing', episodeCount: 1, episodeFileCount: 1, rootFolderPath: '/Plex/Plex/TV Shows', certification: 'TV-Y' },
        { id: 6, title: 'Severance', year: 2022, tvdbId: 3, monitored: true, status: 'continuing', episodeCount: 1, episodeFileCount: 1, rootFolderPath: '/Plex/Plex/TV Shows', certification: 'TV-MA' },
      ],
    },
  });
  const listLibrary = tools.find(tool => tool.name === 'plex_list_library');

  // The exact scenario from the transcript: kid-safe titles (movies PG-13 or below, shows
  // TV-Y7 or below) whose root folder does NOT contain "/Kids/", in one call.
  const result = await listLibrary.execute({
    mediaType: 'all',
    ratingOperator: 'lte',
    movieRatingValue: 'PG-13',
    showRatingValue: 'TV-Y7',
    excludeRootFolderPath: '/Kids/',
  });
  assert.deepEqual(result.movies.map(m => m.title), ['Encanto']);
  assert.deepEqual(result.series.map(s => s.title), ['Bluey']);
}

async function testListLibrarySectionsAliasesLibraryStats() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    plex: { getLibraryCounts: async () => [{ id: '1', name: 'Kids Movies', type: 'movie', count: 5 }] },
  });
  const stats = tools.find(tool => tool.name === 'plex_get_library_stats');
  const sections = tools.find(tool => tool.name === 'plex_list_library_sections');

  const statsResult = await stats.execute({});
  const sectionsResult = await sections.execute({});
  assert.deepEqual(statsResult, sectionsResult);
  assert.equal(sectionsResult.libraries[0].name, 'Kids Movies');
}

async function testGetDownloadsFiltersAndTrimsStatus() {
  const { buildPlexTools } = await importTs('/Users/kyleboyer/git/kai-plugin-plex/src/main/tools.ts');
  const tools = buildPlexTools({
    sabnzbd: {
      getQueue: async () => [
        { id: 'sab-1', source: 'sabnzbd', name: 'Some Movie', status: 'Downloading', sizeBytes: 10, sizeLeftBytes: 5, speed: 0, eta: '', progress: 50, category: 'movies' },
      ],
      getFullStatus: async () => ({
        status: 'Downloading',
        paused: false,
        speedLimit: '0',
        speed: '10 MB/s',
        speedMb: 10,
        sizeLeft: '5 GB',
        slots: [{ id: 'sab-1', source: 'sabnzbd', name: 'Some Movie', status: 'Downloading', sizeBytes: 10, sizeLeftBytes: 5, speed: 0, eta: '', progress: 50, category: 'movies' }],
      }),
    },
    qbittorrent: {
      getTorrents: async () => [
        { id: 'qbt-abc', source: 'qbittorrent', name: 'Ubuntu ISO', status: 'downloading', sizeBytes: 20, sizeLeftBytes: 2, speed: 100, eta: '1m', progress: 90, category: 'linux' },
      ],
      getTransferInfo: async () => ({ connection_status: 'connected', dl_info_speed: 100 }),
    },
  });
  const getDownloads = tools.find(tool => tool.name === 'plex_get_downloads');
  const result = await getDownloads.execute({ query: 'ubuntu', category: 'linux', limit: 1 });

  assert.equal(result.totalItems, 1);
  assert.equal(result.returnedItems, 1);
  assert.equal(result.items[0].name, 'Ubuntu ISO');
  assert.equal(result.status.sabnzbd.slots, undefined);
  assert.equal(result.status.sabnzbd.status, 'Downloading');
}

await testQbitErrors();
await testRadarrFullToggle();
await testSeerTvUsesTmdb();
await testTautulliNoApiKeyUrl();
await testPlexLibraryIndexExtractsSectionIds();
await testPollerAttachesPlexLibrarySections();
await testPollerEmitsAutomationEvents();
await testPollerDoesNotOverlapFastPolls();
await testPollerPublishesStreamThumbnailsSeparately();
await testBackendRejectsAmbiguousAddDefaults();
await testListLibraryFiltersAndPages();
await testListLibraryRatingOperatorAndPlexSectionCrossReference();
await testListLibraryMediaFiltersBySectionAndRating();
await testListLibraryContentRatingToleratesFormatting();
await testListLibraryRatingValidationRejectsInvalidInput();
await testPlexSectionFiltersRejectUnknownSectionNames();
await testListLibrarySingleCallKidsRatingAcrossRootFolders();
await testListLibrarySectionsAliasesLibraryStats();
await testGetDownloadsFiltersAndTrimsStatus();

console.log('All tests passed');
