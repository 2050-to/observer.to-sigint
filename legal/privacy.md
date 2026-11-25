# Privacy Policy

Last updated: 24 November 2026
Version: 2026-11-24.2

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

## 3. Information collected from the device you use

After you accept, a drive can record:

- Public Wi-Fi beacon fields the device hears, such as SSID, BSSID, channel, security, and signal strength.
- Public Bluetooth advertisement fields, such as the identifier the operating system provides, a name if one is advertised, and signal strength. macOS does not reveal a Bluetooth hardware address. Observer.to does not connect to Bluetooth devices.
- This device's GPS, altitude, and speed while a drive runs, so the observation can be placed.
- Cell tower identifiers the phone reports during normal operation, such as mobile country and network codes, area, and cell id. Observer.to does not collect IMSI, TMSI, or call content.

If you turn on the owned-network check, Observer.to stores the current device description you allowed (operating system, browser string, memory, processor, and hostname) and the address inventory of a network you own (address, role, announced name, and related service names). It also keeps the previous inventory and the change list from announced names and the classifications already computed. Those rows are saved to your account. They are not a record of other people's traffic.

A named site stores the name you give it, the radius or walk boundary, the SSIDs and BSSIDs you claim, the security baseline, and the beacons heard on the latest walk. It also stores each radio heard inside that boundary: BSSID, SSID, channel, security, and the first and last time your account heard it there.

A disposition stores a status and an optional note on an access point or Bluetooth advertiser in your account.

A weekly review is stored on your account so the Changes tab can show it. The email of that review is sent only for an active plan. An active plan also sends an immediate email for a critical site finding: a claimed network heard as open or WEP, your claimed name on a BSSID you did not claim, or a claimed BSSID on a different channel. The Android app shows a notification on that phone when a scan it uploads opens an evil twin. The phone creates that notification from the upload response. Observer.to does not use a push service for it.

## 4. Place fields

When a drive has coordinates, the server may ask Nominatim, a public OpenStreetMap service, for a place description, and Open-Meteo for ground elevation. From a United States result, your account stores city, state, and ZIP on the networks and advertisements that drive heard, so you can filter your own map. Sightings outside the United States stay in your private catalog and are not added to that place index.

Place text is about the location of a public beacon your account heard. It is not a profile of a person.

## 5. What is stored, and how

The database is Postgres. Each row is tied to your account. The database disks and their backups are encrypted at rest. Observer.to also encrypts account fields with a server key before writing them.

The email address is stored as a keyed hash, so sign-in can find the account, and as ciphertext. Date of birth is ciphertext. Scan catalogs, device details, local network hosts, the previous owned-network inventory, Wi-Fi place fields, Bluetooth place fields, named sites, dispositions, and the stored weekly review are ciphertext. A keyed hash records that a critical site finding was emailed, so the same finding is not emailed twice. That hash is not the hardware address. The server decrypts a field only to answer the signed-in account, including a map filter or a paid question. Time stays indexed so your own rows can be ordered. Hardware-address lookups use a keyed hash, not the address in the clear.

A short-lived Redis copy uses the same server key. The Mac and Android apps also keep a local catalog so a drive can continue while the server is unreachable. Protect those devices.

Hardware addresses are not used to follow a person. Bluetooth rows keep the first time, the last time, and the last United States place your account heard that advertisement. They do not keep a movement trail.

## 6. Who can see your information

You can, when you are signed in and you have accepted the current documents.

People who operate the service can access the database to run and protect it. They do not use one account's records to answer another account.

These processors receive only what they need:

- Resend, or the server log when email is not configured, receives your email address and the message text for sign-in, weekly reviews, and immediate critical site alerts.
- Stripe receives the billing details required to charge the monthly plan and to open the customer portal.
- DeepSeek receives a question you submit and a bounded excerpt of your own rows for that question, when the assistant is enabled. It does not receive another account's rows, your password (there is none), or a database login. Observer.to does not send the assistant your email address.
- Nominatim and Open-Meteo receive coordinates from a place your account is already recording, so the server can attach an address, elevation, or United States city, state, and ZIP.

Observer.to does not let customers query across accounts. Place search, exports, the map, and assistant questions all require your session and your user id.

## 7. The assistant

The assistant is part of the paid plan. A question is about your own Wi-Fi places, Bluetooth places, towers, enrichment, and owned-network inventory. The server loads a limited excerpt of those rows and asks DeepSeek to answer from that excerpt. If the excerpt does not contain the answer, the reply should say so. The assistant is not a source of records about other people, and it is not a substitute for your own judgment.

If the DeepSeek key is not configured, questions are unavailable. That does not open the rest of the account to anyone else.

## 8. How long information is kept

Records stay until you delete them, you delete the account's data, or the account is removed. Acceptance of these documents is kept so the service can require a new acceptance when the text changes.

Weekly review mail is sent only for an active plan, and not more than about once a week. Immediate critical mail is sent only for an active plan. The same finding is not emailed again. An account receives at most 20 of those messages a day.

Server logs may keep operational errors for as long as the host keeps process logs. Those logs are not a second catalog.

## 9. Deletion and access

Delete all data in the app removes your scans and the records described in the Terms from the device and, when the server is reachable, from the server. You can export a CSV and a markdown report of your beacon catalog, and a markdown report of one site, while you are signed in.

You may ask for a copy of the email and acceptance record associated with your account by using the contact below.

An under-18 attempt is deleted rather than stored.

## 10. Security

The website and the API are served over HTTPS. Session tokens are signed. Magic links are stored as keyed hashes and expire. Account data is encrypted at rest on the database disks and again with the server key described above. Access checks reject a request that has not accepted the current Terms and Privacy Policy, and every read of stored rows is limited to the signed-in account.

No method of storage is perfect. You should protect the devices where the local catalog and the session are saved.

## 11. Cookies and local storage

The website and apps store the session token in local storage on the device. That token is what proves the session. Observer.to does not use a third-party advertising cookie. A dismissed upgrade note may be stored on the device so the banner stays closed.

## 12. Changes

When this policy or the Terms change, the version changes with them. The apps and data views close until you read and accept the new text. The public legal pages show the current text before you accept.

## 13. Contact

Privacy questions can be sent to the address used for sign-in email when that mailbox is monitored, or to the contact published on the Observer.to website.
