# DeepL Translator

A private, password-protected site for translating documents with DeepL.

- **One shared password**, no accounts. The login lasts 30 days on each device.
- **Passkeys**: once signed in, add a passkey for each device and sign in with your fingerprint, face or device PIN instead of the password.
- **Your DeepL keys stay on the server** (in environment variables). The page shows how much quota each key has left and, on "Automatic", sends each file to whichever key has the most.
- **Force the source language** (e.g. French) or let DeepL detect it, choose the target language, and save PDFs as Word or PDF.
- **Large PDFs are split automatically** into the fewest parts DeepL will accept, translated, and joined back into a single file. Because DeepL bills every PDF at a minimum of 50,000 characters, the page shows the estimated cost before you start.

## Setting it up on Vercel

1. **Import the repo** at [vercel.com/new](https://vercel.com/new) (or open your existing project).
2. **Add environment variables** under *Settings → Environment Variables*:

   | Name | Value |
   |---|---|
   | `SITE_PASSWORD` | The password you'll type to get in. Make it long. |
   | `SESSION_SECRET` | Any long random string (a password manager can generate one). |
   | `DEEPL_API_KEY_1` | Your first DeepL key |
   | `DEEPL_API_KEY_2` | Your second DeepL key |
   | `DEEPL_API_KEY_1_LABEL`, `DEEPL_API_KEY_2_LABEL` | Optional names shown on the page |

3. **Create a Blob store** under *Storage → Create → Blob*, choose **Private** access, and connect it to this project. This sets `BLOB_READ_WRITE_TOKEN` for you.
   Vercel limits uploads to its servers to 4.5 MB, so large files go to this store first, are passed to DeepL and are deleted straight away. Without it the site still works, but PDFs are split into parts of under 4 MB each, which can mean more parts and so more of the 50,000-character minimums.
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the new variables take effect.

If `SITE_PASSWORD` or `SESSION_SECRET` is missing, the site refuses all access rather than being left open.

## Passkeys

Passkeys are tied to the domain they're created on, so add them on the address you normally use (e.g. your custom domain, not the `…vercel.app` one). Their public keys are kept in the Blob store as `auth/passkeys.json`, so the Blob store (step 3 above) is needed. The password always remains as a fallback. To pin the domain explicitly, set `PASSKEY_RP_ID` (e.g. `alihbahasa.caprichos.dev`).

## Running it locally

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Locally there's no 4.5 MB limit, so the Blob store isn't needed.

## How splitting works

1. The browser reads the PDF (with pdf.js) to count characters per page.
2. If the file is over the limit for the key in use (Free: 10 MB / 500,000 characters, Pro: 30 MB / 1,000,000 characters), it's divided into consecutive page ranges, starting with as few parts as possible and adding one at a time until every part fits.
3. Each part is translated separately (in parallel). The results are joined in the browser: Word files keep their images, headers, lists, styles and footnotes; PDFs are concatenated.
4. If joining fails, each translated part can still be downloaded on its own.
