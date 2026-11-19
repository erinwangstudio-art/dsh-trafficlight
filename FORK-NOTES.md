# dsh-trafficlight fork notes

这是基于 `@chivaskong96/dsh-trafficlight@0.3.0` 的本地 fork，面向 **DSH Desktop 0.2.2-rc.3** 修复和增强。

包名为 `@erinwangstudio-art/dsh-trafficlight`，与 GitHub 仓库一致；插件的 Cordis patch 和 client bundle 标识已同步更新。上游原始包为 `@chivaskong96/dsh-trafficlight`。

## 已包含改动

- 修复从 GitHub 安装副本缺少 `lib/` 构建产物导致插件启用失败的问题（包内已含 `lib/`）。
- 修复悬浮窗偶发消失：每 2 秒重新置顶，并把移出屏幕的窗口拉回主屏。
- 修复暗色模式下会话头部「🚦 订阅」按钮文字看不清的问题。
- 点击悬浮窗中的订阅会话，可把 DSH 窗口带到前台并打开对应会话：
  - 浮窗 → 本机 `POST /focus`
  - DSH Web → `GET /api/dsh-tl/focus`
  - 页面调用 `uiWorkspace.openSession(id)`，兼容 `sessions.open(id)`。
- 悬浮窗标题优先使用真实对话标题：
  - DSH `sessionTitle` 服务；
  - 会话标题投影缓存 `session_projcache`；
  - 可靠持久化到订阅文件；
  - 不再用普通用户消息覆盖真实标题。
- 订阅文件支持新旧格式：
  - 旧：`["session-id"]`
  - 新：`{ "subscriptions": ["session-id"], "titles": { "session-id": "真实标题" } }`
- 普通模式右侧边缘可拖动调整宽度；手动宽度持久化。
- 默认自动宽度 `165pt`，最小 `150pt`，最大 `560pt`。
- 保留已编译的 macOS arm64 `TrafficLightOverlay` 二进制。
- 插件市场展示元数据：
  - 中文名称：`任务状态灯`
  - 中文简介：见 `locale/zh.json` 的 `meta.description`
  - 图标：包根 `icon.svg`（红黄绿三色交通灯）

完整补丁细节见 [docs/LOCAL-PATCHES.md](./docs/LOCAL-PATCHES.md)。

## 安装

从仓库安装：

```bash
dsh plugin --profile desktop add github:erinwangstudio-art/dsh-trafficlight
```

或在 DSH 插件管理里添加该 Git 仓库地址。

安装后重启 DSH Desktop。若悬浮窗没有自动出现，在任意会话头部点击「🚦 订阅」，或手动启动：

```bash
bash "$HOME/.dsh/profiles/desktop/node_modules/@erinwangstudio-art/dsh-trafficlight/scripts/trafficlight.sh"
```

## 重要说明

- 上游 npm 包声明的开发依赖 `@deepseek-ai/dsh-client-runtime@^0.1.5-rc.1` 已无法从 npm 获取，因此本 fork 的 `lib/` 和已编译二进制是随仓库一起提供的运行产物。
- 如需重新构建 Swift 悬浮窗，在当前机器上可使用 macOS 26.2 SDK：

```bash
DSH_TL_OVERLAY_SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.2.sdk bash overlay/build.sh
```

- 上游许可见 `LICENSE`。

## 本次贡献（0.4.0-fork.1）

在 0.3.1 的基础上补齐了一轮交互与渲染修复，均已在本机 DSH 2.x（macOS 27）实测：

### 修复
- **点击行无法恢复窗口**：上游用 `NSWorkspace.open(dsh://open)`，但 DSH Desktop NEXT 没有注册
  `dsh://` URL scheme，系统会弹"没有应用可打开"。改为按 bundle id 走 LaunchServices
  `openApplication`（等价点 Dock 图标），可把最小化的窗口一起还原。
- **macOS 13 无法启动**：二进制 minos 从 14 降到 13；6 处 macOS 14 才有的两参数
  `onChange` 改为 macOS 11 兼容写法（DSH 自身最低支持 macOS 13）。
- **呼吸不触发**：原来用"最近 6 秒内变化过"的布尔值触发，两次变化间隔小于 6 秒时布尔值不翻边，
  呼吸被静默跳过。改为单调递增的变化计数（`stateChangeTick`）。
- **0.7s 轮询打断动画**：`repeatForever` 动画会被状态轮询的重渲染重置；持续呼吸/红灯光环改为
  `TimelineView` 按时间驱动。

### 新增
- **归位模式（floating / docked）**：`mode` 设置 + `/mode`、`/dockbeat` 路由；`docked` 时悬浮窗隐藏，
  官方槽位 `sidebar.footer.action` 渲染侧栏面板（点行跳转、取消订阅、"悬浮窗"按钮）。
- **拖拽归位**：把悬浮窗拖进侧栏底部的虚线占位区松手即归位；拖动时面板变全磨砂提示"准备固定"；
  心跳缺失 12–15 秒会自动退回悬浮窗，避免灯丢失。
- **左右双边缘缩放**：左把手拖左变宽（右边缘固定），右把手拖右变宽（左边缘固定）；悬停时边缘亮起
  + 画出 ↔ 徽章（非激活面板无法改系统光标，见下）。
- **原生 Liquid Glass**：macOS 26+ 用 `NSGlassEffectView`（clear ↔ regular 随滑块过渡），旧系统回退
  vibrancy；`DSH_TL_FORCE_VIBRANCY=1` 可强制走兜底。
- **红灯扩展光环**：阻塞状态下灯体呼吸幅度 38%、周期 0.9s，并每 0.9s 扩散一圈红色光环；黄灯为
  1.8s 的慢呼吸。

### 构建说明（重要）
本机 `pnpm install` 无法解析上游 `devDependencies`（`@deepseek-ai/dsh-client-runtime@^0.1.5-rc.1`
等版本已不在 npm 上，最新只到 0.1.1-rc.2）。因此本次提交中的 `lib/*.js` 是**与本机实测版本一致的
构建产物**（与 `src/*.ts` 逻辑对应，行为已在本机验证）；维护者若能在自己的工具链中构建，可重新
生成 `lib/` 后覆盖。Swift 悬浮窗二进制已用 `swift build`（macOS 13 target）重新编译并提交。

### 0.4.1 修复
- 折叠/展开不再漂移：自动适配不再撑开折叠条，展开高度取自实际窗口高度；
- 关闭红绿灯会取消全部订阅并退出，头部「已订阅」2 秒内同步为「订阅」；
- 菜单栏新增「显示/隐藏悬浮窗」。

### 已知限制
- 悬浮窗是 .nonactivatingPanel，macOS 不允许非激活 app 改变系统光标，所以缩放边缘用"画出来的
  亮条 + ↔ 徽章"提示，而不是系统 resize 光标；要真光标只能让面板抢焦点。
