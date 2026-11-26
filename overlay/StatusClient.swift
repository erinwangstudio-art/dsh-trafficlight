import AppKit
import Foundation
import SwiftUI

/// Known DSH Desktop bundle identifiers, newest packaged build first.
enum DSHDesktopApp {
    static let bundleIds = ["com.deepseek.dsh", "ai.deepseek.dsh.desktop.next"]

    static func runningApplication() -> NSRunningApplication? {
        for bundleId in bundleIds {
            if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
                return app
            }
        }
        return nil
    }
}

/// Polls the dsh-trafficlight bridge and exposes the subscribed session list
/// to SwiftUI — one traffic-light row per subscribed session.
final class StatusClient: ObservableObject {
    @Published var state: TrafficState = .offline
    @Published var title: String = "DSH"
    @Published var sessions: [SessionStatus] = []
    @Published var detail: String = ""
    /// User-configured overlay opacity (0.1..1); applied to the panel window.
    @Published var opacity: Double = 1
    /// User-configured minimal single-lamp mode; applied to the panel layout.
    @Published var minimalMode: Bool = false
    /// Breathing beats per state change; consumed by the lamps.
    @Published var breathCount: Int = 3
    /// Breathing beat width (one scale-sweep) in seconds; consumed by the lamps.
    @Published var breathBeat: Double = 0.35
    /// Where the light lives: "floating" (this panel) or "docked" (DSH sidebar).
    @Published var mode: String = "floating"
    /// User-configured status cue sound.
    private var soundEnabled = true
    private var soundVolume: Double = 0.6
    /// Fired on the main queue whenever the mode changes (local click or host poll).
    var onModeChanged: ((String) -> Void)?
    /// The most-recently-changed subscribed session's light state. Drives the
    /// big lamp in minimal mode — it reflects the latest update regardless of
    /// which session produced it.
    @Published private(set) var latestState: TrafficState = .offline

    private let url: URL
    private var timer: Timer?
    /// sessionId -> monotonic change counter. The breathing lamp triggers on
    /// this instead of the 6-second "recent" flag: two changes that happen
    /// inside the window would otherwise never flip the boolean and the pulse
    /// would be silently skipped.
    @Published private(set) var stateChangeTick: [String: Int] = [:]

    /// sessionId -> when its state/detail last changed (used to spotlight
    /// recently-changed rows with a temporarily larger lamp).
    private var stateChangedAt: [String: Date] = [:]
    /// Epoch of the latest observed change; the newest change wins the big lamp.
    private var lastChangeAt: Date = .distantPast

    /// Whether this session's state changed within the given window.
    func isStateRecent(_ sessionId: String, within: TimeInterval = 6) -> Bool {
        guard let date = stateChangedAt[sessionId] else { return false }
        return Date().timeIntervalSince(date) < within
    }

    /// Play a built-in macOS sound for attention-worthy transitions only.
    /// Initial rows and detail-only changes are deliberately silent.
    private func playCue(_ state: TrafficState) {
        guard soundEnabled, soundVolume > 0 else { return }
        // Ping is a more noticeable ~1.5s cue than Basso (~0.8s) for pending attention.
        guard let name: String = state == .blocked ? "Ping" : (state == .done ? "Glass" : nil),
              let sound = NSSound(named: name) else { return }
        sound.volume = Float(min(1, max(0, soundVolume)))
        sound.play()
    }

    private func recordChange(_ id: String, newState: TrafficState, playSound: Bool = false) {
        let now = Date()
        stateChangedAt[id] = now
        stateChangeTick[id, default: 0] += 1
        // Opportunistic prune: drop entries older than the recency window.
        if stateChangedAt.count > 32 {
            let cutoff = Date(timeIntervalSinceNow: -6)
            stateChangedAt = stateChangedAt.filter { $0.value > cutoff }
        }
        if playSound { playCue(newState) }
        // The big lamp follows the newest change in the whole subscribed set.
        if now >= lastChangeAt {
            lastChangeAt = now
            latestState = newState
        }
    }

    /// Detect state transitions for newly freshened rows and record them.
    private func trackChanges(_ newSessions: [SessionStatus]) {
        let old = Dictionary(uniqueKeysWithValues: sessions.map { ($0.sessionId, $0) })
        for s in newSessions {
            if let prev = old[s.sessionId] {
                if prev.state != s.state || (prev.detail ?? "") != (s.detail ?? "") {
                    let next = TrafficState(rawValue: s.state) ?? .offline
                    let stateChanged = prev.state != s.state
                    recordChange(s.sessionId, newState: next,
                                 playSound: stateChanged && (next == .blocked || next == .done))
                }
            } else {
                recordChange(s.sessionId, newState: TrafficState(rawValue: s.state) ?? .offline) // brand-new row counts as a change
            }
        }
    }

    init(port: Int? = nil) {
        let envPort = ProcessInfo.processInfo.environment["DSH_TL_PORT"].flatMap { Int($0) }
        let effectivePort = port ?? envPort ?? 18_765
        self.url = URL(string: "http://127.0.0.1:\(effectivePort)/state")!
        startPolling()
    }

    func startPolling() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in
            self?.poll()
        }
        timer?.tolerance = 0.25
    }

    /// Ask the DSH web client to open this subscribed session, then bring the
    /// desktop window forward — restoring it from the Dock when minimized.
    func openSession(_ sessionId: String) {
        guard !sessionId.isEmpty,
              let endpoint = URL(string: "http://127.0.0.1:\(url.port ?? 18_765)/focus") else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["sessionId": sessionId])
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { _, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 202 else { return }
            DispatchQueue.main.async { StatusClient.raiseDesktopApp() }
        }.resume()
    }

    /// Bring the DSH Desktop window to the front, restoring it when minimized.
    ///
    /// Support both the packaged Desktop (`com.deepseek.dsh`) and the NEXT
    /// build (`ai.deepseek.dsh.desktop.next`). Upstream opened `dsh://open`,
    /// but the current Desktop registers no usable `dsh://` handler for this.
    static func raiseDesktopApp() {
        for bundleId in DSHDesktopApp.bundleIds {
            guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { continue }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            configuration.createsNewApplicationInstance = false
            NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { app, _ in
                // LaunchServices can refuse (busy app, policy); fall back to
                // plain activation so the row never becomes a dead click.
                if app == nil { activateRunning(bundleId) }
            }
            return
        }
        if let app = DSHDesktopApp.runningApplication() {
            _ = app.unhide()
            app.activate(options: [.activateAllWindows])
        }
    }

    /// Last-resort activation: unhide + activate, without reopen semantics.
    private static func activateRunning(_ bundleId: String) {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else { return }
        _ = app.unhide()
        app.activate(options: [.activateAllWindows])
    }

    /// Switch the light between the floating panel and the DSH sidebar twin.
    /// Applies locally at once (so the window hides/shows immediately) and
    /// persists the choice through the host bridge.
    func setMode(_ target: String) {
        let next = target == "docked" ? "docked" : "floating"
        guard next != mode else { return }
        mode = next
        onModeChanged?(next)
        guard var comps = URLComponents(string: url.absoluteString) else { return }
        comps.path = "/mode"
        guard let endpoint = comps.url else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": next])
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request).resume()
    }

    /// Turn the light off for good: unsubscribe every current row (so the DSH
    /// header chips flip back to「订阅」) and quit the overlay. The next
    /// subscription restarts it through the plugin's auto-start.
    func closeOverlay() {
        let ids = sessions.map(\.sessionId)
        guard !ids.isEmpty else {
            NSApp.terminate(nil)
            return
        }
        let group = DispatchGroup()
        for id in ids {
            var comps = URLComponents(string: url.absoluteString)
            comps?.path = "/subscriptions"
            comps?.queryItems = [URLQueryItem(name: "sessionId", value: id)]
            guard let target = comps?.url else { continue }
            var request = URLRequest(url: target)
            request.httpMethod = "DELETE"
            request.timeoutInterval = 2
            group.enter()
            URLSession.shared.dataTask(with: request) { _, _, _ in
                group.leave()
            }.resume()
        }
        group.notify(queue: .main) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                NSApp.terminate(nil)
            }
        }
    }

    /// Remove a row (unsubscribe). The bridge deletes the subscription and the
    /// next poll drops the session from the list.
    func unsubscribe(_ sessionId: String) {
        guard var comps = URLComponents(string: url.absoluteString) else { return }
        comps.path = "/subscriptions"
        comps.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        guard let target = comps.url else { return }
        var request = URLRequest(url: target)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request).resume()
    }

    private func poll() {
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.6
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self else { return }
            guard let data, error == nil,
                  let snap = try? JSONDecoder().decode(TrafficSnapshot.self, from: data) else {
                DispatchQueue.main.async { self.state = .offline }
                return
            }
            DispatchQueue.main.async {
                if snap.sessions.isEmpty {
                    // No subscriptions yet: keep the latestState grey so the
                    // minimal lamp shows idle instead of a stale color.
                    self.latestState = .offline
                }
                self.trackChanges(snap.sessions)
                self.state = TrafficState(rawValue: snap.state) ?? .offline
                self.title = snap.title
                self.sessions = snap.sessions
                self.detail = snap.detail ?? ""
                if let opacity = snap.opacity {
                    self.opacity = min(1, max(0.1, opacity))
                }
                self.minimalMode = snap.minimalMode ?? false
                if let breaths = snap.breathCount {
                    self.breathCount = min(6, max(1, breaths))
                }
                if let beat = snap.breathBeat {
                    self.breathBeat = min(1.0, max(0.1, beat))
                }
                self.soundEnabled = snap.soundEnabled ?? true
                if let volume = snap.soundVolume {
                    self.soundVolume = min(1, max(0, volume))
                }
                if let mode = snap.mode, (mode == "floating" || mode == "docked"), mode != self.mode {
                    self.mode = mode
                    self.onModeChanged?(mode)
                }
            }
        }
        task.resume()
    }
}