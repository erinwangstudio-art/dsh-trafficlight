import AppKit
import SwiftUI

/// Native drag strip covering just the grip icon, embedded via SwiftUI
/// (NSViewRepresentable → NativeDragStrip).
///
/// The window is moved manually from the mouse delta instead of using
/// `NSWindow.performDrag(with:)`: performDrag assumes a titled window and
/// re-anchors the frame to the click, which made the borderless panel jump so
/// the cursor landed in its centre on mouse-down. Tracking the delta keeps the
/// grab point exactly under the pointer.
final class GripDragView: NSView {
    weak var mover: PanelMover?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }

    override func mouseDown(with event: NSEvent) {
        mover?.beginDrag(at: NSEvent.mouseLocation)
    }

    override func mouseDragged(with event: NSEvent) {
        mover?.continueDrag(to: NSEvent.mouseLocation)
    }

    override func mouseUp(with event: NSEvent) {
        mover?.endDrag(at: NSEvent.mouseLocation)
    }

    /// Draw the three-line drag-handle glyph so the strip looks like a handle.
    /// Scales with the view size so it always fits a small 22pt icon.
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let fill = NSColor.white.withAlphaComponent(0.6)
        fill.setFill()
        let w = bounds.width
        let h = bounds.height
        let cx = w / 2
        let cy = h / 2
        let lineW = min(13, w * 0.6)
        let lineH = max(1.1, h * 0.07)
        let gap = lineW * 0.24
        for i in -1...1 {
            let rect = NSRect(x: cx - lineW / 2, y: cy + CGFloat(i) * gap - lineH / 2, width: lineW, height: lineH)
            NSBezierPath(roundedRect: rect, xRadius: lineH / 2, yRadius: lineH / 2).fill()
        }
    }
}

/// Left-edge resize strip. Dragging left widens the panel and dragging right
/// narrows it, with the *left* edge following the pointer (the right edge is
/// anchored), so the edge under the cursor is always the edge that moves.
/// Uses absolute mouse location so a setFrame during the drag cannot feed back
/// into the delta calculation.
final class ResizeEdgeView: NSView {
    weak var mover: PanelMover?
    /// false = leading handle (keeps the right edge pinned, left edge follows
    /// the pointer); true = trailing handle (keeps the left edge pinned).
    var trailingHandle = false
    private var startWidth: CGFloat = 0
    private var startMouseX: CGFloat = 0
    private var cursorArea: NSTrackingArea?
    /// macOS only lets the *active* app change the pointer image, and this
    /// overlay is deliberately non-activating. Hover feedback therefore has to
    /// be drawn, not delegated to the cursor.
    private var isHovered = false

    /// Cursor feedback has to come from an always-active tracking area: this
    /// panel never becomes key (`.nonactivatingPanel`), so plain cursor rects
    /// are not consulted and hovering the edge looked like nothing happened.
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let cursorArea { removeTrackingArea(cursorArea) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .cursorUpdate, .activeAlways],
                                  owner: self,
                                  userInfo: nil)
        addTrackingArea(area)
        cursorArea = area
    }

    override func cursorUpdate(with event: NSEvent) {
        NSCursor.resizeLeftRight.set()
    }

    override func mouseEntered(with event: NSEvent) {
        NSCursor.resizeLeftRight.set()
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        needsDisplay = true
        mover?.setEdgeHover(trailingHandle ? .trailing : .leading, active: false)
        NSCursor.arrow.set()
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        startWidth = window.frame.width
        startMouseX = NSEvent.mouseLocation.x
        mover?.glassPanel?.setEffectActive(false)
    }

    override func mouseDragged(with event: NSEvent) {
        let delta = trailingHandle
            ? NSEvent.mouseLocation.x - startMouseX
            : startMouseX - NSEvent.mouseLocation.x
        mover?.setManualWidth(startWidth + delta, keepRightEdge: !trailingHandle)
    }

    override func mouseUp(with event: NSEvent) {
        mover?.glassPanel?.setEffectActive(true)
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .resizeLeftRight)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let barWidth: CGFloat = isHovered ? 3 : 2
        let alpha: CGFloat = isHovered ? 0.65 : 0.22
        NSColor.white.withAlphaComponent(alpha).setFill()
        let x = trailingHandle ? bounds.maxX - barWidth : 0
        NSBezierPath(roundedRect: NSRect(x: x, y: 8, width: barWidth, height: bounds.height - 16),
                     xRadius: barWidth / 2, yRadius: barWidth / 2).fill()

        guard isHovered else { return }
        // Drawn ↔ badge: the pointer image cannot change for a non-activating
        // panel, so the affordance is rendered into the strip itself.
        let glyph = "↔" as NSString
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 9, weight: .bold),
            .foregroundColor: NSColor.white.withAlphaComponent(0.9),
        ]
        let size = glyph.size(withAttributes: attrs)
        let pill = NSRect(x: trailingHandle ? bounds.maxX - 14 : 2,
                          y: bounds.midY - 8,
                          width: 12,
                          height: 16)
        NSColor.black.withAlphaComponent(0.35).setFill()
        NSBezierPath(roundedRect: pill, xRadius: 4, yRadius: 4).fill()
        glyph.draw(at: NSPoint(x: pill.midX - size.width / 2, y: pill.midY - size.height / 2),
                   withAttributes: attrs)
    }
}

/// SwiftUI bridge for the resize strips (leading and trailing edge).
struct ResizeEdgeStrip: NSViewRepresentable {
    let mover: PanelMover
    var trailing = false

    func makeNSView(context: Context) -> ResizeEdgeView {
        let view = ResizeEdgeView()
        view.mover = mover
        view.trailingHandle = trailing
        return view
    }

    func updateNSView(_ nsView: ResizeEdgeView, context: Context) {
        nsView.mover = mover
        nsView.trailingHandle = trailing
    }
}

/// A vibrancy layer that never intercepts clicks (used as the dock-armed
/// "this row is about to be captured" cover over the panel content).
final class PassThroughEffectView: NSVisualEffectView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// Container that guarantees the layering “glass → content”.
///
/// On macOS 26+ the backdrop is the system's real Liquid Glass
/// (`NSGlassEffectView`), cross-faded from the clear style to the regular
/// (frosted) style by the user's slider. A vibrancy layer sits underneath as
/// the fallback for older systems and to keep text legible when the clear
/// style is very transparent.
final class GlassPanelView: NSView {
    // The window must be free to be resized by us only. Reporting a concrete
    // intrinsic/fitting size makes AppKit's constraint pass resize the window
    // (and rewrite its origin) whenever the SwiftUI content changes, which is
    // what caused the collapsed bar's leftover area and the drift on toggles.
    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }
    override var fittingSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }

    let effectView = NSVisualEffectView()
    let hostingView: NSView
    private var liquidGlass: NSView?
    /// Opaque frosted cover shown while the panel hovers over the dock zone:
    /// hides the rows so the drop target is unmistakable.
    private let frostCover = PassThroughEffectView()
    private var dockArmed = false
    /// Escape hatch for older systems (and for anyone who prefers the classic
    /// vibrancy look): DSH_TL_FORCE_VIBRANCY=1 disables the Liquid Glass path.
    private let forcesVibrancy = ProcessInfo.processInfo.environment["DSH_TL_FORCE_VIBRANCY"] == "1"

    init<Content: View>(rootView: Content) {
        let host = NSHostingView(rootView: AnyView(rootView))
        // PanelMover owns the window size. Without this, NSHostingView adds
        // min/max/intrinsic size constraints from the SwiftUI content, which
        // fight the autoresizing frame whenever the body switches between the
        // collapsed (58pt) and expanded layouts.
        if #available(macOS 13.0, *) {
            host.sizingOptions = []
        }
        self.hostingView = host
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 16
        layer?.masksToBounds = true

        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.frame = bounds
        effectView.autoresizingMask = [.width, .height]
        addSubview(effectView)

        if #available(macOS 26.0, *), !forcesVibrancy {
            let glass = NSGlassEffectView()
            glass.style = .regular
            glass.cornerRadius = 16
            glass.tintColor = NSColor.black.withAlphaComponent(0.2)
            glass.frame = bounds
            glass.autoresizingMask = [.width, .height]
            addSubview(glass)
            liquidGlass = glass
        }

        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor
        hostingView.frame = bounds
        hostingView.autoresizingMask = [.width, .height]
        addSubview(hostingView)

        frostCover.material = .hudWindow
        frostCover.blendingMode = .behindWindow
        frostCover.state = .active
        frostCover.frame = bounds
        frostCover.autoresizingMask = [.width, .height]
        frostCover.alphaValue = 0
        frostCover.isHidden = true
        addSubview(frostCover)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layout() {
        super.layout()
        effectView.frame = bounds
        liquidGlass?.frame = bounds
        hostingView.frame = bounds
        frostCover.frame = bounds
    }

    /// Fade the rows away behind a full frost while the panel is over the dock
    /// zone ("release now to dock").
    func setDockArmed(_ armed: Bool) {
        guard armed != dockArmed else { return }
        dockArmed = armed
        if armed {
            frostCover.isHidden = false
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.12
                frostCover.animator().alphaValue = 1
            }
        } else {
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.12
                frostCover.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                guard let self, !self.dockArmed else { return }
                self.frostCover.isHidden = true
            })
        }
    }

    /// True when the system provides the native Liquid Glass backdrop.
    var usesLiquidGlass: Bool {
        if #available(macOS 26.0, *) { return liquidGlass != nil }
        return false
    }

    /// 0.1 — clear liquid glass; 1.0 — fully frosted glass.
    func applyGlass(level: Double) {
        let clamped = min(1, max(0.1, level))
        if #available(macOS 26.0, *), let glass = liquidGlass as? NSGlassEffectView {
            glass.style = clamped < 0.35 ? .clear : .regular
            glass.tintColor = NSColor.black.withAlphaComponent(0.03 + 0.45 * clamped)
            // A light vibrancy underlay keeps text readable in clear mode.
            effectView.alphaValue = CGFloat(0.20 + 0.22 * clamped)
        } else {
            effectView.alphaValue = CGFloat(0.30 + 0.70 * clamped)
        }
    }

    /// Suspend live blur recomposition while the panel is being moved.
    func setEffectActive(_ active: Bool) {
        effectView.state = active ? .active : .inactive
    }
}

extension NSPanel {
    /// Builds the system-wide floating traffic-light panel.
    ///
    /// Desktop-pet style overlay:
    /// - Borderless + transparent + `nonactivatingPanel` so it never steals focus.
    /// - Level is raised *above* normal/floating app windows (raw 6) but still
    ///   *below* macOS modal/alert windows (≈8), so an approval dialog is never
    ///   hidden behind the light. `hidesOnDeactivate = false` + re-fronting
    ///   observers (see AppDelegate) keep it pinned across every app switch.
    /// - Click-through everywhere except the grip icon (drag) and the close /
    ///   minimize buttons.
    static func trafficLightPanel<Content: View>(rootView: Content) -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 134),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // Above app windows (floating=3) yet below modal alerts (~8).
        panel.level = NSWindow.Level(rawValue: 6)
        panel.ignoresMouseEvents = false // events needed for dragging the grip
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isReleasedWhenClosed = false
        panel.contentView = GlassPanelView(rootView: rootView)

        // Pin the panel size. Assigning a contentViewController makes AppKit
        // resize the window to the hosting view's *initial* fitting size
        // (title "DSH" / empty detail → quite narrow). Later the real title
        // arrives but the window width never follows, so the title bar would
        // be squeezed and the title truncated to "…". Pin explicit min/max so
        // nothing collapses the capsule; PanelMover.fitToContent then widens
        // the panel to fit the actual rows when they change.
        panel.setContentSize(NSSize(width: 300, height: 134))
        panel.minSize = NSSize(width: 300, height: 36)
        panel.maxSize = NSSize(width: 560, height: 400)

        if let screen = NSScreen.main {
            let margin: CGFloat = 16
            let x = screen.visibleFrame.maxX - panel.frame.width - margin
            let y = screen.visibleFrame.maxY - panel.frame.height - margin
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        return panel
    }
}
