function ap(fields: {
  ssid: string
  bssid: string
  rssi: number
  capabilities: string
  channel: number
  frequencyMhz: number
  band: string
  wifiStandard?: string
}) {
  return {
    securityTypes: [],
    channelWidthMhz: 20,
    centerFreq0: 0,
    centerFreq1: 0,
    wifiStandard: fields.wifiStandard ?? 'legacy',
    passpoint: false,
    responder80211mc: false,
    responder80211az: false,
    twtResponder: false,
    secureHeLtf: false,
    rangingFrameProtection: false,
    apMldMac: null,
    apMloLinkId: null,
    affiliatedLinks: [],
    operatorName: null,
    venueName: null,
    countryCode: 'US',
    maxRateMbps: 54,
    stationCount: 3,
    channelUtilization: 20,
    admissionCapacity: 100,
    vendorOuis: ['001A2B'],
    ...fields,
  }
}

export function sampleScans(speedMps: number) {
  const cafe = ap({
    ssid: 'Cafe WiFi',
    bssid: 'aa:bb:cc:dd:ee:01',
    rssi: -42,
    capabilities: '[ESS]',
    channel: 6,
    frequencyMhz: 2437,
    band: '2.4',
  })
  const cafeWeaker = { ...cafe, rssi: -80 }
  const cafeOther = ap({
    ssid: 'Cafe WiFi',
    bssid: 'aa:bb:cc:dd:ee:02',
    rssi: -55,
    capabilities: '[ESS]',
    channel: 11,
    frequencyMhz: 2462,
    band: '2.4',
  })
  const home = ap({
    ssid: 'Home',
    bssid: 'aa:bb:cc:dd:ee:03',
    rssi: -60,
    capabilities: '[WPA2-PSK-CCMP][ESS]',
    channel: 36,
    frequencyMhz: 5180,
    band: '5',
    wifiStandard: 'ax',
  })
  const enhanced = ap({
    ssid: 'Library Open',
    bssid: 'aa:bb:cc:dd:ee:05',
    rssi: -48,
    capabilities: '[OWE][ESS]',
    channel: 44,
    frequencyMhz: 5220,
    band: '5',
    wifiStandard: 'ax',
  })
  const hidden = ap({
    ssid: '',
    bssid: 'aa:bb:cc:dd:ee:04',
    rssi: -70,
    capabilities: '[ESS]',
    channel: 1,
    frequencyMhz: 2412,
    band: '2.4',
  })
  const observedAt = new Date().toISOString()
  return [
    {
      scanId: crypto.randomUUID(),
      observedAt,
      lat: 47.6205,
      lon: -122.3493,
      accuracy: 8,
      altitudeM: 30,
      verticalAccuracyM: 3,
      relativeM: 0,
      speedMps,
      networks: [cafe, cafeWeaker, cafeOther, home, hidden],
    },
    {
      scanId: crypto.randomUUID(),
      observedAt: new Date(Date.now() + 1000).toISOString(),
      lat: 47.6216,
      lon: -122.3493,
      accuracy: 8,
      altitudeM: 42,
      verticalAccuracyM: 3,
      relativeM: 12,
      speedMps,
      networks: [{ ...cafe, rssi: -68 }, enhanced],
    },
  ]
}
