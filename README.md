# Relay WhatsApp workspace

Frontend assets and the Node backend share the project root. Use Node.js 20 or later:

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. `npm.cmd start` runs without watch mode. Restart an already-running server after backend changes. The ignored `.env` contains the PostgreSQL connection; `.env.example` provides a setup template.

The main Relay application uses `PORT=3000`. The independent GHL outbound callback listener uses `GHL_CALLBACK_PORT=3003`, so both services can run at the same time without a port conflict. The tunnel helper reads both values from `.env` and stops with a clear configuration error if they are set to the same port.

All displayed records come from PostgreSQL and connected WhatsApp accounts. There are no seeded contacts, numbers, branches, analytics, or profile identities. Dashboard totals describe stored synchronized records. WhatsApp Numbers contains only your own accounts; Contacts lists remote contacts and groups with full phone numbers when WhatsApp provides them. WhatsApp LIDs are internal identifiers and are never displayed as telephone numbers.

Add accounts through WhatsApp Numbers and scan the live QR from WhatsApp > Linked devices > Link a device. Accounts can be paired before any branches exist. Create real branches in Branches, then Manage a number to select several branches and enter its responsible person's name. Assignments persist in PostgreSQL.

Click a contact to view its complete stored timeline across all accounts, with full account phone numbers on each message. The Conversations page merges group history received by multiple accounts, displays the accounts sharing that group, and lists available member numbers. Filter by branch, connected number, all groups, direct contacts, or a specific group. Choose the sending account before replying. Group members synchronize on connection and membership changes; Sync groups refreshes them manually.

Baileys synchronizes contacts, messages supplied through WhatsApp history events, and group metadata. Only records actually received from WhatsApp are shown; WhatsApp may provide limited history or omit member phone numbers. Old records captured before sender metadata support may have no sender phone. Media messages show captions or placeholders; attachments are not downloaded. QR pairing uses community Baileys 7.0.0-rc14. The server binds to localhost; remote deployment needs authentication and HTTPS.

The backend adds its own tables and columns without deleting existing account sessions or messages: relay_accounts, relay_auth, relay_messages, relay_contacts, relay_groups, relay_branches, and relay_account_branches. Legacy demo branch identifiers are not imported as real branches.

Validation: `npm.cmd run check` and `npm.cmd test`. Tests cover phone/LID identity, cross-account contact history, many-to-many branches, shared group membership and message deduplication, group filtering, empty real-data state, and QR modal click dispatch.

Remote contacts and groups also support multiple branch assignments and responsible person names: open their profile and choose Manage branches and responsible person. These persist in relay_contact_profiles and relay_contact_branches.

Delete a connected account from WhatsApp Numbers > Delete (or Manage > Delete number). Confirm the removal to clear that account and its saved session, assignments, contacts, groups, and stored messages. Other accounts and branches remain. If remote logout fails, the app tells you to remove the linked device on your phone.

Background mode (Windows): stop the foreground backend with Ctrl+C, then run `npm.cmd run background:start`. Closing the browser or terminal does not stop the supervised backend. `npm.cmd run background:status` checks it; `npm.cmd run background:stop` stops it. Logs are in `.runtime/backend.log`. The supervisor restarts a crashed backend after five seconds; saved WhatsApp sessions restore from PostgreSQL. Network reconnects continue with a capped delay until explicit logout or session replacement.

`npm.cmd run background:install` uses native Windows Task Scheduler to register a limited-permission task that starts the supervisor at your sign-in and starts it now. `npm.cmd run background:uninstall` removes that startup task; use background:stop separately to stop the active supervisor. No administrator password or elevated runtime is stored. The PC must remain awake and signed in. Sign-out, sleep, or shutdown interrupts local operation. For uninterrupted 24/7 operation, deploy to an always-on server.

The background supervisor and automatic sign-in task were installed on this PC. A restart check confirmed the supervisor restored a healthy backend after its child process stopped. `npm.cmd run background:startup-status` checks the task. `node background-restart.test.mjs` is an optional live restart test that briefly stops the supervised backend at port 3000.

WhatsApp Numbers and Branches use tables. Click a row (or press Enter when focused) to open its full details and editing controls. Number details allow editing the account name, responsible person, and multiple branches; branch details allow editing its name/location and list all assigned accounts and contacts.

Contact synchronization stores the device-saved name separately from a contact's public WhatsApp profile name. Saved names take priority and are shown per connected account in the contact profile. Contacts > Sync contact names requests a fresh contact snapshot from connected accounts. Existing saved sessions also request a snapshot on reconnection when app-state keys are available. This can only obtain names WhatsApp supplies to the linked device, not unrestricted access to the phone address book.

Only contacts and groups with at least one captured stored message appear in the workspace and its counts. Address-book records still supply saved names for matching conversations; phonebook-only records do not appear as contacts. Number filters require captured messages through that account. WhatsApp Numbers and Branches tables have no action column: click a row or press Enter to open its details.

Message bubbles show the sender name without a telephone number or Sent through/Received by footer. Saved phone-contact names take priority per connected account, including group members without a separate captured direct chat.

Dashboard and Conversations group filters list every synchronized group, including groups without stored messages. Selecting All groups or a specific group includes those group records in these views; an empty group opens with its membership details and no captured history. Contacts still lists only captured conversations.

Navigation stores the active tab in the URL fragment (for example, /#contacts or /#numbers). Refreshing or reopening that URL restores the same tab; browser Back/Forward follows tab navigation.

Responsive layouts support compact phone inbox/thread navigation, tablet split views, and desktop navigation. Tables scroll inside their panels, dialogs fit dynamic viewport height, touch controls are enlarged, and mobile navigation supports a dismissible overlay and keyboard focus.

Contacts & Groups has All, Contacts, and Groups tabs with independent filters. Contacts uses separate name and phone fields; Groups uses group name, group selection, and connected number; All uses separate name and phone-number filters plus connected number. The directory lists and counts only captured conversations.

Every directory tab also has Branch, Employee, Message date from, and Message date to filters. Employee matches the responsible person assigned to a contact/group or its connected accounts. Dates are inclusive and match captured message dates in Asia/Kolkata. Each tab retains its own selections.

Message type filters support text, audio/voice notes, images, videos, documents, stickers, locations, contact cards, and unknown types. Date, connected number, and type constraints must match the same captured message. New messages store the WhatsApp payload type. Older records are classified from existing placeholders/text, since original media payloads were not retained.

Contacts & Groups filters are in a right-side slide-in drawer opened by Filters. Edits are drafts until Apply & save; selections are stored per tab in this browser and restored after refresh. Cancel discards drafts; Reset resets draft values and requires Apply & save to change the results. Invalid date ranges cannot be applied.

Every page uses the compact right-side filter drawer with draft edits, Apply & save, Cancel, and Reset. Selections persist independently for Dashboard, Conversations, WhatsApp Numbers, Branches, and the three directory tabs. The manual Sync contact names button has been removed; saved names still synchronize in the backend. Tables use Phone number; the former Connected numbers column is Employee and displays responsible person/account names only.


## Integrations

Open Integrations to add WhatsApp, Plivo, or email accounts. WhatsApp uses the existing live QR pairing flow. The packages `imapflow`, `nodemailer`, `mailparser`, `googleapis`, `@azure/msal-node`, and `plivo` are installed. Plivo is pinned to 4.75.1 to avoid vulnerable legacy dependencies in a later SDK release.

- Plivo: enter Auth ID and Auth Token from your Plivo account. A phone number can restrict imported call records. Save, Test connection, then Sync now. The integration reads the latest 20 completed calls on each poll; Employees can also place browser voice calls using assigned Plivo numbers.
- Zoho: enable IMAP for the mailbox, enter its email address and app password, and use your region/account's IMAP and SMTP hosts. Defaults are imap.zoho.com and smtp.zoho.com; business accounts may use imappro/smtppro hosts. Connections use TLS on 993 and 465.
- Gmail: choose an app password (requires provider support and account setup) or OAuth. OAuth requires a Google web application client ID/secret, enabled Gmail API, and the exact callback `http://localhost:3000/api/integrations/oauth/gmail/callback`. Requested scope is gmail.readonly; offline tokens allow background refresh.
- Microsoft: register a confidential web application in Microsoft Entra, provide client ID, client secret, and tenant, and register `http://localhost:3000/api/integrations/oauth/microsoft/callback`. Delegated scopes are Mail.Read, User.Read, and offline_access. Save and choose Sign in, then authorize the configured mailbox.
- Other email: enter TLS IMAP/SMTP hostnames and mailbox credentials.

Configuration forms do not label an account Connected until a provider test or OAuth verification succeeds. Credentials are never returned to the browser and are encrypted in PostgreSQL using the local `.runtime/integration.key`. Back up that key with the database; losing it prevents decryption of provider credentials. Keep it out of source control. OAuth base origin can be configured with OAUTH_REDIRECT_BASE; its callbacks must match the registered provider redirect URLs.

Connected email/call integrations synchronize in the backend every minute. The latest 100 inbox messages are imported per email account; only text/captions are displayed, and attachments are not stored. Calls and Email conversation tabs display imported records; All also includes them. Plivo also supports the browser dialer described below; outbound email composition is not implemented. Credentials and provider account consent are needed to verify live connections.

Integration data is stored in relay_integrations and relay_channel_records. Integration tests cover validation, encrypted credentials, tamper rejection, redacted API fields, and routing. No fake provider accounts are seeded.

Provider setup references: [Zoho IMAP](https://www.zoho.com/mail/help/imap-access.html), [Google OAuth web applications](https://developers.google.com/identity/protocols/oauth2/web-server), [Microsoft Graph messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), [Plivo calls](https://docs.plivo.com/docs/voice/api/calls).

## Employees and browser voice calls

Open Employees > New employee, enter a name and select one or more branches. Each employee can have multiple WhatsApp accounts, Plivo numbers, and email integrations. Each account/number/mailbox belongs to one employee. Refresh Plivo numbers retrieves actual purchased numbers from connected Plivo accounts; only available voice-enabled numbers can place calls. Click an employee row to edit assignments.

Create an employee with a Plivo number, then use Voice call in their details, a contact conversation, or Conversations > Calls > New voice call. Select the employee, caller number and destination, then allow microphone access. The dialer uses short-lived Plivo endpoint JWTs; account credentials remain on the backend. It creates a provider application/endpoint when needed. Only voice calls use session recording. Signed recording callbacks retrieve the provider audio and store the actual MP3 bytes in PostgreSQL relay_call_recordings; playback reads those bytes from the local backend. Recordings larger than 32 MB are rejected.

Plivo requires public HTTPS callbacks. The approved temporary Cloudflare tunnel exposes only the dedicated callback listener at 127.0.0.1:3002. Unsigned callbacks return 403, and application/database API routes return 404. Call metadata and recording callback details pass through Cloudflare; the main application and provider credentials stay local.

Start the backend first, then run `npm.cmd run voice:tunnel:start`. Use `npm.cmd run voice:tunnel:status` and `npm.cmd run voice:tunnel:stop` to manage it. The helper runs hidden after the terminal closes. Restarting it generates a new temporary hostname and updates Voice setup automatically. A Windows reboot requires starting this tunnel again. Quick tunnels are for development; continuous service needs a stable HTTPS callback URL and an always-on host. The main app remains at http://localhost:3000.

The official prebuilt Plivo browser SDK 2.2.16 and its licenses are vendored under vendor/, avoiding unused SDK build dependencies. Tests validate employee assignments, inherited branch/name displays, voice XML and UI dispatch. Live account authentication and number discovery were verified; a real recipient call and recording still require a user-initiated call.

## Unified contact inbox

Conversations now lists contact names on the left and shows WhatsApp messages, Plivo calls, and emails together in the right timeline. Incoming activity is on the left; outgoing activity is on the right. Calls with stored recordings have an audio player with seeking. New contact/Edit contact supports multiple international phone numbers and multiple email addresses. Matching addresses link captured history to that contact; changing addresses changes the linked history without deleting messages or recordings. A phone/email address can belong to only one saved contact. Saved contact identity is separate from WhatsApp device contact names. New contacts can be created without captured messages.

The bottom composer switches between WhatsApp and Email, chooses a connected sender account/mailbox and recipient address, and retains drafts per contact/channel. Connect mailbox/WhatsApp opens the integration form. Email sending uses SMTP for app-password mailboxes, Gmail messages.send for Google OAuth, and Microsoft Graph sendMail. Existing Gmail/Microsoft OAuth users must reauthorize for gmail.send/Mail.Send permissions; no automatic consent or test email is sent. Imported inbox messages and messages sent from this app appear in the timeline; emails sent outside this app are not imported from Sent folders. Email synchronization currently loads the latest 100 inbox messages.

Plivo recording sync imports the latest 20 available provider recordings per account, resolves their call metadata, and retries missing downloads each minute. It stores actual audio bytes in relay_call_recordings, including historical incoming/outgoing call recordings when available. Sync recordings also runs manually from Calls. Calls that were never recorded by Plivo cannot be reconstructed and display Recording unavailable. The app's browser voice calls already request recording; this update does not change existing external Plivo number routing. Audio downloads are limited to 32 MB and approved Plivo/S3 recording hosts over HTTPS. Real stored MP3 playback and HTTP byte-range seeking were verified.

Contact identities use relay_crm_contacts and relay_crm_addresses. Verification: npm.cmd run check, npm.cmd test, and unified-conversations.test.mjs cover multi-address matching, merged channel history, direction, call deduplication and playback URLs.

The conversation composer is collapsed by default. Write a message opens it; Collapse composer closes it while retaining drafts. Its connection buttons and Channel caption are removed. Call bubbles show direction, recording playback and date without the hangup/status-duration line. Delete contact requires confirmation and deletes all locally stored activity matched to the contact, including recordings. Deleted message/call/email identifiers are retained in relay_deleted_activity to prevent history polling from restoring them. New activity can create a new conversation. This deletes local database history; it does not delete provider-side messages, emails or recordings. The deletion database test uses temporary tables only.

Scroll preservation: the five-second workspace poll skips identical responses, and rendering skips unchanged markup. Changed content preserves window/nested scroll positions and the visible contact anchor, restoring focus with preventScroll. Checkbox changes update controls without replacing the list. Thread auto-follow applies only when already at its bottom or opening a different conversation. Polling does not reset selection, filters, or drafts. Scroll regression tests cover inserted rows, horizontal scrolling, caret/focus and intentional thread changes.

WhatsApp message support now unwraps nested ephemeral, view-once, document-caption and edited-message payloads. Text/emoji, images, video/GIF, audio/voice notes, stickers, documents, locations, vCards, reactions, polls and common interactive messages have dedicated parsing. Available image/video/audio/sticker/document bytes are downloaded through Baileys and stored in relay_whatsapp_media with cascading message deletion; the inbox and full history show previews, players and downloads. Media capture uses three concurrent workers, a 45-second request timeout and a 64 MB per-file limit. Expired/unavailable files are labeled explicitly. Unrecognized future event types display their type rather than an Unsupported Message placeholder. Older placeholders have no original payload to recover unless WhatsApp supplies that message again. Files are served only from the local media endpoint, with byte ranges, nosniff, and forced downloads for documents/unknown MIME types.
