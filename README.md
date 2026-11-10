# Bonk Football Division

A Bonk.io football platform for player assessments, tier rankings, playstyle classes, and championship partnerships.

Live site: [bonk-football-division.com](https://bonk-football-division.com/).

## Project structure

```text
assets/                       Images, icons, fonts, and other media
code/
    html/index.html           Page structure
    css/main.css              Shared theme and navigation
    css/pages.css             Page layouts
    javascript/main.js        Navigation and routing
    javascript/assessments.js  Assessment browsing and profiles
    javascript/classes.js     Seven playstyle class guides
    javascript/divisions.js   Championship partnerships
    javascript/build.mjs      Public-site build
wrangler.jsonc                Cloudflare Worker configuration
```

## Current content

Assessments and Divisions start empty. The seven defined playstyle classes are retained. Class videos are not available yet.

The site does not yet connect to an assessment database or provide Bonk.io account sign-in. No player records or competitions are fabricated, and the existing Bonk Critic database is not connected.

## Local development

Open `code/html/index.html` directly, or install the deployment tools and run the Cloudflare preview:

```powershell
npm install
npm run dev
```

Wrangler runs the build automatically. `npm run build` can also be run separately; it writes only public HTML, CSS, JavaScript, and media to `dist/`. The build rebases HTML asset references for hosting at the site root or a GitHub Pages project path. Configuration, credentials, source-control metadata, and the build script are excluded from the public output.

## Deployment

The GitHub repository stores the source. Wrangler publishes the site as the dedicated `bonk-football-division` Worker with static assets.

```powershell
npx wrangler whoami
npm run deploy -- --dry-run
npm run deploy
```

If Cloudflare authentication has expired, run `npx wrangler login` before deploying. GitHub pushes and Cloudflare deployments are separate actions; no automatic deployment workflow is configured.

The `bonk-football-division.com` custom domain is attached through `wrangler.jsonc`. Cloudflare manages its DNS binding and TLS certificate. Enable **Always Use HTTPS** under the domain's **SSL/TLS > Edge Certificates** settings to redirect HTTP traffic to HTTPS.

## Assessment browsing

Circular tier buttons and square initials filter the assessment grid. Multiple choices can be selected; each index has its own **All** button. Names starting with numbers or symbols appear under `#`. The grid renders up to 12 assessments per page, replacing cards when pages change.

Search, filters, sorting, and page are remembered in this browser. **Copy view link** includes the current settings, which take priority over the recipient's saved preferences. A selectable link field appears if automatic copying is unavailable. Press `/` to focus search when you are not already typing. Entire player cards are keyboard-accessible profile links.

Assessments use normal page scrolling with matching top and bottom padding. On desktop, the left indexes remain visible and scroll separately when needed; on smaller screens, they become horizontal rows. Returning from a profile restores the page and index positions for the same view.

When a database API is connected, it must paginate downloads as well as rendering. Player comparison and assessment editing are not implemented yet.

## Code conventions

Use four-space indentation, including the `head` and `body` elements inside `html`. Keep code in its language folder and media in `assets/`.

Page text is unselectable except inside text inputs and textareas. Images are undraggable.
