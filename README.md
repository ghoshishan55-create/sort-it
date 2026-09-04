# Sort-it

A full-stack civic issue reporting platform using Express and SQLite.

## Run locally

1. Install Node.js 18+ (Node 20+ recommended).
2. Open a terminal in this folder.
3. Run:
```bash
npm install
npm start
```
4. Open `http://localhost:3000`.

The server binds to `0.0.0.0`, so another device on the same Wi-Fi can reach the development server using the computer's local IP, for example `http://192.168.1.10:3000`.

## Important

- `localhost` is only for the computer running the server. It is not a public website address.
- For public use, deploy the app behind HTTPS with a real domain and production database.
- Browser geolocation normally requires HTTPS on phones and non-localhost sites.
- Statistics start at zero and are calculated from the database.
- Login uses real server-side accounts and sessions.
- Poll votes can be changed. A user can vote separately in different polls.
- Issue support remains one support action per user/browser identity.
- Uploaded evidence is stored locally for development.
- This is not yet a production government-grade service. Add rate limiting, moderation, malware scanning, secure object storage, backups, audit logs, stronger identity verification where appropriate, privacy/legal review, and PostgreSQL or another production database before public launch.


## Sort-it admin access
The administrator account is determined by `ADMIN_EMAIL`, which defaults to `ghoshishan55@gmail.com`.
Set `ADMIN_EMAIL` in production if you want a different administrator. The administrator must log in with the password for that account, then open `/admin.html`.
Never expose or hard-code an administrator password.
