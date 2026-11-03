// Listening, on the Lock Screen and in the Dynamic Island. Orange means live; when the tune is
// named its title takes over in the serif the app uses for tunes.

import ActivityKit
import DesignSystem
import ListenActivity
import SwiftUI
import WidgetKit

struct ListenLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ListenActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Palette.card)
                .activitySystemActionForegroundColor(Palette.foreground)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveMark(phase: state.phase).font(.title2).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing).frame(width: 56)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(headline(state)).font(state.phase == .named ? .tuneTitle(.title3) : .headline).lineLimit(1)
                        if let meta = state.meta, state.phase == .named {
                            Text(meta).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if state.phase == .named {
                        if context.attributes.mode == .recordSession {
                            Text(state.tunesHeard == 1 ? "1 tune so far" : "\(state.tunesHeard) tunes so far")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        ProgressView(value: state.confidence).tint(Palette.brandDot).padding(.horizontal, 8)
                    }
                }
            } compactLeading: {
                LiveMark(phase: state.phase)
            } compactTrailing: {
                if state.phase == .named, let title = state.title {
                    Text(title).font(.tuneTitle(.caption)).lineLimit(1).minimumScaleFactor(0.8).frame(maxWidth: 128)
                } else {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.caption.monospacedDigit()).frame(width: 40)
                }
            } minimal: {
                LiveMark(phase: state.phase)
            }
            .keylineTint(Palette.brandDot)
        }
    }

    private func headline(_ state: ListenActivityAttributes.ContentState) -> String {
        switch state.phase {
        case .listening: "Listening"
        case .narrowing: "Narrowing it down"
        case .named: state.title ?? "Named"
        }
    }
}

/// The orange mark of a live mic, which settles to a note once the tune is named.
private struct LiveMark: View {
    let phase: ListenActivityAttributes.ContentState.Phase

    var body: some View {
        Image(systemName: phase == .named ? "music.note" : "waveform")
            .foregroundStyle(Palette.brandDot)
            .symbolEffect(.variableColor.iterative, isActive: phase != .named)
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<ListenActivityAttributes>

    var body: some View {
        let state = context.state
        HStack(spacing: 14) {
            LiveMark(phase: state.phase).font(.title)
            VStack(alignment: .leading, spacing: 2) {
                if state.phase == .named, let title = state.title {
                    Text(title).font(.tuneTitle(.title2)).foregroundStyle(Palette.foreground)
                    if let meta = state.meta { Text(meta).font(.subheadline).foregroundStyle(Palette.text3) }
                } else {
                    Text(state.phase == .listening ? "Listening" : "Narrowing it down").font(.headline)
                    ProgressView(value: state.confidence).tint(Palette.brandDot)
                }
            }
            Spacer(minLength: 0)
            Text(context.attributes.startedAt, style: .timer)
                .font(.callout.monospacedDigit()).foregroundStyle(Palette.text3)
                .multilineTextAlignment(.trailing).frame(width: 56)
        }
        .padding(16)
    }
}
