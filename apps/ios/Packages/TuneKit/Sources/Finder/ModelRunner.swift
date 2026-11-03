// Runs the finder's model on one window: features in (1 × channels × 400), one cosine per tune out.
// The shipped model takes 12 channels (pitch classes); the height model takes 24. The runner finds
// out which when it loads, so the app works with whichever model the server has.

import Foundation
import ListenCore
import OnnxRuntimeBindings

public final class ModelRunner: @unchecked Sendable {
    private let env: ORTEnv
    private let session: ORTSession
    private var shape: [NSNumber] = []
    /// The model's input channels: 12 or 24.
    public private(set) var channels = 24

    /// Loading takes a moment (the model is ~36 MB); do it off the main thread.
    public init(modelURL: URL) throws {
        env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setGraphOptimizationLevel(.all)
        try options.setIntraOpNumThreads(2)
        session = try ORTSession(env: env, modelPath: modelURL.path(percentEncoded: false), sessionOptions: options)
        let frames = ListenEngine.windowShape[1]
        for channels in [24, 12] {
            shape = [1, channels, frames].map { NSNumber(value: $0) }
            if (try? cosines([Float](repeating: 0, count: channels * frames))) != nil {
                self.channels = channels
                return
            }
        }
        throw CocoaError(.featureUnsupported)
    }

    /// Not thread-safe across calls; the listener scores one window at a time.
    public func cosines(_ features: [Float]) throws -> [Float] {
        let data = features.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.stride) }
        let input = try ORTValue(tensorData: data, elementType: .float, shape: shape)
        let outputs = try session.run(withInputs: ["windows": input], outputNames: ["cosines"], runOptions: nil)
        guard let output = outputs["cosines"] else { throw CocoaError(.coderValueNotFound) }
        let raw = try output.tensorData() as Data
        return raw.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }
}
