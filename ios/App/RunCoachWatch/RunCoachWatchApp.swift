import SwiftUI

@main
struct RunCoachWatchApp: App {
    @StateObject private var session = WatchSessionManager.shared

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                LiveRunView()
            }
            .environmentObject(session)
        }
    }
}
