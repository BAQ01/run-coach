import WatchKit
import Foundation

/// HapticsManager — coördineert haptic feedback op de Watch.
///
/// Regels:
/// - Minimaal 8 seconden tussen willekeurige haptics (global throttle).
/// - HR-warning haptic: maximaal 1 per 120 seconden.
/// - Elke haptic vuurt alleen bij een echte toestandsovergang.
///
/// Moet altijd op de main thread worden aangeroepen (WatchSessionManager
/// dispatcht al naar main).
final class HapticsManager {

    static let shared = HapticsManager()
    private init() {}

    // MARK: - Input state

    struct RunState {
        let mode:      String   // "IDLE"|"WARMUP"|"RUN"|"WALK"|"COOLDOWN"|"DONE"
        let isPaused:  Bool
        let hrWarning: Bool     // iPhone stuurt true als HR te hoog is
    }

    // MARK: - Intern geheugen

    private var lastMode:        String = "IDLE"
    private var lastHapticAt:    Date?  = nil
    private var lastHrWarnAt:    Date?  = nil

    // MARK: - Drempelwaarden

    private let globalGap:   TimeInterval = 8
    private let hrWarnGap:   TimeInterval = 120

    // MARK: - Publieke API

    func handleUpdate(_ state: RunState) {
        let now  = Date()
        let mode = state.mode

        // ── HR-warning (eigen throttle, onafhankelijk van global gap) ─────────
        if state.hrWarning {
            let sinceWarn = lastHrWarnAt.map { now.timeIntervalSince($0) } ?? .infinity
            if sinceWarn >= hrWarnGap {
                lastHrWarnAt = now
                play(.failure)
            }
        }

        // ── Mode ongewijzigd → geen verdere haptic ────────────────────────────
        guard mode != lastMode else { return }
        let prev = lastMode
        lastMode = mode

        // ── Global throttle check ─────────────────────────────────────────────
        let sinceGlobal = lastHapticAt.map { now.timeIntervalSince($0) } ?? .infinity
        let canFire     = sinceGlobal >= globalGap

        // ── Workout start: IDLE → WARMUP of RUN (bypass throttle, eenmalig) ──
        let wasIdle   = prev == "IDLE" || prev == ""
        let isActive  = mode == "WARMUP" || mode == "RUN"
        if wasIdle && isActive {
            lastHapticAt = now
            play(.start)
            return
        }

        guard canFire else { return }

        switch (prev, mode) {

        // Eerste echte run-interval na warming-up
        case ("WARMUP", "RUN"):
            lastHapticAt = now
            play(.success)

        // RUN → WALK: neerwaartse overgang
        case ("RUN", "WALK"):
            lastHapticAt = now
            play(.directionDown)

        // WALK → RUN: opwaartse overgang
        case ("WALK", "RUN"):
            lastHapticAt = now
            play(.directionUp)

        // Workout afgerond
        case (_, "DONE"), (_, "COMPLETED"):
            lastHapticAt = now
            play(.notification)

        default:
            break
        }
    }

    // MARK: - Privé

    private func play(_ type: WKHapticType) {
        WKInterfaceDevice.current().play(type)
    }
}
