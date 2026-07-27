/* @ds-bundle: {"namespace":"DonelDesignSystem","components":[{"name":"AccountBadge","sourcePath":"components/contas/AccountBadge/AccountBadge.jsx"},{"name":"Button","sourcePath":"components/base/Button/Button.jsx"},{"name":"Modal","sourcePath":"components/base/Modal/Modal.jsx"},{"name":"PhaseChip","sourcePath":"components/modo-dev/PhaseChip/PhaseChip.jsx"},{"name":"PostItCard","sourcePath":"components/post-its/PostItCard/PostItCard.jsx"},{"name":"SegmentedControl","sourcePath":"components/base/SegmentedControl/SegmentedControl.jsx"},{"name":"Select","sourcePath":"components/base/Select/Select.jsx"},{"name":"SmartZoneMeter","sourcePath":"components/sess-o/SmartZoneMeter/SmartZoneMeter.jsx"},{"name":"SplitButton","sourcePath":"components/base/SplitButton/SplitButton.jsx"},{"name":"StateDot","sourcePath":"components/sess-o/StateDot/StateDot.jsx"},{"name":"StatusBar","sourcePath":"components/shell/StatusBar/StatusBar.jsx"},{"name":"TerminalTab","sourcePath":"components/sess-o/TerminalTab/TerminalTab.jsx"},{"name":"TextInput","sourcePath":"components/base/TextInput/TextInput.jsx"},{"name":"Toast","sourcePath":"components/base/Toast/Toast.jsx"},{"name":"Toggle","sourcePath":"components/base/Toggle/Toggle.jsx"}],"sourceHashes":{"components/contas/AccountBadge/AccountBadge.jsx":"7d0371135a99","components/contas/AccountBadge/AccountBadge.d.ts":"1f5a9ffc13ac","components/contas/AccountBadge/AccountBadge.prompt.md":"d2414ebe53e7","components/base/Button/Button.jsx":"7c3a22243082","components/base/Button/Button.d.ts":"5a2dc3577b70","components/base/Button/Button.prompt.md":"2acdfbbcfd1b","components/base/Modal/Modal.jsx":"7668fc441c3f","components/base/Modal/Modal.d.ts":"2090cadeaaaf","components/base/Modal/Modal.prompt.md":"e26b1d6f0d3f","components/modo-dev/PhaseChip/PhaseChip.jsx":"20c7444f268b","components/modo-dev/PhaseChip/PhaseChip.d.ts":"b6a0e5ba1baa","components/modo-dev/PhaseChip/PhaseChip.prompt.md":"98217ed383fd","components/post-its/PostItCard/PostItCard.jsx":"46f1d6d35162","components/post-its/PostItCard/PostItCard.d.ts":"25454c03bb9a","components/post-its/PostItCard/PostItCard.prompt.md":"e413138f43c3","components/base/SegmentedControl/SegmentedControl.jsx":"cfff8ae53065","components/base/SegmentedControl/SegmentedControl.d.ts":"224421239339","components/base/SegmentedControl/SegmentedControl.prompt.md":"4414a521b63f","components/base/Select/Select.jsx":"7aa30b55b8c0","components/base/Select/Select.d.ts":"1356d4b375c0","components/base/Select/Select.prompt.md":"6c8f730969ea","components/sess-o/SmartZoneMeter/SmartZoneMeter.jsx":"d39096ec161b","components/sess-o/SmartZoneMeter/SmartZoneMeter.d.ts":"9f7b0aaff76a","components/sess-o/SmartZoneMeter/SmartZoneMeter.prompt.md":"7ac94003361b","components/base/SplitButton/SplitButton.jsx":"d23d5ec1b4a1","components/base/SplitButton/SplitButton.d.ts":"d79f6d28f545","components/base/SplitButton/SplitButton.prompt.md":"e1dcdd184423","components/sess-o/StateDot/StateDot.jsx":"e87e23ec2253","components/sess-o/StateDot/StateDot.d.ts":"ea9be62dd121","components/sess-o/StateDot/StateDot.prompt.md":"82d37690f5f9","components/shell/StatusBar/StatusBar.jsx":"451f863bb601","components/shell/StatusBar/StatusBar.d.ts":"f1488e22f3e2","components/shell/StatusBar/StatusBar.prompt.md":"023664e76657","components/sess-o/TerminalTab/TerminalTab.jsx":"aa13ce5ff2e2","components/sess-o/TerminalTab/TerminalTab.d.ts":"80f1665ad23c","components/sess-o/TerminalTab/TerminalTab.prompt.md":"efaa34da2cd7","components/base/TextInput/TextInput.jsx":"76bccd295a67","components/base/TextInput/TextInput.d.ts":"d435d222210b","components/base/TextInput/TextInput.prompt.md":"d124db2625f8","components/base/Toast/Toast.jsx":"fb5a7fcb4aca","components/base/Toast/Toast.d.ts":"720e0c1d00c5","components/base/Toast/Toast.prompt.md":"6c8637712ba0","components/base/Toggle/Toggle.jsx":"bb5658993de1","components/base/Toggle/Toggle.d.ts":"e305f0ece97a","components/base/Toggle/Toggle.prompt.md":"572fe1c7133c"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
"use strict";
var DonelDesignSystem = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn2, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R2 = window.React;
      function np(p, k) {
        var o = {};
        for (var x2 in p) if (x2 !== "children") o[x2] = p[x2];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx(t, p, k) {
        var c2 = p && p.children;
        return c2 === void 0 ? R2.createElement(t, np(p, k)) : R2.createElement(t, np(p, k), c2);
      }
      function jsxs(t, p, k) {
        return R2.createElement.apply(R2, [t, np(p, k)].concat(p.children));
      }
      module.exports = R2;
      module.exports.jsx = jsx;
      module.exports.jsxs = jsxs;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs : jsx)(t, p, k);
      };
      module.exports.Fragment = R2.Fragment;
    }
  });

  // shim:react-dom-shim
  var require_react_dom_shim = __commonJS({
    "shim:react-dom-shim"(exports, module) {
      init_define_import_meta_env();
      var D2 = window.ReactDOM;
      var n2 = function() {
      };
      module.exports = Object.assign({ preload: n2, preinit: n2, preconnect: n2, prefetchDNS: n2, preloadModule: n2, preinitModule: n2 }, D2);
    }
  });

  // dist/donel-design-system.js
  var donel_design_system_exports = {};
  __export(donel_design_system_exports, {
    AccountBadge: () => dn,
    Button: () => un,
    DEFAULT_MAX_TOKENS: () => M,
    ESTEIRA_PHASE_LABEL_PT: () => Ze,
    Modal: () => vn,
    PhaseChip: () => _n,
    PostItCard: () => gn,
    SESSION_STATE_LABEL_PT: () => H,
    SMART_ZONE_COLOR_VAR: () => cn,
    SegmentedControl: () => bn,
    Select: () => pn,
    SmartZoneMeter: () => be,
    SplitButton: () => hn,
    StateDot: () => ie,
    StatusBar: () => wn,
    TerminalTab: () => yn,
    TextInput: () => mn,
    Toast: () => kn,
    Toggle: () => fn,
    formatSmartZoneLabel: () => ce,
    formatTokenCount: () => F,
    getHeadroomTier: () => Ve,
    getSmartZone: () => le
  });
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var import_react = __toESM(require_react_shim(), 1);
  var import_react_dom = __toESM(require_react_dom_shim(), 1);
  var Q = "_wrapper_45t62_1";
  var Y = "_dot_45t62_8";
  var ee = "_working_45t62_15";
  var te = "_waiting_45t62_20";
  var ne = "_permission_45t62_24";
  var oe = "_done_45t62_30";
  var ae = "_error_45t62_34";
  var re = "_ringed_45t62_40";
  var se = "_label_45t62_49";
  var C = {
    wrapper: Q,
    dot: Y,
    working: ee,
    "state-dot-pulse": "_state-dot-pulse_45t62_1",
    waiting: te,
    permission: ne,
    done: oe,
    error: ae,
    ringed: re,
    label: se
  };
  var H = {
    working: "Trabalhando",
    waiting: "Aguardando resposta",
    permission: "Permiss\xE3o pendente",
    done: "Encerrada",
    error: "Falha ou quota esgotada"
  };
  function ie({ state: t, label: e, ring: o, size: a = 8, className: s }) {
    const r = {
      width: a,
      height: a,
      "--ring-color": o ? `var(--zone-${o})` : void 0
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: [C.wrapper, s].filter(Boolean).join(" "), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "span",
        {
          className: [C.dot, C[t], o ? C.ringed : ""].filter(Boolean).join(" "),
          style: r,
          role: e ? void 0 : "img",
          "aria-label": e ? void 0 : H[t],
          "aria-hidden": e ? true : void 0
        }
      ),
      e ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: C.label, children: e }) : null
    ] });
  }
  var M = 4e5;
  function le(t, e = M) {
    const o = e > 0 ? t / e * 100 : 0;
    return o > 100 ? "over" : o >= 70 ? "warn" : "ok";
  }
  function F(t) {
    return `${Math.round(t / 1e3)}k`;
  }
  function ce(t, e = M) {
    return `${F(t)}/${F(e)}`;
  }
  var cn = {
    ok: "var(--zone-ok)",
    warn: "var(--zone-warn)",
    over: "var(--zone-over)"
  };
  var de = "_root_ywg9f_1";
  var _e = "_barTrack_ywg9f_17";
  var ue = "_compact_ywg9f_25";
  var he = "_barFill_ywg9f_29";
  var me = "_label_ywg9f_47";
  var pe = "_tooltip_ywg9f_55";
  var fe = "_handoffButton_ywg9f_88";
  var w = {
    root: de,
    barTrack: _e,
    compact: ue,
    barFill: he,
    "fill-ok": "_fill-ok_ywg9f_35",
    "fill-warn": "_fill-warn_ywg9f_39",
    "fill-over": "_fill-over_ywg9f_43",
    label: me,
    tooltip: pe,
    handoffButton: fe
  };
  var V = {
    ok: "dentro da zona",
    warn: "aten\xE7\xE3o",
    over: "handoff sugerido"
  };
  function be({
    usedTokens: t,
    maxTokens: e = M,
    variant: o = "default",
    onHandoff: a,
    className: s
  }) {
    const r = le(t, e), l = Math.min(t / e * 100, 100), i = ce(t, e), d = (0, import_react.useId)();
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: [w.root, w[o], s].filter(Boolean).join(" "),
        tabIndex: 0,
        "aria-describedby": d,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              className: w.barTrack,
              role: "progressbar",
              "aria-valuenow": Math.round(l),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-label": `Smart zone: ${i} tokens usados, ${V[r]}`,
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "div",
                {
                  className: [w.barFill, w[`fill-${r}`]].join(" "),
                  style: { width: `${l}%` }
                }
              )
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: w.label, children: i }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { id: d, role: "tooltip", className: w.tooltip, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              i,
              " \xB7 ",
              V[r]
            ] }),
            r === "over" && a ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: w.handoffButton, onClick: a, children: "Handoff \u2192 nova sess\xE3o" }) : null
          ] })
        ]
      }
    );
  }
  var X = (...t) => t.filter((e, o, a) => !!e && e.trim() !== "" && a.indexOf(e) === o).join(" ").trim();
  var ye = (t) => t.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  var ge = (t) => t.replace(
    /^([A-Z])|[\s-_]+(\w)/g,
    (e, o, a) => a ? a.toUpperCase() : o.toLowerCase()
  );
  var K = (t) => {
    const e = ge(t);
    return e.charAt(0).toUpperCase() + e.slice(1);
  };
  var D = {
    xmlns: "http://www.w3.org/2000/svg",
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };
  var ve = (t) => {
    for (const e in t)
      if (e.startsWith("aria-") || e === "role" || e === "title")
        return true;
    return false;
  };
  var ke = (0, import_react.createContext)({});
  var we = () => (0, import_react.useContext)(ke);
  var Ne = (0, import_react.forwardRef)(
    ({ color: t, size: e, strokeWidth: o, absoluteStrokeWidth: a, className: s = "", children: r, iconNode: l, ...i }, d) => {
      const {
        size: h = 24,
        strokeWidth: u = 2,
        absoluteStrokeWidth: k = false,
        color: m = "currentColor",
        className: _ = ""
      } = we() ?? {}, p = a ?? k ? Number(o ?? u) * 24 / Number(e ?? h) : o ?? u;
      return (0, import_react.createElement)(
        "svg",
        {
          ref: d,
          ...D,
          width: e ?? h ?? D.width,
          height: e ?? h ?? D.height,
          stroke: t ?? m,
          strokeWidth: p,
          className: X("lucide", _, s),
          ...!r && !ve(i) && { "aria-hidden": "true" },
          ...i
        },
        [
          ...l.map(([f, N]) => (0, import_react.createElement)(f, N)),
          ...Array.isArray(r) ? r : [r]
        ]
      );
    }
  );
  var j = (t, e) => {
    const o = (0, import_react.forwardRef)(
      ({ className: a, ...s }, r) => (0, import_react.createElement)(Ne, {
        ref: r,
        iconNode: e,
        className: X(
          `lucide-${ye(K(t))}`,
          `lucide-${t}`,
          a
        ),
        ...s
      })
    );
    return o.displayName = K(t), o;
  };
  var xe = [
    ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1", key: "1wp1u1" }],
    ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", key: "1s80jp" }],
    ["path", { d: "M10 12h4", key: "a56b0p" }]
  ];
  var $e = j("archive", xe);
  var je = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]];
  var Ce = j("check", je);
  var Ee = [["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]];
  var R = j("chevron-down", Ee);
  var Le = [
    ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
    ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
  ];
  var Be = j("copy", Le);
  var Se = [
    [
      "path",
      {
        d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
        key: "1ffxy3"
      }
    ],
    ["path", { d: "m21.854 2.147-10.94 10.939", key: "12cjpa" }]
  ];
  var ze = j("send", Se);
  var Te = [
    ["path", { d: "M12 19h8", key: "baeox8" }],
    ["path", { d: "m4 17 6-6-6-6", key: "1yngyt" }]
  ];
  var Ie = j("terminal", Te);
  var Ae = [
    ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
    ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
  ];
  var De = j("x", Ae);
  var We = "_badge_2xodd_1";
  var Pe = "_interactive_2xodd_16";
  var Me = "_name_2xodd_30";
  var Re = "_separator_2xodd_34";
  var Oe = "_headroom_2xodd_38";
  var Fe = "_icon_2xodd_62";
  var b = {
    badge: We,
    interactive: Pe,
    name: Me,
    separator: Re,
    headroom: Oe,
    "tier-high": "_tier-high_2xodd_44",
    "tier-mid": "_tier-mid_2xodd_48",
    "tier-low": "_tier-low_2xodd_52",
    "tier-none": "_tier-none_2xodd_56",
    icon: Fe
  };
  function Ve(t) {
    return t === null ? "none" : t > 40 ? "high" : t >= 15 ? "mid" : "low";
  }
  function dn({
    accountNumber: t,
    headroomPercent: e,
    loginPending: o = false,
    active: a = false,
    expandable: s = false,
    onClick: r,
    className: l
  }) {
    const i = Ve(e), d = !!r;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      d ? "button" : "span",
      {
        type: d ? "button" : void 0,
        className: [b.badge, d ? b.interactive : "", l].filter(Boolean).join(" "),
        onClick: r,
        "aria-current": a ? "true" : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: b.name, children: [
            "Tecnologia Claude ",
            t
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: b.separator, "aria-hidden": "true", children: "\xB7" }),
          o ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: [b.headroom, b["tier-none"]].join(" "), children: "login pendente" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: [b.headroom, b[`tier-${i}`]].join(" "), children: e === null ? "\u2014" : `${e}%` }),
          a ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ce, { size: 14, strokeWidth: 1.5, className: b.icon, "aria-hidden": "true" }) : null,
          s ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(R, { size: 14, strokeWidth: 1.5, className: b.icon, "aria-hidden": "true" }) : null
        ]
      }
    );
  }
  var Ke = "_chip_191ml_1";
  var qe = {
    chip: Ke
  };
  var Ze = {
    discovery: "Discovery",
    plano: "Plano",
    implementar: "Implementar",
    validar: "Validar",
    concluir: "Concluir"
  };
  function _n({ phase: t, className: e }) {
    const o = {
      "--phase-color": `var(--phase-${t})`
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: [qe.chip, e].filter(Boolean).join(" "), style: o, children: Ze[t] });
  }
  var Ue = "_button_1x5r3_1";
  var He = "_fullWidth_1x5r3_31";
  var Xe = "_label_1x5r3_35";
  var Ge = "_primary_1x5r3_40";
  var Je = "_secondary_1x5r3_49";
  var Qe = "_ghost_1x5r3_59";
  var Ye = "_danger_1x5r3_70";
  var T = {
    button: Ue,
    fullWidth: He,
    label: Xe,
    primary: Ge,
    secondary: Je,
    ghost: Qe,
    danger: Ye
  };
  function un({
    variant: t = "secondary",
    iconLeft: e,
    iconRight: o,
    fullWidth: a = false,
    className: s,
    children: r,
    ...l
  }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        className: [T.button, T[t], a ? T.fullWidth : "", s].filter(Boolean).join(" "),
        ...l,
        children: [
          e,
          r ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: T.label, children: r }) : null,
          o
        ]
      }
    );
  }
  var et = "_root_zd8f4_1";
  var tt = "_main_zd8f4_8";
  var nt = "_caret_zd8f4_9";
  var ot = "_primary_zd8f4_45";
  var at = "_secondary_zd8f4_54";
  var rt = "_menu_zd8f4_64";
  var st = "_menuItem_zd8f4_79";
  var x = {
    root: et,
    main: tt,
    caret: nt,
    primary: ot,
    secondary: at,
    menu: rt,
    menuItem: st
  };
  function hn({
    label: t,
    onClick: e,
    items: o,
    variant: a = "primary",
    disabled: s = false,
    className: r
  }) {
    const [l, i] = (0, import_react.useState)(false), d = (0, import_react.useRef)(null), h = (0, import_react.useRef)(null);
    return (0, import_react.useEffect)(() => {
      if (!l) return;
      function u(m) {
        d.current && !d.current.contains(m.target) && i(false);
      }
      function k(m) {
        var _;
        m.key === "Escape" && (i(false), (_ = h.current) == null || _.focus());
      }
      return document.addEventListener("pointerdown", u), document.addEventListener("keydown", k), () => {
        document.removeEventListener("pointerdown", u), document.removeEventListener("keydown", k);
      };
    }, [l]), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: [x.root, r].filter(Boolean).join(" "), ref: d, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: [x.main, x[a]].join(" "),
          onClick: e,
          disabled: s,
          children: t
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          ref: h,
          className: [x.caret, x[a]].join(" "),
          onClick: () => i((u) => !u),
          disabled: s,
          "aria-haspopup": "menu",
          "aria-expanded": l,
          "aria-label": `Mais op\xE7\xF5es de ${t}`,
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(R, { size: 14, strokeWidth: 1.5, "aria-hidden": "true" })
        }
      ),
      l ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: x.menu, role: "menu", children: o.map((u) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { role: "none", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          role: "menuitem",
          className: x.menuItem,
          onClick: () => {
            u.onSelect(), i(false);
          },
          children: u.label
        }
      ) }, u.label)) }) : null
    ] });
  }
  var it = "_field_3ajp5_1";
  var lt = "_label_3ajp5_7";
  var ct = "_input_3ajp5_15";
  var dt = "_hint_3ajp5_42";
  var _t = "_hintDanger_3ajp5_48";
  var E = {
    field: it,
    label: lt,
    input: ct,
    hint: dt,
    hintDanger: _t
  };
  function mn({ label: t, hint: e, hintTone: o = "muted", id: a, className: s, ...r }) {
    const l = (0, import_react.useId)(), i = a ?? l;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: [E.field, s].filter(Boolean).join(" "), children: [
      t ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: i, className: E.label, children: t }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: i, className: E.input, ...r }),
      e ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: [E.hint, o === "danger" ? E.hintDanger : ""].filter(Boolean).join(" "), children: e }) : null
    ] });
  }
  var ut = "_field_2sn7k_1";
  var ht = "_label_2sn7k_8";
  var mt = "_trigger_2sn7k_16";
  var pt = "_triggerValue_2sn7k_44";
  var ft = "_triggerPlaceholder_2sn7k_48";
  var bt = "_listbox_2sn7k_52";
  var yt = "_option_2sn7k_69";
  var gt = "_optionSelected_2sn7k_93";
  var vt = "_optionLabel_2sn7k_97";
  var kt = "_optionDescription_2sn7k_103";
  var y = {
    field: ut,
    label: ht,
    trigger: mt,
    triggerValue: pt,
    triggerPlaceholder: ft,
    listbox: bt,
    option: yt,
    optionSelected: gt,
    optionLabel: vt,
    optionDescription: kt
  };
  function pn({
    label: t,
    value: e,
    options: o,
    onChange: a,
    placeholder: s = "Selecionar",
    disabled: r = false,
    className: l
  }) {
    const [i, d] = (0, import_react.useState)(false), h = (0, import_react.useRef)(null), u = (0, import_react.useRef)(null), k = (0, import_react.useId)();
    (0, import_react.useEffect)(() => {
      if (!i) return;
      function _(f) {
        h.current && !h.current.contains(f.target) && d(false);
      }
      function p(f) {
        var N;
        f.key === "Escape" && (d(false), (N = u.current) == null || N.focus());
      }
      return document.addEventListener("pointerdown", _), document.addEventListener("keydown", p), () => {
        document.removeEventListener("pointerdown", _), document.removeEventListener("keydown", p);
      };
    }, [i]);
    const m = o.find((_) => _.value === e);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: [y.field, l].filter(Boolean).join(" "), ref: h, children: [
      t ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: y.label, children: t }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          ref: u,
          className: y.trigger,
          onClick: () => d((_) => !_),
          disabled: r,
          "aria-haspopup": "listbox",
          "aria-expanded": i,
          "aria-controls": k,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: m ? y.triggerValue : y.triggerPlaceholder, children: m ? m.label : s }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(R, { size: 14, strokeWidth: 1.5, "aria-hidden": "true" })
          ]
        }
      ),
      i ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { id: k, role: "listbox", className: y.listbox, children: o.map((_) => {
        const p = _.value === e;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { role: "none", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            role: "option",
            "aria-selected": p,
            className: [y.option, p ? y.optionSelected : ""].filter(Boolean).join(" "),
            onClick: () => {
              var f;
              a(_.value), d(false), (f = u.current) == null || f.focus();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: y.optionLabel, children: _.label }),
              _.description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: y.optionDescription, children: _.description }) : null
            ]
          }
        ) }, _.value);
      }) }) : null
    ] });
  }
  var wt = "_row_1j04i_1";
  var Nt = "_disabled_1j04i_9";
  var xt = "_text_1j04i_14";
  var $t = "_label_1j04i_20";
  var jt = "_description_1j04i_26";
  var Ct = "_input_1j04i_38";
  var Et = "_track_1j04i_52";
  var Lt = "_thumb_1j04i_61";
  var v = {
    row: wt,
    disabled: Nt,
    text: xt,
    label: $t,
    description: jt,
    switch: "_switch_1j04i_32",
    input: Ct,
    track: Et,
    thumb: Lt
  };
  function fn({ checked: t, onChange: e, label: o, description: a, disabled: s = false, className: r }) {
    const l = (0, import_react.useId)();
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "label",
      {
        htmlFor: l,
        className: [v.row, s ? v.disabled : "", r].filter(Boolean).join(" "),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: v.text, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: v.label, children: o }),
            a ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: v.description, children: a }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: v.switch, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: l,
                type: "checkbox",
                role: "switch",
                className: v.input,
                checked: t,
                disabled: s,
                onChange: (i) => e(i.target.checked)
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: v.track, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: v.thumb }) })
          ] })
        ]
      }
    );
  }
  var Bt = "_root_6kn5d_1";
  var St = "_segment_6kn5d_10";
  var zt = "_active_6kn5d_34";
  var W = {
    root: Bt,
    segment: St,
    active: zt
  };
  function bn({ options: t, value: e, onChange: o, ariaLabel: a, className: s }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "radiogroup", "aria-label": a, className: [W.root, s].filter(Boolean).join(" "), children: t.map((r) => {
      const l = r.value === e;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": l,
          className: [W.segment, l ? W.active : ""].filter(Boolean).join(" "),
          onClick: () => o(r.value),
          children: r.label
        },
        r.value
      );
    }) });
  }
  var Tt = "_tab_38rwx_1";
  var It = "_active_38rwx_14";
  var At = "_body_38rwx_19";
  var Dt = "_shellIcon_38rwx_36";
  var Wt = "_name_38rwx_41";
  var Pt = "_model_38rwx_47";
  var Mt = "_close_38rwx_53";
  var $ = {
    tab: Tt,
    active: It,
    body: At,
    shellIcon: Dt,
    name: Wt,
    model: Pt,
    close: Mt
  };
  function yn({ name: t, model: e, state: o, active: a = false, onClick: s, onClose: r, className: l }) {
    const i = o ? H[o] : "Terminal comum", d = e ? `${i} \xB7 ${e}` : i;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: [$.tab, a ? $.active : "", l].filter(Boolean).join(" "),
        role: "tab",
        "aria-selected": a,
        title: d,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: $.body, onClick: s, children: [
            o ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ie, { state: o }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ie, { size: 16, strokeWidth: 1.5, className: $.shellIcon, "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: $.name, children: t }),
            e ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: $.model, children: e }) : null
          ] }),
          r ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: $.close, onClick: r, "aria-label": `Fechar aba ${t}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(De, { size: 12, strokeWidth: 1.5, "aria-hidden": "true" }) }) : null
        ]
      }
    );
  }
  var Rt = "_card_a5f16_1";
  var Ot = "_text_a5f16_12";
  var Ft = "_meta_a5f16_19";
  var Vt = "_actions_a5f16_28";
  var Kt = "_action_a5f16_28";
  var qt = "_actionLabel_a5f16_58";
  var g = {
    card: Rt,
    text: Ot,
    meta: Ft,
    actions: Vt,
    action: Kt,
    actionLabel: qt
  };
  function gn({ text: t, date: e, project: o, onArchive: a, onSendToSession: s, onCopy: r, className: l }) {
    const i = !!(a || s || r);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: [g.card, l].filter(Boolean).join(" "), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: g.text, children: t }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: g.meta, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: e }),
        o ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: o }) : null
      ] }),
      i ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: g.actions, children: [
        s ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: g.action,
            onClick: s,
            title: "Enviar para sess\xE3o\u2026",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ze, { size: 16, strokeWidth: 1.5, "aria-hidden": "true" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: g.actionLabel, children: "Enviar para sess\xE3o\u2026" })
            ]
          }
        ) : null,
        r ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: g.action, onClick: r, title: "Copiar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Be, { size: 16, strokeWidth: 1.5, "aria-hidden": "true" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: g.actionLabel, children: "Copiar" })
        ] }) : null,
        a ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: g.action, onClick: a, title: "Arquivar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)($e, { size: 16, strokeWidth: 1.5, "aria-hidden": "true" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: g.actionLabel, children: "Arquivar" })
        ] }) : null
      ] }) : null
    ] });
  }
  var Zt = "_overlay_1vfz4_1";
  var Ut = "_dialog_1vfz4_11";
  var Ht = "_title_1vfz4_26";
  var Xt = "_body_1vfz4_34";
  var Gt = "_actions_1vfz4_41";
  var L = {
    overlay: Zt,
    dialog: Ut,
    title: Ht,
    body: Xt,
    actions: Gt
  };
  var Jt = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function vn({ open: t, onClose: e, title: o, children: a, actions: s, className: r }) {
    const l = (0, import_react.useRef)(null), i = (0, import_react.useId)();
    return (0, import_react.useEffect)(() => {
      if (!t) return;
      const d = l.current;
      if (!d) return;
      const h = document.activeElement, u = () => Array.from(d.querySelectorAll(Jt));
      (u()[0] ?? d).focus();
      function m(_) {
        if (_.key === "Escape") {
          _.preventDefault(), e();
          return;
        }
        if (_.key !== "Tab") return;
        const p = u();
        if (p.length === 0) return;
        const f = p[0], N = p[p.length - 1];
        _.shiftKey && document.activeElement === f ? (_.preventDefault(), N.focus()) : !_.shiftKey && document.activeElement === N && (_.preventDefault(), f.focus());
      }
      return document.addEventListener("keydown", m), () => {
        document.removeEventListener("keydown", m), h == null || h.focus();
      };
    }, [t, e]), !t || typeof document > "u" ? null : (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: L.overlay,
          onMouseDown: (d) => {
            d.target === d.currentTarget && e();
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              ref: l,
              role: "dialog",
              "aria-modal": "true",
              "aria-labelledby": i,
              className: [L.dialog, r].filter(Boolean).join(" "),
              tabIndex: -1,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: i, className: L.title, children: o }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: L.body, children: a }),
                s ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: L.actions, children: s }) : null
              ]
            }
          )
        }
      ),
      document.body
    );
  }
  var Qt = "_viewport_1dyiu_1";
  var Yt = "_toast_1dyiu_8";
  var en = "_message_1dyiu_24";
  var tn = "_action_1dyiu_28";
  var I = {
    viewport: Qt,
    toast: Yt,
    message: en,
    action: tn
  };
  function kn({ open: t, message: e, actionLabel: o, onAction: a, onDismiss: s, duration: r = 6e3, className: l }) {
    return (0, import_react.useEffect)(() => {
      if (!t) return;
      const i = window.setTimeout(s, r);
      return () => window.clearTimeout(i);
    }, [t, e, r, s]), !t || typeof document > "u" ? null : (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: I.viewport, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "status", "aria-live": "polite", className: [I.toast, l].filter(Boolean).join(" "), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: I.message, children: e }),
        o && a ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: I.action, onClick: a, children: o }) : null
      ] }) }),
      document.body
    );
  }
  var nn = "_bar_x3ofo_1";
  var on = "_separator_x3ofo_15";
  var an = "_mono_x3ofo_19";
  var B = {
    bar: nn,
    separator: on,
    mono: an
  };
  function wn({ accountLabel: t, modelEffort: e, sessionCount: o, smartZone: a, className: s }) {
    const r = o === 1 ? "1 sess\xE3o" : `${o} sess\xF5es`;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: [B.bar, s].filter(Boolean).join(" "), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t }),
      e ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: B.separator, "aria-hidden": "true", children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: B.mono, children: e })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: B.separator, "aria-hidden": "true", children: "\xB7" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: r }),
      a ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: B.separator, "aria-hidden": "true", children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          be,
          {
            variant: "compact",
            usedTokens: a.usedTokens,
            maxTokens: a.maxTokens
          }
        )
      ] }) : null
    ] });
  }
  return __toCommonJS(donel_design_system_exports);
})();
/**
 * @license lucide-react v1.25.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
window.DonelDesignSystem=DonelDesignSystem.__dsMainNs?Object.assign({},DonelDesignSystem,DonelDesignSystem.__dsMainNs,{__dsMainNs:undefined}):DonelDesignSystem;
