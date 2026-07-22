# Kai Plugin — Plex & the Arr Stack

Integrate your Plex media server and self-hosted arr stack into [Kai](https://github.com/LegionIO/kai-desktop). Monitor streams, manage downloads, browse your library, handle requests, and let Kai's AI operate your media stack via natural language.

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

Configure services via **Settings → Plex & the Arr Stack**. Enter the URL and API key for each service you use; anything unconfigured is simply skipped.

## AI library filtering

`plex_list_library` exposes a compact model-facing contract for the common
rating-and-location query. `includeLocationName` and `excludeLocationName` use
the caller's own text and match it against either the Radarr/Sonarr root folder
path or the Plex library section name; the plugin does not assume a particular
directory layout or section name.

For mixed movie/TV results, `maxContentRating` accepts either rating system and
reports the resolved pair in `ratingPolicy`. The default crosswalk is:

| Movie | TV |
|---|---|
| G | TV-G |
| PG | TV-PG |
| PG-13 | TV-14 |
| R / NC-17 | TV-MA |

Because the two systems are not identical, callers can supply
`movieMaxRating` and `showMaxRating` to override either side. Unknown ratings
and media whose Plex section cannot be cross-referenced are excluded from
ordered or combined-location comparisons rather than treated as safe matches.

## Development

```bash
npm install
npm run dev    # builds directly to ~/.kai/plugins/plex/ and watches for changes
npm run build  # production build → dist/
```

Restart Kai after each build to reload the plugin.

## Release

Releases are automated via GitHub Actions. Go to **Actions → Release Plugin → Run workflow**, choose a version bump (`patch` / `minor` / `major`), and the workflow will build, tag, and publish a release with the plugin tarball.

## License

MIT
