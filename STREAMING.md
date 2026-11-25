# Streaming Ilm

Streaming is a way to find users, not a way to pay the hosting bill directly.
Twitch and Kick pay the *streamer*; none of that money arrives in the app's
accounts automatically. Add a support link (see `/en/support` and
`NEXT_PUBLIC_SUPPORT_URL`) and point viewers there, then earmark a fixed share
of what comes in for hosting.

The app's own running cost can be close to zero — the Oracle Always Free stack
in [deploy/README.md](./deploy/README.md#local-docker--a-free-cloudflare-tunnel)
is free, and every AI feature has a local fallback. Measure that number before
chasing revenue.

## Which platform

| Platform | Bar to monetise | Fit for Ilm |
| --- | --- | --- |
| **Kick** | 5 cumulative streamed hours unlock "Streamer" status and paid subs; 95/5 split in the creator's favour ([help](https://help.kick.com/en/articles/12273402-how-to-become-a-kick-streamer-and-enable-subscriptions)) | Lowest bar to actually receiving money. Good first channel. |
| **Twitch** | Subs/Bits/emotes/badges/Channel Points are open to all eligible streamers since 13 May 2026, but **payouts require Affiliate or Partner** ($50 minimum). Affiliate: 25 followers, 4 hours, 4 different days, 3+ average concurrent viewers on 4 days ([announcement](https://blog.twitch.tv/en/2026/05/13/monetization-for-all/)) | Bigger audience, slower path to a payout. |
| **pump.fun** | Livestreaming is 18+ only — streaming, watching *and* chatting — with a strict moderation policy ([policy](https://intercom.help/pumpfun-web/en/articles/11399886-livestream-moderation-policy)) | **Not recommended.** It is a memecoin launchpad; a coin attached to a scripture app is a legal and reputational risk, and the stream feature has been paused and reopened before. |

## Funding the app directly

The support page (`/[locale]/support`, linked from Settings and the sidebar) is
where stream revenue turns into hosting money. With a Square account, use a
hosted **Square Payment Link** — no API keys, no backend code, no card data in
this repo:

1. Square Dashboard → **Payments & orders → Payment links → Create link**.
2. Choose **Accept a donation** so donors enter their own amount, and title it
   "Ilm". Optionally redirect to the app after checkout.
3. **Share → Copy link**, then set it as `NEXT_PUBLIC_SUPPORT_URL` on the web
   service (before build, since `NEXT_PUBLIC_` values are inlined at build time).
4. Square sends receipts and shows sales per link in Dashboard. Online card
   processing is 3.3% + 30¢ for new US accounts, with no monthly fee for links;
   check the rate for your region.

A Square "donation" is not automatically tax-deductible unless you are a
registered charity — treat it as revenue for accounting purposes.

## What to stream

- Build in public: implement a feature, explain a search ranking decision, or
  show how a passage comparison is assembled from the corpus.
- Corpus exploration: pick a theme, search across the Quran, Torah, Talmud,
  both Testaments and Enoch, and read the evidence spans the app surfaces.
- Do **not** turn the stream into a place for religious rulings. The app shows
  sources, evidence and labelled scores; keep that discipline on camera.

## Compliance checklist

- **Copyright:** original-language texts are public domain; translations are
  not. Quote short excerpts and name the translation. No copyrighted music —
  all three platforms enforce DMCA. Do not stream content created by others.
- **Privacy:** the API logs search queries and can send query text to Jev. Do
  not let viewers type personal information into the app on stream, and do not
  read chat PII aloud.
- **AI claims:** scores are `source: 'jev' | 'derived'`. Never present a derived
  local score as model output, and never present the app as writing commentary.
- **Sensitive topics:** expect heated chat. Moderators, slow mode and a banned
  word list are not optional for this subject matter.
- **Disclosure:** disclose paid promotions and gifted subscriptions clearly.
- **Taxes:** creator income is yours and is taxable; keep records. This document
  is practical guidance, not legal or tax advice.

## OBS setup

1. Capture the deployed app URL (not the dev server or the quick tunnel) as a
   **Browser Source**: width 1920, height 1080, CSS `body { zoom: 1.25; }` if
   text is small. A browser source keeps chat and browser tabs off screen.
2. Use a second scene with a **Window Capture** of the browser only if the
   browser source breaks on locale redirects; the app redirects `/` → `/en`.
3. Crop any chat/notification overlays. Do not show email, tokens or the
   `.env` file.
4. Put the support URL and the stable app URL in the stream description and
   panels, not only in chat.

## Channel copy (ready to paste)

**Panel — About**

> Ilm is an open-source study tool for comparing the Quran, Torah, Talmud,
> both Testaments and the Book of Enoch. It shows passages, evidence and where
> each score came from. Web app: `<stable URL>`.

**Panel — Support**

> Hosting and development are paid by readers. If Ilm is useful to you, support
> it here: `<NEXT_PUBLIC_SUPPORT_URL>`. No account, no ads, no data selling.

**Rules / disclosure**

> Be civil. No harassment, hate, doxxing, personal information, spam, or
> proselytising wars. Keep questions about the texts, not about each other.
> Short quotes only — name your translation. Paid promotions and gifted subs
> are disclosed on stream. Moderators may remove comments at their discretion.

## Pre-stream checklist

- [ ] Stable HTTPS URL is live and search works through it.
- [ ] Support link is configured and visible in the panel and description.
- [ ] No dev tools, `.env`, keystore or private chat on screen.
- [ ] Translation excerpts are short and attributed.
- [ ] No copyrighted music.
- [ ] Moderator present, slow mode on, rules posted.
- [ ] Source labels visible; nothing derived presented as model output.
