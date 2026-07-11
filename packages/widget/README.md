# @krispy/widget

The embeddable live-chat widget. One dependency-free `widget.js`, isolated in a
Shadow DOM (host-page CSS can't leak in). It talks to [`@krispy/edge`](../../services/edge).

## Embed

Host `widget.js` anywhere static (your CDN, the edge Worker's origin, an R2/Pages
bucket) and drop one tag on any page:

```html
<script
  src="https://widget.krispyai.com/widget.js"
  data-api="https://edge.krispyai.com"
  data-tenant="self"
  async
></script>
```

| attribute     | required | default        | meaning                                              |
| ------------- | -------- | -------------- | ---------------------------------------------------- |
| `data-api`    | yes      | —              | the `@krispy/edge` Worker base URL                   |
| `data-tenant` | no       | `self`         | tenant id (multi-tenant SaaS uses this)              |
| `data-title`  | no       | `Chat with us` | header text                                          |
| `data-accent` | no       | `#e39a2b`      | brand color (used before the KV `theme` fetch lands) |

## The loop

1. Visitor types → `POST /api/chat` → instant AI reply (Workers AI).
2. Every visitor message is mirrored to the owner's Telegram (one topic per visitor).
3. Owner replies from their phone → the widget's WebSocket (`/api/session/:id/ws`)
   pushes it in live, and **the AI goes silent** — the human owns the conversation.
4. When the AI hits its limit it appends `[!HANDOFF]`; the widget then shows a
   small contact-capture form (`POST /api/contact`).

## Local demo

Run the edge Worker (`cd services/edge && bunx wrangler dev`, serves on `:8787`),
then open `index.html` (it points `data-api` at `http://localhost:8787`). Serve it
over http so the WebSocket and `localStorage` work, e.g. `bunx serve packages/widget`.
