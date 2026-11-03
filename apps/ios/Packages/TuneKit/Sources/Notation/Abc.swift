// ABC helpers, ported from apps/web/src/lib/notation.ts so a tune's opening bars and score read
// exactly as on the web. Tests/NotationTests checks them against the TypeScript's output.

import Foundation

public struct AbcTune: Sendable, Hashable {
    public var title: String?
    public var kind: String?
    public var meter: String?
    public var mode: String?
    public var abc: String

    public init(title: String?, kind: String?, meter: String?, mode: String?, abc: String) {
        self.title = title
        self.kind = kind
        self.meter = meter
        self.mode = mode
        self.abc = abc
    }
}

public enum Abc {
    /// A tune's ABC with headers, as The Session's bare bodies need.
    public static func forTune(_ tune: AbcTune) -> String {
        if matches("^X\\s*:", tune.abc, lines: true) { return tune.abc }
        func line(_ value: String?, _ fallback: String) -> String {
            let text = value.flatMap { $0.isEmpty ? nil : $0 } ?? fallback
            return text.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        }
        return "X:1\nT:\(line(tune.title, "Untitled"))\nR:\(line(tune.kind, "tune"))\nM:\(line(tune.meter, "4/4"))\nL:1/8\nQ:1/4=100\nK:\(line(tune.mode, "D"))\n\(tune.abc)"
    }

    /// The score leaves out the title and the rhythm: the screen already says both.
    public static func forScore(_ tune: AbcTune) -> String {
        replace("^[TR]\\s*:[^\\r\\n]*(?:\\r?\\n|$)", in: forTune(tune), lines: true)
    }

    /// How a tune starts: any pickup and then `bars` full bars of the first part, as full ABC.
    public static func openingPhrase(_ tune: AbcTune, bars: Int = 2) -> String {
        let lines = replace("^[RQ]\\s*:[^\\r\\n]*(?:\\r?\\n|$)", in: forScore(tune), lines: true)
            .components(separatedBy: "\n").map { $0.hasSuffix("\r") ? String($0.dropLast()) : $0 }
        var headers: [String] = [], body: [String] = []
        for line in lines {
            if body.isEmpty, matches("^[A-Za-z]\\s*:", line) { headers.append(line) } else { body.append(line) }
        }
        let text = replace("%[^\\n]*", in: body.joined(separator: " "))
        // Split at bar lines, as the TypeScript's split with a capturing group: separators are dropped below.
        let separator = try! NSRegularExpression(pattern: "\\|\\]|\\|\\||\\|:|:\\||::|\\|\\d?|\\[\\d")
        var measures: [String] = [], current = "", cursor = text.startIndex
        for match in separator.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            let range = Range(match.range, in: text)!
            current += text[cursor..<range.lowerBound]
            if !current.trimmingCharacters(in: .whitespaces).isEmpty { measures.append(current.trimmingCharacters(in: .whitespaces)) }
            current = ""
            cursor = range.upperBound
        }
        current += text[cursor...]
        if !current.trimmingCharacters(in: .whitespaces).isEmpty { measures.append(current.trimmingCharacters(in: .whitespaces)) }
        if measures.isEmpty { return (headers + [body.joined(separator: " ")]).joined(separator: "\n") }
        // A first bar much shorter than the second is a pickup: keep it and count full bars after it.
        func notes(_ measure: String) -> Int { measure.filter { "ABCDEFGabcdefgz".contains($0) }.count }
        let pickup = measures.count > 1 && notes(measures[0]) * 2 <= notes(measures[1]) ? 1 : 0
        return (headers + [measures.prefix(pickup + bars).joined(separator: " | ") + " |]"]).joined(separator: "\n")
    }

    private static func matches(_ pattern: String, _ text: String, lines: Bool = false) -> Bool {
        let regex = try! NSRegularExpression(pattern: pattern, options: lines ? [.anchorsMatchLines] : [])
        return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func replace(_ pattern: String, in text: String, lines: Bool = false) -> String {
        let regex = try! NSRegularExpression(pattern: pattern, options: lines ? [.anchorsMatchLines] : [])
        return regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }
}
