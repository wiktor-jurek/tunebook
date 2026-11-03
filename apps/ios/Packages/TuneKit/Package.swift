// swift-tools-version: 6.2
// TuneKit: everything the app and its extensions share. ListenCore wraps the Rust listen engine
// (built into listen_ffiFFI.xcframework by `just ios-core`).
import PackageDescription

let package = Package(
    name: "TuneKit",
    platforms: [.iOS(.v26)],
    products: [
        .library(name: "ListenCore", targets: ["ListenCore"]),
        .library(name: "Haptics", targets: ["Haptics"]),
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .library(name: "API", targets: ["API"]),
        .library(name: "ListenActivity", targets: ["ListenActivity"]),
        .library(name: "Finder", targets: ["Finder"]),
        .library(name: "Notation", targets: ["Notation"]),
    ],
    dependencies: [
        // The same model.onnx the website runs. Core ML conversion can replace this later.
        .package(url: "https://github.com/microsoft/onnxruntime-swift-package-manager", exact: "1.24.2"),
    ],
    targets: [
        .binaryTarget(name: "listen_ffiFFI", path: "listen_ffiFFI.xcframework"),
        .target(name: "ListenCore", dependencies: ["listen_ffiFFI"]),
        .target(name: "Haptics"),
        .target(name: "DesignSystem"),
        .target(name: "API"),
        .target(name: "ListenActivity"),
        .target(name: "Finder", dependencies: [
            "ListenCore", "API",
            .product(name: "onnxruntime", package: "onnxruntime-swift-package-manager"),
        ]),
        // abcjs 6.7.1 (MIT, see Resources/abcjs-LICENSE.txt), the same version the website renders with.
        .target(name: "Notation", resources: [.copy("Resources/abcjs-basic-min.js"), .copy("Resources/score-player.js")]),
        .testTarget(name: "NotationTests", dependencies: ["Notation"], resources: [.copy("phrases.json")]),
        .testTarget(name: "ListenCoreTests", dependencies: ["ListenCore"]),
        .testTarget(name: "FinderTests", dependencies: ["Finder", "ListenCore"]),
    ]
)
