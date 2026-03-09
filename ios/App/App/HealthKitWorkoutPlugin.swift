import Capacitor
import Foundation
import HealthKit

@objc(HealthKitWorkoutPlugin)
public class HealthKitWorkoutPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier   = "HealthKitWorkoutPlugin"
    public let jsName       = "HealthKitWorkout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start",              returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause",              returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume",             returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop",               returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus",          returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceStatus",    returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    // Stored as Any? to avoid @available stored-property restrictions
    private var sessionAny: Any? = nil  // HKWorkoutSession (iOS 26+)

    // Live queries
    private var hrQuery:   HKAnchoredObjectQuery? = nil
    private var stepQuery: HKAnchoredObjectQuery? = nil

    private var sessionStartDate: Date? = nil

    // In-memory ring buffer (max 3 600 ≈ 1 hour at 1 Hz)
    private let maxSamples = 3_600
    private var samples: [[String: Any]] = []

    // Cadence window – stores cumulative step count per observation
    private var stepWindow: [(endDate: Date, steps: Double)] = []

    // Stale-data detection
    private var lastHRTimestamp: Date? = nil
    private var staleTimer: DispatchSourceTimer? = nil
    private let staleThresholdSeconds: TimeInterval = 10

    // MARK: – requestPermissions (override from CAPPlugin)

    public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is niet beschikbaar op dit apparaat")
            return
        }

        let readTypes: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.workoutType(),
        ]
        let writeTypes: Set<HKSampleType> = [HKObjectType.workoutType()]

        store.requestAuthorization(toShare: writeTypes, read: readTypes) { granted, error in
            if let error = error {
                call.reject("HealthKit toestemmingsfout: \(error.localizedDescription)")
                return
            }
            call.resolve(["granted": granted])
        }
    }

    // MARK: – start

    @objc func start(_ call: CAPPluginCall) {
        samples    = []
        stepWindow = []
        let startDate = Date()
        sessionStartDate = startDate

        startHRQuery(from: startDate)
        startStepQuery(from: startDate)
        startStaleTimer()

        if #available(iOS 26.0, *) {
            startWorkoutSession(from: startDate)
        }

        call.resolve(["started": true])
    }

    // MARK: – pause / resume / stop

    @objc func pause(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) {
            (sessionAny as? HKWorkoutSession)?.pause()
        }
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) {
            (sessionAny as? HKWorkoutSession)?.resume()
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopQueries()
        stopStaleTimer()

        if #available(iOS 26.0, *) {
            (sessionAny as? HKWorkoutSession)?.end()
        }
        sessionAny       = nil
        sessionStartDate = nil
        print("[HealthKitWorkout] Workout gestopt")
        call.resolve(["stopped": true])
    }

    // MARK: – getStatus

    @objc func getStatus(_ call: CAPPluginCall) {
        guard let start = sessionStartDate else {
            call.resolve(["status": "idle", "elapsedSeconds": 0])
            return
        }
        var state = "running"
        if #available(iOS 26.0, *) {
            switch (sessionAny as? HKWorkoutSession)?.state {
            case .paused:           state = "paused"
            case .stopped, .ended:  state = "idle"
            default:                break
            }
        }
        call.resolve(["status": state, "elapsedSeconds": Date().timeIntervalSince(start)])
    }

    // MARK: – getDeviceStatus

    @objc func getDeviceStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "watchPaired": false, "watchReachable": false])
            return
        }

        // Check if we have HR authorization (proxy for Watch connectivity)
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.resolve(["available": true, "watchPaired": false, "watchReachable": false])
            return
        }

        let authStatus = store.authorizationStatus(for: hrType)
        let authorized = authStatus == .sharingAuthorized

        // Check recency: if last HR sample arrived within 60s, watch is reachable
        let reachable: Bool
        if let last = lastHRTimestamp {
            reachable = Date().timeIntervalSince(last) < 60
        } else {
            reachable = false
        }

        call.resolve([
            "available":       true,
            "watchPaired":     authorized,
            "watchReachable":  reachable,
            "lastHRSeconds":   lastHRTimestamp.map { Date().timeIntervalSince($0) } as Any,
        ])
    }

    // MARK: – HR streaming via HKAnchoredObjectQuery

    private func startHRQuery(from startDate: Date) {
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return }

        let predicate = HKQuery.predicateForSamples(
            withStart: startDate, end: nil, options: .strictStartDate
        )

        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = {
            [weak self] _, newSamples, _, _, error in
            if let error = error {
                print("[HealthKitWorkout] HR query fout: \(error.localizedDescription)")
                return
            }
            self?.processHRSamples(newSamples)
        }

        let query = HKAnchoredObjectQuery(
            type: hrType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit,
            resultsHandler: handler
        )
        query.updateHandler = handler

        hrQuery = query
        store.execute(query)
        print("[HealthKitWorkout] HR live query gestart")
    }

    private func processHRSamples(_ rawSamples: [HKSample]?) {
        guard let hkSamples = rawSamples as? [HKQuantitySample], !hkSamples.isEmpty else { return }
        for sample in hkSamples {
            let bpm = sample.quantity.doubleValue(for: HKUnit(from: "count/min"))
            lastHRTimestamp = sample.endDate
            let spm = currentSPM(at: sample.endDate)
            emitBiometrics(timestamp: sample.endDate.timeIntervalSince1970, bpm: bpm, spm: spm)
        }
    }

    // MARK: – Step cadence via HKAnchoredObjectQuery

    private func startStepQuery(from startDate: Date) {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }

        let predicate = HKQuery.predicateForSamples(
            withStart: startDate, end: nil, options: .strictStartDate
        )

        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = {
            [weak self] _, newSamples, _, _, error in
            if let error = error {
                print("[HealthKitWorkout] Step query fout: \(error.localizedDescription)")
                return
            }
            self?.processStepSamples(newSamples)
        }

        let query = HKAnchoredObjectQuery(
            type: stepType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit,
            resultsHandler: handler
        )
        query.updateHandler = handler

        stepQuery = query
        store.execute(query)
        print("[HealthKitWorkout] Step live query gestart")
    }

    private func processStepSamples(_ rawSamples: [HKSample]?) {
        guard let hkSamples = rawSamples as? [HKQuantitySample], !hkSamples.isEmpty else { return }
        for sample in hkSamples {
            let steps = sample.quantity.doubleValue(for: HKUnit.count())
            stepWindow.append((endDate: sample.endDate, steps: steps))
        }
        // Prune old entries (keep last 20s)
        let cutoff = Date().addingTimeInterval(-20)
        stepWindow.removeAll { $0.endDate < cutoff }
    }

    private func currentSPM(at date: Date) -> Double? {
        let cutoff = date.addingTimeInterval(-12)
        let window = stepWindow.filter { $0.endDate >= cutoff && $0.endDate <= date }
        guard window.count >= 2 else { return nil }
        let totalSteps = window.reduce(0) { $0 + $1.steps }
        guard let first = window.first else { return nil }
        let dt = date.timeIntervalSince(first.endDate)
        guard dt > 0 else { return nil }
        // Convert steps to strides: Apple Watch stepCount = individual steps (not strides)
        // SPM (strides/min) = steps per minute / 2, but coaches use steps/min directly
        return (totalSteps / dt) * 60.0
    }

    // MARK: – Stale biometrics detection

    private func startStaleTimer() {
        stopStaleTimer()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + staleThresholdSeconds, repeating: staleThresholdSeconds)
        timer.setEventHandler { [weak self] in self?.checkStaleness() }
        timer.resume()
        staleTimer = timer
    }

    private func stopStaleTimer() {
        staleTimer?.cancel()
        staleTimer = nil
    }

    private func checkStaleness() {
        guard sessionStartDate != nil else { return }
        let stale: Bool
        if let last = lastHRTimestamp {
            stale = Date().timeIntervalSince(last) > staleThresholdSeconds
        } else {
            stale = true
        }
        if stale {
            let lastSeconds = lastHRTimestamp.map { Date().timeIntervalSince($0) } ?? -1
            notifyListeners("biometricsStale", data: [
                "secondsSinceLastSample": lastSeconds,
            ])
            print("[HealthKitWorkout] Biometrics stale: \(lastSeconds)s geleden")
        }
    }

    // MARK: – Cleanup

    private func stopQueries() {
        if let q = hrQuery   { store.stop(q); hrQuery   = nil }
        if let q = stepQuery { store.stop(q); stepQuery = nil }
    }

    // MARK: – Emit helpers

    private func emitBiometrics(timestamp: Double, bpm: Double?, spm: Double?) {
        let payload: [String: Any] = [
            "timestamp": timestamp,
            "bpm":       bpm as Any? ?? NSNull(),
            "spm":       spm as Any? ?? NSNull(),
            "source":    "healthkit",
        ]

        samples.append(payload)
        if samples.count > maxSamples { samples.removeFirst() }

        let bStr = bpm.map { String(format: "%.0f bpm", $0) } ?? "-"
        let sStr = spm.map { String(format: "%.0f spm", $0) } ?? "-"
        print("[HealthKitWorkout] HR: \(bStr)  cadans: \(sStr)")

        notifyListeners("biometrics", data: payload)
    }

    // MARK: – Official workout session (iPhone: iOS 26+)

    @available(iOS 26.0, *)
    private func startWorkoutSession(from startDate: Date) {
        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: config)
            session.delegate = self
            sessionAny = session
            session.startActivity(with: startDate)
            print("[HealthKitWorkout] Workout sessie gestart (iOS 26+)")
        } catch {
            print("[HealthKitWorkout] Sessie aanmaken mislukt: \(error.localizedDescription)")
        }
    }
}

// MARK: – HKWorkoutSessionDelegate (iPhone: iOS 26+)

@available(iOS 26.0, *)
extension HealthKitWorkoutPlugin: HKWorkoutSessionDelegate {
    public func workoutSession(
        _ session: HKWorkoutSession,
        didChangeTo to: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        print("[HealthKitWorkout] State: \(fromState.rawValue) → \(to.rawValue)")
    }

    public func workoutSession(_ session: HKWorkoutSession, didFailWithError error: Error) {
        print("[HealthKitWorkout] Sessie fout: \(error.localizedDescription)")
    }
}
