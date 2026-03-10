import Foundation
import WatchConnectivity
import Capacitor

/// WatchSyncPlugin — WatchConnectivity bridge tussen iPhone JS en Apple Watch.
///
/// iPhone → Watch: sendRunState({ mode, remainingSeconds, hr, spm, isPaused, accentColor })
/// Watch  → iPhone: { action: "pause"|"resume"|"stop" } → emits "watchCommand" event naar JS
@objc(WatchSyncPlugin)
public class WatchSyncPlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {

    // MARK: - CAPBridgedPlugin

    public let identifier = "WatchSyncPlugin"
    public let jsName     = "WatchSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate",     returnType: "promise"),
        CAPPluginMethod(name: "sendRunState", returnType: "promise"),
    ]

    // MARK: - Properties

    private var wcSession: WCSession?
    private let throttleInterval: TimeInterval = 1.0   // max 1 msg/sec naar Watch
    private var lastSentAt: Date?

    // MARK: - Plugin lifecycle

    public override func load() {
        guard WCSession.isSupported() else {
            print("[WatchSync] WCSession niet ondersteund op dit device")
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        wcSession = session
        print("[WatchSync] WCSession geactiveerd")
    }

    // MARK: - JS Methods

    @objc func activate(_ call: CAPPluginCall) {
        call.resolve(["supported": WCSession.isSupported()])
    }

    /// Stuur run-state naar Watch. Gethrottled op 1s.
    @objc func sendRunState(_ call: CAPPluginCall) {
        guard let session = wcSession else {
            call.resolve(["sent": false, "reason": "no_session"])
            return
        }

        // Throttle
        let now = Date()
        if let last = lastSentAt, now.timeIntervalSince(last) < throttleInterval {
            call.resolve(["sent": false, "reason": "throttled"])
            return
        }
        lastSentAt = now

        let payload: [String: Any] = [
            "mode":             call.getString("mode") ?? "IDLE",
            "remainingSeconds": call.getDouble("remainingSeconds") ?? 0,
            "hr":               call.getInt("hr") as Any,
            "spm":              call.getInt("spm") as Any,
            "isPaused":         call.getBool("isPaused") ?? false,
            "accentColor":      call.getString("accentColor") ?? "#39FF14",
            "totalSeconds":     call.getDouble("totalSeconds") ?? 0,
        ]

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { err in
                print("[WatchSync] sendMessage mislukt: \(err.localizedDescription)")
            }
        } else {
            // Fallback: applicationContext overleeft niet-actieve watch app
            do {
                try session.updateApplicationContext(payload)
            } catch {
                print("[WatchSync] updateApplicationContext mislukt: \(error)")
            }
        }

        call.resolve(["sent": true])
    }

    // MARK: - WCSessionDelegate — ontvangen commands van Watch

    public func session(_ session: WCSession,
                        didReceiveMessage message: [String: Any]) {
        guard let action = message["action"] as? String else { return }
        print("[WatchSync] Command van Watch: \(action)")
        notifyListeners("watchCommand", data: ["action": action])
    }

    public func session(_ session: WCSession,
                        didReceiveMessage message: [String: Any],
                        replyHandler: @escaping ([String: Any]) -> Void) {
        guard let action = message["action"] as? String else {
            replyHandler(["ok": false]); return
        }
        print("[WatchSync] Command (reply) van Watch: \(action)")
        notifyListeners("watchCommand", data: ["action": action])
        replyHandler(["ok": true])
    }

    public func session(_ session: WCSession,
                        activationDidCompleteWith state: WCSessionActivationState,
                        error: Error?) {
        if let err = error {
            print("[WatchSync] Activatie mislukt: \(err)")
        } else {
            print("[WatchSync] Activatie klaar — state: \(state.rawValue)")
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {
        print("[WatchSync] Session inactief")
    }

    public func sessionDidDeactivate(_ session: WCSession) {
        print("[WatchSync] Session gedeactiveerd — heractiveren")
        session.activate()
    }
}
