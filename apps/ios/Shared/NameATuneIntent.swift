// "Name a tune", from the Action Button, Control Center, the Lock Screen or Siri. Compiled into the
// app and the widget extension; running it opens the app, which starts listening.

import AppIntents
import Foundation

extension Notification.Name {
    static let nameATune = Notification.Name("com.tunecompanion.app.name-a-tune")
}

struct NameATuneIntent: AppIntent {
    static let title: LocalizedStringResource = "Name a tune"
    static let description = IntentDescription("Listen to the tune being played and name it.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .nameATune, object: nil)
        return .result()
    }
}
