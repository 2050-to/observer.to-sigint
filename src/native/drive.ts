import { Capacitor, WebPlugin, registerPlugin } from '@capacitor/core'

export interface DriveStatus {
  running: boolean
  message: string
}

interface WardrivePlugin {
  startDrive(options: { apiUrl: string; token: string }): Promise<void>
  stopDrive(): Promise<void>
  getStatus(): Promise<DriveStatus>
}

class WardriveWeb extends WebPlugin implements WardrivePlugin {
  private running = false

  async startDrive(): Promise<void> {
    this.running = true
  }

  async stopDrive(): Promise<void> {
    this.running = false
  }

  async getStatus(): Promise<DriveStatus> {
    return {
      running: this.running,
      message: this.running
        ? 'This browser cannot scan Wi-Fi. Use Load sample drive, or run the Android app.'
        : 'Drive is stopped.',
    }
  }
}

export const Wardrive = registerPlugin<WardrivePlugin>('Wardrive', {
  web: () => new WardriveWeb(),
})

export function onDevice(): boolean {
  return Capacitor.isNativePlatform()
}
