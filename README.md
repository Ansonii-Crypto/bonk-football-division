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
    css/account.css           Account form and navigation dropdown
    javascript/main.js        Navigation and routing
    javascript/assessments.js  Assessment browsing and profiles
    javascript/classes.js     Seven playstyle class guides
    javascript/divisions.js   Championship partnerships
    javascript/account.js     Bonk sign-in and account state
    javascript/build.mjs      Public-site build
worker/index.js               Same-origin account API
worker/migrations/            Account database migrations
worker/tests/                 Authentication tests
tests/                        Account UI tests
wrangler.jsonc                Cloudflare Worker configuration
```

## Current content

Assessments and Divisions start empty. The seven defined playstyle classes are retained. Class videos are not available yet.

Bonk.io account sign-in is available through **Account**. Assessments are not yet connected to a database. No player records or competitions are fabricated, and the existing Bonk Critic database is not connected.

## Local development

Open `code/html/index.html` directly, or install the deployment tools and run the Cloudflare preview:

```powershell
npm install
npm run db:migrate:local
npm run dev
```

Wrangler runs the build automatically. `npm run build` can also be run separately; it writes only public HTML, CSS, JavaScript, and media to `dist/`. The build rebases HTML asset references for hosting at the site root or a GitHub Pages project path. Configuration, credentials, source-control metadata, and the build script are excluded from the public output.

Use the Wrangler preview to test accounts. Opening the HTML file directly can preview static content but cannot sign in.

## Deployment

The GitHub repository stores the source. Wrangler publishes the site and its account API as the dedicated `bonk-football-division` Worker. A separate D1 database with the same name stores this site's accounts and sessions.

```powershell
npx wrangler whoami
npm run db:migrate:remote
npm run deploy -- --dry-run
npm run deploy
```

If Cloudflare authentication has expired, run `npx wrangler login` before deploying. GitHub pushes and Cloudflare deployments are separate actions; no automatic deployment workflow is configured.

The `bonk-football-division.com` custom domain is attached through `wrangler.jsonc`. Cloudflare manages its DNS binding and TLS certificate. Enable **Always Use HTTPS** under the domain's **SSL/TLS > Edge Certificates** settings to redirect HTTP traffic to HTTPS.

## Bonk accounts

Sign-in follows the old site's working Bonk flow: the Worker sends the username and unchanged password over HTTPS to the fixed `https://bonk2.io/scripts/login_legacy.php` endpoint with `remember=false`. It requires a successful response containing a valid account ID, username, and provider token. This uses Bonk's legacy login endpoint, rather than OAuth.

Passwords and Bonk tokens are not saved to the database, returned to the browser, or logged by the application. The Worker saves the verified Bonk ID, username, selected avatar code when available, and a hash of a new random site session token. The interface currently uses the username initial as its avatar. Your browser's password manager may separately offer to remember your password.

Site sessions last 24 hours and use an HttpOnly, Secure, SameSite=Lax cookie. The browser does not keep a session token in localStorage or sessionStorage. Logging out revokes the current session on the server and clears its cookie. Normal sign-in does not grant administrator access; administrator tools have not been added to this site.

The API requires same-origin JSON requests for sign-in and sign-out. Credentials are sent only to the fixed Bonk endpoint, with redirects disabled and bounded request/response sizes and timeouts. Sign-in is limited by IP and username. Expired sessions and stale attempt counters are cleaned daily.

Run the account and UI checks with Node.js 24 or later:

```powershell
npm test
```

Tests use mocked provider responses and synthetic credentials. They do not sign into a real Bonk account.

## Assessment browsing

Circular tier buttons and square initials filter the assessment grid. Multiple choices can be selected; each index has its own **All** button. Names starting with numbers or symbols appear under `#`. The grid renders up to 12 assessments per page, replacing cards when pages change.

Search, filters, sorting, and page are remembered in this browser. **Copy view link** includes the current settings, which take priority over the recipient's saved preferences. A selectable link field appears if automatic copying is unavailable. Press `/` to focus search when you are not already typing. Entire player cards are keyboard-accessible profile links.

Assessments use normal page scrolling with matching top and bottom padding. On desktop, the left indexes remain visible and scroll separately when needed; on smaller screens, they become horizontal rows. Returning from a profile restores the page and index positions for the same view.

When a database API is connected, it must paginate downloads as well as rendering. Player comparison and assessment editing are not implemented yet.

## Code conventions

Use four-space indentation, including the `head` and `body` elements inside `html`. Keep code in its language folder and media in `assets/`.

Page text is unselectable except inside text inputs and textareas. Images are undraggable.
