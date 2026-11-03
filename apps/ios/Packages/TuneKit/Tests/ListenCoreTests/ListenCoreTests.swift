import Foundation
import Testing
@testable import ListenCore

@Test func engineMakesOneWindow() {
    let tone: [Float] = (0..<ListenEngine.windowSamples).map { n in
        let phase = 2 * Double.pi * 293.66 * Double(n) / 16_000
        return Float(0.2 * sin(phase))
    }
    let features = ListenEngine.features(samples: tone, rate: 16_000)
    #expect(features.count == ListenEngine.windowShape.reduce(1, *))
}

@Test func decoderAnswersOnceALeaderHolds() {
    let decoder = ListenDecoder(tunebooks: [])
    let window: [Float] = [0.1, 0.4, 0.2]
    #expect(decoder.push(cosines: window).status == .listening)
    #expect(decoder.push(cosines: window).status == .listening)
    let verdict = decoder.push(cosines: window)
    #expect(verdict.status == .match)
    #expect(verdict.candidates.first?.index == 1)
}
