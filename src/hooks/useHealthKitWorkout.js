import { registerPlugin } from '@capacitor/core'

const HealthKitWorkout = registerPlugin('HealthKitWorkout')

export function useHealthKitWorkout() {
  const requestPermissions = () =>
    HealthKitWorkout.requestPermissions().catch(err => {
      console.warn('[HealthKit] Toestemming mislukt:', err)
      return { granted: false }
    })

  const startWorkout = () =>
    HealthKitWorkout.start().catch(err => {
      console.warn('[HealthKit] Start mislukt:', err)
    })

  const pauseWorkout = () =>
    HealthKitWorkout.pause().catch(err => {
      console.warn('[HealthKit] Pause mislukt:', err)
    })

  const resumeWorkout = () =>
    HealthKitWorkout.resume().catch(err => {
      console.warn('[HealthKit] Resume mislukt:', err)
    })

  const stopWorkout = () =>
    HealthKitWorkout.stop().catch(err => {
      console.warn('[HealthKit] Stop mislukt:', err)
    })

  const getStatus = () =>
    HealthKitWorkout.getStatus().catch(err => {
      console.warn('[HealthKit] GetStatus mislukt:', err)
      return { status: 'idle', elapsedSeconds: 0 }
    })

  const getDeviceStatus = () =>
    HealthKitWorkout.getDeviceStatus().catch(err => {
      console.warn('[HealthKit] GetDeviceStatus mislukt:', err)
      return { available: false, watchPaired: false, watchReachable: false }
    })

  // Returns a Promise<PluginListenerHandle> — caller must store and .remove() on cleanup
  const attachBiometrics = (onSample) =>
    HealthKitWorkout.addListener('biometrics', onSample)

  // Returns a Promise<PluginListenerHandle>
  const attachStale = (onStale) =>
    HealthKitWorkout.addListener('biometricsStale', onStale)

  return {
    requestPermissions,
    startWorkout,
    pauseWorkout,
    resumeWorkout,
    stopWorkout,
    getStatus,
    getDeviceStatus,
    attachBiometrics,
    attachStale,
  }
}
