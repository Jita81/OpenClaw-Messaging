# Website (landing + bootstrap)

Static site you can host anywhere (e.g. Vercel, GitHub Pages, Netlify). Serves the landing page and **bootstrap.json** for mesh discovery. No backend; the actual chat runs on peers run by the community.

**Deployed at [https://openclawmessaging.com](https://openclawmessaging.com)**; serves `bootstrap.json` so peers can discover each other. Pushes to the repo trigger automatic redeploys when connected to Vercel (or your host).

## Contents

- **index.html** — Landing page (quick start, mesh P2P, deployment, env vars, links).
- **WEBSITE.md** — Full website content in markdown (same structure as index.html). Use as source for static generation or rendering.
- **bootstrap.json** — Peer list for mesh discovery. Peers set `MESH_BOOTSTRAP_URL` to this URL to join the public mesh.
- **nodes.json** — Optional list of bootstrap URLs (e.g. this site’s bootstrap). Entries have `bootstrap_url` and description. No bridge or initiation URLs; mesh only.

## Bootstrap

- **Consume:** GET `bootstrap.json`. Returns `{ "version", "peers": [ { "peer_id", "ws_url", "capabilities" } ] }`. Peers use this to connect to each other.
- **Add a peer:** Open a PR adding or updating an entry in `peers` in `website/bootstrap.json`. Keep a copy at repo root `website/bootstrap.json` so links work—update both when changing.

## Hosting

1. Serve the `website/` folder as static files (e.g. `npx serve website` or deploy to Vercel).
2. Point your domain at it. No backend required.
3. Ensure `bootstrap.json` is deployed so `https://yourdomain.com/bootstrap.json` works for mesh discovery.

### Vercel (from GitHub)

1. In Vercel: **Add New Project** → import your GitHub repo.
2. **Root Directory:** Set to `website` (Project Settings → General → Root Directory).
3. Redeploy on push to `main`. No build step needed; Vercel serves the static files. You get `/`, `/bootstrap.json`, and `/nodes.json`.
4. Add custom domain (e.g. openclawmessaging.com) in Project → Settings → Domains.

### Railway (optional)

- Use **Dockerfile** at `website/Dockerfile` with build context = repo root, or set Root Directory to `website` and use Nixpacks/Node with `npx serve -s .`. Same result: `/`, `/bootstrap.json`, `/nodes.json`.
