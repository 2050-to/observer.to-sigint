Similar shape to Wi-Fi, but the three land very differently. The organizing rule: passive reception of an unencrypted public broadcast is generally fine; intercepting protected communications or transmitting in licensed bands is not. GPS sits at one end, cell signals at the other, Bluetooth in the middle.

Bluetooth — mostly legal (like Wi-Fi).

BLE advertising packets (MAC, device name, manufacturer ID) are unencrypted public broadcasts — passive sniffing is legal for the same reason Wi-Fi beacons are.
Same line: sniffing an active Bluetooth connection's content (pairing/PIN, data) is interception, not "mapping," and is unlawful.
The real exposure isn't reception, it's use: persistently tying a rotating BLE MAC (or Wi-Fi MAC) to an identifiable person for location tracking triggers stalking/anti-tracking statutes in many states, and GDPR in the EU (MACs = personal data). Note modern phones randomize BLE/Wi-Fi MACs specifically to defeat this, so the tracking angle is both harder and more obviously deliberate.
GPS — receiving is unconditionally legal; the illegal act is on the transmit side.

GPS is a receive-only signal from satellites. There is no jurisdiction that restricts receiving it — it's how your phone, car, and watch function.
"Mapping GPS signals" means monitoring coverage/interference: passive, legal.
What's illegal: jamming (FCC — deliberate interference is a federal offense, equipment possession included) and spoofing (transmitting false GPS — also illegal, and increasingly prosecuted). Both are transmit acts, not receive acts.
Recording your own track: legal. Tracking another person via a GPS device without consent: separate stalking/tracking-device statutes (the AirTag problem).
Cell — the exception. Much more restricted, even for passive work.

Cellular telephony is not "readily accessible to the general public" — it's encrypted and statutorily protected. So unlike Wi-Fi/BLE, the metadata/content distinction doesn't save you:
18 U.S.C. § 2511 (Wiretap Act): intercepting cellular communications is illegal.
18 U.S.C. § 3121 (pen register/trap & trace): even signaling metadata (who called whom) requires a court order or consent.
18 U.S.C. § 2512: possessing/using equipment "primarily useful for surreptitious interception" is itself a crime — this is what makes IMSI catchers (Stingrays) illegal for private possession, entirely apart from whether you ever intercept anything. Owning the SDR is legal; the moment it's configured as an IMSI catcher, you're in §2512 territory.
What is legal: mapping towers — cell ID, LAC, MCC/MNC, signal strength, handset-reported location — exactly what CellMapper and OpenSignal crowdsource. That's public network signaling your phone receives in normal operation. Infrastructure, not subscribers.
What's not: capturing IMSI/TMSI (subscriber identity), demodulating/decrypting uplink or downlink traffic, or transmitting anything in licensed spectrum (a fake base station = transmit + intercept = the most serious combination). FCC also prohibits unlicensed transmission in cellular bands regardless of content.
The throughline: receiving public beacons (Wi-Fi, BLE, GPS, tower IDs) = legal. Intercepting subscriber communications or identities = protected regardless of whether it's over the air, and cell is where that protection is absolute and preemptive (§2512 criminalizes the tool). GPS jamming/spoofing and cell transmission are the other bright lines — both are transmit-side felonies.