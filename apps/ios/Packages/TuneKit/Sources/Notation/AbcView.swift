// Music notation drawn by abcjs, the same engine and options the website uses, in a transparent
// web view that sizes itself to the music. A native renderer can replace this later; callers only
// see `AbcView`.

import SwiftUI
import UIKit
import WebKit

public struct AbcView: View {
    public enum Style: Sendable {
        /// One line: a tune's pickup and first bars (the web's OpeningPhrase).
        case phrase
        /// The whole tune, wrapped for a phone at reading distance (the web's session notation).
        case score
    }

    let abc: String
    let style: Style
    let playback: ScorePlayback?
    @State private var height: CGFloat
    /// Hidden until abcjs has drawn and measured the music, so it never shows blank or jumps in size.
    @State private var drawn = false

    /// With `playback`, the score plays too: the island's controls drive it, and the note playing lights up.
    public init(abc: String, style: Style, playback: ScorePlayback? = nil) {
        self.abc = abc
        self.style = style
        self.playback = playback
        // A score seen before takes its height straight away; a new one reserves about a line of music.
        _height = State(initialValue: AbcHeights.shared[AbcHeights.key(abc, style)] ?? (style == .phrase ? 64 : 110))
    }

    public var body: some View {
        // Given room (a phone on its side, a tablet), a score lays out wider, as the web's does: notes stay the same
        // size and more of the tune fits, instead of one line blown up to fill the width.
        GeometryReader { geometry in
            AbcWebView(abc: abc, style: style, playback: playback, wide: style == .score && geometry.size.width > 600,
                       height: $height, drawn: $drawn)
        }
            .frame(height: height)
            .opacity(drawn ? 1 : 0)
            .animation(.easeOut(duration: 0.18), value: drawn)
            .frame(maxWidth: style == .phrase ? 420 : .infinity)
            .accessibilityElement()
            .accessibilityLabel(style == .phrase ? "Opening bars" : "Score")
    }
}

private struct AbcWebView: UIViewRepresentable {
    let abc: String
    let style: AbcView.Style
    let playback: ScorePlayback?
    let wide: Bool
    @Binding var height: CGFloat
    @Binding var drawn: Bool
    @Environment(\.colorScheme) private var scheme

    func makeCoordinator() -> Coordinator { Coordinator(height: $height, drawn: $drawn, key: AbcHeights.key(abc, style), playback: playback) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "size")
        configuration.userContentController.add(context.coordinator, name: "player")
        // Scores play when the island's play button is pressed, a tap in the app rather than on the page.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsInlineMediaPlayback = true
        // abcjs goes in as a user script: a page loaded from a string may not fetch file:// scripts.
        if let engine = Self.engine {
            configuration.userContentController.addUserScript(WKUserScript(source: engine, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if playback != nil, let player = Self.player {
            configuration.userContentController.addUserScript(WKUserScript(source: player, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.underPageBackgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.navigationDelegate = context.coordinator
        view.loadHTMLString(Self.page, baseURL: nil)
        context.coordinator.view = view
        playback?.webView = view
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let options = style == .phrase
            ? #"{"staffwidth":360,"paddingtop":0,"paddingbottom":0,"paddingleft":0,"paddingright":0}"#
            : #"{"staffwidth":\#(wide ? 760 : 400),"paddingtop":0,"paddingbottom":0,"wrap":{"minSpacing":1.6,"maxSpacing":2.6,"preferredMeasuresPerLine":4}}"#
        // The foreground follows the app's appearance; abcjs draws in currentColor.
        let colour = scheme == .dark ? "#ecece8" : "#171717"
        context.coordinator.render(abc: abc, options: options, colour: colour)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "size")
        view.configuration.userContentController.removeScriptMessageHandler(forName: "player")
        MainActor.assumeIsolated { coordinator.playback?.pause() }
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        @Binding var height: CGFloat
        @Binding var drawn: Bool
        let key: String
        let playback: ScorePlayback?
        weak var view: WKWebView?
        private var last: String?
        private var loaded = false
        private var pending: String?

        init(height: Binding<CGFloat>, drawn: Binding<Bool>, key: String, playback: ScorePlayback?) {
            _height = height
            _drawn = drawn
            self.key = key
            self.playback = playback
        }

        func render(abc: String, options: String, colour: String) {
            guard let data = try? JSONSerialization.data(withJSONObject: [abc, colour], options: [.fragmentsAllowed]),
                  let args = String(data: data, encoding: .utf8) else { return }
            let script = "window.draw(\(args.dropFirst().dropLast()), \(options))"
            guard script != last else { return }
            last = script
            // Calls made before the page has loaded wait for it.
            if loaded { view?.evaluateJavaScript(script) } else { pending = script }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            if let pending { webView.evaluateJavaScript(pending) }
            pending = nil
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "player" {
                MainActor.assumeIsolated { playback?.receive(message.body) }
                return
            }
            guard let value = message.body as? Double else { return }
            // -1: a score was just drawn (its height already reported); show it, and the player starts afresh on it.
            if value < 0 {
                MainActor.assumeIsolated { playback?.configure() }
                if !drawn { DispatchQueue.main.async { self.drawn = true } }
                return
            }
            MainActor.assumeIsolated { AbcHeights.shared[key] = value }
            if abs(height - value) > 0.5 { height = value }
        }
    }

    private static let engine = Bundle.module.url(forResource: "abcjs-basic-min", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    private static let player = Bundle.module.url(forResource: "score-player", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    private static let page = """
    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}#paper svg{display:block;overflow:visible}
    .playing-note path,.playing-note ellipse{fill:#C8642A!important;stroke:#C8642A!important}.abcjs-tempo{display:none}</style>
    <script>
    var pending = null;
    window.draw = function (abc, colour, options) {
      pending = [abc, colour, options];
      if (window.ABCJS) flush();
    };
    function flush() {
      if (!pending) return;
      var p = pending; pending = null;
      document.body.style.color = p[1];
      var options = Object.assign({ responsive: "resize", add_classes: true }, p[2]);
      window.currentVisual = ABCJS.renderAbc("paper", p[0], options)[0] || null;
      report();
      try { window.webkit.messageHandlers.size.postMessage(-1); } catch (e) {}
    }
    // abcjs sizes its SVG to the staff; a clef's tail or a high note can draw past it. Measure what is
    // actually drawn, pad the paper so nothing above the box is lost, and report the full height.
    function report() {
      var paper = document.getElementById("paper"), svg = paper.querySelector("svg");
      paper.style.paddingTop = "0px";
      var box = paper.getBoundingClientRect(), height = box.height;
      if (svg) {
        var rect = svg.getBoundingClientRect(), view = svg.viewBox && svg.viewBox.baseVal;
        var scale = view && view.width ? rect.width / view.width : 1, drawn = svg.getBBox();
        var above = Math.max(0, -(drawn.y * scale)), below = Math.max(0, (drawn.y + drawn.height) * scale - rect.height);
        paper.style.paddingTop = Math.ceil(above) + "px";
        height = rect.height + Math.ceil(above) + Math.ceil(below) + 2;
      }
      window.webkit.messageHandlers.size.postMessage(height);
    }
    window.addEventListener("resize", function () { setTimeout(report, 0); });
    </script>
    </head><body><div id="paper"></div></body></html>
    """
}

/// Heights of scores already drawn (by ABC and style), so a score seen again lays out at once.
@MainActor
enum AbcHeights {
    static var shared: [String: CGFloat] = [:]

    static func key(_ abc: String, _ style: AbcView.Style) -> String { "\(style)-\(abc.hashValue)" }
}
