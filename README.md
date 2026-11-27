# TheZachBot

A Discord bot with role-restricted moderation and voice commands, dino-themed welcome messages, and TikTok LIVE alerts.

## Setup

1. Install Node.js 20 or newer.
2. Create a Discord application and bot, invite it with **Ban Members**, **View Channels**, **Send Messages**, **Embed Links**, **Connect**, and **Speak** permissions.
3. In the Discord Developer Portal, enable the **Server Members Intent** and **Message Content Intent** for the bot.
4. Copy `.env.example` to `.env`, add your bot token, and adjust channel/role IDs if needed.
5. Run `npm install`, then `npm start`.

The configured minimum command role defaults to `1572455183819087903`. A member can use commands only if their highest role is that role or above it. All prefix commands, including `.help`, are restricted. Commands are prefixed with a period.

## Features

- `.ban <user ID> [reason]` and `.unban <user ID>` require the configured role and the bot's **Ban Members** permission.
- `.block <TikTok username>` explains that TikTok blocking must be done by a LIVE moderator; the connector is read-only and cannot block users on TikTok.
- `.join` joins the regular voice channel you are in and reads messages from that voice channel's chat aloud. `.leave` disconnects the bot. Voice playback uses English Google Translate TTS; keep voice messages reasonably short.
- New members receive a dino-themed welcome embed in channel `1572447173579243614` and a welcome DM. DMs depend on each member's privacy settings.
- TikTok LIVE is checked every 30 seconds for `@zachwallace09`. When the creator is live, the bot connects to the LIVE and posts a dino-themed embed for each gift in channel `1572450669275783260`. Set `TIKTOK_GIFT_CHANNEL_ID` to change it. LIVE-start alerts still go to the welcome channel by default; set `TIKTOK_NOTIFY_CHANNEL_ID` to change that.

TikTok live detection and gift events use the community-maintained, unofficial `tiktok-live-connector` package and may be affected by changes to TikTok. The bot logs connection errors and retries on the next check. It monitors the configured creator only; it cannot detect every TikTok LIVE globally.

Run the focused tests with `npm test`.

## Deploy on Render

1. Upload the ZIP to a GitHub repository, or connect the repository containing these files to Render.
2. In Render, create a **Background Worker** from the repository. The included `render.yaml` configures the worker, build command, and start command.
3. Add `DISCORD_TOKEN` in the Render service's environment settings. Do not put your bot token in the ZIP or commit it to source control.
4. Deploy the worker. Render should show `Logged in as ...` in the service logs when the Discord connection succeeds.

The worker needs outbound network access to Discord and TikTok. Use a paid Render instance if the free tier does not offer always-on background workers for your account.
