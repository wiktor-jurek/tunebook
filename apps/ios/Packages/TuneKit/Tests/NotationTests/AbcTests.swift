import Foundation
import Testing
@testable import Notation

private struct Case: Decodable {
    struct Tune: Decodable { let title: String?, kind: String?, meter: String?, mode: String?, abc: String }
    let tune: Tune
    let phrase: String
    let score: String
}

/// phrases.json is the TypeScript's output for real tunes from /api/finder (apps/web/src/lib/notation.ts).
@Test func matchesTheWebsNotation() throws {
    let url = Bundle.module.url(forResource: "phrases", withExtension: "json")!
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    #expect(cases.count > 5)
    for c in cases {
        let tune = AbcTune(title: c.tune.title, kind: c.tune.kind, meter: c.tune.meter, mode: c.tune.mode, abc: c.tune.abc)
        #expect(Abc.forScore(tune) == c.score, "score of \(c.tune.title ?? "")")
        #expect(Abc.openingPhrase(tune) == c.phrase, "phrase of \(c.tune.title ?? "")")
    }
}
