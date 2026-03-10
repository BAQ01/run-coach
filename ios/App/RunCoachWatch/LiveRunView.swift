import SwiftUI

struct LiveRunView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var showStopConfirm = false

    var body: some View {
        VStack(spacing: 6) {

            // ── Mode label ────────────────────────────────────────────────────
            Text(modeLabel)
                .font(.system(size: 17, weight: .black, design: .rounded))
                .foregroundColor(session.accentColor)
                .frame(maxWidth: .infinity, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            // ── Resterende tijd ───────────────────────────────────────────────
            Text(formatTime(session.remainingSeconds))
                .font(.system(size: 38, weight: .black, design: .monospaced))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .center)

            // ── HR + SPM pills ────────────────────────────────────────────────
            HStack(spacing: 14) {
                BiometricPill(
                    symbol:   "heart.fill",
                    value:    session.hr.map(String.init) ?? "–",
                    unit:     "bpm",
                    tintColor: .red
                )
                BiometricPill(
                    symbol:   "figure.run",
                    value:    session.spm.map(String.init) ?? "–",
                    unit:     "spm",
                    tintColor: .blue
                )
            }
            .padding(.vertical, 4)

            // ── Knoppen ───────────────────────────────────────────────────────
            HStack(spacing: 10) {
                // Pause / Resume
                Button {
                    session.sendCommand(session.isPaused ? "resume" : "pause")
                } label: {
                    Image(systemName: session.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 20, weight: .bold))
                        .frame(width: 52, height: 52)
                }
                .buttonStyle(.bordered)
                .tint(session.isPaused ? .green : .orange)

                // Stop
                Button {
                    showStopConfirm = true
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 20, weight: .bold))
                        .frame(width: 52, height: 52)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
        }
        .padding(.horizontal, 4)
        .navigationBarHidden(true)
        .alert("Training stoppen?", isPresented: $showStopConfirm) {
            Button("Stoppen", role: .destructive) {
                session.sendCommand("stop")
            }
            Button("Doorgaan", role: .cancel) {}
        }
    }

    // MARK: - Helpers

    var modeLabel: String {
        if session.isPaused { return "GEPAUZEERD" }
        switch session.mode {
        case "RUN":      return "RENNEN"
        case "WALK":     return "WANDELEN"
        case "WARMUP":   return "WARMING-UP"
        case "COOLDOWN": return "COOLING-DOWN"
        case "DONE":     return "KLAAR!"
        default:         return "WACHTEN..."
        }
    }

    func formatTime(_ secs: Double) -> String {
        let s = max(0, Int(secs))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

// MARK: - BiometricPill

struct BiometricPill: View {
    let symbol:    String
    let value:     String
    let unit:      String
    let tintColor: Color

    var body: some View {
        VStack(spacing: 1) {
            Image(systemName: symbol)
                .font(.system(size: 11))
                .foregroundColor(tintColor)
            Text(value)
                .font(.system(size: 20, weight: .black, design: .monospaced))
                .foregroundColor(.white)
                .lineLimit(1)
            Text(unit)
                .font(.system(size: 9))
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Preview

#Preview {
    LiveRunView()
        .environmentObject(WatchSessionManager.shared)
}
