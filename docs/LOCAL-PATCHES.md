# dsh-trafficlight 悬浮窗防消失补丁

插件：`@chivaskong96/dsh-trafficlight@0.3.0`（npm 发布包）
文件：`overlay/TrafficLightApp.swift`
修改位置：`AppDelegate.setupAlwaysOnTop()`

## 问题

已订阅会话在 Web 端正常，菜单栏 🚦 图标也在，但 macOS 悬浮面板偶尔不可见。
原因：面板 level=6，切到全屏应用 / Stage Manager 桌面切换 / 其他应用置顶时可能被盖住且不再恢复；
或外接显示器断开后，保存的窗口坐标不再落在任何屏幕上，面板被移到屏幕外。

## 修复内容

1. 在 `setupAlwaysOnTop()` 里新增一个每 2 秒触发的定时器，主线程调用
   `panel.orderFrontRegardless()`，让面板周期性重新置顶。
2. 新增 `ensureOnScreen(_:)`：若面板 frame 不与任何屏幕的 visibleFrame 相交，
   则把它移回主屏右上角（保留 16pt 边距）。

## 完整替换代码

把 `setupAlwaysOnTop()` 整段替换为：

```swift
    /// Keep the panel pinned on top across every app-switch / space change.
    private func setupAlwaysOnTop() {
        let center = NotificationCenter.default
        let reFront = { [weak self] in self?.panel?.orderFrontRegardless() }
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
                panel.orderFrontRegardless()
                self.ensureOnScreen(panel)
            }
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
```

## 重新应用步骤

插件升级或重装会覆盖该文件。重新应用：

1. 按上面替换 `overlay/TrafficLightApp.swift` 的 `setupAlwaysOnTop()`。
2. 重新编译：

```bash
DSH_TL_OVERLAY_SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.2.sdk \
  bash "$HOME/.dsh/profiles/desktop/node_modules/@chivaskong96/dsh-trafficlight/overlay/build.sh"
```

3. 重启悬浮窗：

```bash
bash "$HOME/.dsh/profiles/desktop/node_modules/@chivaskong96/dsh-trafficlight/scripts/trafficlight.sh" --restart
```

本机环境：Swift 6.2.4 + macOS 26.2 SDK（不要用 build.sh 默认的 15.4 SDK，会与编译器不匹配）。

---

## 补丁二：订阅按钮在暗色模式下看不清文字

文件：`lib/client.js`（运行时实际加载）和 `src/client/index.tsx`（源码），`SubscribeAction` 按钮的 `style`。

问题：未订阅时按钮文字色用了 `var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))`，但该 CSS 变量在会话头部 slot 里未生效，回退到半透明黑色，暗色背景上几乎不可见。

修复：改为不依赖主题变量、明暗背景都清晰的颜色。把按钮 style 里这三行替换为：

```js
border: "1px solid " + (active ? "#5b8cff" : "rgba(128,128,128,0.45)"),
background: active ? "rgba(91,140,255,0.14)" : "transparent",
color: active ? "#5b8cff" : "currentColor",
```

（TSX 源码里用单引号，值相同。）`currentColor` 让未订阅文字继承会话头部的主题文字色，明暗模式都跟随主题；已订阅用亮蓝色。

生效：改 `lib/client.js` 后刷新 DSH 页面即可（client bundle 由前端模块加载器加载）。若之后执行 `build:client` 重建，需确保 `src/client/index.tsx` 已同步修改（本补丁已同步）。

---

## 补丁三：点击浮窗会话行跳转回对应对话

改动文件：
- `lib/host/bridge.js`（实际运行）+ `src/host/bridge.ts`（源码）
- `lib/client.js`（实际运行）+ `src/client/index.tsx`（源码）
- `overlay/StatusClient.swift`
- `overlay/TrafficLightView.swift`

链路：
1. Swift 会话行 `.onTapGesture { client.openSession(session.sessionId) }`。
2. `StatusClient.openSession(_:)` 向 `POST http://127.0.0.1:18765/focus` 提交 `{ sessionId }`；仅当桥返回 `202` 时 `NSWorkspace.shared.open(URL(string: "dsh://open")!)` 唤起桌面窗口。
3. Host bridge 的 `/focus` 只接受当前已订阅的会话 ID，压入一个有界队列（最多 32 条）。Web 路由 `GET /api/dsh-tl/focus` 一次性取出队列中的会话 ID。
4. Web client 每 800ms 轮询 `/api/dsh-tl/focus`，拿到会话 ID 后调用 `uiWorkspace.openSession(id)`；旧宿主回退到 `sessions.open(id)`；`apply()` dispose 时 `clearInterval`。

重要：DSH Desktop 只支持 `dsh://open` 唤起窗口，不支持携带 sessionId；精确会话跳转必须靠上面的本地桥 + Web client。`@chivaskong96/dsh-trafficlight@0.3.0` 的 npm 包缺少可重建的 devDependencies（`@deepseek-ai/dsh-client-runtime@^0.1.5-rc.1` 已从 npm 移除），所以本机直接补丁实际加载的 `lib/*.js` 并同步源码。

重新应用：
- Host 改动需停用/启用 bundle（或重启 DSH）后加载：对 Loader entryId `include:dsh-trafficlight` disable 再 enable。
- Web client 改动需刷新 DSH 页面。
- Swift overlay 重新编译并 restart：
  `DSH_TL_OVERLAY_SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.2.sdk bash overlay/build.sh`
  `bash scripts/trafficlight.sh --restart`

验证要点：
- `POST http://127.0.0.1:18765/focus` 对已订阅会话应返回 `202 {"ok":true}`，未订阅返回 `404`。
- `GET http://127.0.0.1:<webPort>/api/dsh-tl/focus` 应能取到刚提交的 `sessionId`，再次取为 `null`。

---

## 补丁四：右边缘拖拽调整悬浮窗宽度（普通模式）

改动文件：
- `overlay/TrafficLightApp.swift`：PanelMover 增加 `manualWidthKey = "dsh_tl_manual_width"`、`minWidth = 300`、`maxWidth = 560`、`manualWidth`、`isMinimal`；初始化读取已保存宽度；`setMinimal(_:)` 记录模式；新增 `setManualWidth(_:)`；`fitToContent(_:)` 普通模式使用 `manualWidth ?? neededWidth`，极简模式不改尺寸。
- `overlay/TrafficLightWindow.swift`：新增 `ResizeEdgeView: NSView` 与 `ResizeEdgeStrip: NSViewRepresentable`。鼠标按下记录起始宽度与鼠标 X；拖动时 `startWidth + (startMouseX - NSEvent.mouseLocation.x)` 调整宽度（保持右上锚点）；`resetCursorRects` 使用 `resizeLeftRight` 光标；绘制右侧半透明细条。
- `overlay/TrafficLightView.swift`：普通模式 fullBody 右边缘叠加 `ResizeEdgeStrip`，宽 10pt，顶部 padding 38pt（避开关闭/最小化按钮），鼠标提示“拖动调整宽度”；极简模式不显示把手。

用户行为：普通模式拖动悬浮窗右边缘即可改宽，范围 150–560pt；宽度保存到 UserDefaults，标题或订阅变化不再覆盖手动宽度。极简模式仍固定小尺寸。默认自动宽度为 165pt（用户最终调好的宽度约 164.74pt，取整为 165pt），最小宽度为 150pt，最大宽度为 560pt（原默认/最小均为 300pt）。若要恢复自动宽度：退出悬浮窗后清除该 App 的 `dsh_tl_manual_width` 默认值，或在新版本里提供重置入口。

本机已执行：`defaults delete TrafficLightOverlay dsh_tl_manual_width`，删除旧的 300pt 手动宽度，使 150pt 默认值立即生效。重新编译与重启命令同补丁三。

---

## 补丁五：悬浮窗标题使用真实对话标题并跨重启保留

改动文件：`lib/host/subscriptions.js`（实际运行）+ `src/host/subscriptions.ts`（源码）；`lib/host/status.js`（实际运行）+ `src/host/status.ts`（源码）。

问题：订阅文件只保存会话 ID；重启后非活动会话未进入 live session store，标题无法回填，且旧占位符 `sessionId.slice(0, 8)` 对所有会话都得到 `会话 session-`，无法区分。

修复：
- `SubscriptionStore` 增加 `titles: Map<string,string>`，兼容旧数组格式和新对象格式：
  ```json
  {
    "subscriptions": ["session-id"],
    "titles": { "session-id": "真实标题" }
  }
  ```
- `title(sessionId)` 优先返回缓存标题；没有时读取 DSH 会话标题投影缓存：
  `~/.dsh/storages/session_projcache/sessions/<sessionId>.json` 的 `record.rows.title.val`。
- `setTitle(sessionId,title)` 在 sessionTitle 服务、`session/title` 事件或首条用户消息解析出标题后保存。
- `StatusMachine.snapshot()` 对非活动订阅会话使用缓存标题并显示绿灯；活动会话仍优先使用 `ctx.sessionTitle.get(session)` 的结果。
- `placeholderTitle()` 改用会话 ID 后 8 位，避免全是 `会话 session-`。

验证结果：bridge `/state` 返回两个真实标题：`test插件` 与 `💻 Yayi-B端`；持久化文件同时包含两个订阅 ID 与标题，重启/重载后可恢复。

标题优先级修正：`SubscriptionStore.title()` 每次都先读 DSH 会话标题投影 `~/.dsh/storages/session_projcache/sessions/<id>.json` 的 `record.rows.title.val`，再回退到持久化标题；`StatusMachine.snapshot()` 只有 `t.titleAuthoritative` 为真时才使用活动会话的 `t.sessionTitle`。避免新用户消息把真实标题覆盖成消息原文。此前缓存被消息原文污染时，需要把订阅文件 `titles` 中的对应值纠正为投影标题，或等待下一次投影刷新。

---

# 0.4.0 交互与渲染补丁

## 1. 点击会话行恢复窗口

**问题**：`StatusClient.openSession` 在 `/focus` 成功后执行 `NSWorkspace.shared.open(dsh://open)`，
DSH Desktop NEXT 的 Info.plist 没有 `CFBundleURLTypes`，系统弹「没有应用可打开 URL dsh://open」。

**修复**：改用 LaunchServices 重新打开（等价点 Dock 图标），DSH 的 `app.on("activate", openMain)`
会执行 `show(window)`，其中包含 `window.restore()`，可同时还原最小化窗口：

```swift
let config = NSWorkspace.OpenConfiguration()
config.activates = true
config.createsNewApplicationInstance = false
NSWorkspace.shared.openApplication(at: appURL, configuration: config) { app, _ in
  if app == nil { activateRunning(bundleId) }   // 兜底
}
```

文件：`overlay/StatusClient.swift`（`raiseDesktopApp`）。

## 2. 部署目标 macOS 13

**问题**：DSH 最低支持 macOS 13，但二进制 minos=14，且代码用了 macOS 14 的两参数 `onChange`。

**修复**：`overlay/Package.swift` 改为 `.macOS(.v13)`；`TrafficLightView.swift` 中 6 处
`.onChange(of:) { _, new in }` 改为单参数闭包（macOS 11 API）。

## 3. 呼吸触发与持续呼吸

**问题**：① 行内呼吸由 `recent`（6 秒窗口布尔值）触发，两次变化间隔小于 6 秒时无 false→true 跳变，
呼吸被跳过；② `repeatForever` 动画被 0.7s 状态轮询的重渲染重置，灯几乎不动。

**修复**：① `StatusClient` 维护 `stateChangeTick`（每会话单调计数），行内 `.onChange(of: changeTick)`；
② 持续呼吸改为 `TimelineView(.animation)` 按时间计算缩放（`ContinuousBreathing`），红灯光环同理
（`AlertRipple`，0.9s 扩散一圈）。

## 4. 缩放交互

- 左把手：`setManualWidth(width, keepRightEdge: true)`，右边缘固定；
- 右把手：`keepRightEdge: false`，左边缘固定；
- 悬停：始终生效的 tracking area + 绘制的亮条与 ↔ 徽章（非激活面板无法改系统光标）。

文件：`overlay/TrafficLightWindow.swift`、`overlay/TrafficLightView.swift`、`overlay/TrafficLightApp.swift`。

## 5. Liquid Glass 底座

- 面板内容改为 `GlassPanelView`：磨砂层 → 玻璃着色 → 内容，修掉"磨砂层盖住 SwiftUI 背景导致透明度无效"；
- macOS 26+ 用 `NSGlassEffectView`（`if #available`），`tintColor` 随滑块变化，`clear`/`regular` 两档；
- 旧系统回退 `NSVisualEffectView`；`DSH_TL_FORCE_VIBRANCY=1` 可强制兜底。

## 6. 归位模式（floating ↔ docked）

- `settings.ts` 增加 `mode` 持久化与 `clampMode`；
- `status.ts` 快照增加 `mode` / `dockHealthy`，`setMode` 带 12s 自动回退安全网，`attach` 带
  15s 重启安全网；
- `bridge.ts` 增加 `/mode`（独立桥）、`/api/dsh-tl/mode`、`POST /api/dsh-tl/focus`、
  `/api/dsh-tl/dockbeat`；
- 客户端 `sidebar.footer.action` 槽位渲染常驻虚线占位（`docked` 时渲染真实面板），占位在布局流里，
  列表底部止于其上缘；
- 悬浮窗拖入判定区（侧栏底部、账号行上方）时显示全磨砂提示，松手归位；`endDrag` 用鼠标落点判定。

---

# 0.4.1 修复：折叠漂移与关闭后的订阅同步

## 折叠后残留磨砂区、反复折叠向上漂移

**问题**：根因不在 `fitToContent`，而是 **AppKit 的约束布局**。折叠时窗口被约束系统
`_changeWindowFrameFromConstraintsIfNecessary` 强制撑到内容的最小高度（实测 58pt），并同时改写窗口
原点；于是折叠后留下空磨砂区、反复切换时顶边逐次上移，拖动松手后又会补一次跳位。

**修复**：
- 折叠态改用**独立紧凑布局** `minimizedBody`（固定 50pt 内容 + 4pt 外边距 = 58pt），其固有高度与
  窗口折叠高度一致，约束系统不再改窗口；
- `minimizedHeight` 从 40 调整为 58；
- `PanelMover` 记录 `isMinimized`：折叠时自动适配只更新恢复高度、不改窗口尺寸；极简模式直接跳过；
- 折叠高度取当前实际窗口高度，展开后再对齐一次内容；
- 按钮切换不再使用 `withAnimation`：布局动画会触发 AppKit 的约束重排并改写窗口原点；
- `setMinimized` 在下一个 runloop 重新断言目标高度与顶边，抵消约束系统的二次改写。

> 调试方法：给 `NSPanel` 子类覆盖 `setFrame(_:display:)` 打印调用栈，可以看到窗口被
> `-[NSWindow(NSConstraintBasedLayoutInternal) _changeWindowFrameFromConstraintsIfNecessary]`
> 改写；这正是"折叠残留磨砂区 + 顶边漂移"的来源。

### 最终修复：不再向窗口暴露内容的固有尺寸

约束重排的触发源是 `GlassPanelView` 作为 `contentView` 时暴露的 `fittingSize`/`intrinsicContentSize`：
SwiftUI 内容一变，AppKit 就按这个尺寸调整窗口并改写原点。修复：

```swift
override var intrinsicContentSize: NSSize {
    NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
}
override var fittingSize: NSSize {
    NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
}
```

修复后同一调用栈不再出现，窗口只由我们自己的代码设置。配合折叠态固定 58pt 布局、按钮取消
`withAnimation`、以及下一 runloop 的顶边重新断言，连续切换与拖动后释放都不再漂移。

## 关闭红绿灯后「已订阅」不同步

**问题**：头部订阅按钮只在挂载时读一次订阅集合，悬浮窗里取消订阅后不会刷新；而关闭按钮只是退出
悬浮窗进程，订阅仍然保留。

**修复**：
- 头部按钮每 2 秒刷新一次订阅集合，任何入口（悬浮窗行内取消、侧栏面板 ✕）都能同步；
- 关闭按钮改为「取消全部订阅后退出」，下次订阅会自动重新拉起悬浮窗；
- 菜单栏新增「显示悬浮窗 / 隐藏悬浮窗」，取消订阅前也可只隐藏窗口。


## 实机日志确认与三处附带修复

给真实运行的面板加上 `setFrame` 调用栈日志后确认：

- 屏蔽内容固有尺寸前：每次折叠都出现
  `-[NSWindow(NSConstraintBasedLayoutInternal) _changeWindowFrameFromConstraintsIfNecessary]`；
- 屏蔽后：折叠/展开 6 轮、主副屏各一轮，**0 次约束改写**，顶边坐标全程不变；
- 拖动：指针位移 +50/+30，松手后窗口落点就是松手位置，无补跳。

附带发现并修复：

1. **启动位置被重置**：第一个模式快照被当成「从归位状态恢复」，调用了 `restoreAfterUndock()`，
   把刚恢复的位置又改回默认点。现在只有真正从 docked 切回 floating 才恢复。
2. **保存的位置从未生效**：`UserDefaults` 返回的数字数组整体桥接成 `[CGFloat]`/`[NSNumber]`
   会失败（元素可能是 NSNumber/Int/String），解码失败后静默忽略。改为逐元素兼容解码。
3. **默认位置总在主屏**：`defaultOrigin` 优先用鼠标所在屏幕，避免多显示器时灯跑到另一块屏。
4. **宽度适配算错**：`dw` 用 `targetWidth` 计算却把宽度设成 `neededWidth`，用户手动拉宽后
   每次自动适配都会横移一段；现在直接把宽度设为 `targetWidth`。

---

# 0.4.2 复盘：横向跳动与排版错位

## 展开 / 拖动松手后每次左移 23pt

- **定位**：录屏逐帧量绿灯坐标，`-` 折叠不位移，`+` 展开每次 −23pt，拖动松手每次 −22~−24pt；
  23 ≈ `manualWidth(300.58) − neededWidth(277.6)`。
- **根因**：`fitToContent` 里 `dw` 用 `targetWidth` 计算，宽度却写成了 `neededWidth`，
  位移和实际宽度不一致。用户手动拉过宽度（UserDefaults 里有 `dsh_tl_manual_width`）才会触发，
  干净环境不会复现。
- **修复**：宽度直接设为 `targetWidth`，第一次对齐后 `dw = 0`。

## 展开后标题被裁、底部空磨砂带；折叠条下移 12.5pt

- **定位**：量渲染像素发现窗口 frame 是对的，但 SwiftUI 卡片整体上移约 12.5pt；
  12.5 = (83 − 58) / 2，指向"SwiftUI 仍按旧高度居中排版"。
- **根因**：在 SwiftUI 的 `.onChange` 里同步改窗口尺寸，`NSHostingView` 尚未按新尺寸重排，
  沿用上一个状态的高度；原有异步补救只检查 frame，frame 已正确所以不会触发重排。
- **修复**：
  1. `.onChange` 改到下一 runloop 调 `setMinimized`；
  2. 新增 `relayoutContent()`，改完尺寸后强制 hosting view 重排；
  3. `NSHostingView.sizingOptions = []`，窗口尺寸完全由 `PanelMover` 管理；
  4. 根视图 `.frame(..., alignment: .top)` 兜底，排版滞后时也只裁底部。
