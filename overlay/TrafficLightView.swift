import SwiftUI

/// Logical light state (mirrors the dsh-trafficlight wire `TrafficState`).
enum TrafficState: String, Codable {
    case idle
    case running
    case blocked
    case done
    case offline
}

/// One subscribed session row as delivered by the bridge.
struct SessionStatus: Codable, Identifiable, Equatable {
    let sessionId: String
    let title: String
    let state: String
    let detail: String?

    var id: String { sessionId }

    var light: TrafficState { TrafficState(rawValue: state) ?? .idle }
}

/// Wire snapshot returned by the bridge at http://127.0.0.1:18765/state.
struct TrafficSnapshot: Codable {
    let state: String
    let title: String
    let sessions: [SessionStatus]
    let subscribed: [String]?
    let opacity: Double?
    let minimalMode: Bool?
    let breathCount: Int?
    let breathBeat: Double?
    let detail: String?
    let mode: String?
    let soundEnabled: Bool?
    let soundVolume: Double?
    let updatedAt: Int
}

/// Drawn resize affordance. macOS ignores cursor changes from non-activating
/// panels, so the edge itself lights up with a bar and a “↔” badge on hover.
private struct EdgeResizeHint: View {
    let trailing: Bool

    var body: some View {
        HStack(spacing: 6) {
            if trailing {
                Spacer(minLength: 0)
                pill
                bar
            } else {
                bar
                pill
                Spacer(minLength: 0)
            }
        }
        .frame(maxHeight: .infinity)
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private var bar: some View {
        RoundedRectangle(cornerRadius: 1.5)
            .fill(Color.white.opacity(0.62))
            .frame(width: 3)
            .padding(.vertical, 12)
    }

    private var pill: some View {
        Text("↔")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white.opacity(0.95))
            .frame(width: 20, height: 20)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.5)))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white.opacity(0.25), lineWidth: 1))
    }
}

struct TrafficLightView: View {
    @EnvironmentObject private var client: StatusClient
    @EnvironmentObject private var mover: PanelMover
    @State private var minimized = false
    /// Bumped when the latest big-lamp state changes; drives the minimal lamp's breathing.
    @State private var latestBreath = 0

    /// Rows shown without scrolling before the panel caps its height.
    private let maxVisibleRows = 6
    private let rowHeight: CGFloat = 36

    private var statusLabel: String {
        if client.sessions.isEmpty {
            return "未订阅会话"
        }
        switch client.state {
        case .blocked: return "有会话阻塞 · 等待处理"
        case .running: return "任务执行中"
        case .done: return "全部完成"
        case .idle: return "等待开始"
        case .offline: return "未连接 DSH"
        }
    }

    // ── Liquid-glass backing ─────────────────────────────────────────────
    // The slider is a "glass density": low values leave the vibrancy almost
    // clear (transparent glass), high values tint it into a fully frosted
    // surface. The real blur comes from the NSVisualEffectView behind the
    // SwiftUI layer; this tint is what the user can tune.
    private var glassLevel: Double { min(1, max(0.1, client.opacity)) }
    private var glassTint: Double {
        // Liquid Glass already supplies most of the backdrop; the fallback
        // vibrancy path needs the heavier tint to stay readable.
        mover.usesLiquidGlass ? 0.10 + 0.42 * glassLevel : 0.12 + 0.72 * glassLevel
    }
    private var glassHighlight: Color { Color.white.opacity(0.04 + 0.05 * glassLevel) }

    private var glassBackground: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(glassTint))
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LinearGradient(colors: [glassHighlight, Color.clear],
                                     startPoint: .top,
                                     endPoint: .center))
        }
    }

    var body: some View {
        (client.minimalMode
            ? AnyView(minimalBody)
            : (minimized ? AnyView(minimizedBody) : AnyView(fullBody)))
            // Pin the content to the top edge. If the hosting view's layout is
            // ever a frame behind the window size, the content now overflows
            // at the bottom instead of being centred and clipped at the top.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .onAppear {
                mover.setMinimal(client.minimalMode)
                mover.fitToContent(client.sessions)
            }
            .onChange(of: client.sessions) { newSessions in
                mover.fitToContent(newSessions)
            }
            .onReceive(client.$opacity) { value in
                mover.setGlassLevel(value)
            }
            .onChange(of: client.minimalMode) { newValue in
                mover.setMinimal(newValue)
            }
            .onChange(of: minimized) { newValue in
                // Resize the window on the next runloop, outside SwiftUI's view
                // update. Resizing synchronously here left NSHostingView laying
                // out the new body with the previous height (58 <-> 83), which
                // clipped the title on expand and shifted the bar on collapse.
                DispatchQueue.main.async {
                    mover.setMinimized(newValue)
                }
            }
    }

    /// Collapsed layout: one compact, fixed-height bar. Its required height
    /// matches the window's collapsed height, otherwise AppKit's constraint
    /// layout grows the window (leaving an empty frosted area) and shifts the
    /// top edge on every toggle.
    private var minimizedBody: some View {
        HStack(spacing: 8) {
            NativeDragStrip(size: 20)
                .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(client.sessions.isEmpty ? "DSH 红绿灯" : statusLabel)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                Text(subtitle)
                    .font(.system(size: 9.5))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            statusDot
            dockButton
            minimizeButton
            closeButton
        }
        .padding(.horizontal, 10)
        .frame(height: 50)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.45))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(4)
    }

    /// Full layout: persistent title bar + subscribed-session rows.
    private var fullBody: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                NativeDragStrip(size: 22)
                    .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(client.sessions.isEmpty ? "DSH 红绿灯" : statusLabel)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white.opacity(0.9))
                    Text(subtitle)
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.55))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if minimized {
                    statusDot
                }
                dockButton
                minimizeButton
                closeButton
            }
            .padding(.leading, 10)
            .padding(.trailing, 18)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 34)

            if !minimized {
                Rectangle()
                    .fill(Color.white.opacity(0.12))
                    .frame(height: 1)
                    .padding(.horizontal, 10)

                if client.sessions.isEmpty {
                    emptyState
                } else {
                    rows
                }
            }
        }
        .padding(4)
        .frame(maxWidth: .infinity)
        .background(glassBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .leading) {
            ResizeEdgeStrip(mover: mover)
                .frame(width: 14)
                .frame(maxHeight: .infinity)
                .help("拖动左边缘调整宽度")
        }
        .overlay(alignment: .trailing) {
            ResizeEdgeStrip(mover: mover, trailing: true)
                .frame(width: 14)
                .frame(maxHeight: .infinity)
                .help("拖动右边缘调整宽度")
        }
        .overlay(alignment: .leading) {
            if mover.hoveredEdge == .leading { EdgeResizeHint(trailing: false) }
        }
        .overlay(alignment: .trailing) {
            if mover.hoveredEdge == .trailing { EdgeResizeHint(trailing: true) }
        }
    }

    /// Minimal layout (极简模式): drag handle + a single large lamp + close.
    /// The lamp shows the most recently-updated state across all subscribed
    /// sessions, regardless of which session it came from.
    private var minimalBody: some View {
        HStack(spacing: 12) {
            NativeDragStrip(size: 22)
                .frame(width: 22, height: 22)
            BreathingLamp(
                color: client.latestState.lampColor,
                active: !client.sessions.isEmpty && client.latestState != .offline,
                size: 40,
                breath: latestBreath,
                breaths: client.breathCount,
                beatDuration: client.breathBeat,
                continuous: client.latestState == .running || client.latestState == .blocked,
                continuousPeriod: client.latestState == .blocked ? 1.0 : 2.0,
                continuousScale: client.latestState == .blocked ? 1.30 : 1.15,
                alert: client.latestState == .blocked
            )
            .onChange(of: client.latestState) { _ in
                latestBreath += 1
            }
            .help("最近状态：" + client.latestState.statusText)
            // Close collapses everything — no minimize button in minimal mode.
            closeButton
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(minWidth: 0)
        .background(glassBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// Second line of the header: session count + aggregate title.
    private var subtitle: String {
        let count = client.sessions.count
        if count == 0 { return "在 DSH 会话菜单中添加订阅" }
        let running = client.sessions.filter { $0.light == .running }.count
        let blocked = client.sessions.filter { $0.light == .blocked }.count
        var parts = ["\(count) 个订阅"]
        if running > 0 { parts.append("\(running) 执行中") }
        if blocked > 0 { parts.append("\(blocked) 阻塞") }
        return parts.joined(separator: " · ")
    }

    private var emptyState: some View {
        HStack(spacing: 8) {
            Lamp(color: .gray, active: false, size: 20)
            Text("暂无订阅会话\n在 DSH 会话右侧「…」菜单选择「添加订阅」")
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(height: 52)
    }

    private var rows: some View {
        let all = client.sessions
        let visible = Array(all.prefix(maxVisibleRows))
        let showMore = all.count > maxVisibleRows
        return VStack(spacing: 0) {
            ForEach(visible) { session in
                SessionRow(
                    session: session,
                    changeTick: client.stateChangeTick[session.sessionId] ?? 0,
                    breaths: client.breathCount,
                    beatDuration: client.breathBeat,
                    onOpen: { client.openSession(session.sessionId) }
                ) {
                    client.unsubscribe(session.sessionId)
                }
                if session.id != visible.last?.id {
                    Rectangle()
                        .fill(Color.white.opacity(0.12))
                        .frame(height: 1)
                        .padding(.leading, 44)
                }
            }
            if showMore {
                Text("还有 \(all.count - maxVisibleRows) 个订阅 · 请展开菜单管理")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.5))
                    .padding(.vertical, 5)
                ScrollView {
                    ForEach(all.dropFirst(maxVisibleRows)) { session in
                        SessionRow(
                            session: session,
                            changeTick: client.stateChangeTick[session.sessionId] ?? 0,
                            breaths: client.breathCount,
                            beatDuration: client.breathBeat,
                            onOpen: { client.openSession(session.sessionId) }
                        ) {
                            client.unsubscribe(session.sessionId)
                        }
                    }
                }
                .frame(height: CGFloat(all.count - maxVisibleRows) * rowHeight)
            }
        }
    }
}

/// One subscribed session: lamp + title + state line (+ transient detail when
/// blocked) + unsubscribe. The lamp breathes on every recorded state/detail
/// change (monotonic tick), then settles back to resting.
private struct SessionRow: View {
    let session: SessionStatus
    /// Bumped by StatusClient on every recorded state/detail change.
    let changeTick: Int
    /// Breathing config from settings (forwarded to the lamp).
    let breaths: Int
    let beatDuration: TimeInterval
    let onOpen: () -> Void
    let onUnsubscribe: () -> Void

    /// Bumped whenever a change arrives; drives the breathing lamp.
    @State private var breath = 0
    private let lampSize: CGFloat = 21

    var body: some View {
        HStack(spacing: 9) {
            BreathingLamp(
                color: session.light.lampColor,
                active: session.light != .idle && session.light != .offline,
                size: lampSize,
                breath: breath,
                breaths: breaths,
                beatDuration: beatDuration,
                continuous: session.light == .running || session.light == .blocked,
                continuousPeriod: session.light == .blocked ? 0.9 : 1.8,
                continuousScale: session.light == .blocked ? 1.38 : 1.20,
                alert: session.light == .blocked
            )
            .onChange(of: changeTick) { _ in
                breath += 1
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(session.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Text(session.statusText)
                    .font(.system(size: 10))
                    .foregroundColor(session.light.lampColor.opacity(0.9))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onUnsubscribe) {
                Image(systemName: "minus.circle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.45))
                    .frame(width: 20, height: 20)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(5)
            }
            .buttonStyle(.plain)
            .help("取消订阅此会话")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(height: 36)
        .contentShape(Rectangle())
        .onTapGesture { onOpen() }
        .help("打开此会话")
    }
}

/// Per-row status line: always visible, colored by the light state.
private extension SessionStatus {
    var statusText: String {
        switch light {
        case .blocked:
            return detail?.isEmpty == false ? detail! : "阻塞 · 等待处理"
        case .running:
            return "执行中"
        case .done:
            return "已完成 · 待指示"
        case .idle:
            return "等待开始"
        case .offline:
            return "未连接"
        }
    }
}

private extension TrafficState {
    var lampColor: Color {
        switch self {
        case .blocked: return Color.red
        case .running: return Color.yellow
        case .done: return Color.green
        case .idle: return Color.gray
        case .offline: return Color.gray
        }
    }

    /// Short label for a bare light state (used by the minimal-mode tooltip).
    var statusText: String {
        switch self {
        case .blocked: return "阻塞 · 等待处理"
        case .running: return "执行中"
        case .done: return "已完成"
        case .idle: return "等待开始"
        case .offline: return "未连接"
        }
    }
}

extension TrafficLightView {
    /// Top-right close affordance. Same interactive strip as the grip
    /// (see TrafficLightHostingView.interactiveZones).
    private var closeButton: some View {
        Button {
            client.closeOverlay()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white.opacity(0.6))
                .frame(width: 18, height: 18)
                .background(Color.white.opacity(0.08))
                .cornerRadius(5)
        }
        .buttonStyle(.plain)
        .help("关闭红绿灯（取消所有订阅）")
    }

    /// Minimize / expand toggle: hides (or restores) the row list,
    /// leaving only the persistent title bar.
    /// Dock the traffic light into the DSH sidebar (the in-page twin shows up
    /// in the official `sidebar.footer.action` slot) and hide this panel.
    private var dockButton: some View {
        Button {
            client.setMode("docked")
        } label: {
            Image(systemName: "sidebar.left")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.white.opacity(0.7))
                .frame(width: 18, height: 18)
                .background(Color.white.opacity(0.08))
                .cornerRadius(5)
        }
        .buttonStyle(.plain)
        .help("固定到 DSH 侧边栏")
    }

    private var minimizeButton: some View {
        Button {
            // No withAnimation here: the layout animation makes AppKit's
            // constraint pass resize the window and shift its origin.
            minimized.toggle()
        } label: {
            Image(systemName: minimized ? "plus" : "minus")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white.opacity(0.6))
                .frame(width: 18, height: 18)
                .background(Color.white.opacity(0.08))
                .cornerRadius(5)
        }
        .buttonStyle(.plain)
        .help(minimized ? "展开红绿灯" : "隐藏红绿灯")
    }

    /// Tiny state dot — only shown in the title bar while minimized.
    private var statusDot: some View {
        Circle()
            .fill(labelColor)
            .frame(width: 8, height: 8)
            .shadow(color: labelColor, radius: 4, x: 0, y: 0)
    }

    private var labelColor: Color {
        switch client.state {
        case .blocked: return Color.red
        case .running: return Color.yellow
        case .done: return Color.green
        case .idle: return Color.white.opacity(0.6)
        case .offline: return Color.gray
        }
    }
}

struct Lamp: View {
    let color: Color
    let active: Bool
    var size: CGFloat = 16

    var body: some View {
        Circle()
            .fill(active ? color : color.opacity(0.16))
            .frame(width: size, height: size)
            .shadow(color: active ? color : .clear, radius: active ? size * 0.45 : 0, x: 0, y: 0)
            .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 1))
    }
}

/// A lamp that "breathes" when its underlying state changes: instead of the old
/// one-shot size jump, it scales up and back down a few beats, then settles at
/// its resting size. `breath` is a monotonic counter that a parent increments
/// on each state change — every increment starts one breathing cycle.
struct BreathingLamp: View {
    let color: Color
    let active: Bool
    let size: CGFloat
    /// Bump to retrigger the cycle (row / minimal lamp counts state changes).
    let breath: Int
    /// How many up-and-down beats per state change.
    var breaths: Int = 3
    /// One beat = scale up over `beat`, hold, then scale back over `beat`.
    var beatDuration: TimeInterval = 0.35
    /// Gentle continuous breathing while the task is still running (or blocked).
    var continuous: Bool = false
    var continuousPeriod: Double = 1.8
    var continuousScale: CGFloat = 1.08
    /// Blocked state: adds an expanding ring so the red lamp is unmistakable.
    var alert: Bool = false

    @State private var scale: CGFloat = 1
    @State private var cycleTask: Task<Void, Never>?

    var body: some View {
        // Use scaleEffect for visual scaling — changing `size` directly would
        // trigger a layout pass that deforms the panel's rounded corners.
        ZStack {
            if continuous {
                ContinuousBreathing(period: continuousPeriod, amplitude: continuousScale) {
                    Lamp(color: color, active: active, size: size)
                }
            } else {
                Lamp(color: color, active: active, size: size)
            }
            if alert {
                AlertRipple(color: color, size: size)
            }
        }
            .scaleEffect(scale)
            .onChange(of: breath) { newValue in
                guard newValue > 0 else { return }
                cycleTask?.cancel()
                let fresh = Task { @MainActor in
                    await runCycle()
                }
                cycleTask = fresh
            }
            .onDisappear { cycleTask?.cancel() }
    }

    /// Scale up then settle to rest, `breaths` times, using a natural ease.
    @MainActor
    private func runCycle() async {
        for _ in 0..<breaths {
            withAnimation(.easeInOut(duration: beatDuration)) { scale = 1.35 }
            try? await Task.sleep(for: .seconds(beatDuration))
            withAnimation(.easeInOut(duration: beatDuration)) { scale = 1 }
            try? await Task.sleep(for: .seconds(beatDuration))
        }
        scale = 1
    }
}

/// Expanding, fading ring for the blocked state. Clock-driven for the same
/// reason as ContinuousBreathing (a repeating SwiftUI animation is reset by the
/// 0.7 s status poll).
private struct AlertRipple: View {
    let color: Color
    let size: CGFloat
    private let cycle: Double = 0.9

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let phase = (t.truncatingRemainder(dividingBy: cycle)) / cycle
            Circle()
                .stroke(color.opacity(0.7), lineWidth: 2)
                .frame(width: size, height: size)
                .scaleEffect(1.0 + 1.1 * phase)
                .opacity(1.0 - phase)
        }
        .allowsHitTesting(false)
    }
}

/// Slow, ever-running “breathing”. Rendered only while a task is active, so
/// leaving the running/blocked state tears the TimelineView down with it.
///
/// A `repeatForever` animation started in `onAppear` did not survive the
/// overlay's 0.7 s status poll (each re-render restarted it), so the scale is
/// derived from the clock on every frame instead — re-renders cannot cancel it.
private struct ContinuousBreathing<Content: View>: View {
    let period: Double
    let amplitude: CGFloat
    let content: Content

    init(period: Double, amplitude: CGFloat, @ViewBuilder content: () -> Content) {
        self.period = period
        self.amplitude = amplitude
        self.content = content()
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let phase = 0.5 + 0.5 * sin(2 * .pi * t / period)
            content.scaleEffect(1 + (amplitude - 1) * phase)
        }
    }
}

/// SwiftUI-embedded native drag strip for the grip icon. AppKit mouse events
/// (mouseDown / mouseDragged / mouseUp) move the window directly — no SwiftUI
/// gesture round-trip — and because it is placed by SwiftUI layout it always
/// exists. The strip draws the three-line handle glyph itself and only occupies
/// the icon's footprint, so only the icon drags the window.
struct NativeDragStrip: NSViewRepresentable {
    @EnvironmentObject private var mover: PanelMover
    var size: CGFloat = 30

    func makeNSView(context: Context) -> GripDragView {
        let view = GripDragView()
        view.mover = mover
        return view
    }

    func updateNSView(_ nsView: GripDragView, context: Context) {
        nsView.mover = mover
    }
}