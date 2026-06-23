# Kai Plugin — Plex & Media Stack

Full dashboard and AI controls for your self-hosted media stack, integrated into [Kai](https://github.com/LegionIO/kai-desktop).

## Features

- **Live streams** — Active Plex sessions via Tautulli with progress, transcode status, and stream termination
- **Downloads** — SABnzbd and qBittorrent queue management: pause, resume, delete, speed limits
- **Library browser** — Browse and manage your Radarr & Sonarr libraries with Plex section awareness
- **Requests** — Approve, deny, and review media requests from Seer/Overseerr
- **Subtitles** — Bazarr wanted list, manual subtitle search, provider status, and task runner
- **Indexers** — Prowlarr indexer health, release search, and grab
- **Transcoding** — Tdarr node management, worker controls, and library requeue
- **Invitations** — Wizarr user and invitation management
- **Stats** — Disk space, service health, and version info across all services
- **AI tools** — Ask Kai to search, add, or manage media across your stack
- **Key encryption** — API keys stored encrypted via Electron safeStorage (OS keychain)

## Services Supported

| Service | Purpose |
|---|---|
| Plex | Media server — library index and stream awareness |
| Tautulli | Stream monitoring and termination |
| Radarr | Movie library and download management |
| Sonarr | TV library and download management |
| SABnzbd | Usenet download client |
| qBittorrent | Torrent download client |
| Seer (Overseerr) | Media request management |
| Bazarr | Subtitle management |
| Prowlarr | Indexer aggregator |
| Tdarr | Media transcoding pipeline |
| Wizarr | Plex invitation and user management |

## Installation

Install from the Kai marketplace, or manually:

```bash
cd ~/.kai/plugins
git clone https://github.com/KyleBoyer/kai-plugin-plex.git plex
cd plex
npm install
npm run build
```

Restart Kai — the plugin is discovered automatically.

Configure each service via **Settings → Plex & Media Stack**. Enter the URL and API key for each service you use; unused services can be left unconfigured or disabled.

## Development

```bash
npm install
npm run dev      # builds directly to ~/.kai/plugins/plex/ and watches for changes
npm run watch    # alias for dev
npm run build    # production build → dist/
```

Restart Kai after each build to reload the plugin.

## Project Structure

```
src/
├── backend/
│   └── index.ts              # activate / deactivate, action handlers, key encryption
├── frontend/
│   ├── index.ts              # component registration
│   └── components/
│       ├── PlexPanel.tsx     # tabbed dashboard (Streams, Downloads, Library, Requests, …)
│       ├── PlexSettings.tsx  # per-service URL + key + test-connection
│       └── LibraryBrowser.tsx# search, add/remove/monitor Radarr & Sonarr
├── main/
│   ├── clients/              # typed API clients for each service
│   ├── poller.ts             # 30s fast poll + 5min slow poll
│   └── tools.ts              # AI tool definitions
└── shared/
    └── types.ts              # shared interfaces (PluginAPI, PluginConfig, state types)
```

## Release

Releases are automated via GitHub Actions. Go to **Actions → Release Plugin → Run workflow**, choose a version bump (`patch` / `minor` / `major`), and the workflow will build, tag, and publish a release with the plugin tarball.

## License

MIT
