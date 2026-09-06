# HE30 config cloud API

This is the server-side part of the optional private profile backup feature. It
must run separately from GitHub Pages. The browser never connects to MongoDB and
the MongoDB connection string must never be committed or added to `index.html`.

## Data model

Each `device_configs` document uses an HMAC-SHA256 of the normalized WebHID
serial as `_id`. The raw serial is not stored. The complete single-profile JSON
is stored in `config`, and the user's passphrase is stored as a salted scrypt
hash. A serial number identifies a keyboard; the passphrase authorizes reading
and replacing its backup.

## Local setup

1. Create a MongoDB Atlas database and a least-privilege database user.
2. Copy `.env.example` to `.env` and fill in `MONGODB_URI`.
3. Generate a private `CONFIG_KEY_SECRET` of at least 32 random characters.
4. Keep the production GitHub Pages origin and local development origin in
   `ALLOWED_ORIGINS`.
5. Install and run the API:

   ```powershell
   npm install
   npm start
   ```

6. Test `http://localhost:8787/health`.
7. In the root `index.html`, set `he30-cloud-api` to the API URL, for example
   `http://localhost:8787` locally or the deployed HTTPS URL in production.

For production, deploy this folder to a Node.js host and add the same environment
variables in that host's secret manager. Do not expose port 8787 directly; use
the host's HTTPS endpoint. Atlas network access must allow that server, not every
browser using the web driver.

## Endpoints

- `GET /health` checks service availability.
- `POST /api/configs/upload` creates or replaces a backup after validation.
- `POST /api/configs/download` returns a backup after passphrase verification.

Both config endpoints accept the serial and passphrase in the JSON request body,
so the serial does not appear in URLs or ordinary proxy access logs. Requests are
limited to 2 MB and rate-limited per server instance.
