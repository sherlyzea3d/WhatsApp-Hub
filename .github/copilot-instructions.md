# Project Notes

- Frontend assets and the Node backend are combined in the project root. Start with npm.cmd run dev and open http://localhost:3000.
- Show only persisted user records and real data synchronized from WhatsApp. Never seed demo contacts, branches, analytics, phone numbers, or identities.
- Pairing uses live Baileys QR events. Keep credentials and authentication keys on the backend.
- Preserve unified contact history across connected accounts, multiple branch assignments per number, responsible person names, group membership and group filters.
- Phone numbers belong in their proper roles: connected accounts in WhatsApp Numbers, remote contacts in Contacts. Never present a WhatsApp LID as a phone number.
