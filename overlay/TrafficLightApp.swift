import AppKit
import SwiftUI

/// AppKit entry point instead of a SwiftUI `App` scene.
///
/// The upstream build used a SwiftUI app whose only scene was an empty
/// `Settings {}`. That was invisible when built with Swift 6.2 / SDK 26.2, but
/// with the newer toolchain SwiftUI shows an empty 900×450 window at launch.
/// The overlay only ever needs the AppKit floating panel, so start NSApp
/// directly and keep SwiftUI for the view content only.
@main
@MainActor
enum TrafficLightMain {
    /// NSApplication.delegate is weak — keep the delegate alive here.
    static let appDelegate = AppDelegate()

    static func main() {
        setbuf(stdout, nil) // debug lines must reach the log immediately
        let app = NSApplication.shared
        app.delegate = appDelegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

/// Drives the floating panel's position and auto-fit behaviour. Dragging is
/// handled by AppKit's native window-move session (GripDragView +
/// NSPanel.performDrag) — the system moves the window with compositor sync,
/// which is far smoother than a SwiftUI DragGesture round-tripping through
/// setFrameOrigin.
final class PanelMover: ObservableObject {
    weak var panel: NSPanel?
    /// Glass backdrop view; its live-vibrancy recomposition is suspended while
    /// dragging so window movement stays smooth.
    weak var glassPanel: GlassPanelView?
    private let positionKey = "dsh_tl_origin"
    private let manualWidthKey = "dsh_tl_manual_width"
    private let minWidth: CGFloat = 150
    private let maxWidth: CGFloat = 560
    private let minimizedHeight: CGFloat = 58
    private var lastExpandedHeight: CGFloat = 134
    private var manualWidth: CGFloat?
    private(set) var isMinimal = false
    /// True when the user hid the panel from the close button / menu bar, so
    /// the keep-on-top timer does not instantly bring it back.
    var isHiddenByUser = false

    /// True while the panel is collapsed to the title bar. Kept here (not only
    /// in SwiftUI) so auto-fit never re-expands a collapsed window.
    private(set) var isMinimized = false
    /// True while the user drags; auto-fit resizes are deferred until release
    /// so a poll landing mid-drag can't fight the movement.
    private(set) var isDragging = false
    private var lastSessions: [SessionStatus] = []
    /// Called when a drag ends inside the DSH window's sidebar dock zone, i.e.
    /// the user dropped the light where the docked panel lives.
    var onDockRequest: (() -> Void)?
    private var dragStartOrigin: NSPoint?
    private var dragStartMouse: NSPoint?

    /// Which resize edge the pointer is over (drives the drawn hover hint,
    /// since a non-activating panel cannot change the system cursor).
    enum HoverEdge { case none, leading, trailing }
    @Published var hoveredEdge: HoverEdge = .none

    func setEdgeHover(_ edge: HoverEdge, active: Bool) {
        if active {
            if hoveredEdge != edge { hoveredEdge = edge }
        } else if hoveredEdge == edge {
            hoveredEdge = .none
        }
    }
    /// Floating position captured when docking, so "取回悬浮窗" retreats to the
    /// same place instead of landing back over the sidebar.
    private var preDockOrigin: NSPoint?

    init() {
        if let saved = UserDefaults.standard.object(forKey: manualWidthKey) as? CGFloat,
           saved >= minWidth, saved <= maxWidth {
            manualWidth = saved
        }
    }

    /// Mouse-down on the grip: remember the grab offset. The window only
    /// starts moving once the pointer actually moves.
    func beginDrag(at point: NSPoint) {
        guard let panel, !isMinimal else { return }
        isDragging = true
        dragStartMouse = point
        dragStartOrigin = panel.frame.origin
        glassPanel?.setDockArmed(false)
        glassPanel?.setEffectActive(false) // drop live blur recomposition while moving
    }

    /// Mouse-drag: translate the panel by exactly the pointer delta, so the
    /// grip stays under the cursor instead of jumping to the window centre.
    func continueDrag(to point: NSPoint) {
        guard let panel, let startMouse = dragStartMouse, let startOrigin = dragStartOrigin else { return }
        panel.setFrameOrigin(NSPoint(x: startOrigin.x + (point.x - startMouse.x),
                                     y: startOrigin.y + (point.y - startMouse.y)))
        // Full frost while the pointer is over the dock zone: "release to dock".
        glassPanel?.setDockArmed(isInsideDockZone(atScreenPoint: point))
    }

    /// Mouse-up: settle size, persist position, and dock when the cursor was
    /// released inside the dashed sidebar drop target.
    func endDrag(at point: NSPoint) {
        let startMouse = dragStartMouse
        let startOrigin = dragStartOrigin
        isDragging = false
        glassPanel?.setDockArmed(false)
        glassPanel?.setEffectActive(true)
        savePosition()
        // Re-apply any auto-fit that was deferred during the drag.
        fitToContent(lastSessions)
        if let startMouse, let startOrigin, let onDockRequest,
           hypot(point.x - startMouse.x, point.y - startMouse.y) >= 24,
           !isInsideDockZone(atScreenPoint: startMouse),
           isInsideDockZone(atScreenPoint: point) {
            // Remember where the drag began (outside the zone) for undocking.
            preDockOrigin = startOrigin
            onDockRequest()
        }
        dragStartMouse = nil
        dragStartOrigin = nil
    }

    /// True when an AppKit screen point falls inside the dock zone.
    private func isInsideDockZone(atScreenPoint point: NSPoint) -> Bool {
        guard let dsh = panelMover_dshWindowFrame() else { return false }
        return dockZone(for: dsh).contains(cgPoint(point.x, point.y))
    }

    /// The dock zone: the bottom slice of the DSH sidebar, right above the
    /// account/settings row — i.e. the red box the sidebar footer occupies.
    private func dockZone(for dsh: CGRect) -> CGRect {
        let width = min(270, dsh.width * 0.34)
        let height: CGFloat = 80        // the sidebar footer drop target
        let bottomInset: CGFloat = 50   // account row + settings strip
        return CGRect(x: dsh.minX + 4,
                      y: dsh.maxY - bottomInset - height,
                      width: width,
                      height: height)
    }

    /// True when the given panel frame's centre falls into the dock zone.
    func isInsideDockZone(_ frame: CGRect) -> Bool {
        guard let dsh = panelMover_dshWindowFrame() else { return false }
        let zone = dockZone(for: dsh)
        return zone.contains(cgPoint(frame.midX, frame.midY))
    }

    /// Convert an AppKit (bottom-left origin) point to CoreGraphics window
    /// coordinates (top-left origin of the main display). Secondary displays
    /// above the main one naturally map to negative y, matching CG bounds.
    private func cgPoint(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: x, y: primaryHeight - y)
    }

    /// Capture the floating origin before the panel hides for docking.
    func rememberPreDockPosition() {
        guard preDockOrigin == nil, let panel else { return }
        preDockOrigin = panel.frame.origin
    }

    /// Put the panel back on screen after undocking: the pre-dock spot when it
    /// is still outside the dock zone, otherwise the top-right default.
    func restoreAfterUndock() {
        guard let panel else { return }
        var target = preDockOrigin
        if let candidate = target {
            let frame = CGRect(origin: candidate, size: panel.frame.size)
            // Never land back on the app window or inside the dock zone: the
            // floating light should come back to open screen, not on top of
            // the sidebar it was just docked to.
            if isInsideDockZone(frame) {
                target = nil
            } else if let dsh = panelMover_dshWindowFrame(), dsh.contains(cgPoint(frame.midX, frame.midY)) {
                target = nil
            }
        }
        if target == nil {
            target = defaultOrigin(width: panel.frame.width, height: panel.frame.height)
        }
        if let target { panel.setFrameOrigin(target) }
        preDockOrigin = nil
    }

    /// Top-right of the main display, matching the launch position.
    private func defaultOrigin(width: CGFloat, height: CGFloat) -> NSPoint {
        // Prefer the display the pointer is on (the one the user is working
        // on), so the light does not open on another monitor.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        guard let screen else { return NSPoint(x: 120, y: 120) }
        let visible = screen.visibleFrame
        return NSPoint(x: visible.maxX - width - 16, y: visible.maxY - height - 16)
    }

    /// Frame of the DSH desktop main window in CoreGraphics (top-left origin)
    /// coordinates. No Accessibility permission is needed for window bounds.
    private func panelMover_dshWindowFrame() -> CGRect? {
        guard let app = DSHDesktopApp.runningApplication() else { return nil }
        let pid = app.processIdentifier
        guard let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var best: CGRect?
        var bestArea: CGFloat = 0
        for info in infos {
            guard let owner = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, owner == pid,
                  let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue, layer == 0,
                  let dict = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: dict as CFDictionary) else { continue }
            let area = rect.width * rect.height
            if area > bestArea {
                bestArea = area
                best = rect
            }
        }
        return best
    }

    /// Whether the native Liquid Glass backdrop is active (macOS 26+).
    var usesLiquidGlass: Bool { glassPanel?.usesLiquidGlass ?? false }

    /// Drive the whole glass effect from the user's slider: at the low end the
    /// blur is faint and the tint light (clear glass); at the high end the blur
    /// is full strength and the tint deep (fully frosted).
    func setGlassLevel(_ level: Double) {
        glassPanel?.applyGlass(level: level)
    }

    func hidePanel() {
        isHiddenByUser = true
        panel?.orderOut(nil)
    }

    func showPanel() {
        isHiddenByUser = false
        panel?.orderFrontRegardless()
    }

    /// Collapse/expand the panel while keeping its top edge fixed on screen.
    @MainActor
    func setMinimized(_ minimized: Bool) {
        guard let panel else { return }
        if minimized {
            if !isMinimized, !isMinimal, panel.frame.height > minimizedHeight + 1 {
                // Capture the height the user actually sees, not whatever
                // auto-fit last computed, so repeated toggles never drift.
                lastExpandedHeight = panel.frame.height
            }
            isMinimized = true
        } else {
            isMinimized = false
        }
        let newHeight = minimized ? minimizedHeight : lastExpandedHeight
        var frame = panel.frame
        let desiredTop = frame.origin.y + frame.height
        frame.origin.y = desiredTop - newHeight
        frame.size.height = newHeight
        panel.setFrame(frame, display: true)
        if !minimized { fitToContent(lastSessions) }
        relayoutContent()
        // AppKit's constraint-based layout rewrites the window frame right
        // after a collapse/expand (it keeps the content's minimum height and
        // nudges the origin). Re-assert the intended top edge on the next
        // runloop so repeated toggles never drift.
        DispatchQueue.main.async { [weak self] in
            guard let self, let panel = self.panel else { return }
            let height = minimized ? self.minimizedHeight : self.lastExpandedHeight
            var f = panel.frame
            let targetY = desiredTop - height
            if abs(f.height - height) > 0.5 || abs(f.origin.y - targetY) > 0.5 {
                f.size.height = height
                f.origin.y = targetY
                panel.setFrame(f, display: true)
            }
            // The window frame can already be right while the SwiftUI content
            // is still laid out for the old height, so always relayout here.
            self.relayoutContent()
        }
    }

    /// Make the hosting view match the panel and lay its SwiftUI content out
    /// again for the current size.
    private func relayoutContent() {
        guard let glass = glassPanel else { return }
        if glass.hostingView.frame != glass.bounds {
            glass.hostingView.frame = glass.bounds
        }
        glass.hostingView.needsLayout = true
        glass.needsLayout = true
        glass.layoutSubtreeIfNeeded()
        glass.hostingView.needsDisplay = true
    }

    /// Compact size for minimal (single-lamp) mode.
    private let minimalSize: (CGFloat, CGFloat) = (104, 58)

    /// Switch between minimal (single-lamp) and full layouts. In minimal mode
    /// the panel is pinned to a small fixed size; otherwise auto-fit resumes.
    func setMinimal(_ minimal: Bool) {
        guard let panel else { return }
        if isDragging { return }
        isMinimal = minimal
        if minimal {
            let (w, h) = minimalSize
            setFrameKeepTopRight(width: w, height: h)
        } else {
            // Restore auto-fit sizing based on the current subscription list.
            fitToContent(lastSessions)
        }
    }

    /// Set a user-chosen width from the right-edge resize handle. The manual
    /// value takes priority over content-based auto-fit until the key is reset.
    func setManualWidth(_ width: CGFloat, keepRightEdge: Bool = true) {
        guard let panel, !isMinimal else { return }
        let clamped = min(maxWidth, max(minWidth, width))
        manualWidth = clamped
        UserDefaults.standard.set(clamped, forKey: manualWidthKey)
        var frame = panel.frame
        // Leading handle keeps the right edge pinned (grows toward the screen
        // interior); trailing handle keeps the left edge pinned.
        if keepRightEdge { frame.origin.x += frame.width - clamped }
        frame.size.width = clamped
        panel.setFrame(frame, display: true)
    }

    /// Resize the panel to the given size anchoring its top-right corner.
    private func setFrameKeepTopRight(width: CGFloat, height: CGFloat) {
        guard let panel else { return }
        var frame = panel.frame
        let dx = frame.width - width
        frame.origin.x += dx // keep right edge fixed
        frame.size.width = width
        let dy = frame.height - height
        frame.origin.y += dy // keep top edge fixed
        frame.size.height = height
        panel.setFrame(frame, display: true)
    }

    /// Auto-fit the capsule to the subscribed session list.
    ///
    /// Called whenever the row list changes (and once at appear). The width
    /// grows to fit the longest row title (right edge anchored, 300–560pt) and
    /// the height grows with the row count (top edge anchored, capped so a big
    /// subscription list scrolls instead of filling the screen). This also
    /// repairs the historical bug where the panel was frozen at the *initial*
    /// SwiftUI fitting size and a later, wider title got truncated to "…".
    func fitToContent(_ sessions: [SessionStatus]) {
        guard let panel else { return }
        lastSessions = sessions
        // Never resize a panel the user is currently dragging — a setFrame
        // landing mid-drag visibly stutters the movement.
        if isDragging { return }
        // Minimal mode owns a fixed single-lamp size.
        if isMinimal { return }
        // Default auto-fit width, captured from the user-tuned overlay width.
        let baseWidth: CGFloat = 165
        let maxWidth: CGFloat = 560
        let chrome: CGFloat = 110 // row chrome around the title text
        let font = NSFont.systemFont(ofSize: 12, weight: .semibold)

        var longest: CGFloat = 0
        for s in sessions {
            let tw = (s.title as NSString).size(withAttributes: [.font: font]).width
            longest = max(longest, tw)
        }
        let neededWidth = min(max(baseWidth, chrome + longest.rounded(.up)), maxWidth)
        let targetWidth = isMinimal ? (panel.frame.width) : (manualWidth ?? neededWidth)

        let header: CGFloat = 36
        let rowH: CGFloat = 36
        let maxVisible: Int = 6
        let visible = min(sessions.count, maxVisible)
        let scrolled = max(0, sessions.count - maxVisible)
        let scrollArea: CGFloat = CGFloat(min(scrolled, 3)) * rowH
        let neededHeight: CGFloat = sessions.isEmpty
            ? 88
            : header + 1 + CGFloat(visible) * rowH + (scrolled > 0 ? 16 + scrollArea : 0) + 10

        // The collapsed bar keeps its height; only remember what to restore.
        lastExpandedHeight = neededHeight
        if isMinimized { return }

        var frame = panel.frame
        var changed = false
        let dw = targetWidth - frame.width
        if abs(dw) > 0.5 {
            // Use the target width itself: using neededWidth here while
            // shifting by (targetWidth - width) moved the panel sideways on
            // every fit when the user had resized it.
            frame.size.width = targetWidth
            frame.origin.x -= dw // keep the right edge anchored (capsule sits top-right)
            changed = true
        }
        let dh = neededHeight - frame.height
        if abs(dh) > 0.5 {
            frame.size.height = neededHeight
            frame.origin.y += dh // keep the top edge anchored
            changed = true
        }
        if changed {
            panel.setFrame(frame, display: true)
        }
    }

    /// Quit the overlay app (main-actor: touches NSApp).
    @MainActor func quit() {
        NSApp.terminate(nil)
    }

    func restorePosition() {
        guard let panel else { return }
        // UserDefaults hands back a mixed number array; bridging it wholesale
        // to [CGFloat] / [NSNumber] fails, which silently ignored the saved
        // position on every launch. Decode element by element instead.
        func number(_ value: Any) -> Double? {
            if let n = value as? NSNumber { return n.doubleValue }
            if let d = value as? Double { return d }
            if let i = value as? Int { return Double(i) }
            if let f = value as? CGFloat { return Double(f) }
            if let s = value as? String { return Double(s) }
            return nil
        }
        guard let raw = UserDefaults.standard.array(forKey: positionKey), raw.count == 2,
              let x = number(raw[0]), let y = number(raw[1]) else { return }
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func savePosition() {
        guard let panel else { return }
        let p = panel.frame.origin
        UserDefaults.standard.set([p.x, p.y], forKey: positionKey)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: NSPanel?
    private var statusItem: NSStatusItem?
    private var stateItem: NSMenuItem?
    private var client: StatusClient?
    private var mover: PanelMover?
    /// Last presentation mode we acted on; the first snapshot must not count as
    /// an "undock" (that used to reset the restored position to the default).
    private var lastAppliedMode: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let client = StatusClient()
        let mover = PanelMover()
        self.client = client
        self.mover = mover

        let panel = NSPanel.trafficLightPanel(
            rootView: TrafficLightView()
                .environmentObject(client)
                .environmentObject(mover)
        )
        mover.panel = panel
        // Wire the glass backdrop to the mover (blur suspended during drag).
        mover.glassPanel = panel.contentView as? GlassPanelView
        mover.glassPanel?.applyGlass(level: client.opacity)
        mover.restorePosition()
        client.onModeChanged = { [weak self] mode in self?.applyMode(mode) }
        mover.onDockRequest = { [weak client] in client?.setMode("docked") }
        mover.setMinimal(client.minimalMode) // start in the persisted layout mode
        panel.orderFrontRegardless()
        self.panel = panel

        setupStatusItem()
        setupAlwaysOnTop()
    }

    /// Keep the panel pinned on top across every app-switch / space change.
    private func setupAlwaysOnTop() {
        let center = NotificationCenter.default
        let reFront = { [weak self] in
            guard let self else { return }
            guard self.client?.mode != "docked" else { return }
            guard self.mover?.isHiddenByUser != true else { return }
            self.panel?.orderFrontRegardless()
        }
        center.addObserver(forName: NSApplication.didResignActiveNotification,
                           object: nil, queue: .main, using: { _ in reFront() })
        center.addObserver(forName: NSApplication.didBecomeActiveNotification,
                           object: nil, queue: .main, using: { _ in reFront() })
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil, queue: .main, using: { _ in reFront() })
        // Periodic keep-alive: a fullscreen app, a Stage Manager space switch,
        // or another app raising its window can cover a level-6 panel without
        // firing any of the observers above. Re-front on a timer so the light
        // always comes back, and pull the panel back if it drifted off-screen
        // (e.g. an external display was disconnected and its saved origin no
        // longer intersects any screen).
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, let panel = self.panel else { return }
                guard self.client?.mode != "docked" else { return }
                guard self.mover?.isHiddenByUser != true else { return }
                panel.orderFrontRegardless()
                self.ensureOnScreen(panel)
            }
        }
    }

    /// Show or hide the floating panel for the current presentation mode.
    /// In `docked` mode the in-page sidebar twin takes over; the panel parks
    /// offscreen (not closed) so its state and position survive the round trip.
    private func applyMode(_ mode: String) {
        guard let panel else { return }
        let previous = lastAppliedMode
        lastAppliedMode = mode
        if mode == "docked" {
            if previous != "docked" {
                // Keep the floating spot so undocking does not put the panel
                // back on top of the sidebar.
                mover?.rememberPreDockPosition()
            }
            panel.orderOut(nil)
        } else {
            // Only restore the pre-dock spot when we actually came from docked.
            // Treating the first snapshot as an undock discarded the saved
            // position and snapped the panel back to its default origin.
            if previous == "docked" {
                mover?.restoreAfterUndock()
            }
            mover?.isHiddenByUser = false
            panel.orderFrontRegardless()
            ensureOnScreen(panel)
        }
    }

    /// If the panel's frame no longer intersects any attached screen, move it
    /// back to the top-right of the main display. This is the usual cause of a
    /// "the light vanished but the menu-bar icon is still there" report after
    /// unplugging an external monitor or changing display arrangement.
    private func ensureOnScreen(_ panel: NSPanel) {
        let frame = panel.frame
        let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(frame) }
        if onScreen { return }
        guard let main = NSScreen.main else { return }
        let margin: CGFloat = 16
        var f = frame
        f.origin.x = main.visibleFrame.maxX - f.width - margin
        f.origin.y = main.visibleFrame.maxY - f.height - margin
        panel.setFrame(f, display: true)
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.title = "🚦"
            button.toolTip = "DSH 任务状态红绿灯"
        }
        let menu = NSMenu()
        let stateItem = NSMenuItem(title: "状态：连接中…", action: nil, keyEquivalent: "")
        self.stateItem = stateItem
        menu.addItem(stateItem)
        menu.addItem(.separator())
        let showItem = NSMenuItem(title: "显示悬浮窗", action: #selector(showPanel), keyEquivalent: "")
        showItem.target = self
        menu.addItem(showItem)
        let hideItem = NSMenuItem(title: "隐藏悬浮窗", action: #selector(hidePanel), keyEquivalent: "")
        hideItem.target = self
        menu.addItem(hideItem)
        let quitItem = NSMenuItem(title: "退出红绿灯", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        item.menu = menu
        self.statusItem = item

        // Keep the menu item's status line roughly in sync with the light.
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self, let client = self.client,
                  let stateItem = self.stateItem else { return }
            let label: String
            switch client.state {
            case .blocked: label = "状态：阻塞（红灯）"
            case .running: label = "状态：执行中（黄灯）"
            case .done: label = "状态：已完成（绿灯）"
            case .idle: label = "状态：空闲"
            case .offline: label = "状态：未连接 DSH"
            }
            DispatchQueue.main.async { stateItem.title = label }
        }
    }

    @objc private func showPanel() {
        mover?.showPanel()
    }

    @objc private func hidePanel() {
        mover?.hidePanel()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
