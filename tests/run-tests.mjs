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
  const client = new TautulliClient('http://tautulli', 'secret-key', async url => {
    if (String(url).includes('pms_image_proxy')) {
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
  const activity = await client.getActivity();
  assert.equal(activity.sessions[0].thumb, '/library/metadata/1/thumb');
  assert.equal('thumbUrl' in activity.sessions[0], false);
  assert.match(activity.sessions[0].thumbDataUrl, /^data:image\/png;base64,/);
  assert.equal(activity.sessions[0].thumbDataUrl.includes('secret-key'), false);
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
await testBackendRejectsAmbiguousAddDefaults();
await testListLibraryFiltersAndPages();
await testGetDownloadsFiltersAndTrimsStatus();

console.log('All tests passed');
