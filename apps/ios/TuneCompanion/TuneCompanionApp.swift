import API
import AppIntents
import DesignSystem
import ListenCore
import OSLog
import SwiftUI

let log = Logger(subsystem: "com.tunecompanion.app", category: "app")

@main
struct TuneCompanionApp: App {
    @State private var listen = ListenModel()
    @State private var library = LibraryStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(listen)
                .environment(library)
                .tint(Palette.brandInk)
                .task {
                    log.info("Listen engine \(ListenEngine.version, privacy: .public), window \(ListenEngine.windowShape, privacy: .public)")
                    let healthy = await APIClient.current.healthy()
                    log.info("API healthy: \(healthy, privacy: .public)")
                    listen.signedIn = { [library] in library.signedIn }
                    listen.libraryChanged = { [library] in Task { await library.load() } }
                    await library.load()
                }
        }
    }
}

struct Shortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NameATuneIntent(), phrases: ["Name a tune with \(.applicationName)", "What's this tune in \(.applicationName)"],
                    shortTitle: "Name a tune", systemImageName: "waveform")
    }
}
