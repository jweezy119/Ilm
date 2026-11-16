# Running Ilm on your own host (Oracle Always Free)

The app needs three processes — Postgres 16, the Fastify API, the Next web
server — and Caddy in front for TLS. `docker-compose.prod.yml` runs all four on
one machine. Nothing is pulled prebuilt, so it builds for whatever architecture
the host is (x86_64 or ARM64).

Estimated cost: **$0**. No AI key is required; every Jev and embedding feature
has a local fallback. The only bill is the host.

---

## 1. Get an Oracle Always Free account

1. <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Sign up with an email, verify a phone number, and add a credit or debit card.
   The card is for identity verification only; Always Free resources are not
   charged. Oracle may make a small temporary authorization hold.
3. **Choose a home region with ARM capacity.** `us-phoenix-1`, `us-ashburn-1`,
   `eu-frankfurt-1` and `uk-london-1` are the usual bets. If the A1 shape says
   out of capacity, pick another region — the app does not care where it runs.

What you get for free: ARM Ampere A1 compute, **200 GB** of block storage, and
about **10 TB** of outbound traffic a month. Oracle reduced the Always Free A1
allowance in June 2026, so check the current figure on the signup page — it was
2 OCPU and 12 GB of RAM at the time of writing, down from 4 OCPU and 24 GB. Either
way it is more than this app needs: the full corpus is a 193 MB database and the
three processes measure about 520 MB under load (see
[the small-VPS section](#8-a-2-cpu--2-gb-vps-build-elsewhere)).

## 2. Create the instance

Compute → Instances → **Create Instance**:

| Field | Value |
| --- | --- |
| Image | **Ubuntu 24.04** (ARM). Oracle Linux 9 also works; Ubuntu is assumed below. |
| Shape | `VM.Standard.A1.Flex` — **2 OCPU, 12 GB** (the current Always Free allowance) |
| Networking | Create a VCN with a public subnet (the default wizard is fine) |
| SSH key | Generate one and paste the public half (see below) |
| Boot volume | **200 GB** (the default is ~50 GB, which is enough but tight) |

Generate a key on the machine that will administer the box:

```bash
ssh-keygen -t ed25519 -C "ilm-admin" -f ~/.ssh/ilm_oracle
# paste ~/.ssh/ilm_oracle.pub into the instance form
```

### Reserve the public IP

Instance → Attached VNICs → IPv4 addresses → edit → **Reserve a public IP
address**. An ephemeral IP can change when the instance stops, which would break
DNS and the certificate. Ten seconds here saves an afternoon later.

## 3. Open the firewall

Oracle gates traffic in the **VCN Security List**, not in the OS:

Networking → Virtual cloud networks → your VCN → Security Lists → Default
Security List → **Add Ingress Rules**:

| Port | Source | Why |
| --- | --- | --- |
| 80/TCP | `0.0.0.0/0` | Let's Encrypt HTTP-01, and the HTTP→HTTPS redirect |
| 443/TCP | `0.0.0.0/0` | The app |
| 22/TCP | your IP | SSH (usually already present) |

Postgres is published on `127.0.0.1` only, so it needs no rule.

## 4. A free hostname

Caddy gets a real certificate from Let's Encrypt, which needs a name that
resolves to the instance.

**DuckDNS** is the simplest free option — no card, no domain to buy:

1. <https://www.duckdns.org/> → sign in with any provider → create a subdomain,
   e.g. `ilm`.
2. Set its IP to your reserved Oracle public IP.
3. Add `A` records for both `ilm.duckdns.org` and `api.ilm.duckdns.org`
   (DuckDNS only hosts the bare name; the `api.` subdomain needs a second free
   DuckDNS subdomain, or a wildcard from a domain you control).

If that second subdomain is annoying, point `ILM_API_HOST` at the same DuckDNS
name with a different path — or just check the API on the server with
`docker compose exec api curl -s localhost:4000/health` and keep one public name.

**Zero-signup alternative for a quick look:** a Cloudflare quick tunnel
(`cloudflared tunnel --url http://localhost:3000`) hands you a
`https://*.trycloudflare.com` URL with no DNS and no open ports. Fine for a demo,
not for a product — the name is random and dies with the process.

## 5. Install Docker and run

```bash
sudo apt update && sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # then log back in
```

Copy the repository to the box (`git clone`, or `scp -r`), then:

```bash
cd Ilm/deploy
cp .env.example .env
$EDITOR .env          # hosts, password, ADMIN_TOKEN, email
./bootstrap.sh
```

Spoken audio is cached on disk (`TTS_CACHE_DIR`, persisted in the `api_data`
volume) and synthesised at most once per distinct text, so the default Google
Translate voice is shared by every reader rather than fetched once per listener.
Past `TTS_CACHE_MAX_BYTES` the oldest files are pruned.

`bootstrap.sh` starts Postgres, applies the migrations, ingests the five
scriptures (~35-40 min), ingests the Book of Enoch, builds the Arabic /
Hebrew / Greek search vectors, scores and indexes the corpus, then builds and
starts everything. It is safe to re-run.

The order matters: `index-original-text` must run after ingestion, because it
fills a column the ranking expression reads on every search. Skipping it leaves
every relevance score at 0 and literal English search returns nothing.

## 6. Prove it works

```bash
curl https://api.ilm.duckdns.org/health
# {"success":true,"data":{"status":"ok","search":{"ready":true,"passagesIndexed":45453},...}}

curl -X POST https://api.ilm.duckdns.org/api/search \
  -H 'content-type: application/json' -d '{"query":"mercy"}' | head -c 400
```

Then open the web app. `passagesIndexed` should be in the tens of thousands; if
it is 0 the corpus is not in that database.

## 7. Keep it alive and backed up

```bash
# Oracle reclaims Always Free instances that look idle for a week.
( crontab -l ; echo '0 */6 * * * /home/$USER/Ilm/deploy/keepalive.sh >/dev/null 2>&1' ) | crontab -

# Nightly database dump, kept for 14 days.
( crontab -l ; echo '0 3 * * * /home/$USER/Ilm/deploy/backup.sh >/dev/null 2>&1' ) | crontab -
```

## 8. A 2 CPU / 2 GB VPS: build elsewhere

A small free VPS is enough to **run** Ilm but not to **build** it.

Measured on the full corpus, `SEARCH_ENGINE=postgres`:

| Container | Idle | 40 concurrent searches |
| --- | --- | --- |
| postgres | 260 MB | 306 MB |
| api | 95 MB | 148 MB |
| web | 64 MB | 66 MB |
| **total** | **420 MB** | **~520 MB** |

Add the Docker daemon (~200 MB) and the OS (~300 MB) and you are around 1 GB of
2 GB. Two vCPUs is plenty: search is a Postgres `tsvector` query, and the heavy
CPU work (ingest, indexing) is one-time.

What does not fit is `npm ci` plus `next build`, which needs roughly 3-4 GB. So:

```bash
# on a machine with memory, then:
./deploy/ship-images.sh user@your-vps
```

`ship-images.sh` builds both images locally and streams them to the VPS over SSH,
so the VPS never compiles anything. The two machines must share an architecture
— `docker info | grep Architecture` on both. Then on the VPS:

```bash
cd Ilm/deploy
cp .env.example .env && $EDITOR .env
docker compose -f docker-compose.prod.yml -f docker-compose.small.yml up -d --build postgres
./bootstrap.sh          # migrations, ingest, index — no image build
```

`docker-compose.small.yml` lowers `shared_buffers` and the API heap for the
smaller box. Add a swap file anyway; it is cheap insurance against the OOM
killer:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Two caveats worth saying out loud. Ingest on 2 vCPUs takes roughly twice as long
as on 4. And a free VPS from a little-known provider is a learning machine, not
a production SLA — check whether it is a permanent tier or a limited trial before
you point a domain at it.

## Updating

```bash
git pull
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

The API runs `prisma migrate deploy` on boot and refuses to start if it fails, so
a schema change ships with the code that needs it. If you add a migration, the
deploy is the migration step.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `passagesIndexed: 0` | Corpus not ingested. Re-run `bootstrap.sh`, or run the ingest step alone. |
| Browser loads the site, search returns nothing | `NEXT_INTERNAL_API_URL` was not set at **build** time. Rebuild the web image with the compose build arg. |
| Caddy loops on `certificate issuance failed` | Port 80 is blocked by the Security List, or DNS does not point at the instance yet. |
| API exits immediately on start | A migration failed. Read the log — it names the migration. |
| `docker: command not found` after installing | You did not log back in after `usermod -aG docker`. |
| Oracle says the A1 shape is out of capacity | Pick a different home region. |
