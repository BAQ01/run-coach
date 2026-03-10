import Foundation
import WatchConnectivity
import SwiftUI

/// WatchSessionManager — ontvangt run-state van iPhone en stuurt commands terug.
final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {

    static let shared = WatchSessionManager()

    // ── Gepubliceerde state (driven door iPhone messages) ────────────────────
    @Published var mode:             String  = "IDLE"
    @Published var remainingSeconds: Double  = 0
    @Published var totalSeconds:     Double  = 0
    @Published var hr:               Int?    = nil
    @Published var spm:              Int?    = nil
    @Published var isPaused:         Bool    = false
    @Published var accentHex:        String  = "#39FF14"
    @Published var isConnected:      Bool    = false

    var accentColor: Color {
        Color(hex: accentHex) ?? .green
    }

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Stuur command naar iPhone

    func sendCommand(_ action: String) {
        guard WCSession.default.isReachable else {
            print("[WatchSession] iPhone niet bereikbaar voor command: \(action)")
            return
        }
        WCSession.default.sendMessage(
            ["action": action],
            replyHandler: nil,
            errorHandler: { err in print("[WatchSession] Command mislukt: \(err)") }
        )
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession,
                 activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {
        DispatchQueue.main.async {
            self.isConnected = (state == .activated)
        }
    }

    func session(_ session: WCSession,
                 didReceiveMessage message: [String: Any]) {
        applyPayload(message)
    }

    func session(_ session: WCSession,
                 didReceiveApplicationContext context: [String: Any]) {
        applyPayload(context)
    }

    private func applyPayload(_ p: [String: Any]) {
        DispatchQueue.main.async {
            if let m   = p["mode"]             as? String  { self.mode             = m   }
            if let r   = p["remainingSeconds"] as? Double  { self.remainingSeconds = r   }
            if let t   = p["totalSeconds"]     as? Double  { self.totalSeconds     = t   }
            if let pa  = p["isPaused"]         as? Bool    { self.isPaused         = pa  }
            if let hex = p["accentColor"]      as? String  { self.accentHex        = hex }

            // HR en SPM: null-safe (komen als NSNull als niet beschikbaar)
            if let hr  = p["hr"]  as? Int { self.hr  = hr  } else { self.hr  = nil }
            if let spm = p["spm"] as? Int { self.spm = spm } else { self.spm = nil }

            // Haptics — na state update zodat lastMode correct vergelijkt
            let hrWarning = p["hrWarning"] as? Bool ?? false
            HapticsManager.shared.handleUpdate(
                HapticsManager.RunState(
                    mode:      self.mode,
                    isPaused:  self.isPaused,
                    hrWarning: hrWarning
                )
            )
        }
    }
}
