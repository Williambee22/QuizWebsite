# Real-Time Quiz Site

A simple admin-controlled quiz website using Node, Express, and Socket.IO.

## Features

- Admin page controls the current question.
- Players join from their own browser.
- Server-controlled synchronized 15-second timer.
- Answer choices support A-D, plus E and F if the admin adds them.
- Live updates for all players.
- Admin sees who answered and live answer counts.
- Reveal button scores correct answers.
- Everything is synchronized through the server as the single source of truth.

## Run it

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Admin page:

```text
http://localhost:3000/admin.html
```

Default admin password:

```text
admin123
```

## Change the admin password

Windows PowerShell:

```powershell
$env:ADMIN_PASSWORD="yourpassword"
npm start
```

Command Prompt:

```cmd
set ADMIN_PASSWORD=yourpassword
npm start
```

macOS/Linux:

```bash
ADMIN_PASSWORD="yourpassword" npm start
```

## Use it on the same Wi-Fi

Find your computer's local IP address, then have players open:

```text
http://YOUR-IP:3000
```

Example:

```text
http://192.168.1.25:3000
```

## Notes

This version stores players and scores in memory. Restarting the server clears the game.
For a permanent production version, add login accounts and a database.