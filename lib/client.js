window.__ModuleLoader__.load({ id: "@erinwangstudio-art/dsh-trafficlight", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let react = require("react");
react = __toESM(react, 1);
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/index.tsx
const NS = "dsh-trafficlight";
const zh = {
	"section.title": "🚦 红绿灯悬浮窗",
	"section.desc": "配置 macOS 全局悬浮窗的外观和行为",
	"opacity.label": "悬浮窗透明度",
	"minimal.label": "极简模式",
	"minimal.desc": "只显示一个大信号灯，忽略具体会话",
	"breathCount.label": "呼吸次数",
	"breathCount.desc": "每次状态变化时灯放大/缩小的次数",
	"breathCount.unit": " 次",
	"breathBeat.label": "呼吸速度",
	"breathBeat.desc": "每次放大或回落的持续时间",
	"preview.title": "预览",
	"preview.desc": "实时预览当前参数效果",
	"preview.running": "执行中",
	"preview.blocked": "阻塞",
	"preview.done": "已完成",
	"preview.idle": "空闲"
};
const en = {
	"section.title": "🚦 Traffic Light Overlay",
	"section.desc": "Configure the macOS global floating window appearance and behavior",
	"opacity.label": "Overlay Opacity",
	"minimal.label": "Minimal Mode",
	"minimal.desc": "Show only a single big lamp, ignore individual sessions",
	"breathCount.label": "Breath Count",
	"breathCount.desc": "Number of scale pulses per state change",
	"breathCount.unit": "",
	"breathBeat.label": "Breath Speed",
	"breathBeat.desc": "Duration of each scale-up / scale-down",
	"preview.title": "Preview",
	"preview.desc": "Live preview of current parameter effects",
	"preview.running": "Running",
	"preview.blocked": "Blocked",
	"preview.done": "Done",
	"preview.idle": "Idle"
};
let subscribedIds = /* @__PURE__ */ new Set();
let refreshInFlight;
async function fetchState() {
	const res = await fetch("/api/dsh-tl/state", { cache: "no-store" });
	if (!res.ok) throw new Error("state " + res.status);
	const body = await res.json();
	const ids = body.ok ? body.value?.subscribed ?? [] : [];
	return new Set(ids);
}
function refresh() {
	if (refreshInFlight === void 0) refreshInFlight = fetchState().then((ids) => {
		subscribedIds = ids;
		return ids;
	}).finally(() => {
		refreshInFlight = void 0;
	});
	return refreshInFlight;
}
async function toggle(sessionId, next) {
	try {
		const res = await fetch("/api/dsh-tl/subscriptions" + (next ? "" : "?sessionId=" + encodeURIComponent(sessionId)), {
			method: next ? "POST" : "DELETE",
			headers: next ? { "content-type": "application/json" } : void 0,
			body: next ? JSON.stringify({ sessionId }) : void 0,
			cache: "no-store"
		});
		if (!res.ok) return false;
		const body = await res.json();
		if (body.ok) subscribedIds = new Set(body.value?.subscribed ?? []);
		return body.ok !== false;
	} catch {
		return false;
	}
}
const OPACITY_MIN = .1;
const OPACITY_MAX = 1;
const OPACITY_STEP = .01;
const BREATH_COUNT_MIN = 1;
const BREATH_COUNT_MAX = 6;
const BREATH_BEAT_MIN = .1;
const BREATH_BEAT_MAX = 1;
const BREATH_BEAT_STEP = .05;
async function fetchOpacity() {
	try {
		const res = await fetch("/api/dsh-tl/opacity", { cache: "no-store" });
		if (!res.ok) return OPACITY_MAX;
		const body = await res.json();
		if (body.ok && body.value && typeof body.value.opacity === "number") return body.value.opacity;
	} catch {}
	return OPACITY_MAX;
}
async function saveOpacity(opacity) {
	try {
		await fetch("/api/dsh-tl/opacity", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ opacity }),
			cache: "no-store"
		});
	} catch {}
}
async function fetchMinimalMode() {
	try {
		const res = await fetch("/api/dsh-tl/minimal", { cache: "no-store" });
		if (!res.ok) return false;
		const body = await res.json();
		if (body.ok && body.value && typeof body.value.minimalMode === "boolean") return body.value.minimalMode;
	} catch {}
	return false;
}
async function saveMinimalMode(minimalMode) {
	try {
		await fetch("/api/dsh-tl/minimal", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ minimalMode }),
			cache: "no-store"
		});
	} catch {}
}
async function fetchBreath() {
	try {
		const res = await fetch("/api/dsh-tl/breath", { cache: "no-store" });
		if (!res.ok) return {
			count: 3,
			beat: .35
		};
		const body = await res.json();
		if (body.ok && body.value) return {
			count: typeof body.value.breathCount === "number" ? body.value.breathCount : 3,
			beat: typeof body.value.breathBeat === "number" ? body.value.breathBeat : .35
		};
	} catch {}
	return {
		count: 3,
		beat: .35
	};
}
async function saveBreath(count, beat) {
	try {
		await fetch("/api/dsh-tl/breath", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				breathCount: count,
				breathBeat: beat
			}),
			cache: "no-store"
		});
	} catch {}
}
/** CSS variable-based label colors matching DeepSeek theme. */
const LABEL_STYLE = {
	fontSize: 12.5,
	color: "var(--dsw-alias-label-primary)",
	whiteSpace: "nowrap",
	flexShrink: 0
};
const LABEL_SECONDARY = {
	fontSize: 12,
	color: "var(--dsw-alias-label-secondary)",
	whiteSpace: "nowrap"
};
/** Fixed-width value badge so all sliders align on the right edge. */
const VALUE_WIDTH = 44;
function SettingsRow({ label, children, hint }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 2,
			padding: "4px 0"
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				display: "flex",
				alignItems: "center",
				gap: 12
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: LABEL_STYLE,
				children: label
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 10,
					flex: 1,
					minWidth: 0
				},
				children
			})]
		}), hint && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4))"
			},
			children: hint
		})]
	});
}
/** Styled checkbox matching DeepSeek theme (accentColor picks up brand blue). */
function StyledCheckbox({ checked, disabled, onChange, label }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
		type: "checkbox",
		"aria-label": label,
		checked,
		disabled,
		onChange: (e) => onChange(e.target.checked),
		style: {
			width: 16,
			height: 16,
			cursor: disabled ? "default" : "pointer",
			accentColor: "var(--dsw-alias-brand-primary, #3964fe)"
		}
	});
}
function SubscribeAction(_props) {
	const sessionId = String(_props.sessionId ?? "");
	const [state, setState] = react.useState({
		subscribed: false,
		busy: false
	});
	react.useEffect(() => {
		let alive = true;
		const sync = () => {
			refresh().then(() => {
				if (alive) setState((s) => ({
					...s,
					subscribed: subscribedIds.has(sessionId)
				}));
			});
		};
		sync();
		const timer = setInterval(sync, 2e3);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [sessionId]);
	const onClick = async () => {
		if (state.busy || sessionId === "") return;
		setState((s) => ({
			...s,
			busy: true
		}));
		if (await toggle(sessionId, !state.subscribed)) setState((s) => ({
			...s,
			subscribed: !s.subscribed
		}));
		setState((s) => ({
			...s,
			busy: false
		}));
	};
	const active = state.subscribed;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		onClick: () => void onClick(),
		title: active ? "取消红绿灯订阅（悬浮窗将移除该会话）" : "添加红绿灯订阅（悬浮窗跟踪该会话状态）",
		style: {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			height: 22,
			padding: "0 8px",
			borderRadius: 6,
			border: "1px solid " + (active ? "#5b8cff" : "rgba(128,128,128,0.45)"),
			background: active ? "rgba(91,140,255,0.14)" : "transparent",
			color: active ? "#5b8cff" : "currentColor",
			fontSize: 11,
			lineHeight: 1,
			cursor: state.busy ? "wait" : "pointer",
			opacity: state.busy ? .6 : 1,
			whiteSpace: "nowrap"
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: { fontSize: 12 },
			children: "🚦"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: active ? "已订阅" : "订阅" })]
	});
}
function PreviewLamp({ color, breathCount, breathBeat, opacity }) {
	const totalDuration = breathCount * breathBeat * 2;
	const keyframeParts = [];
	for (let i = 0; i < breathCount; i++) {
		const pctUp = (i * 2 + 1) / (breathCount * 2) * 100;
		const pctDown = (i * 2 + 2) / (breathCount * 2) * 100;
		keyframeParts.push(`${pctUp.toFixed(1)}% { transform: scale(1.35); }`);
		keyframeParts.push(`${pctDown.toFixed(1)}% { transform: scale(1); }`);
	}
	const keyframeName = `tl-breathe-${breathCount}-${Math.round(breathBeat * 100)}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `@keyframes ${keyframeName} { ${keyframeParts.join(" ")} }` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
		width: 32,
		height: 32,
		borderRadius: "50%",
		background: color,
		opacity,
		boxShadow: `0 0 ${12 * opacity}px ${color}`,
		animation: `${keyframeName} ${totalDuration}s ease-in-out infinite`,
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	} })] });
}
function TrafficLightSection({ t }) {
	const tl = (key) => t?.(key) ?? zh[key] ?? key;
	const [opacity, setOpacity] = react.useState(OPACITY_MAX);
	const [minimal, setMinimal] = react.useState(false);
	const [breathCount, setBreathCount] = react.useState(3);
	const [breathBeat, setBreathBeat] = react.useState(.35);
	const [ready, setReady] = react.useState(false);
	react.useEffect(() => {
		let alive = true;
		Promise.all([
			fetchOpacity(),
			fetchMinimalMode(),
			fetchBreath()
		]).then(([o, m, b]) => {
			if (alive) {
				setOpacity(o);
				setMinimal(m);
				setBreathCount(b.count);
				setBreathBeat(b.beat);
				setReady(true);
			}
		});
		return () => {
			alive = false;
		};
	}, []);
	const onOpacityChange = (e) => {
		const v = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number(e.target.value) || OPACITY_MIN));
		setOpacity(v);
		saveOpacity(v);
	};
	const onMinimalChange = (v) => {
		setMinimal(v);
		saveMinimalMode(v);
	};
	const onBreathCountChange = (e) => {
		const v = Math.min(BREATH_COUNT_MAX, Math.max(BREATH_COUNT_MIN, Math.round(Number(e.target.value) || 1)));
		setBreathCount(v);
		saveBreath(v, breathBeat);
	};
	const onBreathBeatChange = (e) => {
		const v = Math.min(BREATH_BEAT_MAX, Math.max(BREATH_BEAT_MIN, Math.round(Number(e.target.value) * 100) / 100));
		setBreathBeat(v);
		saveBreath(breathCount, v);
	};
	const beatMs = Math.round(breathBeat * 1e3);
	const lampColors = [
		{
			label: tl("preview.blocked"),
			color: "var(--dsw-alias-state-error-primary, #ef4444)"
		},
		{
			label: tl("preview.running"),
			color: "var(--dsw-alias-state-warn-primary, #eab308)"
		},
		{
			label: tl("preview.done"),
			color: "var(--dsw-alias-state-success-primary, #22c55e)"
		},
		{
			label: tl("preview.idle"),
			color: "var(--dsw-alias-label-tertiary, #9ca3af)"
		}
	];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			width: "100%"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "16px 20px 12px",
					borderBottom: "1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06))"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 14,
						fontWeight: 600,
						color: "var(--dsw-alias-label-primary)",
						marginBottom: 2
					},
					children: tl("section.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						color: "var(--dsw-alias-label-secondary)"
					},
					children: tl("section.desc")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "8px 20px 16px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SettingsRow, {
						label: tl("opacity.label"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": tl("opacity.label"),
							type: "range",
							min: OPACITY_MIN,
							max: OPACITY_MAX,
							step: OPACITY_STEP,
							value: opacity,
							disabled: !ready,
							onChange: onOpacityChange,
							style: {
								flex: 1,
								minWidth: 0
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								...LABEL_SECONDARY,
								width: VALUE_WIDTH,
								textAlign: "right",
								fontVariantNumeric: "tabular-nums",
								flexShrink: 0
							},
							children: opacity.toFixed(2)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SettingsRow, {
						label: tl("minimal.label"),
						hint: tl("minimal.desc"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: { flex: 1 } }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StyledCheckbox, {
							checked: minimal,
							disabled: !ready,
							onChange: onMinimalChange,
							label: tl("minimal.label")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SettingsRow, {
						label: tl("breathCount.label"),
						hint: tl("breathCount.desc"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": tl("breathCount.label"),
							type: "range",
							min: BREATH_COUNT_MIN,
							max: BREATH_COUNT_MAX,
							step: 1,
							value: breathCount,
							disabled: !ready,
							onChange: onBreathCountChange,
							style: {
								flex: 1,
								minWidth: 0
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								...LABEL_SECONDARY,
								width: VALUE_WIDTH,
								textAlign: "right",
								fontVariantNumeric: "tabular-nums",
								flexShrink: 0
							},
							children: [breathCount, tl("breathCount.unit") ?? " 次"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SettingsRow, {
						label: tl("breathBeat.label"),
						hint: tl("breathBeat.desc"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"aria-label": tl("breathBeat.label"),
							type: "range",
							min: BREATH_BEAT_MIN,
							max: BREATH_BEAT_MAX,
							step: BREATH_BEAT_STEP,
							value: breathBeat,
							disabled: !ready,
							onChange: onBreathBeatChange,
							style: {
								flex: 1,
								minWidth: 0
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								...LABEL_SECONDARY,
								width: VALUE_WIDTH,
								textAlign: "right",
								fontVariantNumeric: "tabular-nums",
								flexShrink: 0
							},
							children: [beatMs, "ms"]
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "12px 20px 16px",
					borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06))"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 13,
							fontWeight: 600,
							color: "var(--dsw-alias-label-primary)",
							marginBottom: 2
						},
						children: tl("preview.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 11,
							color: "var(--dsw-alias-label-secondary)",
							marginBottom: 12
						},
						children: tl("preview.desc")
					}),
					minimal && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 16,
							padding: "12px 16px",
							borderRadius: 12,
							background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))",
							marginBottom: 12
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreviewLamp, {
							color: "var(--dsw-alias-state-warn-primary, #eab308)",
							breathCount,
							breathBeat,
							opacity
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								fontWeight: 500,
								color: "var(--dsw-alias-label-primary)"
							},
							children: "极简模式"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 11,
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								"单灯 · 透明度 ",
								opacity.toFixed(2),
								" · ",
								breathCount,
								"次 · ",
								beatMs,
								"ms"
							]
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 16,
							padding: "12px 16px",
							borderRadius: 12,
							background: "var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 14,
								alignItems: "center"
							},
							children: lampColors.map((lamp) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: 4
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreviewLamp, {
									color: lamp.color,
									breathCount,
									breathBeat,
									opacity
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 10,
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: lamp.label
								})]
							}, lamp.label))
						})
					})
				]
			})
		]
	});
}
/** The entry apply(). */
function apply(ctx) {
	ctx.effect(() => {
		const disposers = [];
		const slotsService = ctx.slots;
		const localeService = ctx.locale;
		if (localeService !== void 0 && typeof localeService.register === "function") try {
			localeService.register(NS, {
				zh,
				en
			});
		} catch {}
		const t = localeService !== void 0 && typeof localeService.bind === "function" ? localeService.bind(NS) : (key) => zh[key] ?? key;
		const openFocusedSession = (sessionId) => {
			if (!sessionId) return;
			try {
				const workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : ctx.uiWorkspace;
				if (workspace && typeof workspace.openSession === "function") { workspace.openSession(sessionId); return; }
				const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : ctx.sessions;
				if (sessions && typeof sessions.open === "function") sessions.open(sessionId);
			} catch (error) { console.warn("[dsh-trafficlight] could not open session", error); }
		};
		const focusTimer = setInterval(() => {
			fetch("/api/dsh-tl/focus", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((body) => {
				const sessionId = body?.ok ? body.value?.sessionId : null;
				if (typeof sessionId === "string" && sessionId) openFocusedSession(sessionId);
			}).catch(() => {});
		}, 800);
		if (slotsService !== void 0 && typeof slotsService.inject === "function" && typeof slotsService.register === "function") {
			const register = (slot, id, order, component, extra) => {
				try {
					disposers.push(slotsService.inject(slot, () => slotsService.register({
						name: slot,
						id: "dsh-trafficlight-" + id,
						order,
						registrant: NS,
						locale: NS,
						...extra
					}, component)));
				} catch (e) {
					console.error(`[dsh-trafficlight] slot inject failed: ${slot}`, e);
				}
			};
			register("conversation.session.header.actions", "subscribe", 1e3, SubscribeAction);
			register("settings.section", "trafficlight", 50, TrafficLightSection, {
				label: () => t("section.title"),
				inject: () => ({ t })
			});
		} else console.warn("[dsh-trafficlight] slots service unavailable — header action / settings card not mounted");
		return () => {
			clearInterval(focusTimer);
			for (const dispose of disposers) try {
				dispose();
			} catch {}
		};
	}, "dsh-trafficlight: slot registration");
}
const name = NS;
/** Required services: the slot registry + locale (optional, for i18n). */
const inject = ["slots", "locale"];
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;

//#region dsh-trafficlight: docked sidebar panel
// In-page twin of the macOS floating panel. Rendered into the official
// `sidebar.footer.action` slot (the sidebar strip right above the account
// row); it only draws while the host reports mode === 'docked'. The floating
// panel hides itself in that mode, so the two never show at the same time.
const DOCK_STATE_COLORS = {
	blocked: "#ff453a",
	running: "#ffd60a",
	done: "#30d158",
	idle: "#8e8e93"
};
const DOCK_STATE_LABELS = {
	blocked: "等待处理",
	running: "执行中",
	done: "已完成",
	idle: "空闲"
};
function dockColor(state) {
	return DOCK_STATE_COLORS[state] ?? DOCK_STATE_COLORS.idle;
}
function dockLabel(state) {
	return DOCK_STATE_LABELS[state] ?? DOCK_STATE_LABELS.idle;
}
function dockPost(path, body) {
	return fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {})
	}).catch(() => {});
}
function DockedPanel() {
	const [snap, setSnap] = react.useState(null);
	react.useEffect(() => {
		let alive = true;
		let timer = null;
		const tick = () => {
			fetch("/api/dsh-tl/state", { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((body) => {
				if (alive) setSnap(body?.ok ? body.value : null);
				if (alive && body?.ok && body.value?.mode === "docked") fetch("/api/dsh-tl/dockbeat", { method: "POST" }).catch(() => {});
			}).catch(() => {});
			if (alive) timer = setTimeout(tick, 1000);
		};
		tick();
		return () => {
			alive = false;
			if (timer !== null) clearTimeout(timer);
		};
	}, []);
	if (!snap) return null;
	if (snap.mode !== "docked") {
		// Persistent drop target. It lives in the sidebar footer's layout flow,
		// so the workspace/session list ends above it and nothing overlaps.
		return react.createElement("div", {
			style: {
				width: "100%",
				boxSizing: "border-box",
				margin: "2px 4px 6px",
				padding: "0 8px",
				height: 64,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 6,
				border: "1.5px dashed var(--dsw-alias-border-default, rgba(200,200,200,0.32))",
				borderRadius: 10,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.5))",
				userSelect: "none"
			}
		}, "🚦 拖到这里固定");
	}
	const rows = Array.isArray(snap.sessions) ? snap.sessions : [];
	const focusRow = (sessionId) => {
		if (sessionId) dockPost("/api/dsh-tl/focus", { sessionId });
	};
	const unsubscribeRow = (sessionId) => {
		fetch("/api/dsh-tl/subscriptions?sessionId=" + encodeURIComponent(sessionId), { method: "DELETE" }).catch(() => {});
	};
	const undock = () => {
		dockPost("/api/dsh-tl/mode", { mode: "floating" });
	};
	const header = react.createElement("div", {
		style: {
			display: "flex",
			alignItems: "center",
			gap: 6,
			padding: "6px 2px 4px"
		}
	}, react.createElement("span", {
		style: {
			fontSize: 11,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary, #e6e6e6)"
		}
	}, "🚦 任务状态"), react.createElement("span", { style: { flex: 1 } }), react.createElement("button", {
		onClick: undock,
		title: "把红绿灯放回 macOS 悬浮窗",
		style: {
			fontSize: 11,
			padding: "2px 8px",
			borderRadius: 6,
			border: "1px solid var(--dsw-alias-border-default, rgba(128,128,128,0.35))",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary, rgba(255,255,255,0.7))",
			cursor: "pointer"
		}
	}, "悬浮窗"));
	const body = rows.length === 0 ? react.createElement("div", {
		style: {
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.5))",
			padding: "2px 2px 6px"
		}
	}, "在会话标题栏点击 🚦 订阅，这里会显示任务状态") : react.createElement("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 2,
			maxHeight: "30vh",
			overflowY: "auto"
		}
	}, rows.map((row) => {
		const color = dockColor(row.state);
		return react.createElement("div", {
			key: row.sessionId,
			onClick: () => focusRow(row.sessionId),
			title: "跳转到该会话",
			style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "4px 6px",
				borderRadius: 6,
				cursor: "pointer"
			},
			onMouseEnter: (event) => {
				event.currentTarget.style.background = "rgba(127,127,127,0.14)";
			},
			onMouseLeave: (event) => {
				event.currentTarget.style.background = "transparent";
			}
		}, react.createElement("span", {
			style: {
				width: 8,
				height: 8,
				borderRadius: "50%",
				background: color,
				flex: "none",
				boxShadow: row.state === "running" ? "0 0 6px " + color : "none"
			}
		}), react.createElement("span", {
			style: {
				fontSize: 12,
				color: "var(--dsw-alias-label-primary, #e6e6e6)",
				flex: 1,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			}
		}, row.title || row.sessionId), react.createElement("span", {
			style: {
				fontSize: 10,
				color,
				flex: "none"
			}
		}, dockLabel(row.state)), react.createElement("button", {
			onClick: (event) => {
				event.stopPropagation();
				unsubscribeRow(row.sessionId);
			},
			title: "取消订阅",
			style: {
				border: "none",
				background: "transparent",
				color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.4))",
				cursor: "pointer",
				fontSize: 12,
				lineHeight: 1,
				padding: "0 2px"
			}
		}, "✕"));
	}));
	return react.createElement("div", {
		style: {
			width: "100%",
			padding: "0 4px 6px",
			boxSizing: "border-box",
			borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))",
			marginTop: 4
		}
	}, header, body);
}
const __dshTrafficlightApply = apply;
function applyWithDockedPanel(ctx) {
	__dshTrafficlightApply(ctx);
	try {
		ctx.effect(() => {
			const slots = ctx.slots;
			if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return () => {};
			let dispose;
			try {
				dispose = slots.inject("sidebar.footer.action", () => slots.register({
					name: "sidebar.footer.action",
					id: "dsh-trafficlight-docked",
					order: 40,
					registrant: NS,
					locale: NS
				}, DockedPanel));
			} catch (error) {
				console.error("[dsh-trafficlight] docked panel slot failed", error);
				return () => {};
			}
			return () => {
				try {
					dispose();
				} catch (error) {}
			};
		}, "dsh-trafficlight: docked panel");
	} catch (error) {
		console.error("[dsh-trafficlight] docked panel setup failed", error);
	}
}
exports.apply = applyWithDockedPanel;
//#endregion

return module.exports; } });