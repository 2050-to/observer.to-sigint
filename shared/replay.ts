import { classifySecurity } from './security.js'
import type { ScanAp, ScanDevice, SecurityLabel } from './types.js'

export const REPLAY_LIMIT = 500

export interface CompactWifi {
  bssid: string
  ssid: string
  rssi: number
  channel: number
  security: SecurityLabel
  stationCount: number | null
  channelUtilization: number | null
  admissionCapacity: number | null
}

export interface CompactBle {
  address: string
  name: string | null
  rssi: number
}

export interface CompactScan {
  scanId: string
  driveId: string | null
  scannerId: string | null
  scannerLabel: string | null
  observedAt: string
  lat: number | null
  lon: number | null
  wifi: CompactWifi[]
  bluetooth: CompactBle[]
}

export function compactScan(input: {
  scanId: string
  driveId?: string | null
  scannerId?: string | null
  scannerLabel?: string | null
  observedAt: string
  lat?: number | null
  lon?: number | null
  networks?: ScanAp[]
  devices?: ScanDevice[]
}): CompactScan {
  return {
    scanId: input.scanId,
    driveId: input.driveId ?? null,
    scannerId: input.scannerId ?? null,
    scannerLabel: input.scannerLabel?.trim().slice(0, 80) || null,
    observedAt: input.observedAt,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    wifi: (input.networks ?? []).slice(0, 200).map((network) => ({
      bssid: network.bssid.trim().toLowerCase(),
      ssid: network.ssid,
      rssi: network.rssi,
      channel: network.channel,
      security: classifySecurity(network.capabilities ?? '', network.securityTypes ?? []),
      stationCount: finite(network.stationCount),
      channelUtilization: finite(network.channelUtilization),
      admissionCapacity: finite(network.admissionCapacity),
    })),
    bluetooth: (input.devices ?? []).slice(0, 200).flatMap((device) => {
      if (!device.address?.trim() || !Number.isFinite(device.rssi)) return []
      return [{
        address: device.address.trim().toLowerCase(),
        name: device.name?.trim().slice(0, 120) || null,
        rssi: device.rssi,
      }]
    }),
  }
}

export function withoutTombstones(
  scan: CompactScan,
  hidden: (kind: 'ap' | 'adv', id: string) => boolean,
): CompactScan {
  return {
    ...scan,
    wifi: scan.wifi.filter((network) => !hidden('ap', network.bssid)),
    bluetooth: scan.bluetooth.filter((device) => !hidden('adv', device.address)),
  }
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
