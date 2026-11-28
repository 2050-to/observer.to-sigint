# Privacy Policy

Last updated: 27 November 2026
Version: 2026-11-27.3

This policy explains what Observer.to stores, who can see it, and how to delete it. It covers the Mac app, the Android app, the website, and the account API. Read it with the Terms of Service. You must accept the current version of both before an app opens your data or the website shows stored data.

Observer.to does not sell personal information. It does not let one account search or ask questions about another account.

## 1. Who this policy is for

The service is for adults. You must be 18 or older. If a date of birth shows an age under 18, the new account is deleted, tokens are deleted, and the catalog is not kept. Observer.to does not knowingly keep information from anyone under 18.

The public marketing pages and the Terms and Privacy Policy can be read without an account. They do not show stored observations.

## 2. Information you provide

- Email address, used to send the magic link and, on the paid plan, the weekly review and an immediate email when a site finding is critical.
- Date of birth, used only to confirm that you are 18 or older and to decide when you must accept the current terms again. It is not shown to other accounts.
- The versions of the Terms and Privacy Policy you accepted, and the time you accepted them.
- Billing identifiers from Stripe if you start a subscription. Observer.to does not store a full card number.
- A session row for each sign-in: a client label such as Web, Mac, or Android, and the time it was created and last used. You can revoke a session. Sign-out everywhere rejects tokens issued before that moment.

## 3. Information collected from the device you use

After you accept, a drive can record:

- Public Wi-Fi beacon fields the device hears, such as SSID, BSSID, channel, security, signal strength, and, when the radio reports them, station count, channel utilization, and admission capacity.
- Public Bluetooth advertisement fields, such as the identifier the operating system provides, a name if one is advertised, and signal strength. macOS does not reveal a Bluetooth hardware address. Observer.to does not connect to Bluetooth devices.
- This device's GPS, altitude, and speed while a drive runs, so the observation can be placed.
- A stable id for the Mac or phone that uploaded the scan, a label such as the computer name or phone model, and the drive the scan belonged to.
- Cell tower identifiers the phone reports during normal operation, such as mobile country and network codes, area, and cell id. Observer.to does not collect IMSI, TMSI, or call content.

If you turn on the owned-network check, Observer.to stores the current device description you allowed (operating system, browser string, memory, processor, and hostname) and the address inventory of a network you own (address, role, announced name, and related service names). Each named site keeps its own inventory history for the retention window. A check on one site does not replace another site's inventory. Those rows are saved to your account. They are not a record of other people's traffic. The website cannot see a local network. Only the Mac or Android app on that network can take the inventory.

If you allow it, the Mac app keeps a catalog on that Mac of this Mac's secure-connection metadata: the process, protocol, destination or listen address, and the first and last time it was seen. The catalog is not uploaded. It stays on that Mac until you clear it or delete all data.

The This Mac checklist reads the firewall, Gatekeeper, screen lock, sharing, update, login, AirDrop, FileVault, and System Integrity Protection settings on that Mac. The reading and the report stay on the device. They are not uploaded and are not stored on the account. The administrator password is entered in the macOS dialog. Observer.to does not receive it, store it, or send it to the server. The This Mac scan of startup items and weakened settings also stays on the device and is not uploaded.

A named site stores the name you give it, the radius or walk boundary, the SSIDs and BSSIDs you claim, the security baseline, how often you mean to walk it again, and each walk inside the retention window. It also stores each radio heard inside that boundary: BSSID, SSID, channel, security, and the first and last time your account heard it there.

A disposition stores a status and an optional note on an access point, a Bluetooth advertiser, a tower, a site event, or an owned-network host. It can also store a model, a firmware version, an assignee name, and a due date that you type.

Each built review is stored on your account so the Changes tab can reopen it. The email of the latest review is sent only for an active plan. An active plan also sends an immediate email for a critical site finding: a claimed network heard as open or WEP, your claimed name on a BSSID you did not claim, or a claimed BSSID on a different channel. The Android app and the Mac app show a notification on the device that uploaded the scan when that scan opens an evil twin. The device creates that notification from the upload response. Observer.to does not use a push service for it.

A paid question is stored with the answer and the excerpt lines that were sent to the assistant.

Names you give to radios are stored on the account so they follow you to the website, the Mac, and Android.

## 4. Place fields

When a drive has coordinates, the server may ask Nominatim, a public OpenStreetMap service, for a place description, and Open-Meteo for ground elevation. Your account stores the country, region, locality, and postal code Nominatim returns, so you can filter your own map. A United States result is still stored as a state and ZIP. Older rows that have only a city, state, and ZIP stay searchable as United States places.

Place text is about the location of a public beacon your account heard. It is not a profile of a person. The country code advertised by a Wi-Fi radio is not this place.

## 5. What is stored, and how

The database is Postgres. Each row is tied to your account. The database disks and their backups are encrypted at rest. Observer.to also encrypts account fields with a server key before writing them.

The email address is stored as a keyed hash, so sign-in can find the account, and as ciphertext. Date of birth is ciphertext. Scan catalogs, archived scans, device details, local network inventories, Wi-Fi place fields, Bluetooth place fields, named sites, site walks, dispositions, labels, stored questions, and stored reviews are ciphertext. A keyed hash records that a critical site finding was emailed, so the same finding is not emailed twice. That hash is not the hardware address. The server decrypts a field only to answer the signed-in account, including a map filter or a paid question. Time stays indexed so your own rows can be ordered. Hardware-address lookups use a keyed hash, not the address in the clear.

A short-lived Redis copy uses the same server key. The Mac and Android apps also keep a local catalog so a drive can continue while the server is unreachable. Protect those devices.

Hardware addresses are not used to follow a person. The catalog row for a Bluetooth advertisement keeps the first time, the last time, and the last place your account heard it. Inside the retention window, each hearing is also kept with the time and this device's position so a drive can be replayed. That is this device's path and the public advertisements heard there. It is not a trail of another person, and Observer.to does not turn a rotating address into one person.

## 6. Who can see your information

You can, when you are signed in and you have accepted the current documents.

People who operate the service can access the database to run and protect it. They do not use one account's records to answer another account.

These processors receive only what they need:

- Resend, or the server log when email is not configured, receives your email address and the message text for sign-in, weekly reviews, and immediate critical site alerts.
- Stripe receives the billing details required to charge the monthly plan and to open the customer portal.
- DeepSeek receives a question you submit and a bounded excerpt of your own rows for that question, when the assistant is enabled. It does not receive another account's rows, your password (there is none), or a database login. Observer.to does not send the assistant your email address.
- Nominatim and Open-Meteo receive coordinates from a place your account is already recording, so the server can attach an address, elevation, country, region, locality, or postal code.

Observer.to does not let customers query across accounts. Place search, exports, the map, and assistant questions all require your session and your user id.

## 7. The assistant

The assistant is part of the paid plan. A question is about your own Wi-Fi places, Bluetooth places, towers, enrichment, and owned-network inventory. The server loads a limited excerpt of those rows and asks DeepSeek to answer from that excerpt. If the excerpt does not contain the answer, the reply should say so. The assistant is not a source of records about other people, and it is not a substitute for your own judgment.

If the DeepSeek key is not configured, questions are unavailable. That does not open the rest of the account to anyone else.

## 8. How long information is kept

Raw scans, site walks, and owned-network inventory snapshots stay for 90 days unless you set that window to 7 or 30 days. Stored reviews stay for 365 days. You can delete one drive, one Wi-Fi radio, or one Bluetooth advertiser sooner. Everything else stays until you delete it, you delete the account's data, or the account is removed. Acceptance of these documents is kept so the service can require a new acceptance when the text changes.

Weekly review mail is sent only for an active plan, and not more than about once a week. Immediate critical mail is sent only for an active plan. The same finding is not emailed again. An account receives at most 20 of those messages a day.

Server logs may keep operational errors for as long as the host keeps process logs. Those logs are not a second catalog.

## 9. Deletion and access

Delete all data in the app removes your scans and the records described in the Terms from the device and, when the server is reachable, from the server. You can also delete one drive, one Wi-Fi radio, or one Bluetooth advertiser, and you can revoke a session. You can export a CSV and a markdown report of your beacon catalog, a markdown report of one site, and a markdown or CSV file of one stored review, while you are signed in. The review file includes the time it was built and your email. It is a download, not a link someone else can open.

You may ask for a copy of the email and acceptance record associated with your account by using the contact below.

An under-18 attempt is deleted rather than stored.

## 10. Security

The website and the API are served over HTTPS. Session tokens are signed. Magic links are stored as keyed hashes and expire. Account data is encrypted at rest on the database disks and again with the server key described above. Access checks reject a request that has not accepted the current Terms and Privacy Policy, and every read of stored rows is limited to the signed-in account.

No method of storage is perfect. You should protect the devices where the local catalog and the session are saved.

## 11. Cookies and local storage

The website and apps store the session token in local storage on the device. That token is what proves the session. The server also stores a session row so you can revoke that device. Observer.to does not use a third-party advertising cookie. A dismissed upgrade note may be stored on the device so the banner stays closed. Custom names may remain in local storage until the account copy replaces them.

## 12. Changes

When this policy or the Terms change, the version changes with them. The apps and data views close until you read and accept the new text. The public legal pages show the current text before you accept.

## 13. Contact

Privacy questions can be sent to the address used for sign-in email when that mailbox is monitored, or to the contact published on the Observer.to website.
