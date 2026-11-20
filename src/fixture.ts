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
  const base = Date.now()
  const at = (seconds: number) => new Date(base + seconds * 1000).toISOString()
  const rssiFor = (distance: number) => -59 - 22 * Math.log10(distance)
  const place = (
    seconds: number,
    lat: number,
    lon: number,
    speed: number,
    networks: ReturnType<typeof ap>[],
    devices: object[] = [],
    cells: object[] = [],
    extra: { wifiOn?: boolean; bluetoothOn?: boolean; cellOn?: boolean; altitudeM?: number; relativeM?: number } = {},
  ) => ({
    scanId: crypto.randomUUID(),
    observedAt: at(seconds),
    lat,
    lon,
    accuracy: 8,
    altitudeM: extra.altitudeM ?? 30,
    verticalAccuracyM: 3,
    relativeM: extra.relativeM ?? 0,
    speedMps: speed,
    wifiOn: extra.wifiOn ?? false,
    bluetoothOn: extra.bluetoothOn ?? false,
    cellOn: extra.cellOn ?? false,
    networks,
    devices,
    cells,
  })
  const beacon = (address: string, rssi: number, name: string | null, addressType: 'public' | 'random' = 'public') => ({
    address,
    addressType,
    name,
    rssi,
    txPower: -59,
    serviceUuids: [],
  })
  const hotspot = (distance: number) => ap({
    ssid: 'Phone Hotspot',
    bssid: 'de:ad:be:ef:00:01',
    rssi: rssiFor(distance),
    capabilities: '[ESS]',
    channel: 6,
    frequencyMhz: 2437,
    band: '2.4',
  })
  const mover = (distance: number, index = 0, broadcast = false) => ({
    ...beacon('aa:bb:cc:00:00:10', rssiFor(distance), 'Phone Hotspot', 'random'),
    ...(broadcast ? { broadcastLat: 47.62 + (index * 15) / 110540, broadcastLon: -122.35 } : {}),
  })
  const serving = (timing: number) => ({
    radio: 'lte',
    registered: true,
    mcc: '310',
    mnc: '260',
    area: '1234',
    cellId: '99',
    pci: 12,
    rssi: -80,
    timingAdvanceM: timing,
  })
  const neighbor = {
    radio: 'lte',
    registered: false,
    mcc: '310',
    mnc: '260',
    area: '1234',
    cellId: '100',
    pci: 40,
    rssi: -110,
    timingAdvanceM: null,
  }
  const north = 47.62 + 200 / 110540
  return [
    place(0, 47.6205, -122.3493, speedMps, [cafe, cafeWeaker, cafeOther, home, hidden]),
    place(1, 47.6216, -122.3493, speedMps, [{ ...cafe, rssi: -68 }, enhanced], [], [], { altitudeM: 42, relativeM: 12 }),
    place(10, 47.62, -122.35, 0, [cafe], [beacon('b0:00:00:00:00:01', -50, 'Cafe beacon')]),
    place(15, 47.62, -122.35, 0, [cafe], [beacon('b0:00:00:00:00:01', -50, 'Cafe beacon')]),
    place(20, 47.63, -122.35, 0, [], [beacon('b0:00:00:00:00:02', -55, 'Hall speaker')]),
    place(25, 47.63, -122.35, 0, [], [beacon('b0:00:00:00:00:02', -55, 'Hall speaker')]),
    place(100, 47.62, -122.35, 0, [], [beacon('aa:bb:cc:00:00:11', rssiFor(20), null, 'random')]),
    place(101, 47.62, -122.35, 0, [], [beacon('aa:bb:cc:00:00:11', rssiFor(16), null, 'random')]),
    place(102, 47.62, -122.35, 0, [], [beacon('aa:bb:cc:00:00:11', rssiFor(12), null, 'random')]),
    place(200, 47.62, -122.35, 0, [hotspot(20)], [mover(20)]),
    place(201, 47.62, -122.35, 0, [hotspot(18.5)], [mover(18.5)]),
    place(202, 47.62, -122.35, 0, [hotspot(17)], [mover(17)]),
    place(300, 47.62, -122.35, 0, [hotspot(30)], [mover(30, 0, true)]),
    place(301, 47.62, -122.35, 0, [hotspot(15)], [mover(15, 1, true)]),
    place(400, 47.62, -122.35, 0, [], [], [serving(100), neighbor]),
    place(410, north, -122.35, 0, [], [], [serving(100), neighbor]),
    place(500, 47.621, -122.349, Math.max(speedMps, 15), [{ ...cafe, rssi: -60 }], [], [], { wifiOn: true, bluetoothOn: true, cellOn: true }),
  ]
}
