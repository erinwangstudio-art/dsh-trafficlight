// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "TrafficLightOverlay",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TrafficLightOverlay",
            path: "."
        )
    ]
)
