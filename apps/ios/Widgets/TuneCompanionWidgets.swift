import SwiftUI
import WidgetKit

@main
struct TuneCompanionWidgets: WidgetBundle {
    var body: some Widget {
        ListenLiveActivity()
        NameATuneControl()
    }
}

/// Control Center, the Lock Screen and the Action Button: one press to name a tune.
struct NameATuneControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.tunecompanion.app.name-a-tune") {
            ControlWidgetButton(action: NameATuneIntent()) {
                Label("Name a tune", systemImage: "waveform")
            }
        }
        .displayName("Name a tune")
        .description("Listen to the tune being played and name it.")
    }
}
