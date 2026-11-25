// ==UserScript==
// @name         斯诺克大师 · 高级瞄准与走位辅助线
// @namespace    snooker-aim-assistant
// @version      1.9.17
// @description  目标球吃库反弹折线改为随当前力度动态伸缩(终点=该力度下的真实停点，与母球吃库蓝线同一观感口径/按力度行程预算截断)、在 147master.cn 整合原生V3物理引擎，提供笔直瞄准延长线、官方微物理引擎母球走位预测弧线(拉杆/跟杆/划弧)、吃库反弹线、真实物理走位vs蓝色落位预测线录制与导出对比系统(控制面板一键启停录制/毫秒级高频采样击打目标球后实际走位轨迹/多维度量化落位与离线误差分析/JSON格式化导出)、母球碰后走位预测引擎重大精度升级(修复微模拟器连续接触提早截断母球走位Bug/0ms瞬时动力学模型重构/切角能量守恒与薄球切向动能无损保留/低杆逆旋强滑移反推模型/四库级连续弹性反弹)、控制面板展开交互核心重构(彻底修复电脑端Chrome浏览器单击加号圆圈时pointerup与click双重竞态瞬间相互抵消导致点击无反应Bug/全端手势防抖锁)、信息浮标原生DOM单层悬浮胶囊(彻底消除Canvas影子重影与跨窗口/Iframe残留遮挡Bug，离开球桌/对局结束/大厅/结算即刻物理销毁，跨文档穿透单例守护确保新对局浮标绝不被旧浮标重叠遮挡)、两阶段独立动态擦除算法(出杆母球飞行阶段白线平滑吞噬/绿线100%完整保留；撞击后绿线平滑吞噬；基于空间欧氏距离精准锁定目标球/彻底根除多红球同色覆盖导致白绿线瞬间消失Bug)、纯净天蓝走位预测线(彻底移除终点白色假想球圆圈)、全台静止瞬间零延迟消隐(彻底删除600ms后置等待/母球停稳瞬间蓝线即刻清空交接新一杆)、独占击球走位物理保护锁_shotMotionLocked(全台母球未停绝对不退出走位渲染)、绿色瞄准线单向走完终结机制(目标球走完瞄准线或未进袋弹库后立即彻底消失/弹库后绝不再绘制任何轨迹残线)、两杆交接快照深度隔离、低杆真实滑动摩擦阻力模型校准、贴库与亨得利半贴库双平行线擦角检测、死局全自动破局、强化入袋动力学与防停球力度补偿、每日挑战自动化击球、单指双击显隐控制面板、母球摔袋预警与最佳出杆力度推荐
// @author       assistant
// @match        *://147master.cn/*
// @match        *://*.147master.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ================================================================== */
  /* 单例保护：跨版本统一锁                                               */
  /* ================================================================== */

  const INSTANCE_KEY = '__snookerAimAssistantInstanceLock__';
  try {
    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = true;
  } catch (_) {}

  const SCRIPT_VERSION = '1.9.17';

  /* ================================================================== */
  /* 配置                                                                */
  /* ================================================================== */

  const CONFIG = {
    cueLineColor: 'rgba(255, 255, 255, 0.95)',
    cueLineWidthPx: 1.5,
    objectLineColor: '#00ff88',
    objectLineWidthPx: 1.6,
    // 【目标球橙色实线力度条】沿绿色瞄准线显示当前力度下目标球能走到的位置；
    // 长度与 computeTargetTravelBudgetMm()/actualReachMm 同源，终点为该力度下的预计停点。
    targetReachBarColor: '#ff9f43',
    targetReachBarMinMm: 5,
    // 进袋判定颜色 (用于信息浮标指示)：稳进高置信为绿色 #00ff88，临界/薄球/低置信为橙色 #ff8c33
    pocketRingColor: '#00ff88',
    pocketEdgeColor: '#ff8c33',

    // 白色假想球样式 (复刻游戏原始实心白色圆周线圈包裹 + 半透明白填充)
    ghostBallColor: 'rgba(255, 255, 255, 0.35)',
    ghostBallStrokeColor: '#ffffff',
    ghostBallStrokeWidthPx: 1.1,

    // 【母球吃库反弹折线】：天蓝色 #86cfff 实线，粗细 1.6px (与绿色瞄准线一致)
    showCushionRebound: true,
    cueCushionReboundColor: '#86cfff', // 游戏原生新手天蓝色反弹线 #86cfff
    cueCushionReboundWidthPx: 1.6,     // 与绿色瞄准线 1.6px 完全一致
    showObjectRebound: true,           // 目标球吃库反弹折线
    showRecPower: true,                // HUD 推荐力度「需X%，当前Y%」
    ghostCueBallColor: 'rgba(134, 207, 255, 0.35)',

    // 默认开启，无需在控制面板中展示
    flatOnCloth: true,
    checkBlock: true,

    // 功能开关默认值
    showObjectLine: true,
    showCueLine: true,
    showCuePostTrajectory: true,
    showHudPill: true,
    showDebug: false,
    // v1.9.10：母球吃库反弹线与母球落位预测线采用同一生命周期：
    // 出杆运动期间整条保留，全台所有球（含母球）停稳后由静态层清除；
    // 冻结快照只用于目标球吃库反弹线，避免该线跟随目标球移动。
    retainShotAssistLines: true,
    retainedShotLineAlpha: 0.72,
    // v1.9.11：上一杆目标球反弹线作为历史参考，压到较低透明度，
    // 避免和当前瞄准的实时反弹线同亮度造成误读。
    retainedTargetReboundAlpha: 0.34,

    // 官方物理引擎仿真微推演 (在击打目标球时提供真实母球划弧走位与多库反弹)
    engineSimEnabled: true,
    engineSimDelayMs: 90,
    cuePostTrajectoryColor: 'rgba(255, 255, 255, 0.95)', // 与白色母球瞄准线保持一致
    cuePostTrajectoryWidthPx: 1.6,
    showGhostStopPosition: true,

    // 物理常数（完全对齐 147master 原生 V3 物理引擎）
    maxCuePowerMmS: 7000,
    canonicalSimSpeedMmS: 3400,
    maxTipOffsetRatio: 0.5,
    maxTipSpeedRetention: 0.95,
    cueSpinEfficiency: 0.70,
    tipDeadzone: 0.02,
    clothSlidingMu: 0.18,
    clothRollingDecelMmS2: 125,
    clothSideSpinDecelRadS2: 16,
    railRestitution: 0.91,
    cushionContactFrictionMu: 0.18,
    jawRestitution: 0.84,
    ballRestitution: 0.95,
    throwFrictionCoef: 0.038,
    // v1.9.4 精确模式：默认完全使用官方 live 的球-球摩擦值。官方 ballContactFrictionMu=0 时，
    // 目标球不会因为母球左右塞获得人造切向冲量/侧旋；该值仅保留为后续校准开关。
    targetBallContactFrictionMu: 0,
    targetMicroDtMs: 0.65,
    // v1.9.8：单次目标球微模拟最多覆盖约 2.5 张台面长度；不再允许 18m 异常长路径。
    targetMaxPathMm: 9000,
    // v1.9.14：目标球吃库反弹线要画到真实停点，而不是在第二库直接截断。
    // 单独放开显示库数与路径上限，不影响母球/其他预测的 maxRebounds。
    targetRestBounces: 5,
    targetRestMaxPathMm: 15000,
    // v1.9.14：显示路径要覆盖慢速收尾阶段；只提高目标球显示推演的步数上限，
    // 不改动其他预测的采样预算。
    targetRestMaxSteps: 18000,
    targetMaxSteps: 9000,
    // 目标球反弹线绘制：按距离采样后投影，避免整条跨台长段被 projectPolyline 丢弃或拉出屏幕。
    targetReboundSampleStepMm: 50,
    // v1.9.15：目标球吃库反弹蓝线改为「随当前力度动态伸缩」，终点 = 该力度下的真实停点，
    // 与母球吃库蓝线同一观感口径。长度由 computeTargetTravelBudgetMm() 的行程预算决定，
    // 物理段仍由微模拟生成，只在显示层按预算截断。关掉即退回 v1.9.14 的固定长度行为。
    targetReboundBudgetEnabled: true,
    // 微模拟只跑到「预算 × 该余量」，不含在绘制上的部分纯粹是白算的步进。
    targetReboundBudgetSimMargin: 1.35,
    // 目标球反弹线真实停点标记（仅当蓝线来自官方引擎 targetPath 时显示）
    showTargetReboundStop: true,
    targetReboundStopColor: '#86cfff',
    targetReboundStopRadiusPx: 2.6,
    // 袋口候选的最低置信度与库口距离容差；库边先于袋口时优先按吃库路线处理。
    pocketMinConfidence: 0.1,
    pocketRailToleranceMm: 40,

    // 物理有效球心边界 (台面 3568.7 x 1778.0 扣除球半径 26.25)
    railBoundX: 1758.1,
    railBoundY: 862.75,
    maxRebounds: 1,

    calibrationKey: 'snooker-aim-assistant-homography-v1',
    panelPosKey: 'snooker-aim-assistant-panel-pos-v1',
    togglesKey: 'snooker-aim-assistant-toggles-v1',
    panelCollapseKey: 'snooker-aim-assistant-collapse-v1',
    panelCircleHiddenKey: 'snooker-aim-assistant-circle-hidden-v1',

    /* 【每日挑战全自动连打 v1.7.11】
       进房即自动开局（免点击按钮）→ 清台自动领取 → 自动进入下一关 → 打完今日全部关卡自动停止
       支持跳过反复清不掉的关卡（保留未完成）、跨天自动重置、串行领取防丢单 */
    dailyAuto: {
      enabled: true,                 // 总开关
      autoStart: true,               // 进入每日挑战房后自动开始击球
      autoAdvance: true,             // 清台领取后自动进入下一关
      autoClaim: true,               // 领取按钮不可点时直接调用官方领取接口
      totalLevels: 8,                // 每日挑战总关卡数
      entryTTLMs: 6 * 60 * 60 * 1000,// 入口埋点有效期（6 小时）
      enterSettleMs: 900,            // 进房后等待首帧稳定再开局
      claimPollMs: 1500,             // 领取状态轮询间隔
      claimTimeoutMs: 15000,         // 领取等待上限
      advanceLobbyWaitMs: 20000,     // 大厅找入口/关卡按钮等待上限
      maxShotsPerLevel: 160,         // 单关击球次数上限（防死循环）
      maxRetryPerLevel: 1,           // 单关未清台时最多自动重试次数
      levelTimeoutMs: 20 * 60 * 1000,// 单关超时上限
    },
  };

  /* ================================================================== */
  /* 命名常量                                                            */
  /* ================================================================== */

  const BALL_RADIUS_MM = 26.25;
  const COLLISION_DIST_MM = BALL_RADIUS_MM * 2;
  const THROAT_WIDTH_MM = 84;

  const POCKET_SOLID_THRESHOLD = 0.5;
  const DEFAULT_CAPTURE_RADIUS = 67.241377;

  /* ================================================================== */
  /* 开关状态持久化                                                       */
  /* ================================================================== */

  const TOGGLE_KEYS = [
    'showObjectLine',
    'showCueLine',
    'showCuePostTrajectory',
    'showCushionRebound',
    'showHudPill',
    'showDebug',
  ];
  let _configVersion = 0;
  let _storageListenerInstalled = false;

  function loadToggles() {
    try {
      const raw = localStorage.getItem(CONFIG.togglesKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const key of TOGGLE_KEYS) {
        if (typeof saved[key] === 'boolean' && CONFIG[key] !== saved[key]) {
          CONFIG[key] = saved[key];
          _configVersion++;
        }
      }
    } catch (_) {}
    if (!_storageListenerInstalled && typeof window !== 'undefined') {
      _storageListenerInstalled = true;
      window.addEventListener('storage', (e) => {
        if (e && e.key === CONFIG.togglesKey) loadToggles();
      });
    }
  }

  function saveToggles() {
    try {
      const obj = {};
      for (const key of TOGGLE_KEYS) obj[key] = CONFIG[key];
      localStorage.setItem(CONFIG.togglesKey, JSON.stringify(obj));
    } catch (_) {}
    _configVersion++;
    _lastRenderKey = null;
    _forceShowUntil = performance.now() + 1200;
    if (typeof mobileDock !== 'undefined' && mobileDock.ensure) mobileDock.ensure();
  }

  loadToggles();

  /* ================================================================== */
  /* 入射角标定曲线                                                      */
  /* ================================================================== */

  const INCIDENCE_CURVES = {
    middle: [[0, 67.3, 1.0], [15, 68.3, 1.0], [30, 66.0, 0.98], [45, 50.6, 0.75], [50, 43.9, 0.65], [55, 36.6, 0.54], [60, 29.2, 0.43], [65, 21.0, 0.31], [70, 12.4, 0.18], [75, 0, 0]],
    corner: [[0, 49.9, 1.0], [10, 47.3, 0.95], [15, 44.8, 0.90], [20, 40.6, 0.81], [25, 35.7, 0.72], [30, 30.7, 0.62], [35, 22.1, 0.44], [40, 14.4, 0.29], [45, 5.7, 0.11], [46, 0, 0]],
  };

  function incidenceAt(type, angleDeg) {
    const curve = INCIDENCE_CURVES[type] || INCIDENCE_CURVES.corner;
    const a = Math.min(Math.abs(angleDeg), curve[curve.length - 1][0]);
    for (let i = 0; i < curve.length - 1; i++) {
      const [a0, w0, c0] = curve[i], [a1, w1, c1] = curve[i + 1];
      if (a >= a0 && a <= a1) {
        const k = a1 === a0 ? 0 : (a - a0) / (a1 - a0);
        return { widthMm: w0 + (w1 - w0) * k, coef: Math.min(1, c0 + (c1 - c0) * k) };
      }
    }
    const last = curve[curve.length - 1];
    return { widthMm: last[1], coef: Math.min(1, last[2]) };
  }

  const FALLBACK_POCKETS = [
    { id: 'middle-top', label: '左侧中袋', type: 'middle', center: { x: 0, y: -957.090867 }, opening: { x: 0, y: -889.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: 0, y: -1 } },
    { id: 'corner-top-right', label: '左侧顶袋', type: 'corner', center: { x: 1814.830006, y: -918.190443 }, opening: { x: 1765.0, y: -870.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: 0.707107, y: -0.707107 } },
    { id: 'corner-bottom-right', label: '右侧顶袋', type: 'corner', center: { x: 1814.830006, y: 918.190443 }, opening: { x: 1765.0, y: 870.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: 0.707107, y: 0.707107 } },
    { id: 'middle-bottom', label: '右侧中袋', type: 'middle', center: { x: 0, y: 957.090867 }, opening: { x: 0, y: 889.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: 0, y: 1 } },
    { id: 'corner-bottom-left', label: '右侧底袋', type: 'corner', center: { x: -1814.830006, y: 918.190443 }, opening: { x: -1765.0, y: 870.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: -0.707107, y: 0.707107 } },
    { id: 'corner-top-left', label: '左侧底袋', type: 'corner', center: { x: -1814.830006, y: -918.190443 }, opening: { x: -1765.0, y: -870.0 }, captureRadius: DEFAULT_CAPTURE_RADIUS, throatWidthMm: THROAT_WIDTH_MM, dropDirection: { x: -0.707107, y: -0.707107 } },
  ];

  /* ================================================================== */
  /* 通用向量与几何工具                                                  */
  /* ================================================================== */

  const V = {
    len: (p) => Math.hypot(p.x, p.y),
    lenSq: (p) => p.x * p.x + p.y * p.y,
    norm: (p) => {
      const l = Math.hypot(p.x, p.y);
      return l > 1e-9 ? { x: p.x / l, y: p.y / l } : { x: 0, y: 0 };
    },
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
    dot: (a, b) => a.x * b.x + a.y * b.y,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    rotate: (p, rad) => {
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
    },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function distToSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
  }

  function safeGet(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      devLog('warn', 'safeGet 捕获异常:', err);
      return fallback;
    }
  }

  function devLog(level, ...args) {
    if (CONFIG.showDebug) {
      (console[level] || console.log).call(console, '[aim-assistant]', ...args);
    }
  }

  function polylineLength(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += V.dist(pts[i - 1], pts[i]);
    return total;
  }

  // 按累计长度截断折线（配合物理上界与阻尼定标使用）
  function trimPolyline(pts, maxLen) {
    if (!pts || pts.length < 2 || !Number.isFinite(maxLen) || maxLen <= 0) return pts;
    let acc = 0;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + d >= maxLen) {
        const t = d > 0 ? (maxLen - acc) / d : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        return out;
      }
      acc += d;
      out.push(b);
    }
    return out;
  }

  /**
   * 【v1.9.15】按累计长度截断「{from,to} 段」形式的反弹折线。
   * trimPolyline 只吃点数组，而目标球反弹线在内部一直是段数组（segments），
   * 这里补一个同语义的段版本，供「目标球蓝线按力度预算截断」使用。
   * @returns {{segments: Array, endPoint: ({x:number,y:number}|null), trimmed: boolean}}
   */
  function trimReboundSegmentsByLength(segments, maxLen) {
    const list = Array.isArray(segments) ? segments : [];
    const limit = Number(maxLen);
    if (!list.length) return { segments: [], endPoint: null, trimmed: false };
    if (!Number.isFinite(limit) || limit <= 0) {
      return { segments: [], endPoint: null, trimmed: true };
    }

    const out = [];
    let acc = 0;
    for (const seg of list) {
      if (!seg) continue;
      const a = seg.from || seg.p1;
      const b = seg.to || seg.p2;
      if (!a || !b) continue;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) ||
          !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= 1e-6) continue;

      if (acc + d >= limit) {
        const t = (limit - acc) / d;
        const end = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        // 剩余长度不足半个像素对应的物理量时不再追加退化段，直接以终点收尾。
        if (limit - acc > 0.5) {
          out.push({ ...seg, from: { x: a.x, y: a.y }, to: end });
        }
        return { segments: out, endPoint: end, trimmed: true };
      }
      acc += d;
      out.push({ ...seg, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } });
    }

    const last = out.length ? out[out.length - 1] : null;
    return {
      segments: out,
      endPoint: last ? { x: last.to.x, y: last.to.y } : null,
      trimmed: false,
    };
  }

  /**
   * 从官方引擎 targetPath 中截取「第一库之后」的反弹段。
   * 官方 targetPath 是目标球碰后到真实停点的完整逐帧轨迹，包含真实库边反弹、
   * 多库衰减与最终停点；这里以绿色瞄准线终点（第一库接触点）为锚点，
   * 只保留锚点之后的轨迹，供目标球蓝色反弹线直接使用。
   * @returns {Array<{x:number,y:number}>|null}
   */
  function sliceEngineReboundPath(targetPath, joinPoint, toleranceMm = 120) {
    if (!Array.isArray(targetPath) || targetPath.length < 2) return null;
    if (!joinPoint || !Number.isFinite(joinPoint.x) || !Number.isFinite(joinPoint.y)) return null;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < targetPath.length; i++) {
      const p = targetPath[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const d = Math.hypot(p.x - joinPoint.x, p.y - joinPoint.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // 目标球在到达第一库前就停下（或引擎轨迹没跑到库边）时，没有反弹段。
    if (bestIdx < 0 || bestIdx >= targetPath.length - 1) return null;
    if (bestDist > Math.max(20, Number(toleranceMm) || 120)) return null;

    const out = [{ x: joinPoint.x, y: joinPoint.y }];
    for (let i = bestIdx + 1; i < targetPath.length; i++) {
      const p = targetPath[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const last = out[out.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
      out.push({ x: p.x, y: p.y });
    }
    return out.length >= 2 ? out : null;
  }

  // 提取折线中的撞库拐点（夹角突变 >60°）
  function detectJunctions(pts) {
    const out = [];
    if (!pts || pts.length < 3) return out;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = V.norm(V.sub(pts[i], pts[i - 1]));
      const b = V.norm(V.sub(pts[i + 1], pts[i]));
      if (V.len(a) < 1e-6 || V.len(b) < 1e-6) continue;
      if (V.dot(a, b) < 0.5) out.push(pts[i]);
    }
    return out;
  }

  function readTableBounds(state) {
    let boundX = CONFIG.railBoundX;
    let boundY = CONFIG.railBoundY;
    const tcs = state && state.tableColliderSet;
    if (tcs && typeof tcs === 'object') {
      const b = tcs.bounds || tcs.tableBounds || tcs.playfieldBounds;
      if (b && typeof b === 'object') {
        const rawX = Number(b.maxX ?? b.halfWidth ?? b.x);
        const rawY = Number(b.maxY ?? b.halfHeight ?? b.y);
        if (Number.isFinite(rawX) && rawX > 1000) {
          boundX = rawX > 1770 ? rawX - BALL_RADIUS_MM : rawX;
        }
        if (Number.isFinite(rawY) && rawY > 500) {
          boundY = rawY > 875 ? rawY - BALL_RADIUS_MM : rawY;
        }
      }
    }
    return {
      boundX,
      boundY,
      cushionX: boundX + BALL_RADIUS_MM,
      cushionY: boundY + BALL_RADIUS_MM,
    };
  }

  function rayRailHit(origin, dir, cushionX = CONFIG.railBoundX, cushionY = CONFIG.railBoundY, pockets = null) {
    const d = V.norm(dir);
    if (V.len(d) < 1e-6) return null;

    const margin = 0.8;
    const ox = clamp(origin.x, -cushionX + margin, cushionX - margin);
    const oy = clamp(origin.y, -cushionY + margin, cushionY - margin);
    const safeOrigin = { x: ox, y: oy };

    let best = null;
    const consider = (t, axis) => {
      if (!Number.isFinite(t) || t <= 1e-3) return;
      if (!best || t < best.t) {
        best = {
          t,
          axis,
          normal: axis === 'x' ? { x: d.x > 0 ? -1 : 1, y: 0 } : { x: 0, y: d.y > 0 ? -1 : 1 },
          point: { x: ox + d.x * t, y: oy + d.y * t },
        };
      }
    };

    if (d.x > 1e-6) consider((cushionX - ox) / d.x, 'x');
    else if (d.x < -1e-6) consider((-cushionX - ox) / d.x, 'x');

    if (d.y > 1e-6) consider((cushionY - oy) / d.y, 'y');
    else if (d.y < -1e-6) consider((-cushionY - oy) / d.y, 'y');

    if (best && Array.isArray(pockets)) {
      for (const pk of pockets) {
        if (!pk || !pk.opening || !pk.normal || !pk.tangent) continue;
        const toward = V.dot(d, pk.normal);
        if (toward <= 0.1) continue;
        const depth = V.dot(V.sub(pk.opening, safeOrigin), pk.normal);
        if (depth <= 0) continue;
        const s = depth / toward;
        if (s <= best.t || s - best.t > 140) continue;
        const arrive = V.add(safeOrigin, V.scale(d, s));
        const tan = Math.abs(V.dot(V.sub(arrive, pk.opening), pk.tangent));
        const jawHalf = (pk.throatWidthMm || THROAT_WIDTH_MM) * 0.5;
        if (tan <= jawHalf) {
          return {
            t: s,
            axis: 'jaw',
            point: arrive,
          };
        }
      }
    }

    return best;
  }

  function rayFirstBall(origin, dir, balls, ignoreIds) {
    const d = V.norm(dir);
    if (V.len(d) < 1e-6) return null;
    let best = null;
    for (const ball of balls) {
      if (!ball || ball.potted || !ball.pos) continue;
      if (ignoreIds && ignoreIds.has(ball.id)) continue;
      const rc = rayContact(origin, d, ball);
      if (rc && (!best || rc.tHit < best.tHit)) {
        best = { ball, ...rc };
      }
    }
    return best;
  }

  /* ================================================================== */
  /* 跨窗口 / 子 iframe 穿透枚举工具                                     */
  /* ================================================================== */

  function collectCandidateWindows() {
    const list = [];
    const seen = new Set();
    const pushWin = (w) => {
      if (!w || seen.has(w)) return;
      seen.add(w);
      list.push(w);
    };

    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow) pushWin(unsafeWindow); } catch (_) {}
    pushWin(window);

    let root = window;
    try {
      while (root.parent && root.parent !== root) {
        if (root.parent.document) {
          root = root.parent;
          pushWin(root);
        } else {
          break;
        }
      }
    } catch (_) {}
    try {
      if (window.top && window.top !== root) {
        pushWin(window.top);
        root = window.top;
      }
    } catch (_) {}

    const walkFrames = (win, depth) => {
      if (!win || depth > 5) return;
      let frames = null;
      try { frames = win.frames; } catch (_) { return; }
      if (!frames || typeof frames.length !== 'number') return;
      for (let i = 0; i < frames.length; i++) {
        const child = frames[i];
        try {
          if (child && child.document) {
            pushWin(child);
            walkFrames(child, depth + 1);
          }
        } catch (_) {}
      }
    };
    try { walkFrames(root, 0); } catch (_) {}

    return list;
  }

  /**
   * 全局穿透式清理所有候选窗口中的孤立信息浮标 (HUD Pill)
   * @param {boolean} keepActive - 是否保留当前活跃的 hudPill.el
   */
  function cleanAllOrphanHudPills(keepActive = true) {
    const wins = collectCandidateWindows();
    for (const win of wins) {
      try {
        if (!win || !win.document) continue;
        const pills = win.document.querySelectorAll('#snooker-aim-hud-pill');
        for (const el of pills) {
          if (!keepActive || (typeof hudPill !== 'undefined' && el !== hudPill.el)) {
            el.remove();
          }
        }
      } catch (_) {}
    }
  }

  /* ================================================================== */
  /* 【途径 1】 原生 Web Worker 拦截与动力学折线同步桥梁                   */
  /* ================================================================== */

  const _hookedWorkers = new WeakSet();

  const NativeWorkerBridge = {
    activeWorker: null,
    latestAim: null,
    latestRequest: null,
    lastAimTime: 0,
    lastRequestTime: 0,

    initWindow(win) {
      if (!win) return;
      try {
        const OriginalWorker = win.Worker;
        if (!OriginalWorker || OriginalWorker.__snookerHooked) return;

        function SnookerHookedWorker(scriptURL, options) {
          const worker = new OriginalWorker(scriptURL, options);
          try {
            NativeWorkerBridge.trackWorker(worker, scriptURL);
          } catch (_) {}
          return worker;
        }

        SnookerHookedWorker.prototype = OriginalWorker.prototype;
        SnookerHookedWorker.__snookerHooked = true;
        win.Worker = SnookerHookedWorker;
      } catch (_) {}
    },

    trackWorker(worker, scriptURL) {
      if (!worker || _hookedWorkers.has(worker)) return;
      _hookedWorkers.add(worker);
      const urlStr = String(scriptURL || '');
      if (urlStr.includes('aim-worker') || urlStr.includes('worker') || !NativeWorkerBridge.activeWorker) {
        NativeWorkerBridge.activeWorker = worker;
      }

      // 捕获游戏发给 Worker 的原始请求载荷：其中的 physicsOverrides 才是
      // 当前球桌真正使用的物理参数（本地重建的 getParams 可能已被旧配置污染）。
      try {
        const origPost = worker.postMessage;
        worker.postMessage = function (msg, transfer) {
          try {
            if (msg && typeof msg === 'object' && msg.payload && msg.payload.shot) {
              NativeWorkerBridge.latestRequest = msg;
              NativeWorkerBridge.lastRequestTime = performance.now();
            }
          } catch (_) {}
          return origPost.apply(this, arguments);
        };
      } catch (_) {}

      worker.addEventListener('message', (ev) => {
        try {
          const data = ev && ev.data;
          if (!data) return;
          if (data.result) {
            const res = data.result;
            const now = performance.now();
            if (Array.isArray(res.targetPath) || Array.isArray(res.cuePath)) {
              NativeWorkerBridge.latestAim = res;
              NativeWorkerBridge.lastAimTime = now;
            }
          }
        } catch (_) {}
      });
    },

    enableReboundInCore(core) {
      if (!core) return;
      try {
        if (typeof core.getConfig === 'function') {
          const cfg = core.getConfig();
          if (cfg && cfg.aim && cfg.aim.values) {
            cfg.aim.values.reboundEnabled = true;
            cfg.aim.values.cueBallReboundEnabled = true;
          }
        }
        if (typeof core.updateTuning === 'function') {
          core.updateTuning({
            aim: { reboundEnabled: true, cueBallReboundEnabled: true }
          });
        }
      } catch (_) {}
    }
  };

  // 脚本启动立即注入顶级窗口
  NativeWorkerBridge.initWindow(window);
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
      NativeWorkerBridge.initWindow(unsafeWindow);
    }
  } catch (_) {}

  /* ================================================================== */
  /* 官方物理引擎无头微模拟器 (沙箱提取 game-core 模块 68 进行逐帧物理推演)  */
  /* ================================================================== */

  const engineSim = {
    status: 'idle', // idle | loading | ready | failed
    error: null,
    fn: null,
    key: null,
    result: null,
    timer: 0,
    pendingKey: null,
    payloadFactory: null,
    simMs: 0,
    frames: 0,
    _nativeCacheKey: '',
    _nativeCacheResult: null,

    bundleUrl() {
      const cfg = (typeof window !== 'undefined' && window.SnookerLocalLiteConfig) || null;
      const prefix = (cfg && typeof cfg.prefix === 'string' && cfg.prefix) || '/engine/local-lite/';
      return prefix.replace(/\/+$/, '') + '/runtime/game-core.bundle.js';
    },

    load() {
      if (this.status !== 'idle') return;
      this.status = 'loading';
      if (typeof fetch !== 'function') {
        this.status = 'failed';
        this.error = 'fetch unavailable';
        return;
      }
      fetch(this.bundleUrl(), { cache: 'force-cache' })
        .then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then((src) => {
          const idx = src.lastIndexOf('load(0);');
          if (idx < 0) throw new Error('bundle 入口未找到');

          // 快照隔离保护：保留页面原有的 window.Snooker* 全局，绝不干扰游戏本体
          const snapshot = {};
          if (typeof window !== 'undefined') {
            for (const key of Object.keys(window)) {
              if (key.startsWith('Snooker')) snapshot[key] = window[key];
            }
          }

          (0, eval)(src.slice(0, idx) + 'window.__snkAimLoad = load;\n})();');
          const loader = window.__snkAimLoad;
          if (typeof loader !== 'function') throw new Error('loader 提取失败');

          const rt = loader(68);
          if (!rt || typeof rt.simulateShot !== 'function') throw new Error('simulateShot 缺失');
          this.fn = rt.simulateShot;

          const payloadMod = loader(2);
          this.__payload = (payloadMod && typeof payloadMod.createShotRuntimePayload === 'function') ? payloadMod : null;

          // 恢复页面原有的 Snooker* 全局，清掉本次 eval 临时注入的
          if (typeof window !== 'undefined') {
            for (const key of Object.keys(window)) {
              if (key.startsWith('Snooker') && !(key in snapshot)) {
                try { delete window[key]; } catch (_) {}
              }
            }
            for (const key of Object.keys(snapshot)) {
              window[key] = snapshot[key];
            }
          }

          this.loadModule = loader;
          this.params = this.resolvePhysicsParams(loader);
          this.status = 'ready';
        })
        .catch((err) => {
          this.status = 'failed';
          this.error = String((err && err.message) || err);
        });
    },

    resolvePhysicsParams(loader, force) {
      const cfg = (typeof window !== 'undefined' && window.GAME_CLIENT_CONFIG) || {};
      const core = capturedCore || (typeof window !== 'undefined' && window.threeGame && window.threeGame.core);
      const coreConfig = (core && (typeof core.getConfig === 'function' ? core.getConfig() : core.config)) || {};
      const cfgPh = (cfg && cfg.physics) || {};
      const corePh = (coreConfig && coreConfig.physics) || {};
      const cfgHas = Object.keys(cfgPh.overrides || {}).length > 0 || Object.keys(cfgPh.settings || {}).length > 0;
      const ph = cfgHas ? cfgPh : (corePh || {});
      const settings = ph.settings || {};
      const ov = ph.overrides || {};
      const hasConfig = Object.keys(ov).length > 0 || Object.keys(settings).length > 0;
      if (!force && this.params && (this.paramsFromConfig || !hasConfig)) return this.params;

      const isV3 = settings.physicsEngine !== 'v2' && settings.physicsEngine !== 'legacy';
      // 强制严格 V3 物理参数基线：绝不回落到旧版 7800 / 60 导致落位成倍超出的常数
      const baseOverrides = {
        clothRollingDecelMmS2: 125,
        tableSlidingAccel: 1667.7,
        maxCuePower: 7000,
        ...ov,
      };
      const opts = isV3 ? { physicsEngine: 'v3', v3: baseOverrides } : { ...baseOverrides };
      opts.ballClusterLogic = 'hybrid';
      opts.targetPhysicsHz = 120;
      opts.pocketCaptureMode = ['angle', 'controlled', 'immediate', 'live'].indexOf(settings.pocketCaptureMode) >= 0
        ? settings.pocketCaptureMode : 'angle';
      opts.pocketVisualMotionEnabled = true;

      let params = null;
      try {
        if (typeof loader === 'function') {
          const PE = loader(69);
          if (PE && typeof PE.createPhysicsEngine === 'function') {
            params = PE.createPhysicsEngine(opts).params;
          }
        }
      } catch (_) {}
      if (!params) params = isV3 ? { physicsEngine: 'v3', v3: baseOverrides } : { ...baseOverrides };

      if (params) {
        const v3 = params.v3 || {};
        const pwr = Number.isFinite(v3.maxCuePower) ? v3.maxCuePower : params.maxCuePower;
        if (Number.isFinite(pwr) && pwr > 0) {
          CONFIG.maxCuePowerMmS = pwr;
        }
        const roll = Number.isFinite(v3.clothRollingDecelMmS2) ? v3.clothRollingDecelMmS2 : params.clothRollingDecelMmS2;
        if (Number.isFinite(roll) && roll >= 80) CONFIG.clothRollingDecelMmS2 = roll;
        const slide = Number.isFinite(v3.tableSlidingAccel) ? v3.tableSlidingAccel : params.tableSlidingAccel;
        if (Number.isFinite(slide) && slide > 0) {
          CONFIG.tableSlidingAccelMmS2 = slide;
        }
      }
      this.params = params;
      this.paramsFromConfig = hasConfig;
      return params;
    },

    payloadApi() {
      if (this.__payload) return this.__payload;
      const globalApi = typeof window !== 'undefined' && window.SnookerShotRuntimePayload;
      if (globalApi && typeof globalApi.createShotRuntimePayload === 'function') {
        this.__payload = globalApi;
        return globalApi;
      }
      try {
        const mod = this.loadModule ? this.loadModule(2) : null;
        if (mod && typeof mod.createShotRuntimePayload === 'function') {
          this.__payload = mod;
          return mod;
        }
      } catch (_) {}
      return null;
    },

    getParams() {
      const cfg = (typeof window !== 'undefined' && window.GAME_CLIENT_CONFIG) || {};
      const core = capturedCore || (typeof window !== 'undefined' && window.threeGame && window.threeGame.core);
      const hasDynamicConfig = Boolean(
        (cfg && cfg.physics) ||
        (core && (core.config || (typeof core.getConfig === 'function' && core.getConfig())))
      );
      if (!this.params || (!this.paramsFromConfig && hasDynamicConfig)) {
        this.resolvePhysicsParams(this.loadModule || null, false);
      }
      return this.params || {};
    },

    // 复用游戏 Worker 最近一次真实反弹请求。它包含当前球桌的内核物理参数、
    // 精确球位与官方 shot 状态；只要当前瞄准与它一致，直接返回该载荷，
    // 这样复算的入射/反射角与游戏 Worker 使用的官方输入完全同源。
    compatibleWorkerPayload(state, shot, boundary) {
      const req = NativeWorkerBridge.latestRequest;
      const p = req && req.payload;
      if (!p || !p.shot || !Array.isArray(p.balls)) return null;
      if (performance.now() - NativeWorkerBridge.lastRequestTime > 1500) return null;
      if (p.predictionKind !== 'rebound') return null;
      if (p.tableBoundaryId !== boundary) return null;
      if ((state.cueBallId || 'cue') !== (p.cueBallId || 'cue')) return null;
      if (p.balls.length !== (state.balls || []).filter((b) => b && b.pos).length) return null;

      const dir = shot && shot.direction;
      const wdir = p.shot.direction;
      if (!dir || !wdir) return null;
      const dot = V.dot(V.norm(dir), V.norm(wdir));
      if (!Number.isFinite(dot) || dot < 0.9995) return null;

      const pw = Number(p.shot.power);
      const pc = Number(shot.power);
      if (!Number.isFinite(pw) || pw <= 0) return null;
      if (!Number.isFinite(pc) || Math.abs(pw - pc) > 4) return null;

      const wt = p.shot.tipOffset || { x: 0, y: 0 };
      const ct = (shot && shot.tip) || { x: 0, y: 0 };
      if (Math.abs((Number(wt.x) || 0) - (Number(ct.x) || 0)) > 0.08) return null;
      if (Math.abs((Number(wt.y) || 0) - (Number(ct.y) || 0)) > 0.08) return null;
      if (Math.abs((Number(p.shot.verticalAngle) || 0) - (Number(shot.verticalAngle) || 0)) > 3) return null;

      const byId = new Map((p.balls || []).map((b) => [b.id, b]));
      for (const b of state.balls || []) {
        if (!b || !b.pos) continue;
        const wb = byId.get(b.id);
        if (!wb || !wb.pos) return null;
        if (Math.hypot(b.pos.x - wb.pos.x, b.pos.y - wb.pos.y) > 2) return null;
        if (Boolean(b.potted) !== Boolean(wb.potted)) return null;
      }

      // 直接使用官方请求载荷（保留 physicsOverrides/expectedColliderId 等字段）
      return p;
    },

    buildPayload(state, shot) {
      const api = this.payloadApi();
      const balls = (state.balls || [])
        .filter((b) => b && b.pos && Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y))
        .map((b) => ({
          id: b.id,
          kind: b.kind,
          pos: { x: b.pos.x, y: b.pos.y },
          radius: Number.isFinite(b.radius) ? b.radius : BALL_RADIUS_MM,
          potted: Boolean(b.potted),
        }));

      const liteCfg = (typeof window !== 'undefined' && window.SnookerLocalLiteConfig) || null;
      const core = capturedCore || (typeof window !== 'undefined' && window.threeGame && window.threeGame.core);
      const coreConfig = (core && (typeof core.getConfig === 'function' ? core.getConfig() : core.config)) || {};
      const boundary = (liteCfg && liteCfg.boundary) ||
        (state.table && state.table.tableBoundaryId) ||
        (coreConfig && coreConfig.physics && coreConfig.physics.settings && coreConfig.physics.settings.tableBoundaryId) ||
        (typeof window !== 'undefined' && window.GAME_CLIENT_CONFIG &&
         window.GAME_CLIENT_CONFIG.physics &&
         window.GAME_CLIENT_CONFIG.physics.settings &&
         window.GAME_CLIENT_CONFIG.physics.settings.tableBoundaryId) ||
        'local-table-892b5cb90e552ac1a09f-pockets-v2';

      const exact = this.compatibleWorkerPayload(state, shot, boundary);
      if (exact) return exact;

      const payloadObj = {
        tableBoundaryId: boundary,
        cueBallId: state.cueBallId || 'cue',
        balls,
        shot: {
          direction: { x: shot.direction.x, y: shot.direction.y },
          power: shot.power,
          tipOffset: { x: shot.tip.x, y: shot.tip.y },
          verticalAngle: shot.verticalAngle || 0,
        },
        physicsOverrides: (() => {
          // 优先复用游戏 Worker 最近一次真实请求里的物理参数。
          // 这是当前球桌的内核参数（含 v3 的库边摩擦/鼻高/回弹），
          // 比本地 getParams() 重建更可靠，直接决定反弹角是否与官方一致。
          const req = NativeWorkerBridge.latestRequest;
          const p = req && req.payload;
          if (p && p.physicsOverrides &&
              p.tableBoundaryId === boundary &&
              (performance.now() - NativeWorkerBridge.lastRequestTime) < 5000) {
            return p.physicsOverrides;
          }
          return this.getParams();
        })(),
      };

      if (api && typeof api.createShotRuntimePayload === 'function') {
        try {
          return api.createShotRuntimePayload(payloadObj);
        } catch (_) {}
      }
      return payloadObj;
    },

    run(payload) {
      const started = performance.now();
      const res = this.fn(payload);
      this.simMs = Math.max(0, Math.round(performance.now() - started));
      const frames = Array.isArray(res.frames) ? res.frames : [];
      const events = Array.isArray(res.events) ? res.events : [];
      this.frames = frames.length;
      const cueId = payload.cueBallId || 'cue';
      const hit = events.find((e) => e.type === 'ball-hit-ball' &&
        (e.ballAId === cueId || e.ballBId === cueId));

      if (!hit) {
        return {
          hit: false,
          targetId: null,
          targetPath: [],
          cuePath: [],
          potted: false,
          cuePotted: false,
          simMs: this.simMs,
          frames: frames.length,
        };
      }

      const targetId = hit.ballAId === cueId ? hit.ballBId : hit.ballAId;
      const hitT = Number(hit.t) || 0;
      const at = (frame, id) => (frame.balls || []).find((b) => b.id === id) || null;

      const cueNext = events
        .filter((e) => e.type === 'ball-hit-ball'
          && (e.ballAId === cueId || e.ballBId === cueId)
          && e !== hit
          && (e.ballAId !== targetId && e.ballBId !== targetId)
          && Number(e.t) > hitT + 0.08)
        .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))[0] || null;
      const nextT = cueNext ? (Number(cueNext.t) || 0) : Infinity;
      const nextBallId = cueNext ? (cueNext.ballAId === cueId ? cueNext.ballBId : cueNext.ballAId) : null;

      const sample = (id, minStep, fromT, toT) => {
        const pts = [];
        let last = null;
        for (const f of frames) {
          if (f.t + 1e-6 < fromT) continue;
          if (Number.isFinite(toT) && f.t > toT + 1e-6) break;
          const b = at(f, id);
          if (!b || !b.pos) continue;
          const p = { x: b.pos.x, y: b.pos.y };
          if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minStep) { pts.push(p); last = p; }
        }
        return pts;
      };

      const targetPath = sample(targetId, 6, 0);
      let cuePath = sample(cueId, 5, hitT, nextT);
      const lastFrame = frames[frames.length - 1];
      const tb = lastFrame ? at(lastFrame, targetId) : null;
      const cb = lastFrame ? at(lastFrame, cueId) : null;

      // sample() 以 6mm 最小步长采样，最后一小段蠕动可能不足 6mm 而被丢掉；
      // 这里补上目标球最终停点，保证蓝线终点/停点标记就是引擎真实停点。
      if (tb && tb.pos && !tb.potted &&
          Number.isFinite(tb.pos.x) && Number.isFinite(tb.pos.y)) {
        const lastTarget = targetPath[targetPath.length - 1];
        if (!lastTarget || Math.hypot(tb.pos.x - lastTarget.x, tb.pos.y - lastTarget.y) > 0.01) {
          targetPath.push({ x: tb.pos.x, y: tb.pos.y });
        }
      }

      // 目标球第一次真实碰库事件：用事件时间切出「第一库之后」的官方轨迹。
      // 比按最近点匹配更可靠，避免目标球多库折返后靠近首库点时切错位置。
      const targetRailEvent = events
        .filter((e) => e && e.type === 'ball-hit-rail' &&
          (e.ballId === targetId || e.ballAId === targetId || e.ballBId === targetId) &&
          Number(e.t) >= hitT - 1e-6)
        .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))[0] || null;
      const targetFirstRailT = targetRailEvent && Number.isFinite(Number(targetRailEvent.t))
        ? Number(targetRailEvent.t) : null;
      const targetPathAfterRail = (targetFirstRailT != null)
        ? sample(targetId, 6, targetFirstRailT)
        : [];
      if (targetPathAfterRail.length && tb && tb.pos && !tb.potted &&
          Number.isFinite(tb.pos.x) && Number.isFinite(tb.pos.y)) {
        const lastAfterRail = targetPathAfterRail[targetPathAfterRail.length - 1];
        if (!lastAfterRail || Math.hypot(tb.pos.x - lastAfterRail.x, tb.pos.y - lastAfterRail.y) > 0.01) {
          targetPathAfterRail.push({ x: tb.pos.x, y: tb.pos.y });
        }
      }

      // v1.9.17：橙色实线复用官方引擎的「第一库前真实路径」。
      // targetPath 是从碰后到最终停点的整段轨迹；橙色线只负责第一库/袋口之前，
      // 因此这里按第一次碰库事件切出前段。无碰库（含直接落袋/中途停球）时保留整段。
      const targetPathBeforeRail = (targetFirstRailT != null)
        ? sample(targetId, 6, 0, targetFirstRailT)
        : targetPath.slice();
      // 采样在碰库事件前最后一帧可能还差十几毫米才到库边；把碰库后的首个轨迹点
      // 作为第一库接触点补进来，橙色线才能真正停在库边，而不是停在库边前。
      if (targetPathBeforeRail.length && targetPathAfterRail.length >= 1) {
        const railContact = targetPathAfterRail[0];
        const lastBefore = targetPathBeforeRail[targetPathBeforeRail.length - 1];
        if (railContact && Number.isFinite(railContact.x) && Number.isFinite(railContact.y) &&
            lastBefore && Math.hypot(railContact.x - lastBefore.x, railContact.y - lastBefore.y) > 0.01) {
          targetPathBeforeRail.push({ x: railContact.x, y: railContact.y });
        }
      }

      // 库边阻尼与旋转损耗定标 (根据 39 杆实测数据真实拟合，低杆与多次碰库不再过度截断)
      if (cuePath.length >= 2) {
        const railBounces = events.filter((e) => e.type === 'ball-hit-rail' &&
          (e.ballId === cueId || e.ballAId === cueId || e.ballBId === cueId) &&
          Number(e.t) >= hitT - 1e-6 && Number(e.t) <= nextT + 1e-6).length;
        const junctions = detectJunctions(cuePath);
        const bounceCount = Math.max(railBounces, junctions.length);

        const tipY = (payload.shot && payload.shot.tipOffset && Number(payload.shot.tipOffset.y)) || 0;
        const tipCategory = tipY > 0.15 ? 'follow' : (tipY < -0.15 ? 'draw' : 'mid');

        // 实测经验矩阵: { 0库, 1库, 2+库 }
        const CALIB_RATIOS = {
          mid:    { 0: 0.98, 1: 0.97, 2: 0.95 },
          follow: { 0: 0.99, 1: 0.96, 2: 0.95 },
          draw:   { 0: 1.00, 1: 0.98, 2: 0.95 },
        };
        const bKey = Math.min(bounceCount, 2);
        const ratio = (CALIB_RATIOS[tipCategory] && CALIB_RATIOS[tipCategory][bKey]) || 0.98;

        if (ratio < 0.999) {
          const rawLen = polylineLength(cuePath);
          if (rawLen > 50) {
            cuePath = trimPolyline(cuePath, rawLen * ratio);
          }
        }
      }

      return {
        hit: true,
        targetId,
        targetPath,
        targetPathBeforeRail,
        targetFirstRailT,
        targetPathAfterRail,
        cuePath,
        potted: Boolean(tb && tb.potted),
        cuePotted: Boolean(cb && cb.potted),
        cueNextBallId: nextBallId,
        cueNextT: Number.isFinite(nextT) ? nextT : null,
        contactT: hitT,
        simMs: this.simMs,
        frames: frames.length,
      };
    },

    // 【母球吃库反弹：官方内核两库段】
    // 直接调用本地 game-core 的 module 67 createReboundInput + module 68
    // startShot/stepShot，逐物理步进：
    // 起点 = 母球第一次碰到的库边接触点；
    // 终点 = 反弹后第二次碰到的库边接触点（若中途碰球/停球则提前结束）。
    nativeTwoRail(payload, cacheKey) {
      if (!payload) return null;
      const ck = cacheKey ? String(cacheKey) : '';
      if (ck && this._nativeCacheKey === ck && this._nativeCacheResult) {
        return this._nativeCacheResult;
      }
      if (this.status === 'idle') this.load();
      if (this.status !== 'ready') return null;
      const Runtime = this.loadModule ? this.loadModule(68) : null;
      const mod = this.loadModule ? this.loadModule(67) : null;
      if (!Runtime || typeof Runtime.startShot !== 'function' ||
          !mod || typeof mod.createReboundInput !== 'function') {
        return null;
      }
      try {
        const contact = payload.expectedColliderId
          ? { line: { id: payload.expectedColliderId, role: payload.expectedColliderRole } }
          : {};
        const input = mod.createReboundInput(payload, contact);
        const p = input.payload || payload;
        const rt = Runtime.startShot({ ...p, captureFrames: false, maxSeconds: 18 });
        const state = rt.state;
        const physics = rt.physics;
        if (!state || !physics || typeof physics.step !== 'function') return null;
        const cue = (state.balls || []).find((b) => b.id === state.cueBallId);
        if (!cue) return null;

        const dt = physics.params && physics.params.fixedDt;
        if (!Number.isFinite(dt) || dt <= 0) return null;
        const radius = Number.isFinite(Number(cue.radius)) ? Number(cue.radius) : BALL_RADIUS_MM;
        const path = [];
        let last = null;
        let first = null;
        let second = null;
        let travelledMm = 0;

        const add = (pt) => {
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
          if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
            path.push({ x: pt.x, y: pt.y });
            last = { x: pt.x, y: pt.y };
          }
        };
        const railPoint = (event, fallback) => {
          if (event && event.point && event.normal) {
            return {
              x: event.point.x + event.normal.x * radius,
              y: event.point.y + event.normal.y * radius,
            };
          }
          return fallback ? { x: fallback.x, y: fallback.y } : null;
        };

        for (let i = 0; i < Math.ceil(18 / dt); i++) {
          const before = { x: cue.pos.x, y: cue.pos.y };
          physics.step(state, dt);
          const events = (state.physicsEvents || []).filter((e) =>
            e && (e.ballId === cue.id || e.ballAId === cue.id || e.ballBId === cue.id));
          const railEvent = events.find((e) =>
            e.type === 'ball-hit-rail' || e.type === 'ball-hit-pocket-jaw');

          if (!first) {
            if (railEvent) {
              first = railPoint(railEvent, before);
              add(first);
            } else if (events.length) {
              // 第一次碰到的不是库，说明路径被球挡住，放弃这条两库折线
              return null;
            }
          } else if (railEvent) {
            second = railPoint(railEvent, before);
            add(second);
            break;
          } else {
            if (events.some((e) => e.type === 'ball-hit-ball')) {
              add({ x: cue.pos.x, y: cue.pos.y });
              break;
            }
            add({ x: cue.pos.x, y: cue.pos.y });
          }

          if (cue.potted) break;
          if (physics.isTableMoving && !physics.isTableMoving(state)) break;
        }

        if (!first || path.length < 2) return null;
        for (let i = 1; i < path.length; i++) {
          travelledMm += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        }
        const res = {
          hit: true,
          path,
          travelledMm,
          first,
          second,
          secondRailHit: Boolean(second),
          cuePotted: Boolean(cue.potted),
        };
        if (ck) {
          this._nativeCacheKey = ck;
          this._nativeCacheResult = res;
        }
        return res;
      } catch (err) {
        devLog('warn', '[反弹] 官方内核两库复算失败', err);
        return null;
      }
    },



    get(key, factory, contextInfo = null) {
      if (!CONFIG.engineSimEnabled) return null;
      if (this.status === 'idle') this.load();
      if (this.status === 'failed') return null;

      // 严格指纹校验：如果目标球切换，或瞄准角偏差 > 0.08 弧度 (~4.5°)，立即判定旧缓存无效，坚决不画过期旧线！
      const isContextValid = Boolean(
        this.result &&
        this.resultContext &&
        contextInfo &&
        this.resultContext.targetBallId === contextInfo.targetBallId &&
        Math.abs(this.resultContext.aimAngle - contextInfo.aimAngle) < 0.08
      );

      // 若 key 完全一致且上下文匹配，直接返回精确结果
      if (this.key === key && this.result && isContextValid) {
        return this.result;
      }

      // 仅当上下文相符时允许返回过渡标记数据；若不相符则坚决返回 null，杜绝拿上一球路径拼凑乱画
      const stale = isContextValid ? { ...this.result, stale: true } : null;

      this.pendingKey = key;
      this.payloadFactory = factory;
      this.pendingContext = contextInfo;

      const now = performance.now();
      const THROTTLE_MS = 45; // 45ms 稳定时间片节流，消除长达 1~2 秒的无休止防抖重置卡顿

      const executeRun = () => {
        this.timer = 0;
        this.lastRunTime = performance.now();
        if (this.status === 'loading') {
          this.timer = setTimeout(executeRun, 60);
          return;
        }
        if (this.status !== 'ready' || !this.fn) {
          this.pendingKey = null;
          return;
        }
        const pendingKey = this.pendingKey;
        const factoryNow = this.payloadFactory;
        const ctxNow = this.pendingContext;
        try {
          const result = this.run(factoryNow());
          this.key = pendingKey;
          this.result = result;
          this.resultContext = ctxNow;
        } catch (err) {
          this.error = String((err && err.message) || err);
          this.status = 'failed';
          this.result = null;
          this.resultContext = null;
        }
        this.pendingKey = null;
      };

      // 节流调度：超过 45ms 立即执行最新帧，否则等待本周期结束后立即执行，保证后台流式持续刷新
      if (!this.lastRunTime || now - this.lastRunTime >= THROTTLE_MS) {
        clearTimeout(this.timer);
        this.timer = 0;
        executeRun();
      } else if (!this.timer) {
        const remainMs = Math.max(10, THROTTLE_MS - (now - this.lastRunTime));
        this.timer = setTimeout(executeRun, remainMs);
      }

      return stale;
    },
  };

  /* ================================================================== */
  /* 大厅主界面、结算弹窗、加载过渡与房间模式检测 (练球/好友/排名/大厅)  */
  /* ================================================================== */

  const LOBBY_MENU_PATTERNS = [
    '练球房',
    '好友对战',
    '排名赛',
    '排位赛',
    '每日签到',
    '创建房间',
    '加入房间',
    '对战大厅',
    '返回大厅',
    '退出房间',
    '快速开始',
    '匹配中',
  ];

  const SETTLEMENT_PATTERNS = [
    '再来一局', '重新开始', '再玩一次', '再试一次', '重玩',
    '战绩结算', '本局结算', '对局结算', '比赛结束', '对局结束', '本局结束',
    '胜负已分', '单杆最高', '总得分', '本局得分', '我的得分', '对手得分',
    '退出对局', '下一局', '对局结果', '比赛结果',
    '恭喜获胜', '获得胜利', '练习完成', '清台结算'
  ];

  const LOADING_PATTERNS = [
    '加载中',
    '正在加载',
    '正在进入',
    '准备进入',
    '资源加载',
    '匹配成功',
    '正在连接',
    '载入中',
    'loading',
  ];

  let _lobbyCheckCache = false;
  let _lobbyCheckTime = 0;
  let _settleCheckCache = false;
  let _settleCheckTime = 0;
  let _loadingCheckCache = false;
  let _loadingCheckTime = 0;

  function hasVisibleLobbyUiInDoc(doc) {
    if (!doc || !doc.body) return false;
    const win = doc.defaultView || window;
    const nodes = doc.querySelectorAll('button, a, div, span, p');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.id === 'snooker-aim-panel' || (el.closest && el.closest('#snooker-aim-panel'))) continue;
      if (el.id === 'snooker-aim-toast' || (el.closest && el.closest('.snooker-aim-toast'))) continue;
      if (el.children && el.children.length > 3) continue;
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 25) continue;
      if (!LOBBY_MENU_PATTERNS.some((pat) => txt.includes(pat))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 10) continue;
      try {
        const st = win.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) continue;
      } catch (_) {}
      return true;
    }
    return false;
  }

  function isDarkMaskColor(bgStr) {
    if (!bgStr || bgStr === 'transparent') return false;
    const m = bgStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (!m) {
      const hex = bgStr.trim().toLowerCase();
      return hex === '#000' || hex === '#000000' || hex === '#111' || hex === '#111111' || hex === '#1a1a1a';
    }
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    const a = m[4] != null ? parseFloat(m[4]) : 1.0;
    // 关键：必须具备实质的深色遮罩不透明度 (alpha >= 0.25 且 r,g,b <= 65)
    // 游戏页面中的透明层 (alpha=0 或 transparent) 绝对不是遮罩！
    return a >= 0.25 && r <= 65 && g <= 65 && b <= 65;
  }

  // 深度扫描检测全屏黑色/半透明深色蒙层与弹窗遮罩 (Black Modal / Mask Backdrop)
  function hasVisibleDarkMaskInDoc(doc) {
    if (!doc || !doc.body) return false;
    const win = doc.defaultView || window;
    const winW = win.innerWidth || doc.documentElement.clientWidth || 800;
    const winH = win.innerHeight || doc.documentElement.clientHeight || 600;

    try {
      const candidateSelectors = [
        '[class*="mask"]', '[class*="backdrop"]', '[class*="dimmer"]',
        '[class*="modal-bg"]', '[class*="dialog-bg"]', '[id*="mask"]', '[id*="backdrop"]',
        'div, section'
      ].join(', ');

      const elements = doc.querySelectorAll(candidateSelectors);
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.id === 'snooker-aim-panel' || el.id === 'snooker-aim-overlay') continue;
        if (el.closest && el.closest('#snooker-aim-panel')) continue;

        const rect = el.getBoundingClientRect();
        // 必须覆盖大面积屏幕 (至少 45% 宽高)
        if (rect.width < winW * 0.45 || rect.height < winH * 0.45) continue;

        const st = win.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.1) continue;
        if (st.position !== 'fixed' && st.position !== 'absolute') continue;

        // 【最核心判定】：计算出的背景色必须是真正的深色/黑色遮罩，透明层绝对排除！
        if (!isDarkMaskColor(st.backgroundColor)) continue;

        const z = parseInt(st.zIndex, 10);
        if (Number.isFinite(z) && z < 2) continue; // 必须浮于底层游戏画面之上

        return true;
      }
    } catch (_) {}
    return false;
  }

  function hasVisibleSettlementUiInDoc(doc) {
    if (!doc || !doc.body) return false;
    // 1. 【绝对优先】真实黑色全屏遮罩检测
    if (hasVisibleDarkMaskInDoc(doc)) return true;

    const win = doc.defaultView || window;
    // 2. 检查类名或 ID 明确为结算模态框且尺寸足够大的容器 (至少 140x90px)
    const modalNodes = doc.querySelectorAll('[class*="settlement"], [class*="game-over"], [class*="gameover"], [id*="settlement"], [id*="gameover"]');
    for (let i = 0; i < modalNodes.length; i++) {
      const el = modalNodes[i];
      if (el.id === 'snooker-aim-panel' || (el.closest && el.closest('#snooker-aim-panel'))) continue;
      if (el.id === 'snooker-aim-toast' || (el.closest && el.closest('.snooker-aim-toast'))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 140 && rect.height > 90) {
        try {
          const st = win.getComputedStyle(el);
          if (st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.1) {
            return true;
          }
        } catch (_) {}
      }
    }

    // 3. 检查按钮与文本节点是否包含明确的结算关键词
    const nodes = doc.querySelectorAll('button, a, div, span, p, h1, h2, h3, h4');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.id === 'snooker-aim-panel' || (el.closest && el.closest('#snooker-aim-panel'))) continue;
      if (el.id === 'snooker-aim-toast' || (el.closest && el.closest('.snooker-aim-toast'))) continue;
      if (el.children && el.children.length > 3) continue;
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 25) continue;
      if (!SETTLEMENT_PATTERNS.some((pat) => txt.includes(pat))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 15 || rect.height < 10) continue;
      try {
        const st = win.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.1) continue;
      } catch (_) {}
      return true;
    }
    return false;
  }

  function hasVisibleLoadingUiInDoc(doc) {
    if (!doc || !doc.body) return false;
    const win = doc.defaultView || window;
    const loadContainers = doc.querySelectorAll('[class*="loading"], [class*="load-mask"], [class*="preloader"], [id*="loading"], [id*="preloader"]');
    for (let i = 0; i < loadContainers.length; i++) {
      const el = loadContainers[i];
      if (el.id === 'snooker-aim-panel' || (el.closest && el.closest('#snooker-aim-panel'))) continue;
      if (el.id === 'snooker-aim-toast' || (el.closest && el.closest('.snooker-aim-toast'))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        try {
          const st = win.getComputedStyle(el);
          if (st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.1) {
            return true;
          }
        } catch (_) {}
      }
    }
    const nodes = doc.querySelectorAll('div, span, p, h1, h2, h3, h4');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.id === 'snooker-aim-panel' || (el.closest && el.closest('#snooker-aim-panel'))) continue;
      if (el.id === 'snooker-aim-toast' || (el.closest && el.closest('.snooker-aim-toast'))) continue;
      if (el.children && el.children.length > 2) continue;
      const txt = (el.textContent || '').trim().toLowerCase();
      if (!txt || txt.length > 25) continue;
      if (!LOADING_PATTERNS.some((pat) => txt.includes(pat))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 15 || rect.height < 10) continue;
      try {
        const st = win.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.1) continue;
      } catch (_) {}
      return true;
    }
    return false;
  }

  function isPlayableTableState(state) {
    if (!state || !Array.isArray(state.balls) || state.balls.length === 0) return false;
    const hasCue = state.balls.some((b) => b && !b.potted && (b.kind === 'cue' || b.id === state.cueBallId || b.isCue || b.kind === 0));
    const activeObjs = activeObjectBalls(state);
    const hasAimOrMoving = Boolean(state.aim && state.aim.direction && Number.isFinite(state.aim.direction.x)) || isShotOrMoving(state) || _shotMotionLocked;
    const notOver = !(state.isOver || state.gameOver || state.frameOver || state.isSettlement || state.isFinished || state.finished);
    return hasCue && hasAimOrMoving && (activeObjs.length > 0 || _shotMotionLocked) && notOver;
  }

  function isSettlementOrGameOverScreen(state) {
    // 击球走位锁定时绝对豁免结算判定，严防目标球落袋时母球还在滚动却误判结算导致提前清屏
    if (_shotMotionLocked) return false;

    // 0. 优先保障：如果当前是明确的可玩台面状态（有母球、有目标球、且有瞄准线），绝不误判为结算！
    if (isPlayableTableState(state)) {
      _frameOrMatchOver = false;
      return false;
    }

    // 1. 状态变量标记检测
    if (state) {
      if (state.isOver || state.gameOver || state.frameOver || state.isSettlement || state.isFinished || state.finished) return true;
      const statusLow = String(state.status || state.state || state.phase || '').toLowerCase();
      if (statusLow.includes('gameover') || statusLow.includes('finish') || statusLow.includes('settle') || statusLow.includes('end')) return true;
      if (state.ruleState && (state.ruleState.isOver || state.ruleState.gameOver || state.ruleState.frameOver)) return true;
      const activeObjs = activeObjectBalls(state);
      if (activeObjs.length === 0 && (!state.balls || state.balls.length > 0)) {
        return true;
      }
    }

    // 2. 全局多窗口 DOM 穿透检测 (黑色弹窗遮罩 + 语义词)
    const now = performance.now();
    if (now - _settleCheckTime > 150) {
      _settleCheckTime = now;
      let detected = false;
      const wins = collectCandidateWindows();
      for (const win of wins) {
        try {
          if (win.document && hasVisibleSettlementUiInDoc(win.document)) {
            detected = true;
            break;
          }
        } catch (_) {}
      }
      _settleCheckCache = detected;
    }

    if (_settleCheckCache) return true;

    // 若 DOM 未检测到弹窗，自动解除引擎可能滞留的结束锁定
    if (_frameOrMatchOver) {
      if (!_settleCheckCache) {
        _frameOrMatchOver = false;
      } else {
        return true;
      }
    }

    return false;
  }

  function isLoadingScreen(state) {
    if (state && (state.isLoading || state.loading || state.isConnecting)) return true;
    const now = performance.now();
    if (now - _loadingCheckTime > 150) {
      _loadingCheckTime = now;
      let detected = false;
      const wins = collectCandidateWindows();
      for (const win of wins) {
        try {
          if (win.document && hasVisibleLoadingUiInDoc(win.document)) {
            detected = true;
            break;
          }
        } catch (_) {}
      }
      _loadingCheckCache = detected;
    }
    return _loadingCheckCache;
  }

  function isLobbyMenuVisible() {
    const now = performance.now();
    if (now - _lobbyCheckTime > 150) {
      _lobbyCheckTime = now;
      let detected = false;
      const wins = collectCandidateWindows();
      for (const win of wins) {
        try {
          if (win.document && hasVisibleLobbyUiInDoc(win.document)) {
            detected = true;
            break;
          }
        } catch (_) {}
      }
      _lobbyCheckCache = detected;
    }
    return _lobbyCheckCache;
  }

  function isLobbyOrNonTableScreen(state) {
    if (_shotMotionLocked) return false;
    // 0. 可玩台面状态具有最高通行权
    if (isPlayableTableState(state)) {
      _frameOrMatchOver = false;
      return false;
    }

    // 1. 检查大厅主菜单
    if (isLobbyMenuVisible()) {
      if (overlay && overlay.canvas) overlay.clear();
      if (typeof hudPill !== 'undefined') hudPill.hide();
      return true;
    }

    // 2. 检查结算弹窗与加载过渡
    if (isSettlementOrGameOverScreen(state) || isLoadingScreen(state)) {
      if (overlay && overlay.canvas) overlay.clear();
      if (typeof hudPill !== 'undefined') hudPill.hide();
      return true;
    }

    // 3. 状态变量标记检测
    if (state) {
      if (state.isLobby === true || state.inLobby === true) {
        if (typeof hudPill !== 'undefined') hudPill.hide();
        return true;
      }
      const statusLow = String(state.status || state.state || state.phase || '').toLowerCase();
      if (statusLow.includes('lobby') || statusLow.includes('menu') || statusLow.includes('home')) {
        if (typeof hudPill !== 'undefined') hudPill.hide();
        return true;
      }
    }

    return false;
  }



  function detectCurrentRoomMode(state) {
    if (!state || isLobbyOrNonTableScreen(state)) {
      if (isSettlementOrGameOverScreen(state)) {
        return { mode: 'settlement', label: '对局结算' };
      }
      if (isLoadingScreen(state)) {
        return { mode: 'loading', label: '加载中' };
      }
      return { mode: 'lobby', label: '大厅待机' };
    }
    const sp = getGameGlobal('SnookerProduct');

    // 1. 练球房检测
    if (
      (sp && sp.practice) ||
      (state.practiceAutoColorTarget) ||
      (state.ruleSettings && state.ruleSettings.practiceAutoColorTarget) ||
      (sp && (sp.currentMode === 'practice' || sp.mode === 'practice')) ||
      (state.mode === 'practice' || state.gameMode === 'practice')
    ) {
      return { mode: 'practice', label: '练球房' };
    }

    // 2. 排名赛检测
    if (
      (sp && (sp.rank || sp.ranked || sp.ladder)) ||
      (sp && (sp.currentMode === 'rank' || sp.mode === 'rank' || sp.matchType === 'rank')) ||
      (state.matchType === 'rank' || state.gameMode === 'rank')
    ) {
      return { mode: 'ranked', label: '排名赛' };
    }

    // 3. 好友对战检测
    if (
      (sp && (sp.room || sp.customRoom || sp.friendMatch || sp.matchInfo)) ||
      (state.roomType === 'friend' || state.isFriendMatch || state.mode === 'friend')
    ) {
      return { mode: 'friend', label: '好友对战' };
    }

    return { mode: 'match', label: '对局中' };
  }

  function isCanvasActuallyVisible(canvas) {
    if (!canvas || !canvas.isConnected) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 15 || rect.height <= 15) return false;
    const doc = canvas.ownerDocument;
    const win = doc && doc.defaultView;
    if (win) {
      try {
        const st = win.getComputedStyle(canvas);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.02) {
          return false;
        }
      } catch (_) {}
      try {
        const frameEl = win.frameElement;
        if (frameEl) {
          if (!frameEl.isConnected) return false;
          const parentWin = frameEl.ownerDocument && frameEl.ownerDocument.defaultView;
          if (parentWin) {
            const fst = parentWin.getComputedStyle(frameEl);
            if (fst.display === 'none' || fst.visibility === 'hidden' || parseFloat(fst.opacity) < 0.02) {
              return false;
            }
          }
        }
      } catch (_) {}
    }
    return true;
  }

  /* ================================================================== */
  /* Toast 非阻塞通知                                                   */
  /* ================================================================== */

  function showToast(msg, duration) {
    const ms = duration || 3000;
    const hostDoc = (window.top && (() => { try { return window.top.document; } catch (_) { return null; } })()) || document;
    if (!hostDoc || !hostDoc.body) return;
    const toast = hostDoc.createElement('div');
    toast.id = 'snooker-aim-toast';
    toast.className = 'snooker-aim-toast';
    toast.style.cssText = [
      'position:fixed;left:50%;bottom:50px;transform:translateX(-50%);',
      'z-index:2147483648;background:rgba(10,18,12,0.92);color:#f0f4ee;',
      'height:20px;line-height:20px;padding:0 10px;border-radius:10px;',
      'font:600 10px/20px -apple-system,"PingFang SC",sans-serif;',
      'box-shadow:0 3px 12px rgba(0,0,0,0.5);border:1px solid rgba(0,255,136,0.4);',
      'pointer-events:none;transition:opacity 0.3s;white-space:nowrap;',
      'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;',
    ].join('');
    toast.textContent = msg;
    hostDoc.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, ms);
  }

  /* ================================================================== */
  /* 力度与杆法描述                                                      */
  /* ================================================================== */

  function resolveCueSpeed(power, maxCuePower) {
    const p = clamp(Number(power) || 0, 0, 100);
    const max = Math.max(1, Number(maxCuePower) || CONFIG.maxCuePowerMmS);
    return p === 0 ? 0 : max * (p / 100);
  }

  function resolveV3ElevationRetention(elevation = 2.5) {
    const angle = Number.isFinite(Number(elevation)) ? Number(elevation) : 2.5;
    const t = Math.max(0, Math.min(1, (angle - 2.5) / 17.5));
    return 1 - 0.15 * t * t * (3 - 2 * t);
  }

  function tipSpeedRetention(tip) {
    const maxOff = Math.max(1e-6, CONFIG.maxTipOffsetRatio);
    const mag = Math.hypot(Number(tip && tip.x) || 0, Number(tip && tip.y) || 0);
    const norm = Math.min(1, mag / maxOff);
    return 1 - (1 - CONFIG.maxTipSpeedRetention) * norm * norm;
  }

  function tipDescriptor(tip) {
    const x = Number(tip && tip.x) || 0;
    const y = Number(tip && tip.y) || 0;
    const dz = CONFIG.tipDeadzone;
    const parts = [];
    if (Math.abs(x) >= dz) parts.push((x > 0 ? '右塞' : '左塞') + Math.round(Math.abs(x) / CONFIG.maxTipOffsetRatio * 100) + '%');
    if (Math.abs(y) >= dz) parts.push((y > 0 ? '高杆' : '低杆') + Math.round(Math.abs(y) / CONFIG.maxTipOffsetRatio * 100) + '%');
    return {
      x, y,
      norm: Math.min(1, Math.hypot(x, y) / CONFIG.maxTipOffsetRatio),
      hasSpin: parts.length > 0,
      label: parts.length ? parts.join('+') : '中杆无塞',
    };
  }

  function formatTipEnglish(tip) {
    if (!tip) return '中杆';
    const sx = Number(tip.x) || 0;
    const sy = Number(tip.y) || 0;
    const yText = sy > 0.08 ? '高杆' : (sy < -0.08 ? '低杆' : '');
    const xText = sx > 0.08 ? '右塞' : (sx < -0.08 ? '左塞' : '');
    if (!yText && !xText) return '中杆';
    if (!yText) return `中杆${xText}`;
    return `${yText}${xText}`;
  }

  function resolveEffectiveTip(state) {
    if (!state) return { x: 0, y: 0 };
    const cand = (state.aim && (state.aim.tipOffset || state.aim.tip || state.aim.spin)) ||
      (state.shot && (state.shot.tipOffset || state.shot.tip || state.shot.spin)) ||
      state.tipOffset ||
      state.tip ||
      state.spin ||
      (state.cue && (state.cue.tipOffset || state.cue.tip));
    if (cand && (Number.isFinite(cand.x) || Number.isFinite(cand.y))) {
      return {
        x: clamp(Number(cand.x) || 0, -1, 1),
        y: clamp(Number(cand.y) || 0, -1, 1),
      };
    }
    return { x: 0, y: 0 };
  }

  let _turnPowerActive = false;
  let _settledRawPower = null;
  let _turnHasInteracted = false;
  // 出杆瞬间游戏可能把 state.power 清零；这里记录最近一次玩家/脚本实际设置的力度。
  let _lastRequestedShotPower = null;
  let _lastRequestedShotAt = 0;
  let _lastAimPowerObserved = null;
  // 本杆真实出杆力度：停球后作为下一杆的“旧力度基准”，
  // 防止游戏把上一杆力度回填到 state.power/aim.power 时误触发辅助线。
  let _lastShotPowerForTurn = null;
  let _lastActualAimPred = null;

  function extractRawStatePower(state) {
    if (!state) return null;
    // 优先取游戏渲染层实时力度 state.power（拉杆时实时变动，未拉杆或停球后为 0）。
    // 0 是合法状态，不能因为 state.power 为 0 就继续回退到上一杆的 shot.power。
    if (state.power != null && Number.isFinite(Number(state.power)) && Number(state.power) > 0) {
      return Number(state.power);
    }
    // v1.9.16：aim.power 是当前瞄准/蓄力力度，未蓄力时就是 0。
    // 旧逻辑用 >0 过滤，0 会掉进下面的 shot.power 分支；而 shot.power 保存的是
    // 上一杆的出杆力度，导致第 n+1 杆未出杆就继承第 n 杆的力度、HUD 与辅助线。
    if (state.aim && state.aim.power != null && Number.isFinite(Number(state.aim.power))) {
      return Number(state.aim.power);
    }
    // 没有 aim 时，才允许使用 state.power 的 0。
    if (state.power != null && Number.isFinite(Number(state.power))) {
      return Number(state.power);
    }
    // 只有确实处于击球/球体运动阶段，才允许 shot/cue 力度兜底。
    if (isShotOrMoving(state)) {
      if (state.shot && Number.isFinite(Number(state.shot.power)) && Number(state.shot.power) > 0) {
        return Number(state.shot.power);
      }
      if (state.cue && Number.isFinite(Number(state.cue.power)) && Number(state.cue.power) > 0) {
        return Number(state.cue.power);
      }
    }
    return null;
  }

  function resetTurnPowerState() {
    _turnPowerActive = false;
    _settledRawPower = null;
    _turnHasInteracted = false;
    _lastShotPowerForTurn = null;
    resetShotPowerFallbacks();
  }

  // 清空只属于“上一杆”的力度兜底数据，避免下一杆快照在 state 力度缺失时
  // 误用上一杆的静态预测/观察力度，把旧的辅助线与 HUD 力度一起冻结进来。
  function resetShotPowerFallbacks() {
    _lastActualAimPred = null;
    _lastAimPowerObserved = null;
    _lastRequestedShotPower = null;
    _lastRequestedShotAt = 0;
  }

  // 停球后的力度基准：优先使用本杆真实出杆力度。
  // 不能直接用停球瞬间的 state 力度，因为很多情况下它已经被游戏清零，
  // 之后又把上一杆力度回填，导致下一杆一开局就误判为“玩家已蓄力”。
  function resolveSettledPowerBaseline(state) {
    const candidates = [
      _lastShotPowerForTurn,
      _lastAimPowerObserved,
      (performance.now() - _lastRequestedShotAt < 1500) ? _lastRequestedShotPower : null,
    ];
    for (const raw of candidates) {
      const p = Number(raw);
      if (Number.isFinite(p) && p > 2) return clamp(p, 0, 100);
    }
    return extractRawStatePower(state);
  }

  function resolveEffectivePower(state) {
    if (!state) return 0;

    const raw = extractRawStatePower(state);
    if (raw == null || raw <= 0) {
      _turnPowerActive = false;
      return 0;
    }

    // 首次进入球桌 / 重置后没有历史基准：按真实力度处理。
    if (_settledRawPower === null) {
      _turnPowerActive = true;
      return clamp(raw, 0, 100);
    }

    // 停球后游戏可能把上一杆的出杆力度回填到 state.power / aim.power / shot.power。
    // 在玩家真正改变力度之前，这个值不是本杆蓄力，不能点亮辅助线或 HUD 力度。
    // 力度显示按整数百分比使用，留 1% 容差吸收游戏回填时的四舍五入差异。
    if (!_turnHasInteracted) {
      if (Math.abs(raw - _settledRawPower) < 1.0) {
        _turnPowerActive = false;
        return 0;
      }
      _turnHasInteracted = true;
      _turnPowerActive = true;
    }

    return clamp(raw, 0, 100);
  }

  /* ================================================================== */
  /* 击球与运动状态检测                                                  */
  /* ================================================================== */

  let _lastCuePos = null;
  let _cueMoveCount = 0;
  let _shotHiddenSince = 0;
  let _forceShowUntil = 0;
  let _wasInShot = false;
  let _shotMotionLocked = false;

  function hasBallVelocity(state) {
    if (!state || !Array.isArray(state.balls)) return false;
    for (const b of state.balls) {
      if (!b || b.potted) continue;
      const v = b.vel || b.velocity || b.v;
      if (v && typeof v === 'object') {
        const vx = Number(v.x) || 0;
        const vy = Number(v.y) || 0;
        const vz = Number(v.z) || 0;
        // 速度阈值设为 1.5 mm/s (平方 2.25)，超高灵敏捕捉母球慢速走位，严防母球未停误判静止
        if ((vx * vx + vy * vy + vz * vz) > 2.25) return true;
      } else if (Number.isFinite(b.vx) || Number.isFinite(b.vy) || Number.isFinite(b.vz)) {
        const vx = Number(b.vx) || 0;
        const vy = Number(b.vy) || 0;
        const vz = Number(b.vz) || 0;
        if ((vx * vx + vy * vy + vz * vz) > 2.25) return true;
      }
    }
    return false;
  }

  let _lastBallPositions = new Map();
  let _ballsStillSince = 0;

  function ballsActuallyStill(state) {
    if (!state || !Array.isArray(state.balls)) return false;
    let moved = false;
    let count = 0;

    // 专项检测母球自身状态 (母球未停绝对不算静止)
    const cueBall = getCueBall(state);
    if (cueBall && !cueBall.potted) {
      const cpx = Number.isFinite(cueBall.pos?.x) ? cueBall.pos.x : (Number.isFinite(cueBall.x) ? cueBall.x : null);
      const cpy = Number.isFinite(cueBall.pos?.y) ? cueBall.pos.y : (Number.isFinite(cueBall.y) ? cueBall.y : null);
      if (cpx !== null && cpy !== null) {
        const prevCue = _lastBallPositions.get('__cue_ball__');
        if (prevCue && Math.hypot(prevCue.x - cpx, prevCue.y - cpy) > 0.015) {
          moved = true;
        }
        _lastBallPositions.set('__cue_ball__', { x: cpx, y: cpy });
        count++;
      }
    }

    state.balls.forEach((b, i) => {
      if (!b || b.potted) return;
      const px = (b.pos && Number.isFinite(b.pos.x)) ? b.pos.x : (Number.isFinite(b.x) ? b.x : null);
      const py = (b.pos && Number.isFinite(b.pos.y)) ? b.pos.y : (Number.isFinite(b.y) ? b.y : null);
      if (px === null || py === null) return;
      const key = b.id != null ? String(b.id) : (b.isCue || b.kind === 'cue' || b.kind === 0 ? 'cue' : `${b.kind || 'ball'}:${i}`);
      const prev = _lastBallPositions.get(key);
      if (prev && Math.hypot(prev.x - px, prev.y - py) > 0.015) moved = true;
      _lastBallPositions.set(key, { x: px, y: py });
      count++;
    });
    if (!count) return false;
    if (moved || hasBallVelocity(state)) {
      _ballsStillSince = performance.now();
      return false;
    }
    if (!_ballsStillSince) _ballsStillSince = performance.now();
    return performance.now() - _ballsStillSince > 500;
  }

  function isShotOrMoving(state) {
    if (!state) return false;
    // 1. 物理引擎真实击球滚动中标志
    if (state.inPlay === true || state.isRolling === true || state.ballMoving === true || state.shotInProgress === true) {
      return true;
    }
    // 2. 真实出杆击打中的状态，严格排除包含 'move' / 'anim' 等相机旋转或手势调整视角的关键词
    const phase = String(
      state.phase || state.status || state.gameState || state.state ||
      state.shot?.phase || state.shot?.status || state.shot?.state || ''
    ).toLowerCase();
    if (phase) {
      const activeShotPhases = ['shot', 'shooting', 'rolling', 'ballrolling', 'inplay'];
      if (activeShotPhases.some((p) => phase === p || phase.startsWith(p + '_') || phase.startsWith(p + '-'))) {
        return true;
      }
    }
    // 3. 球体存在真实物理运动速度 (击球发生)
    if (hasBallVelocity(state)) return true;

    // 注意：旋转视角或拖动球杆方向属于正常瞄准交互，绝不当做击球运动，保证瞄准线平滑始终显示
    return false;
  }

  /* ================================================================== */
  /* 状态读取与快捷键微调适配器                                           */
  /* ================================================================== */

  function getGameGlobal(prop) {
    const wins = collectCandidateWindows();
    if (projection && projection.canvas && projection.canvas.ownerDocument) {
      const ownerWin = projection.canvas.ownerDocument.defaultView;
      if (ownerWin) {
        try {
          if (ownerWin[prop]) return ownerWin[prop];
        } catch (_) {}
      }
    }
    for (const w of wins) {
      try {
        if (w && w[prop]) return w[prop];
      } catch (_) {}
    }
    return undefined;
  }

  let capturedCore = null;
  let _frameOrMatchOver = false;
  const _hookedNamespaces = new WeakSet();
  const _trappedWins = new WeakSet();

  function onCoreRuleEvent(event) {
    if (!event) return;
    const res = event.result || event.detail?.result || event;
    if (event.type === 'frame-over' || event.type === 'game-over' || res.frameOver || res.matchOver || res.gameOver || res.isOver) {
      _frameOrMatchOver = true;
      // 击球走位中暂缓清空画布，等待母球和台面完全停稳
      if (!_shotMotionLocked) {
        if (overlay && overlay.canvas) overlay.clear();
        if (typeof hudPill !== 'undefined') {
          hudPill.hide();
          hudPill.destroy();
        }
        cleanAllOrphanHudPills(false);
      }
      return;
    }
  }

  function wrapCoreNamespace(ns) {
    if (!ns || typeof ns !== 'object' || _hookedNamespaces.has(ns)) return;
    if (typeof ns.createThreeGameCore !== 'function') return;
    _hookedNamespaces.add(ns);
    const original = ns.createThreeGameCore;
    try {
      ns.createThreeGameCore = function (...args) {
        const api = original.apply(this, args);
        if (api && typeof api.getState === 'function') {
          capturedCore = api;
          _frameOrMatchOver = false;
          NativeWorkerBridge.enableReboundInCore(api);

          // 劫持生命周期销毁与清理 (退出房间时立即切断残留数据并清空画布与信息浮标)
          const origDestroy = api.destroy;
          if (typeof origDestroy === 'function') {
            api.destroy = function (...dArgs) {
              if (capturedCore === api) {
                capturedCore = null;
              }
              if (overlay && overlay.canvas) overlay.clear();
              if (typeof hudPill !== 'undefined') {
                hudPill.hide();
                hudPill.destroy();
              }
              cleanAllOrphanHudPills(false);
              return origDestroy.apply(this, dArgs);
            };
          }
          const origDispose = api.dispose;
          if (typeof origDispose === 'function') {
            api.dispose = function (...dArgs) {
              if (capturedCore === api) {
                capturedCore = null;
              }
              if (overlay && overlay.canvas) overlay.clear();
              if (typeof hudPill !== 'undefined') {
                hudPill.hide();
                hudPill.destroy();
              }
              cleanAllOrphanHudPills(false);
              return origDispose.apply(this, dArgs);
            };
          }

          try {
            if (typeof api.subscribe === 'function') {
              api.subscribe((event) => {
                onCoreRuleEvent(event);
              });
            }
          } catch (_) {}
        }
        return api;
      };
    } catch (_) {}
  }

  function installCoreHook() {
    const targets = collectCandidateWindows();
    for (const win of targets) {
      if (!win) continue;
      NativeWorkerBridge.initWindow(win);
      try {
        if (win.SnookerThreeCore) {
          wrapCoreNamespace(win.SnookerThreeCore);
        } else if (!_trappedWins.has(win)) {
          _trappedWins.add(win);
          let _nsVal = undefined;
          Object.defineProperty(win, 'SnookerThreeCore', {
            configurable: true,
            enumerable: true,
            get() {
              return _nsVal;
            },
            set(val) {
              _nsVal = val;
              wrapCoreNamespace(val);
            },
          });
        }
      } catch (_) {}
    }
  }

  function extractValidState(candidate) {
    if (!candidate) return null;
    try {
      const s = typeof candidate.getState === 'function' ? candidate.getState() : candidate;
      if (s && typeof s === 'object' && Array.isArray(s.balls)) return s;
    } catch (_) {}
    return null;
  }

  function extractRawState() {
    const tg = getGameGlobal('threeGame');
    if (tg) {
      const s = extractValidState(tg.core) || extractValidState(tg);
      if (s) return s;
    }

    const sp = getGameGlobal('SnookerProduct');
    if (sp) {
      const s =
        extractValidState(sp.practice) ||
        extractValidState(sp.core) ||
        extractValidState(sp.threeGame && sp.threeGame.core) ||
        extractValidState(sp.threeGame) ||
        extractValidState(sp);
      if (s) return s;
    }

    const spl = getGameGlobal('SnookerProductLite');
    if (spl) {
      const s = extractValidState(spl.practice) || extractValidState(spl.core) || extractValidState(spl);
      if (s) return s;
    }

    if (capturedCore) {
      if (capturedCore.destroyed === true || capturedCore.isDestroyed === true) {
        capturedCore = null;
        return null;
      }
      NativeWorkerBridge.enableReboundInCore(capturedCore);
      const s = extractValidState(capturedCore);
      if (s) return s;
    }

    return null;
  }

  function readState() {
    if (isLobbyMenuVisible()) {
      return null;
    }
    const raw = extractRawState();
    if (!raw) return null;
    if (isSettlementOrGameOverScreen(raw)) {
      return null;
    }
    return raw;
  }

  /* ================================================================== */
  /* 【每日挑战自动化击球】全台自由选球、无阻挡最优下球、死局冲球解围、智能力度出杆 */
  /* ================================================================== */

  function triggerStrike(callback, power = 100) {
    const targetPower = clamp(Math.round(Number(power) || 100), 2, 100);
    _lastRequestedShotPower = targetPower;
    _lastRequestedShotAt = performance.now();
    const tg = getGameGlobal('threeGame');
    const sp = getGameGlobal('SnookerProduct');
    const practice = sp && sp.practice;
    const coreCandidates = [capturedCore, tg && tg.core, practice, sp && sp.core].filter(Boolean);

    let targetCore = null;
    for (const c of coreCandidates) {
      if (c && typeof c.shoot === 'function') {
        targetCore = c;
        break;
      }
    }

    if (targetCore) {
      // 1. 设置智能力度
      try {
        if (typeof targetCore.setPower === 'function') {
          targetCore.setPower(targetPower);
        }
      } catch (_) {}

      // 2. 短暂延迟 60ms 确保力度同步到核心状态与球杆姿态，然后以有效数值时间戳调用 shoot() 出杆
      setTimeout(() => {
        let shotSuccess = false;
        try {
          if (typeof targetCore.setPower === 'function') {
            targetCore.setPower(targetPower);
          }
          // 核心关键修复：
          // core.shoot(now = performance.now()) 必须接收有效数值时间戳（或不传参使用默认值），
          // 绝对不能传入对象！若传入对象会导致底层 strokeAnimation 的 startTime 为 NaN，
          // 进而导致球杆拉满后永远无法到达击打 impactTime 卡死！
          const res = targetCore.shoot(performance.now());
          shotSuccess = (res !== false);
          if (typeof DailyChallengeEngine !== 'undefined' && DailyChallengeEngine) {
            DailyChallengeEngine.lastShotTime = performance.now();
          }
        } catch (e) {
          console.warn('targetCore.shoot 异常:', e);
        }

        // 3. 若 core.shoot 成功出杆，直接完成
        if (shotSuccess) {
          if (typeof callback === 'function') callback(true);
          return;
        }

        // 4. 若 core.shoot 未生效，使用手势兜底
        simulatePowerSliderPullAndRelease(callback, targetPower);
      }, 60);
      return;
    }

    // 无 core 时的兜底手势
    simulatePowerSliderPullAndRelease(callback, targetPower);
  }

  // 向前兼容别名
  function triggerFullPowerStrike(callback) {
    return triggerStrike(callback, 100);
  }

  function simulatePowerSliderPullAndRelease(done, power = 100) {
    const targetPower = clamp(Math.round(Number(power) || 100), 2, 100);
    const powerRatio = targetPower / 100;
    const targetDoc = overlay.getTargetDoc();
    const win = targetDoc.defaultView || window;
    const canvas = projection.canvas || findGameCanvasInDoc(targetDoc);

    // 寻找潜在的力度条 DOM 或 Canvas 右侧滑杆区域 (#power-track 优先)
    let powerEl = null;
    const selectors = [
      '#power-track', '[id*="power-track"]', '[class*="power-track"]',
      '[class*="cue-power"]', '[class*="cue_power"]', '[id*="cue-power"]',
      '[class*="power-bar"]', '[class*="power_bar"]', '[id*="power"]'
    ];
    for (const sel of selectors) {
      const el = targetDoc.querySelector(sel);
      if (el && !el.closest('#snooker-aim-panel')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 8 && rect.height > 40) {
          powerEl = el;
          break;
        }
      }
    }

    let startX = 0, startY = 0, endX = 0, endY = 0;
    let targetNode = powerEl;

    if (powerEl) {
      const r = powerEl.getBoundingClientRect();
      startX = r.left + r.width / 2;
      startY = r.top + Math.max(8, r.height * 0.1);
      endX = startX;
      const maxEndY = r.top + r.height * 0.95;
      endY = startY + (maxEndY - startY) * powerRatio;
    } else if (canvas) {
      targetNode = canvas;
      const r = canvas.getBoundingClientRect();
      startX = r.left + r.width * 0.93;
      startY = r.top + r.height * 0.28;
      endX = startX;
      const maxEndY = r.top + r.height * 0.88;
      endY = startY + (maxEndY - startY) * powerRatio;
    }

    if (!targetNode) {
      if (done) done(false);
      return;
    }

    try {
      const pointerId = 101;
      const optsDown = {
        bubbles: true, cancelable: true, view: win,
        clientX: startX, clientY: startY,
        screenX: startX, screenY: startY,
        buttons: 1, button: 0, isPrimary: true, pointerId, pointerType: 'touch',
      };
      targetNode.dispatchEvent(new PointerEvent('pointerdown', optsDown));
      targetNode.dispatchEvent(new MouseEvent('mousedown', optsDown));

      setTimeout(() => {
        const optsMove = {
          bubbles: true, cancelable: true, view: win,
          clientX: endX, clientY: endY,
          screenX: endX, screenY: endY,
          buttons: 1, button: 0, isPrimary: true, pointerId, pointerType: 'touch',
        };
        targetNode.dispatchEvent(new PointerEvent('pointermove', optsMove));
        win.dispatchEvent(new PointerEvent('pointermove', optsMove));
        targetNode.dispatchEvent(new MouseEvent('mousemove', optsMove));

        setTimeout(() => {
          const optsUp = {
            bubbles: true, cancelable: true, view: win,
            clientX: endX, clientY: endY,
            screenX: endX, screenY: endY,
            buttons: 0, button: 0, isPrimary: true, pointerId, pointerType: 'touch',
          };
          targetNode.dispatchEvent(new PointerEvent('pointerup', optsUp));
          win.dispatchEvent(new PointerEvent('pointerup', optsUp));
          targetNode.dispatchEvent(new MouseEvent('mouseup', optsUp));
          try {
            if (typeof targetNode.releasePointerCapture === 'function' && targetNode.hasPointerCapture(pointerId)) {
              targetNode.releasePointerCapture(pointerId);
            }
          } catch (_) {}
          if (typeof DailyChallengeEngine !== 'undefined' && DailyChallengeEngine) {
            DailyChallengeEngine.lastShotTime = performance.now();
          }
          if (done) done(true);
        }, 80);
      }, 50);
    } catch (_) {
      if (done) done(false);
    }
  }

  function snapToPerfectPot(options = {}) {
    const autoStrike = options.autoStrike !== false; // 默认自动 100% 满力击球
    const state = readState();
    if (!state) {
      showToast('未检测到球局状态', 1200);
      return false;
    }
    const cue = getCueBall(state);
    if (!cue || !cue.pos) {
      showToast('未检测到母球', 1200);
      return false;
    }
    if (isSettlementOrGameOverScreen(state)) {
      showToast('当前对局已结束', 1200);
      return false;
    }
    if (isLoadingScreen(state)) {
      showToast('对局加载中，请稍候', 1200);
      return false;
    }
    if (isLobbyOrNonTableScreen(state)) {
      showToast('当前处于大厅，未进入对局', 1200);
      return false;
    }
    if (isShotOrMoving(state)) {
      showToast('当前球局运动中，请等待静止', 1200);
      return false;
    }

    const curDir = state.aim && state.aim.direction ? V.norm(state.aim.direction) : { x: 1, y: 0 };
    const objects = activeObjectBalls(state);
    if (!objects.length) {
      showToast('🎉 台面上除母球外无其他球，已全部清台！', 2000);
      return false;
    }

    // 严格遵循斯诺克分阶段规则：台面上只要有红球，必须优先清理红球；红球全清后才按分值清理彩球
    const redBalls = objects.filter((b) => b.kind === 'red');
    const hasReds = redBalls.length > 0;

    // 彩球法定分值顺序：黄(2) -> 绿(3) -> 咖啡(4) -> 蓝(5) -> 粉(6) -> 黑(7)
    const COLOR_ORDER = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];

    let candidateBalls = [];
    if (hasReds) {
      // 阶段一【红球优先阶段】：只要还有红球，候选击打目标球严格且仅限红球！彩球全为不可击打障碍球
      candidateBalls = redBalls;
    } else {
      // 阶段二【清彩球阶段】：红球已全部进袋，按斯诺克法定最小分值彩球优先清理
      let lowestKind = null;
      for (const k of COLOR_ORDER) {
        if (objects.some((b) => b.kind === k)) {
          lowestKind = k;
          break;
        }
      }
      if (lowestKind) {
        candidateBalls = objects.filter((b) => b.kind === lowestKind);
      }
      if (!candidateBalls.length) {
        candidateBalls = objects; // 兜底保护
      }
    }

    // 1. 识别用户当前瞄准意图的目标球 (物理相交优先 > 准星中心垂直距离 perp)
    let userAimedBall = null;
    let minRayTHit = Infinity;
    for (const b of candidateBalls) {
      const rc = rayContact(cue.pos, curDir, b);
      if (rc && rc.tHit < minRayTHit) {
        minRayTHit = rc.tHit;
        userAimedBall = b;
      }
    }
    if (!userAimedBall) {
      let minPerpDist = Infinity;
      for (const b of candidateBalls) {
        const v = V.sub(b.pos, cue.pos);
        const proj = V.dot(v, curDir);
        if (proj <= 0) continue;
        const perp = Math.sqrt(Math.max(0, V.lenSq(v) - proj * proj));
        if (perp <= 45 && perp < minPerpDist) {
          minPerpDist = perp;
          userAimedBall = b;
        }
      }
    }
    // 若用户瞄准的球不属于当前阶段合法候选球，清除该意向，强制从合法候选球中选球
    if (userAimedBall && !candidateBalls.some((b) => b.id === userAimedBall.id)) {
      userAimedBall = null;
    }

    // 2. 核心下球路线验证函数 (四大物理法则：贴库自适应补偿 + 进袋判定 + 切角限制 <= 75° + 双重无阻挡通道)
    const pockets = readPockets(state);
    const tableBounds = readTableBounds(state);
    function evaluateValidRoute(ball, pk) {
      // 贴库球专项自适应平移补偿：沿库滑向角袋时，将入袋目标点吸附到平行库壁切线上，杜绝撞击外角嘴晃袋
      const compResult = resolveCompensatedPocketTarget(ball.pos, pk, tableBounds);
      const effectiveTarget = compResult.targetPoint;

      const dirToPk = V.norm(V.sub(effectiveTarget, ball.pos));
      const towardPk = V.dot(dirToPk, pk.normal);
      if (towardPk <= 0.05) return null;

      const ev = evaluatePocket(ball.pos, dirToPk, pk, effectiveTarget);
      if (!ev || ev.confidence <= 0) return null;

      const contactG = V.sub(ball.pos, V.scale(dirToPk, COLLISION_DIST_MM));
      const cueDir = V.norm(V.sub(contactG, cue.pos));
      const cutDot = V.dot(cueDir, dirToPk);
      if (cutDot < 0.2588) return null; // 切角 > 75度物理不可能下球
      const cutAngleDeg = Math.acos(clamp(cutDot, -1, 1)) * 180 / Math.PI;

      // 双重物理障碍检测：
      // (a) 母球 -> 假想球 无阻挡
      if (pathBlocked(cue.pos, contactG, objects, ball.id, cue.id)) return null;
      // (b) 目标球 -> 袋口 (采用有效入袋点) 无阻挡
      if (pathBlocked(ball.pos, effectiveTarget, objects, ball.id, cue.id)) return null;

      const distObjToPk = V.dist(ball.pos, effectiveTarget);
      // 物理极限可达性检查（能量守恒）：即使 100% 满力目标球最大位移也达不到袋口，直接淘汰
      const maxReachAt100 = reachCapFallback(100, cutDot);
      if (maxReachAt100 != null && distObjToPk > maxReachAt100) return null;

      // 计算该路线推荐出杆力度（基于 3.4.2 实测动力学模型与能量衰减）
      let recommendedPower = calculateRecommendedPower(
        cue.pos,
        contactG,
        ball.pos,
        effectiveTarget,
        cueDir,
        { x: 0, y: 0 },
        2.5
      );

      // 贴库球专项安全力度压制（落实台球铁律：贴库轻推，力大必晃）
      if (compResult.cushionHug.isTight) {
        recommendedPower = clamp(recommendedPower, 22, 32);
      } else if (compResult.cushionHug.isNear || compResult.cushionHug.isJawClipping) {
        recommendedPower = clamp(recommendedPower, 22, 38);
      }

      if (recommendedPower > 100) return null; // 无法以安全力度打进，排除

      // 力度合理性惩罚：对需要 75% 以上大力量的高难度球适度扣分，优先选择更稳健的中小力量线路
      const powerPenalty = recommendedPower > 75 ? (recommendedPower - 75) * 0.025 : 0;
      // 贴库自适应补偿稳健路线给予适度加权激励
      const hugBonus = compResult.isCompensated ? 0.35 : 0;
      const score = (ev.confidence * 4.0) + (cutDot * 3.5) - (distObjToPk / 4000) - powerPenalty + hugBonus;

      return {
        ball,
        pocket: pk,
        contactG,
        cueDir,
        cutDot,
        cutAngleDeg,
        confidence: ev.confidence,
        recommendedPower,
        score,
        isBreakup: false,
        cushionHug: compResult.cushionHug,
        isCompensated: compResult.isCompensated,
        effectiveTarget,
      };
    }

    // 3. 路线分级搜索
    let chosenRoute = null;

    // 优先级 1: 用户已有明确意向的目标球，在该球的 6 个袋口中寻找最佳无阻挡下球路线
    if (userAimedBall) {
      let bestAimedScore = -Infinity;
      for (const pk of pockets) {
        const route = evaluateValidRoute(userAimedBall, pk);
        if (route && route.score > bestAimedScore) {
          bestAimedScore = route.score;
          chosenRoute = route;
        }
      }
    }

    // 优先级 2: 若用户瞄准的球被挡或无袋口，全局遍历全台所有目标球的所有袋口
    if (!chosenRoute) {
      let bestGlobalScore = -Infinity;
      for (const b of candidateBalls) {
        for (const pk of pockets) {
          const route = evaluateValidRoute(b, pk);
          if (route && route.score > bestGlobalScore) {
            bestGlobalScore = route.score;
            chosenRoute = route;
          }
        }
      }
    }

    // 优先级 3: 【死局冲球/解围策略】：全台无直接进袋路线时，寻找合法首碰目标球并冲散球堆
    if (!chosenRoute) {
      // 物理射线检测首碰球 (First Contact Ball)
      const getFirstContactBall = (dir) => {
        if (!dir || (dir.x === 0 && dir.y === 0)) return null;
        let minHitT = Infinity;
        let hitBall = null;
        let hitContact = null;
        for (const b of objects) {
          const rc = rayContact(cue.pos, dir, b);
          if (rc && rc.tHit < minHitT) {
            minHitT = rc.tHit;
            hitBall = b;
            hitContact = rc.G;
          }
        }
        return hitBall ? { ball: hitBall, tHit: minHitT, contact: hitContact } : null;
      };

      const isLegalTarget = (b) => candidateBalls.some((cb) => cb.id === b.id);
      let bestBreakup = null;
      let bestBreakupScore = -Infinity;

      // 阶段 3.1: 遍历合法候选球，直瞄及多角度掠射采样（覆盖避开中台蓝球/粉球的侧向净空通道）
      for (const b of candidateBalls) {
        const baseDir = V.norm(V.sub(b.pos, cue.pos));
        const baseAngle = Math.atan2(baseDir.y, baseDir.x);

        // 采样角度：0度(直瞄球心) 以及左右偏移采样（从 2度 到 18度，覆盖绕过中台蓝球/粉球的切线通道）
        const testAngles = [0, -0.035, 0.035, -0.07, 0.07, -0.12, 0.12, -0.18, 0.18, -0.25, 0.25, -0.32, 0.32];
        for (const delta of testAngles) {
          const ang = baseAngle + delta;
          const dir = { x: Math.cos(ang), y: Math.sin(ang) };
          const fc = getFirstContactBall(dir);
          // 核心法则：严禁首碰彩球！首碰球必须严格为合法目标球集合（即红球）中的球
          if (fc && isLegalTarget(fc.ball)) {
            const contactNormal = V.norm(V.sub(fc.ball.pos, fc.contact));
            const cutCos = clamp(V.dot(dir, contactNormal), 0.1, 1);
            const dist = V.dist(cue.pos, fc.ball.pos);
            // 评分：优先切角厚实(更扎实冲散球堆)、距离较近且远离障碍彩球的冲击线
            const score = (cutCos * 4.0) - (dist / 3000);
            if (score > bestBreakupScore) {
              bestBreakupScore = score;
              bestBreakup = {
                ball: fc.ball,
                contactG: fc.contact,
                cueDir: dir,
                cutDot: cutCos,
                cutAngleDeg: Math.acos(cutCos) * 180 / Math.PI,
              };
            }
          }
        }
      }

      // 阶段 3.2: 若全台所有角度都无法直线首碰红球（全被彩球阻挡），启动第二级：彩球借力破局
      if (!bestBreakup) {
        // 搜索视野内所有可直接首碰的彩球，选择距离与方位最优的彩球进行借力击打破局
        const colorBalls = objects.filter((b) => b.kind !== 'red');
        let bestColorBreakup = null;
        let bestColorScore = -Infinity;

        for (const cb of colorBalls) {
          const dir = V.norm(V.sub(cb.pos, cue.pos));
          const fc = getFirstContactBall(dir);
          // 只要母球能直线首碰该彩球
          if (fc && fc.ball.id === cb.id) {
            const dist = V.dist(cue.pos, cb.pos);
            // 评分：优先距离适中（如中台蓝球/粉球/咖啡球）、首碰扎实的彩球
            const score = 1000 - dist;
            if (score > bestColorScore) {
              bestColorScore = score;
              bestColorBreakup = {
                ball: cb,
                contactG: fc.contact,
                cueDir: dir,
                cutDot: 1.0,
                cutAngleDeg: 0,
              };
            }
          }
        }

        // 若找到可直碰的彩球，以 50% 可控力度出杆借力破局，打破死局继续自动化推进
        if (bestColorBreakup) {
          chosenRoute = {
            ball: bestColorBreakup.ball,
            pocket: null,
            contactG: bestColorBreakup.contactG,
            cueDir: bestColorBreakup.cueDir,
            cutDot: bestColorBreakup.cutDot,
            cutAngleDeg: bestColorBreakup.cutAngleDeg,
            confidence: 0,
            score: 0,
            isBreakup: true,
            isColorBreakout: true,
          };
        } else {
          // 极度贴身死锁兜底：直接朝台面最近的障碍球击打
          const anyTarget = colorBalls[0] || objects[0];
          if (anyTarget) {
            const dir = V.norm(V.sub(anyTarget.pos, cue.pos));
            chosenRoute = {
              ball: anyTarget,
              pocket: null,
              contactG: anyTarget.pos,
              cueDir: dir,
              cutDot: 1.0,
              cutAngleDeg: 0,
              confidence: 0,
              score: 0,
              isBreakup: true,
              isColorBreakout: true,
            };
          }
        }
      } else {
        chosenRoute = {
          ball: bestBreakup.ball,
          pocket: null,
          contactG: bestBreakup.contactG,
          cueDir: bestBreakup.cueDir,
          cutDot: bestBreakup.cutDot,
          cutAngleDeg: bestBreakup.cutAngleDeg,
          confidence: 0,
          score: 0,
          isBreakup: true,
          isColorBreakout: false,
        };
      }
    }

    if (!chosenRoute) {
      showToast('⚠️ 未能找到有效出杆路线', 1500);
      return false;
    }

    const { ball: bestBall, pocket: targetPocket, cueDir: perfectAimDir, cutAngleDeg, isBreakup } = chosenRoute;
    const nextAngle = Math.atan2(perfectAimDir.y, perfectAimDir.x);

    // 4. 执行瞄准对齐控制 (写入游戏控制器)
    const tg = getGameGlobal('threeGame');
    const sp = getGameGlobal('SnookerProduct');
    const practice = sp && sp.practice;
    const controllers = [capturedCore, tg && tg.core, practice, sp && sp.core, tg].filter(Boolean);

    for (const ctrl of controllers) {
      try {
        if (typeof ctrl.setDirection === 'function') {
          ctrl.setDirection(perfectAimDir);
          break;
        }
        if (typeof ctrl.aimAt === 'function') {
          ctrl.aimAt(chosenRoute.contactG || bestBall.pos);
          break;
        }
        if (typeof ctrl.setAimDirection === 'function') {
          ctrl.setAimDirection(perfectAimDir);
          break;
        }
        if (typeof ctrl.setAimAngle === 'function') {
          ctrl.setAimAngle(nextAngle);
          break;
        }
      } catch (_) {}
    }

    try {
      if (state.aim && state.aim.direction) {
        state.aim.direction.x = perfectAimDir.x;
        state.aim.direction.y = perfectAimDir.y;
        if (typeof state.aim.angle === 'number') state.aim.angle = nextAngle;
      }
      state.aimPrediction = null;
    } catch (_) {}

    // 若规则状态要求指定彩球，自动调用 nominate 满足出杆前置规则条件
    try {
      const tg = getGameGlobal('threeGame');
      const sp = getGameGlobal('SnookerProduct');
      const coreCandidates = [capturedCore, tg && tg.core, sp && sp.practice, sp && sp.core].filter(Boolean);
      for (const c of coreCandidates) {
        if (typeof c.nominate === 'function' && state.ruleState?.requiresNomination && bestBall?.kind) {
          c.nominate(bestBall.kind);
        }
      }
    } catch (_) {}

    _lastGeomKey = null;
    _lastRenderKey = null;

    let targetDesc = '';
    let strikePower = isBreakup
      ? (chosenRoute.isColorBreakout ? 50 : 65)
      : clamp(chosenRoute.recommendedPower || 50, 20, 100);

    // 终极安全校验：对贴库球与半贴库擦角补偿球出杆力度严格压制
    if (chosenRoute.cushionHug?.isTight) {
      strikePower = clamp(strikePower, 22, 32);
    } else if (chosenRoute.cushionHug?.isJawClipping || chosenRoute.cushionHug?.isNear) {
      strikePower = clamp(strikePower, 22, 38);
    }

    if (isBreakup) {
      if (chosenRoute.isColorBreakout) {
        targetDesc = `💥 红球通道全受阻，50%可控力度击打「${kindLabel(bestBall.kind)}」借力破局`;
      } else {
        targetDesc = hasReds
          ? `💥 红球无直接下球，65%可控力度冲散红球堆解围「${kindLabel(bestBall.kind)}」`
          : `💥 彩球无直接下球，65%可控力度解围「${kindLabel(bestBall.kind)}」`;
      }
    } else {
      let hugTag = '';
      if (chosenRoute.cushionHug?.isTight) {
        hugTag = ` · 📌贴库(${chosenRoute.cushionHug.edgeGap}mm)修正`;
      } else if (chosenRoute.cushionHug?.isJawClipping) {
        hugTag = ` · 📐擦角补偿(${chosenRoute.cushionHug.compOffset}mm)`;
      } else if (chosenRoute.cushionHug?.isNear) {
        hugTag = ` · 📐半贴库(${chosenRoute.cushionHug.edgeGap}mm)修正`;
      }
      targetDesc = `🎯「${kindLabel(bestBall.kind)}」进「${targetPocket.label}」· 切角 ${Math.round(cutAngleDeg)}° · 力度 ${strikePower}%${hugTag}`;
    }

    if (autoStrike) {
      const pwrLabel = chosenRoute.isColorBreakout
        ? '50%借力破局出杆!'
        : (isBreakup ? '65%稳健冲球出杆!' : `力度 ${strikePower}% 出杆!`);
      showToast(`${targetDesc} · ${pwrLabel}`, 1500);
      setTimeout(() => {
        triggerStrike(null, strikePower);
      }, 60);
    } else {
      showToast(`🎯 已对准: ${targetDesc}`, 1500);
    }

    return true;
  }

  // 连续清台自动化状态机
  const DailyChallengeEngine = {
    running: false,
    timer: null,
    step: 'idle', // 'idle' | 'aiming' | 'waitingMotion' | 'moving' | 'settling'
    lastShotTime: 0,

    toggle() {
      if (this.running) {
        this.stop('已暂停每日挑战自动化击球');
      } else {
        this.start();
      }
    },

    start() {
      const raw = extractRawState();
      if (raw) {
        const objects = activeObjectBalls(raw);
        if (!objects.length) {
          showToast('🎉 台面上除母球外无其他球，已全部清台！', 2000);
          return;
        }
      }
      const state = readState();
      if (!state) {
        showToast('未检测到球局状态', 1200);
        return;
      }
      if (isSettlementOrGameOverScreen(state)) {
        showToast('当前对局已结束', 1200);
        return;
      }
      if (isLoadingScreen(state)) {
        showToast('对局加载中，请稍候', 1200);
        return;
      }
      if (isLobbyOrNonTableScreen(state)) {
        showToast('当前处于大厅，未进入对局', 1200);
        return;
      }
      const objects = activeObjectBalls(state);
      if (!objects.length) {
        showToast('🎉 台面上除母球外无其他球，已全部清台！', 2000);
        return;
      }

      this.running = true;
      this.step = 'idle';
      if (ui && typeof ui.updateDailyChallengeBtn === 'function') {
        ui.updateDailyChallengeBtn();
      }
      showToast('🚀 每日挑战自动化击球已启动', 1500);
      this.scheduleNextShot(50);
    },

    stop(reason) {
      this.running = false;
      this.step = 'idle';
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (ui && typeof ui.updateDailyChallengeBtn === 'function') {
        ui.updateDailyChallengeBtn();
      }
      if (typeof hudPill !== 'undefined') {
        hudPill.hide();
      }
      if (reason) {
        showToast(reason, 1500);
      }
    },

    scheduleNextShot(delayMs = 400) {
      if (!this.running) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.running) return;
        this.executeShot();
      }, delayMs);
    },

    executeShot() {
      if (!this.running) return;
      const state = readState();
      if (!state || isSettlementOrGameOverScreen(state) || isLobbyOrNonTableScreen(state)) {
        this.stop('对局结束或离开球桌，自动化停止');
        return;
      }
      if (isShotOrMoving(state)) {
        this.step = 'moving';
        return;
      }

      const objects = activeObjectBalls(state);
      if (!objects.length) {
        this.stop('🎉 每日挑战已完成，已全部清台！');
        try { if (navigator.vibrate) navigator.vibrate([100, 100, 200]); } catch (_) {}
        return;
      }

      this.step = 'aiming';
      const result = snapToPerfectPot({ autoStrike: true });
      if (!result) {
        this.scheduleNextShot(1000);
        return;
      }

      this.lastShotTime = performance.now();
      this.step = 'waitingMotion';
    },

    onFrame(state, shot, still) {
      if (!this.running) return;
      if (isSettlementOrGameOverScreen(state) || isLobbyOrNonTableScreen(state)) {
        this.stop('对局已结束，自动化停止');
        return;
      }

      const now = performance.now();
      if (this.step === 'waitingMotion') {
        if (shot || (now - this.lastShotTime > 1200)) {
          this.step = 'moving';
        }
        return;
      }

      if (this.step === 'moving') {
        if (!shot && still && (now - this.lastShotTime > 1500)) {
          this.step = 'settling';
          const remaining = activeObjectBalls(state);
          if (remaining.length === 0) {
            this.stop('🎉 每日挑战已完成，已全部清台！');
            try { if (navigator.vibrate) navigator.vibrate([100, 100, 200]); } catch (_) {}
            return;
          }
          this.scheduleNextShot(450);
        }
      }
    }
  };

  /* ================================================================== */
  /* 【每日挑战全自动连打 v1.7.11】                                        */
  /* 入口埋点 → 进房免点击自动开局 → 清台自动领取 → 自动下一关 → 8/8     */
  /* ================================================================== */

  const DAILY_ENTRY_KEY = 'snooker.daily.entry.v1';
  const DAILY_RUN_KEY = 'snooker.daily.run.v1';
  const DAILY_HOME_URL = 'https://147master.cn/';

  function dailyDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function dailyReadJSON(storage, key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch (_) {
      return null;
    }
  }

  function dailyWriteJSON(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function dailySession() {
    try { return window.sessionStorage; } catch (_) { return null; }
  }

  function readDailyEntryMarker() {
    const s = dailySession();
    if (!s) return null;
    const o = dailyReadJSON(s, DAILY_ENTRY_KEY);
    if (!o || !o.id) return null;
    return o;
  }

  function writeDailyEntryMarker(id, name) {
    const s = dailySession();
    if (!s || !id) return;
    dailyWriteJSON(s, DAILY_ENTRY_KEY, { id: String(id), name: String(name || ''), ts: Date.now() });
  }

  function clearDailyEntryMarker() {
    const s = dailySession();
    if (!s) return;
    try { s.removeItem(DAILY_ENTRY_KEY); } catch (_) {}
  }

  function readDailyRunState() {
    const s = dailySession();
    if (!s) return null;
    return dailyReadJSON(s, DAILY_RUN_KEY);
  }

  function writeDailyRunState(v) {
    const s = dailySession();
    if (!s) return;
    dailyWriteJSON(s, DAILY_RUN_KEY, v);
  }

  function getDailyProduct() {
    const p = getGameGlobal('SnookerProduct');
    return p || null;
  }

  function getDailyChallengeList() {
    const P = getDailyProduct();
    const a = P && P.activities;
    return a && Array.isArray(a.challenges) ? a.challenges : null;
  }

  function findDailyChallengeById(id) {
    const list = getDailyChallengeList();
    if (!list || !id) return null;
    const key = String(id).toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c && String(c.id || '').toLowerCase() === key) return c;
    }
    return null;
  }

  function dailyStatusOf(ch) {
    return String((ch && ch.status) || '').toLowerCase();
  }

  function readDailyShapeFromUrl() {
    try {
      if (!/^\/practice\/?$/i.test(location.pathname)) return null;
      const sp = new URLSearchParams(location.search);
      const s = sp.get('shape');
      return s ? String(s) : null;
    } catch (_) {
      return null;
    }
  }

  // 判定“当前房间是每日挑战房”的唯一权威组合：
  // 1) 路由 /practice?shape=<8 个挑战 id 之一>
  // 2) 本次进入由“每日挑战弹窗里的挑战按钮”触发（sessionStorage 埋点，跨页面刷新仍在）
  // 3) 该关卡在 /api/product/activities 里存在且尚未 claimed
  // 这样既不会把普通练球房（可手选同款球型）误判成挑战房，也能在刷新后继续有效
  let _dailyRoomCacheTime = 0;
  let _dailyRoomCacheKey = '';
  let _dailyRoomCacheValue = null;

  function detectDailyChallengeRoom() {
    const shape = readDailyShapeFromUrl();
    if (!shape) return null;
    const entry = readDailyEntryMarker();
    if (!entry || !entry.id) return null;
    const now = performance.now();
    const cacheKey = shape + '|' + entry.id + '|' + entry.ts;
    if (_dailyRoomCacheKey === cacheKey && now - _dailyRoomCacheTime < 1500) {
      return _dailyRoomCacheValue;
    }
    _dailyRoomCacheKey = cacheKey;
    _dailyRoomCacheTime = now;
    _dailyRoomCacheValue = null;
    if (String(entry.id).toLowerCase() !== shape.toLowerCase()) return null;
    const age = Date.now() - (Number(entry.ts) || 0);
    if (age > CONFIG.dailyAuto.entryTTLMs) return null;
    const ch = findDailyChallengeById(shape);
    if (!ch) return null;
    if (dailyStatusOf(ch) === 'claimed') return null;
    _dailyRoomCacheValue = { id: shape, challenge: ch, entry: entry };
    return _dailyRoomCacheValue;
  }

  function installDailyEntryHook() {
    if (window.__snkDailyEntryHookInstalled) return;
    try {
      window.__snkDailyEntryHookInstalled = true;
      document.addEventListener('click', function (e) {
        try {
          const target = e.target;
          if (!target || !target.closest) return;
          const btn = target.closest('button[data-challenge]');
          if (!btn) return;
          const id = btn.getAttribute('data-challenge');
          if (!id) return;
          const item = btn.closest('.challenge-item');
          const name = item ? (item.getAttribute('aria-label') || '') : '';
          writeDailyEntryMarker(id, name);
          if (typeof DailyRunner !== 'undefined' && DailyRunner) {
            DailyRunner.onEntryClicked(id, name);
          }
        } catch (_) {}
      }, true);
      devLog('info', '[每日挑战] 入口埋点已安装');
    } catch (_) {}
  }

  const DailyRunner = {
    phase: 'idle',              // idle | playing | claiming | advancing | paused | done
    currentId: null,
    nextId: null,
    enteredAt: 0,
    startedAt: 0,
    clearAt: 0,
    shots: 0,
    levelsDone: 0,
    _startAttempted: false,
    _lastStartProbeAt: 0,
    _retries: 0,
    _moving: false,
    _claimInflight: false,
    _claimFails: 0,
    _claimTries: 0,
    _lastClaimPollAt: 0,
    _lastSilentClaimAt: 0,
    _driveBusy: false,
    _lobbyTimer: null,
    _lastList: null,
    _navTimer: null,
    day: '',
    _lastListAt: 0,
    _skipped: {},
    _startBusy: false,
    _silentQueue: [],
    _silentBusy: false,
    _silentTries: {},
    _claimKeys: {},
    lastCtx: null,

    init() {
      const saved = readDailyRunState();
      if (saved) {
        this.phase = saved.phase || 'idle';
        this.currentId = saved.currentId || null;
        this.nextId = saved.nextId || null;
        this.enteredAt = Number(saved.enteredAt) || 0;
        this.levelsDone = Number(saved.levelsDone) || 0;
        this.day = String(saved.day || '');
        this._skipped = {};
        if (Array.isArray(saved.skipped)) {
          saved.skipped.forEach((id) => { if (id) this._skipped[id] = true; });
        }
        if (this.phase === 'advancing' && !this.nextId) this.phase = 'idle';
        if (this.phase === 'claiming') this.clearAt = Date.now();
        // 跨天：本地日期与存档不一致时整段重置，避免第二天仍显示“今日已完成”
        const today = this.localDay();
        if (today && this.day && this.day !== today) {
          this.phase = 'idle';
          this.currentId = null;
          this.nextId = null;
          this.levelsDone = 0;
          this.enteredAt = 0;
          this._skipped = {};
          this._claimKeys = {};
          this._silentTries = {};
          this.day = '';
          this.save();
        }
      }
      this.startLobbyDriver();
      devLog('info', '[每日挑战] Runner 初始化', this.phase, this.currentId || '-');
      // 后台校正一次按钮文案/进度（服务端可能已跨天）
      try {
        Promise.resolve(this.loadActivities()).then(() => this.updatePanel()).catch(() => {});
      } catch (_) {}
    },

    localDay() {
      try {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      } catch (_) {
        return '';
      }
    },

    save() {
      writeDailyRunState({
        phase: this.phase,
        currentId: this.currentId,
        nextId: this.nextId,
        enteredAt: this.enteredAt,
        levelsDone: this.levelsDone,
        day: this.day || '',
        skipped: Object.keys(this._skipped || {}),
        ts: Date.now(),
      });
    },

    totalCount(list) {
      if (list && list.length) return list.length;
      if (this._lastList && this._lastList.length) return this._lastList.length;
      return Math.max(1, Number(CONFIG.dailyAuto.totalLevels) || 8);
    },

    isBusy() {
      try {
        if (typeof DailyChallengeEngine !== 'undefined' && DailyChallengeEngine && DailyChallengeEngine.running) return true;
      } catch (_) {}
      return this.phase === 'playing' || this.phase === 'claiming' || this.phase === 'advancing';
    },

    progressText() {
      const total = this.totalCount(this._lastList);
      let done = Number(this.levelsDone) || 0;
      try {
        const list = (this._lastList && Date.now() - this._lastListAt < 10000)
          ? this._lastList
          : getDailyChallengeList();
        if (list && list.length) done = list.filter((c) => dailyStatusOf(c) === 'claimed').length;
      } catch (_) {}
      return done + '/' + total;
    },

    updatePanel() {
      try {
        if (typeof ui !== 'undefined' && ui && typeof ui.updateDailyChallengeBtn === 'function') ui.updateDailyChallengeBtn();
      } catch (_) {}
    },

    notify(text, tone, ms) {
      const t = tone || 'info';
      try {
        if (typeof ui !== 'undefined' && ui && typeof ui.showDailyMessage === 'function') {
          ui.showDailyMessage(text, t, ms === undefined ? 4000 : ms);
        }
      } catch (_) {}
      if (t === 'warn' || t === 'error') {
        try { showToast(text, t === 'error' ? 3200 : 2600); } catch (_) {}
      }
    },

    async fetchActivitiesOnce(timeoutMs) {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      let timer = null;
      if (ctrl) {
        timer = setTimeout(() => {
          try { ctrl.abort(); } catch (_) {}
        }, timeoutMs);
      }
      try {
        const res = await fetch('/api/product/activities', {
          credentials: 'include',
          signal: ctrl ? ctrl.signal : undefined,
        });
        if (!res || !res.ok) return null;
        return await res.json();
      } catch (_) {
        return null;
      } finally {
        if (timer) { clearTimeout(timer); timer = null; }
      }
    },

    applyActivities(data) {
      const list = data && Array.isArray(data.challenges) ? data.challenges : null;
      if (!list) return null;
      const prevDay = this.day;
      if (data.day && prevDay && String(data.day) !== prevDay) {
        // 跨天：清空跳过名单/领取 key，避免把昨天状态带到今天
        this._skipped = {};
        this._claimKeys = {};
        this._silentTries = {};
        this._silentQueue = [];
        if (this.phase === 'done') {
          this.phase = 'idle';
          this.currentId = null;
          this.nextId = null;
          this.levelsDone = 0;
          this.save();
        }
      }
      if (data.day) this.day = String(data.day);
      this._lastList = list;
      this._lastListAt = Date.now();
      const P = getDailyProduct();
      if (P && data) P.activities = data;
      const claimed = list.filter((c) => dailyStatusOf(c) === 'claimed').length;
      this.levelsDone = claimed;
      return list;
    },

    async loadActivities() {
      let data = await this.fetchActivitiesOnce(8000);
      if (!data) {
        await dailyDelay(500);
        data = await this.fetchActivitiesOnce(8000);
      }
      return this.applyActivities(data);
    },

    async startAutoRun() {
      if (!CONFIG.dailyAuto.enabled) {
        this.notify('⚠️ 每日挑战自动化已在配置中关闭（CONFIG.dailyAuto.enabled）', 'warn', 5000);
        return { ok: false, reason: 'disabled' };
      }
      if (window !== window.top) return { ok: false, reason: 'not-top' };
      if (this._startBusy) return { ok: false, reason: 'busy' };
      this._startBusy = true;
      try {
        // 上一轮以“跳过部分关卡”收尾时，用户再次点击启动视为重新尝试这些关卡
        if (this.phase === 'done') {
          this._skipped = {};
          this._silentTries = {};
        }
        // 1. 拉取最新进度（优先服务端，失败时回退内存）
        let list = await this.loadActivities();
        if (!list || !list.length) list = getDailyChallengeList();
        if (!list || !list.length) {
          this.notify('❌ 未读取到每日挑战进度，请确认已登录 147master 账号后重试', 'error', 6000);
          this.updatePanel();
          return { ok: false, reason: 'no-progress' };
        }
        const total = this.totalCount(list);
        const claimed = list.filter((c) => dailyStatusOf(c) === 'claimed').length;
        this.levelsDone = claimed;
        this.save();
        this.updatePanel();

        // 2. 已全部完成：只在面板下方提示，不跳转、不进房
        if (claimed >= total) {
          this.phase = 'done';
          this.nextId = null;
          this._skipped = {};
          this.save();
          this.notify('✅ 今日 ' + claimed + '/' + total + ' 每日挑战已全部完成，无需再打', 'success', 0);
          try { showToast('🎉 今日每日挑战已全部完成（' + claimed + '/' + total + '）', 3200); } catch (_) {}
          this.updatePanel();
          return { ok: true, done: true, claimed, total };
        }

        // 3. 有已清台但未领取的，先补齐奖励（只调接口，不进房）
        const completed = list.find((c) => dailyStatusOf(c) === 'completed');
        if (completed) {
          const cname = completed.name || completed.id;
          this.currentId = completed.id;
          this.nextId = null;
          this.phase = 'claiming';
          this.clearAt = Date.now();
          this._claimFails = 0;
          this._claimTries = 0;
          this._lastClaimPollAt = 0;
          this.save();
          this.notify('💰 发现已清台未领取「' + cname + '」，正在补齐奖励…', 'info', 4500);
          this.updatePanel();
          this.claimReward(completed.id);
          return { ok: true, claiming: completed.id, claimed, total };
        }

        // 4. 已经站在挑战房里：原地继续
        const room = detectDailyChallengeRoom();
        if (room) {
          const rname = (room.challenge && room.challenge.name) || room.id;
          this.currentId = room.id;
          this.nextId = null;
          this.phase = 'playing';
          this.enteredAt = Date.now();
          this._startAttempted = false;
          this.shots = 0;
          this.startedAt = 0;
          this.clearAt = 0;
          this.save();
          this.notify('▶️ 已在「' + rname + '」挑战房，继续自动击球（进度 ' + claimed + '/' + total + '）', 'info', 4500);
          this.updatePanel();
          return { ok: true, inRoom: room.id, claimed, total };
        }

        // 5. 保护：正在普通对局/练球房时不要跳转，避免把当前球局丢掉
        const ctx = this.lastCtx || {};
        if (!ctx.inLobby && (ctx.isPlayable || ctx.hasCanvas)) {
          this.notify('⚠️ 当前正在球桌中（非每日挑战房），请先返回大厅再启动自动完成', 'warn', 6000);
          this.updatePanel();
          return { ok: false, reason: 'in-table' };
        }

        // 6. 选下一关；大厅由常驻 lobbyTick 驱动，其他页面先回大厅再交给它
        const next = this.pickNext(list);
        if (!next) {
          this.phase = 'done';
          this.nextId = null;
          this.save();
          const skippedN = Object.keys(this._skipped || {}).length;
          const left = total - claimed;
          const msg = (left > 0 && skippedN > 0)
            ? '⏭️ 今日已完成 ' + claimed + '/' + total + '，剩余 ' + left + ' 关已跳过（' + skippedN + ' 关）'
            : '✅ 没有待完成的每日挑战（' + claimed + '/' + total + '）';
          this.notify(msg, 'success', 0);
          this.updatePanel();
          return { ok: true, done: true, claimed, total, skipped: skippedN };
        }
        const nname = next.name || next.id;
        this.currentId = null;
        this.nextId = next.id;
        this.phase = 'advancing';
        this.clearAt = 0;
        this.save();
        this.notify('🚀 已开始自动完成每日挑战：当前 ' + claimed + '/' + total + '，剩余 ' + (total - claimed) + ' 关，正在进入「' + nname + '」', 'success', 5200);
        this.updatePanel();
        devLog('info', '[每日挑战] 面板一键启动，下一关', next.id);

        if (!/^\/$/.test(location.pathname)) {
          if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null; }
          this._navTimer = setTimeout(() => {
            this._navTimer = null;
            try { location.href = DAILY_HOME_URL; } catch (_) {}
          }, 400);
        }
        return { ok: true, nextId: next.id, claimed, total };
      } finally {
        this._startBusy = false;
      }
    },

    setPhase(phase, id, resetEntered) {
      this.phase = phase;
      if (id !== undefined) this.currentId = id;
      if (resetEntered) {
        this.enteredAt = Date.now();
        this._startAttempted = false;
        this.shots = 0;
        this.startedAt = 0;
        this._retries = 0;
      }
      this.save();
    },

    onEntryClicked(id, name) {
      this.currentId = id;
      this.phase = 'playing';
      this.enteredAt = Date.now();
      this._startAttempted = false;
      this._retries = 0;
      this.shots = 0;
      this.startedAt = 0;
      this.save();
      devLog('info', '[每日挑战] 记录入口', id, name);
    },

    countClaimed() {
      const list = getDailyChallengeList() || [];
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        if (dailyStatusOf(list[i]) === 'claimed') n += 1;
      }
      return n;
    },

    tick(state, ctx) {
      if (!CONFIG.dailyAuto.enabled) return;
      if (window !== window.top) return;
      this.lastCtx = ctx || {};
      const room = detectDailyChallengeRoom();
      if (room) {
        const sameRoom = this.currentId === room.id;
        if (!sameRoom) {
          this._retries = 0;
          this.setPhase('playing', room.id, true);
        } else if (this.phase === 'idle') {
          this.setPhase('playing', room.id, false);
        }
        if (this.phase === 'playing') {
          this.maybeAutoStart(state, ctx, room);
          if (this.checkCleared(state)) {
            this.onCleared(room);
          } else if (this.startedAt && state) {
            const over = Boolean(
              state.frameOver || state.isOver || state.gameOver || state.isSettlement ||
              state.isFinished || state.finished ||
              (state.ruleState && (state.ruleState.frameOver || state.ruleState.isOver || state.ruleState.gameOver))
            );
            const left = activeObjectBalls(state).length;
            if (over && left > 0 && this.shots > 0) this.retryLevel('本关未能清台（剩余 ' + left + ' 颗）');
          }
        }
      }
      if (this.phase === 'claiming') this.pollClaim(Date.now());
      this.enforceLimits(state);
    },

    maybeAutoStart(state, ctx, room) {
      if (!CONFIG.dailyAuto.autoStart) return;
      if (this.phase !== 'playing') return;
      if (DailyChallengeEngine.running || this._startAttempted) return;
      const probeNow = Date.now();
      if (probeNow - this._lastStartProbeAt < 300) return;
      this._lastStartProbeAt = probeNow;
      if (!state || !ctx || !ctx.isPlayable) return;
      if (isShotOrMoving(state) || !ballsActuallyStill(state)) return;
      if (activeObjectBalls(state).length === 0) return;
      if (Date.now() - this.enteredAt < CONFIG.dailyAuto.enterSettleMs) return;
      const P = getDailyProduct();
      if (!P || !P.practice) return;
      let pShape = null;
      try { pShape = typeof P.practice.getShape === 'function' ? P.practice.getShape() : null; } catch (_) {}
      if (pShape && String(pShape).toLowerCase() !== String(room.id).toLowerCase()) return;
      this._startAttempted = true;
      this.startedAt = Date.now();
      this.shots = 0;
      devLog('info', '[每日挑战] 免点击自动开局', room.id);
      try { DailyChallengeEngine.start(); } catch (err) { devLog('warn', '[每日挑战] 启动失败', err); }
      if (!DailyChallengeEngine.running) {
        setTimeout(() => { this._startAttempted = false; }, 1600);
      }
      this.save();
    },

    checkCleared(state) {
      if (!state) return false;
      if (activeObjectBalls(state).length > 0) return false;
      if (state.frameOver === true || state.matchOver === true || state.isOver === true ||
          state.gameOver === true || state.isSettlement === true || state.isFinished === true ||
          state.finished === true) {
        return true;
      }
      if (state.ruleState && (state.ruleState.frameOver === true || state.ruleState.gameOver === true || state.ruleState.isOver === true)) {
        return true;
      }
      return false;
    },

    onCleared(room) {
      if (this.phase !== 'playing') return;
      this.phase = 'claiming';
      this.clearAt = Date.now();
      this.levelsDone = this.countClaimed();
      this._retries = 0;
      this._claimTries = 0;
      this._claimFails = 0;
      this._lastClaimPollAt = 0;
      clearDailyEntryMarker();
      if (DailyChallengeEngine.running) {
        DailyChallengeEngine.stop('🎉 每日挑战已清台，进入领取流程');
      }
      showToast('🎉 已清台，正在自动领取奖励...', 1800);
      this.notify('✅ 已清台：' + ((room.challenge && room.challenge.name) || room.id) + '，正在自动领取奖励…', 'success', 3200);
      devLog('info', '[每日挑战] 清台', room.id);
      this.save();
      this.updatePanel();
    },

    pollClaim(now) {
      if (now - this._lastClaimPollAt < CONFIG.dailyAuto.claimPollMs) return;
      this._lastClaimPollAt = now;
      const id = this.currentId;
      if (!id) { this.setPhase('idle'); return; }
      const ch = findDailyChallengeById(id);
      if (!ch) { this.refreshActivities(); return; }
      const st = dailyStatusOf(ch);
      if (st === 'claimed') {
        this.levelsDone = this.countClaimed();
        this.advance();
        return;
      }
      const waited = Date.now() - this.clearAt;
      if (waited > CONFIG.dailyAuto.claimTimeoutMs) {
        this.pause('领取奖励超时（' + Math.round(waited / 1000) + 's），已停止自动连打');
        return;
      }
      if (CONFIG.dailyAuto.autoClaim && st === 'completed' && waited > 1200 && this._claimFails < 3 && this._claimTries < 4) {
        this.claimReward(id);
      }
      this.refreshActivities();
    },

    claimKeyName(id) {
      return String(this.day || 'na') + '|' + String(id || '').toLowerCase();
    },

    claimKey(id) {
      const k = this.claimKeyName(id);
      if (!this._claimKeys[k]) {
        this._claimKeys[k] = (window.crypto && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : ('snk-daily-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      }
      return this._claimKeys[k];
    },

    async claimReward(id) {
      if (this._claimInflight || !id) return false;
      this._claimInflight = true;
      this._claimTries += 1;
      let status = 0;
      let errCode = '';
      try {
        const key = this.claimKey(id);
        const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': key };
        try {
          let rev = '';
          if (window.ProductSocial && typeof ProductSocial.gameRevision === 'function') rev = ProductSocial.gameRevision() || '';
          if (!rev && window.SnookerProduct && typeof SnookerProduct.gameRevision === 'function') rev = SnookerProduct.gameRevision() || '';
          if (!rev && typeof window.__gameRevision === 'string') rev = window.__gameRevision;
          if (rev) headers['X-Game-Revision'] = String(rev);
        } catch (_) {}
        const res = await fetch('/api/product/rewards/challenge', {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify({ id: id }),
        });
        status = res ? res.status : 0;
        let body = null;
        try { body = res ? await res.json() : null; } catch (_) {}
        errCode = body && body.error ? String(body.error) : '';
        if (res && res.ok) {
          // 成功：等待 refreshActivities 确认状态
        } else if (status === 409 && errCode === 'already_claimed') {
          this._claimFails = 0;
          devLog('info', '[每日挑战] 该奖励已领取过，按成功处理', id);
        } else if (status === 409 && errCode === 'challenge_not_completed') {
          devLog('info', '[每日挑战] 服务端尚未标记完成，继续等待', id);
        } else {
          this._claimFails += 1;
        }
        devLog('info', '[每日挑战] 领取接口返回', status, errCode || '-');
      } catch (err) {
        this._claimFails += 1;
        devLog('warn', '[每日挑战] 领取接口异常', err);
      } finally {
        this._claimInflight = false;
      }
      await this.refreshActivities();
      const ch = findDailyChallengeById(id);
      const isClaimed = Boolean(ch && dailyStatusOf(ch) === 'claimed');
      if (isClaimed) delete this._claimKeys[this.claimKeyName(id)];
      // 领取成功后立刻推进，避免依赖 frame()/tick 才继续（大厅等页面也能走完）
      if (this.phase === 'claiming') {
        if (isClaimed) {
          this.levelsDone = this.countClaimed();
          this.notify('💰 已领取「' + (ch.name || id) + '」，进度 ' + this.progressText(), 'success', 3500);
          this.updatePanel();
          this.advance();
        } else if (status >= 200 && status < 300) {
          this.notify('💰 领取请求已提交，等待服务端确认「' + (ch ? (ch.name || id) : id) + '」…', 'info', 3000);
        }
      }
      return true;
    },

    async refreshActivities() {
      const data = await this.fetchActivitiesOnce(8000);
      return Boolean(this.applyActivities(data));
    },

    pickNext(list) {
      if (!list || !list.length) return null;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || !c.id) continue;
        if (this._skipped && this._skipped[c.id]) continue;
        if (dailyStatusOf(c) !== 'claimed') return c;
      }
      return null;
    },

    advance() {
      if (this.phase === 'done') return;
      if (this.phase === 'advancing' && this.nextId) return;
      if (!CONFIG.dailyAuto.autoAdvance) {
        this.phase = 'done';
        this.save();
        this.notify('✅ 已领取本关奖励（自动连打已关闭）', 'info', 4000);
        this.updatePanel();
        return;
      }
      const list = getDailyChallengeList() || this._lastList || [];
      if (!list.length) { this.pause('未读取到每日挑战进度，已停止自动连打'); return; }
      const total = this.totalCount(list);
      const claimed = list.filter((c) => dailyStatusOf(c) === 'claimed').length;
      this.levelsDone = claimed;
      if (claimed >= total) { this.finish(); return; }
      const next = this.pickNext(list);
      if (!next) {
        // 剩余关卡都被手动跳过：不再无限尝试，直接收尾
        this.finish();
        return;
      }
      // 若下一关此前已清台但未领取（completed），先把奖励补齐再继续
      if (dailyStatusOf(next) === 'completed') {
        this.currentId = next.id;
        this.phase = 'claiming';
        this.clearAt = Date.now();
        this._claimFails = 0;
        this._claimTries = 0;
        this._lastClaimPollAt = 0;
        this.save();
        this.notify('💰 正在补齐「' + (next.name || next.id) + '」的奖励…', 'info', 3500);
        this.updatePanel();
        this.claimReward(next.id);
        return;
      }
      this.nextId = next.id;
      this.phase = 'advancing';
      this.save();
      this.notify('➡️ 已完成 ' + claimed + '/' + total + '，前往下一关：' + (next.name || next.id), 'info', 4200);
      this.updatePanel();
      devLog('info', '[每日挑战] 下一关', next.id);
      if (/^\/$/.test(location.pathname)) {
        // 已经在大厅：不需要刷新页面，交给 lobbyTick 直接点卡片进房
        return;
      }
      if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null; }
      this._navTimer = setTimeout(() => {
        this._navTimer = null;
        try { location.href = DAILY_HOME_URL; } catch (_) {}
      }, 1400);
    },

    finish() {
      const list = getDailyChallengeList() || this._lastList || [];
      const total = this.totalCount(list);
      const claimed = list.length
        ? list.filter((c) => dailyStatusOf(c) === 'claimed').length
        : this.countClaimed();
      const skipped = Object.keys(this._skipped || {}).length;
      const allDone = claimed >= total;
      this.phase = 'done';
      this.nextId = null;
      this.levelsDone = claimed;
      this.save();
      clearDailyEntryMarker();
      const toastText = allDone
        ? '🎉 每日挑战 ' + claimed + '/' + total + ' 全部完成，已停止自动连打'
        : '⏭️ 已完成 ' + claimed + '/' + total + '，另有 ' + skipped + ' 关被跳过，自动化已停止';
      try { if (DailyChallengeEngine.running) DailyChallengeEngine.stop(toastText); } catch (_) {}
      showToast(toastText, 3200);
      this.notify(
        allDone
          ? '🎉 今日 ' + total + ' 个每日挑战已全部完成（' + claimed + '/' + total + '），自动化已停止'
          : '⏭️ 今日已完成 ' + claimed + '/' + total + '，跳过 ' + skipped + ' 关，自动化已停止（可稍后手动补打剩余关卡）',
        allDone ? 'success' : 'warn',
        0
      );
      this.updatePanel();
      devLog('info', '[每日挑战] 结束 claimed=' + claimed + '/' + total + ' skipped=' + skipped);
    },

    pause(reason) {
      this.phase = 'paused';
      if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null; }
      this.save();
      if (DailyChallengeEngine.running) DailyChallengeEngine.stop(reason || '已暂停每日挑战自动连打');
      if (reason) {
        this.notify('⏸️ ' + reason, 'warn', 5000);
      } else {
        this.notify('⏸️ 已暂停自动完成每日挑战（当前进度 ' + this.progressText() + '）', 'warn', 5000);
      }
      this.updatePanel();
    },

    retryLevel(reason) {
      const id = this.currentId;
      const times = Number(this._retries) || 0;
      const maxRetry = Number(CONFIG.dailyAuto.maxRetryPerLevel || 0);
      if (!id || times >= maxRetry) {
        this.pause((reason || '本关未能清台') + (times > 0 ? '（已自动重试 ' + times + ' 次）' : ''));
        return;
      }
      this._retries = times + 1;
      try { if (DailyChallengeEngine.running) DailyChallengeEngine.stop('重新挑战本关'); } catch (_) {}
      // 优先用页面上的「重打」按钮原地重开（不刷新、不跳转，避免触发“另一台设备正在游戏中”弹窗）
      let retryBtn = null;
      try {
        retryBtn = [...document.querySelectorAll('button')].find((b) => /重打|重新开始|再来一局/.test(b.textContent || '') && !b.disabled) || null;
      } catch (_) {}
      if (retryBtn) {
        try { retryBtn.click(); } catch (_) {}
        this.phase = 'playing';
        this._startAttempted = false;
        this.shots = 0;
        this.startedAt = 0;
        this.clearAt = 0;
        this.save();
        this.notify('🔁 本关未清台，已点击「重打」自动重试（第 ' + this._retries + ' 次）', 'warn', 4000);
        this.updatePanel();
        devLog('info', '[每日挑战] 点击重打重试本关 ' + id);
        return;
      }
      this.phase = 'advancing';
      this.nextId = id;
      this.clearAt = 0;
      this.save();
      this.notify('🔁 ' + (reason || '本关未能清台') + '，自动重试第 ' + this._retries + ' 次', 'warn', 4000);
      this.updatePanel();
      devLog('info', '[每日挑战] 自动重试本关 ' + id + '（第 ' + this._retries + ' 次）');
      if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null; }
      this._navTimer = setTimeout(() => {
        this._navTimer = null;
        try { location.href = DAILY_HOME_URL; } catch (_) {}
      }, 1400);
    },

    skipCurrent() {
      const id = this.currentId || this.nextId;
      if (!id) {
        this.notify('⚠️ 当前没有进行中的关卡可跳过', 'warn', 3000);
        return false;
      }
      if (this.phase === 'idle' || this.phase === 'done') {
        this.notify('⚠️ 自动化未在运行，无需跳过', 'warn', 3000);
        return false;
      }
      this._skipped = this._skipped || {};
      this._skipped[id] = true;
      try { if (DailyChallengeEngine.running) DailyChallengeEngine.stop('已跳过本关'); } catch (_) {}
      if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null; }
      this.currentId = null;
      this.nextId = null;
      this.clearAt = 0;
      this._claimFails = 0;
      this._claimTries = 0;
      this._startAttempted = false;
      this._lastClaimPollAt = 0;
      this.save();
      const list = getDailyChallengeList() || this._lastList || [];
      const next = this.pickNext(list);
      const ch = findDailyChallengeById(id);
      const name = (ch && ch.name) || id;
      if (!next) {
        this.notify('⏭️ 已跳过「' + name + '」，今日已无可自动进行的关卡', 'warn', 4500);
        this.finish();
        if (!/^\/$/.test(location.pathname)) {
          this._navTimer = setTimeout(() => {
            this._navTimer = null;
            try { location.href = DAILY_HOME_URL; } catch (_) {}
          }, 500);
        }
        return true;
      }
      this.nextId = next.id;
      this.phase = 'advancing';
      this.save();
      this.notify('⏭️ 已跳过「' + name + '」，前往下一关：' + (next.name || next.id), 'warn', 4500);
      this.updatePanel();
      if (!/^\/$/.test(location.pathname)) {
        this._navTimer = setTimeout(() => {
          this._navTimer = null;
          try { location.href = DAILY_HOME_URL; } catch (_) {}
        }, 600);
      }
      devLog('info', '[每日挑战] 跳过本关 ' + id);
      return true;
    },

    resume() {
      if (this.phase === 'paused') {
        this.phase = 'playing';
        this._startAttempted = false;
        this.save();
      }
    },

    enforceLimits(state) {
      if (this.phase !== 'playing') return;
      if (this.startedAt && Date.now() - this.startedAt > CONFIG.dailyAuto.levelTimeoutMs) {
        this.pause('单关超时，已停止自动连打');
        return;
      }
      if (!state) return;
      if (isShotOrMoving(state)) { this._moving = true; return; }
      if (this._moving) {
        this._moving = false;
        this.shots += 1;
      }
      if (this.shots > CONFIG.dailyAuto.maxShotsPerLevel) {
        this.pause('单关击球次数超限，已停止自动连打');
      }
    },

    startLobbyDriver() {
      if (this._lobbyTimer) return;
      this._lobbyTimer = setInterval(() => {
        try { this.lobbyTick(); } catch (_) {}
      }, 600);
    },

    lobbyTick() {
      if (!CONFIG.dailyAuto.enabled) return;
      if (window !== window.top) return;
      if (this.phase !== 'advancing') {
        this.claimCompletedSilently();
        return;
      }
      if (!this.nextId) { this.phase = 'idle'; this.save(); return; }
      if (this._driveBusy) return;
      this._driveBusy = true;
      this.driveToNext(this.nextId)
        .catch((err) => devLog('warn', '[每日挑战] 大厅驱动异常', err))
        .finally(() => { this._driveBusy = false; });
    },

    claimCompletedSilently() {
      if (!CONFIG.dailyAuto.autoClaim) return;
      const now = Date.now();
      if (now - this._lastSilentClaimAt < 5000) return;
      this._lastSilentClaimAt = now;
      const list = getDailyChallengeList() || this._lastList;
      if (!list) return;
      const completed = list.filter((c) => dailyStatusOf(c) === 'completed');
      if (!completed.length) return;
      this._silentQueue = this._silentQueue || [];
      this._silentTries = this._silentTries || {};
      completed.forEach((c) => {
        const id = c.id;
        if (!id) return;
        if (this.phase === 'claiming' && this.currentId === id) return; // 主流程正在领取这一关
        if (Number(this._silentTries[id]) >= 5) return;
        if (this._silentQueue.indexOf(id) < 0) this._silentQueue.push(id);
      });
      this._pumpSilentClaims();
    },

    async _pumpSilentClaims() {
      if (this._silentBusy) return;
      this._silentQueue = this._silentQueue || [];
      if (!this._silentQueue.length) return;
      if (this._claimInflight) {
        setTimeout(() => { try { this._pumpSilentClaims(); } catch (_) {} }, 1500);
        return;
      }
      this._silentBusy = true;
      try {
        const id = this._silentQueue.shift();
        this._silentTries[id] = (Number(this._silentTries[id]) || 0) + 1;
        const ch = findDailyChallengeById(id);
        if (ch && dailyStatusOf(ch) === 'completed') {
          await this.claimReward(id);
        }
        const after = findDailyChallengeById(id);
        if (after && dailyStatusOf(after) === 'completed' && Number(this._silentTries[id]) < 5) {
          this._silentQueue.push(id);
        }
      } catch (_) {}
      this._silentBusy = false;
      if (this._silentQueue.length) {
        setTimeout(() => { try { this._pumpSilentClaims(); } catch (_) {} }, 300);
      }
    },

    findDailyCard() {
      try {
        const wrap = document.querySelector('.home-activities');
        if (!wrap) return null;
        const btns = wrap.querySelectorAll('button');
        for (let i = 0; i < btns.length; i++) {
          if (/每日挑战/.test(btns[i].textContent || '')) return btns[i];
        }
      } catch (_) {}
      return null;
    },

    findChallengeButton(id) {
      try {
        const nodes = document.querySelectorAll('button[data-challenge]');
        const key = String(id).toLowerCase();
        for (let i = 0; i < nodes.length; i++) {
          const b = nodes[i];
          if (String(b.getAttribute('data-challenge') || '').toLowerCase() === key && !b.disabled) return b;
        }
      } catch (_) {}
      return null;
    },

    async driveToNext(id) {
      if (!/^\/$/.test(location.pathname)) {
        try { location.href = DAILY_HOME_URL; } catch (_) {}
        return;
      }
      if (this.phase !== 'advancing') return;
      const deadline = Date.now() + CONFIG.dailyAuto.advanceLobbyWaitMs;
      const isDrawerOpen = () => Boolean(document.querySelector('#overlay[data-drawer="training-challenges"]'));
      let card = this.findDailyCard();
      while (!card && !isDrawerOpen() && Date.now() < deadline) {
        await dailyDelay(400);
        card = this.findDailyCard();
      }
      if (this.phase !== 'advancing') return;
      if (!card && !isDrawerOpen()) { this.pause('未找到大厅「每日挑战」入口'); return; }
      if (!isDrawerOpen()) card.click();
      let btn = this.findChallengeButton(id);
      let tries = 0;
      while (!btn && Date.now() < deadline) {
        await dailyDelay(400);
        if (this.phase !== 'advancing') return;
        btn = this.findChallengeButton(id);
        tries += 1;
        if (!btn && (tries % 8) === 0) {
          if (!isDrawerOpen()) {
            const again = this.findDailyCard();
            if (again) again.click();
          }
        }
      }
      if (!btn) { this.pause('未找到可挑战的关卡：' + id); return; }
      if (this.phase !== 'advancing') return;

      // v1.7.11：点击前复核目标状态，避免多端/多标签竞争导致白等 20 秒
      const fresh = await this.loadActivities();
      if (fresh) {
        const t = fresh.find((c) => String(c.id).toLowerCase() === String(id).toLowerCase());
        const st = t ? dailyStatusOf(t) : 'missing';
        if (st === 'claimed' || st === 'missing') {
          const alt = this.pickNext(fresh);
          if (alt && String(alt.id).toLowerCase() !== String(id).toLowerCase()) {
            this.nextId = alt.id;
            this.save();
            return this.driveToNext(alt.id);
          }
          if (!alt) { this.finish(); return; }
          this.pause('目标关卡状态已变化且无其他可挑战关卡：' + id);
          return;
        }
        if (st === 'completed') {
          this.currentId = id;
          this.nextId = null;
          this.phase = 'claiming';
          this.clearAt = Date.now();
          this._claimFails = 0;
          this._claimTries = 0;
          this._lastClaimPollAt = 0;
          this.save();
          this.notify('💰 「' + (t.name || id) + '」已清台未领取，先补领奖励…', 'info', 3500);
          this.updatePanel();
          this.claimReward(id);
          return;
        }
        if (st !== 'ready') {
          this.pause('关卡「' + id + '」当前状态为 ' + st + '，无法挑战');
          return;
        }
      }

      writeDailyEntryMarker(id, '');
      this.currentId = id;
      this.phase = 'playing';
      this.enteredAt = Date.now();
      this._startAttempted = false;
      this._retries = 0;
      this.shots = 0;
      this.startedAt = 0;
      this.clearAt = 0;
      this.nextId = null;
      this.save();
      devLog('info', '[每日挑战] 自动进入下一关', id);
      btn.click();
    },
  };

  const _boundTapDocs = new WeakSet();
  let _lastScreenTapTime = 0;
  let _lastScreenTapPos = { x: 0, y: 0 };
  let _screenTapCount = 0;
  let _pendingDoubleTapTimer = null;
  let _lastTwoFingerTapTime = 0;
  let _lastTwoFingerTapPos = { x: 0, y: 0 };
  let _twoFingerTapCount = 0;

  function togglePanelCircleVisibility() {
    let handled = false;
    if (ui && typeof ui.toggleCircleHidden === 'function') {
      ui.toggleCircleHidden();
      handled = true;
    }
    const wins = collectCandidateWindows();
    for (const w of wins) {
      try {
        if (w && w !== window && w.__snookerAimUi__ && typeof w.__snookerAimUi__.toggleCircleHidden === 'function') {
          w.__snookerAimUi__.toggleCircleHidden();
          handled = true;
        } else if (w && w.document) {
          const p = w.document.getElementById('snooker-aim-panel');
          if (p && (!ui || p !== ui.panel)) {
            const isHidden = p.style.display === 'none';
            p.style.display = isHidden ? 'block' : 'none';
            handled = true;
          }
        }
      } catch (_) {}
    }
    return handled;
  }

  function bindScreenMultiTap(doc) {
    if (!doc || _boundTapDocs.has(doc)) return;
    _boundTapDocs.add(doc);

    const handleTap = (clientX, clientY, target) => {
      // 严格排除控制面板与其子元素
      if (target && target.closest && target.closest('#snooker-aim-panel')) return;

      const now = performance.now();
      const dt = now - _lastScreenTapTime;
      if (dt < 40 && _lastScreenTapTime > 0) return;

      const dist = Math.hypot(clientX - _lastScreenTapPos.x, clientY - _lastScreenTapPos.y);

      // 位移过大(超过 30px)判定为滑屏瞄准，重置点击计数
      if (dist >= 30) {
        _screenTapCount = 1;
        _lastScreenTapTime = now;
        _lastScreenTapPos = { x: clientX, y: clientY };
        return;
      }

      if (dt >= 40 && dt <= 330) {
        _screenTapCount++;
      } else {
        _screenTapCount = 1;
      }

      _lastScreenTapTime = now;
      _lastScreenTapPos = { x: clientX, y: clientY };

      // 单指双击屏幕：显隐控制面板加号圆圈！
      if (_screenTapCount === 2) {
        _screenTapCount = 0;
        _lastScreenTapTime = 0;
        togglePanelCircleVisibility();
        try { if (navigator.vibrate) navigator.vibrate([25, 35]); } catch (_) {}
      }
    };

    // 1. 监听 touchstart (单指双击显隐控制面板)
    doc.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleTap(touch.clientX, touch.clientY, e.target);
    }, { passive: true, capture: true });

    // 2. 监听 pointerdown (覆盖鼠标单指/笔触)
    doc.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.pointerType === 'touch') return; // 移动端 touch 已在 touchstart 处理
      handleTap(e.clientX, e.clientY, e.target);
    }, { passive: true, capture: true });
  }

  function bindScreenDoubleTap(doc) {
    bindScreenMultiTap(doc);
  }

  const _boundKeyDocs = new WeakSet();
  function bindKeyboardShortcuts(doc) {
    if (!doc || _boundKeyDocs.has(doc)) return;
    _boundKeyDocs.add(doc);
    bindScreenDoubleTap(doc);
    doc.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

      // 【快捷键】Space 空格键触发每日挑战自动化击球 (启动/暂停)
      if (e.code === 'Space' || e.key === ' ') {
        DailyChallengeEngine.toggle();
        try {
          if (typeof DailyRunner !== 'undefined' && DailyRunner) {
            if (DailyChallengeEngine.running) DailyRunner.resume();
            else DailyRunner.pause('');
          }
        } catch (_) {}
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 【快捷键】Escape 键退出/停止自动化击球
      if (e.code === 'Escape' || e.key === 'Escape') {
        let runnerPlaying = false;
        try { runnerPlaying = Boolean(typeof DailyRunner !== 'undefined' && DailyRunner && DailyRunner.phase === 'playing'); } catch (_) {}
        if (DailyChallengeEngine.running || runnerPlaying) {
          DailyChallengeEngine.stop('已按下ESC停止每日挑战自动化击球');
          try { if (typeof DailyRunner !== 'undefined' && DailyRunner) DailyRunner.pause('已按下ESC停止每日挑战自动连打'); } catch (_) {}
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }, true);
  }

  /* ================================================================== */
  /* 球桌 Canvas 探测                                                    */
  /* ================================================================== */

  function queryCanvasesInRoot(root, out) {
    if (!root || !root.querySelectorAll) return;
    try {
      const list = root.querySelectorAll('canvas');
      for (const c of list) {
        if (c.id !== 'snooker-aim-overlay' && c.isConnected) out.push(c);
      }
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) queryCanvasesInRoot(el.shadowRoot, out);
      }
    } catch (_) {}
  }

  function findGameCanvasInDoc(doc) {
    if (!doc) return null;
    const scene = doc.getElementById('scene');
    if (scene) {
      if (scene.tagName && scene.tagName.toLowerCase() === 'canvas' && isCanvasActuallyVisible(scene)) {
        return scene;
      }
      const inner = scene.querySelector('canvas');
      if (inner && inner.id !== 'snooker-aim-overlay' && isCanvasActuallyVisible(inner)) {
        return inner;
      }
    }
    const canvases = [];
    queryCanvasesInRoot(doc, canvases);
    const visibleCanvases = canvases.filter((c) => isCanvasActuallyVisible(c));
    if (!visibleCanvases.length) return null;
    visibleCanvases.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    return visibleCanvases[0] || null;
  }

  function findGameCanvas() {
    const localCanvas = findGameCanvasInDoc(document);
    if (localCanvas) return localCanvas;

    if (window === window.top) {
      const wins = collectCandidateWindows();
      for (const w of wins) {
        if (w === window || w === (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null)) continue;
        try {
          if (w.document) {
            const subCanvas = findGameCanvasInDoc(w.document);
            if (subCanvas) return subCanvas;
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function hasGameSurface() {
    return Boolean(findGameCanvas());
  }

  /* ================================================================== */
  /* 跨帧调试与远程操作同步                                               */
  /* ================================================================== */

  const REMOTE_BRIDGE_KEY = '__snookerAimRemoteBridge__';
  let _remoteDebugState = null;

  function setupTopMessageListener() {
    if (window !== window.top) return;
    window.addEventListener('message', (e) => {
      const d = e && e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'SNOOKER_AIM_DEBUG_SYNC' && typeof d.text === 'string') {
        _remoteDebugState = { text: d.text, ts: Date.now() };
      }
    });
  }
  setupTopMessageListener();

  function publishFrameDebugToTop(debugText) {
    if (window === window.top) return;
    const nowEpoch = Date.now();
    try {
      if (window.top) {
        window.top[REMOTE_BRIDGE_KEY] = {
          text: debugText,
          ts: nowEpoch,
          ownerWin: window,
        };
      }
    } catch (_) {}
    try {
      window.top.postMessage({ type: 'SNOOKER_AIM_DEBUG_SYNC', text: debugText }, '*');
    } catch (_) {}
  }

  function readActiveRemoteDebug() {
    if (window !== window.top) return null;
    const nowEpoch = Date.now();
    try {
      const bridge = window[REMOTE_BRIDGE_KEY];
      if (bridge && typeof bridge.text === 'string' && (nowEpoch - bridge.ts) < 1500) {
        return bridge;
      }
    } catch (_) {}
    if (_remoteDebugState && (nowEpoch - _remoteDebugState.ts) < 1500) {
      return _remoteDebugState;
    }
    return null;
  }

  /* ================================================================== */
  /* 控制面板常驻判定与单例管理                                           */
  /* ================================================================== */

  function shouldMountPanelInThisWindow() {
    if (window === window.top) return true;
    try {
      if (window.top && window.top.document && window.top.document.getElementById('snooker-aim-panel')) {
        return false;
      }
    } catch (_) {
      return hasGameSurface();
    }
    return hasGameSurface();
  }

  /* 手机端便捷悬浮触控栏 (左下角UI已移除，由控制面板加号双击对齐完全替代) */
  const mobileDock = {
    el: null,
    ensure() {
      if (typeof document !== 'undefined' && document.body) {
        document.querySelectorAll('#snooker-mobile-dock').forEach((e) => e.remove());
      }
    },
  };

  function ensureUiBuilt() {
    if (shouldMountPanelInThisWindow()) {
      if (document.body) {
        ui.ensure();
        mobileDock.ensure();
      } else {
        window.addEventListener('DOMContentLoaded', () => {
          if (shouldMountPanelInThisWindow()) {
            ui.ensure();
            mobileDock.ensure();
          }
        }, { once: true });
      }
    }
  }

  function removeUiFromOtherFrames() {
    if (window !== window.top) return;
    const walk = (win, depth) => {
      if (!win || depth > 5) return;
      try {
        if (win !== window && win.document) {
          win.document.querySelectorAll('#snooker-aim-panel, #snooker-mobile-dock').forEach((el) => el.remove());
          win.document.querySelectorAll('#snooker-aim-hud-pill').forEach((el) => {
            if (typeof hudPill === 'undefined' || el !== hudPill.el) el.remove();
          });
        }
      } catch (_) {}
      let frames = null;
      try { frames = win.frames; } catch (_) { return; }
      if (!frames || typeof frames.length !== 'number') return;
      for (let i = 0; i < frames.length; i++) walk(frames[i], depth + 1);
    };
    try { walk(window, 0); } catch (_) {}
  }

  function getCueBall(state) {
    if (!state || !Array.isArray(state.balls)) return null;
    const byId = (state.cueBallId != null) ? state.balls.find((b) => b && (b.id === state.cueBallId || String(b.id) === String(state.cueBallId))) : null;
    if (byId) return byId;
    return state.balls.find((b) => b && (b.kind === 'cue' || b.isCue || b.kind === 0)) || null;
  }

  function activeObjectBalls(state) {
    if (!state || !Array.isArray(state.balls)) return [];
    const cueId = state.cueBallId != null ? String(state.cueBallId) : null;
    return state.balls.filter(
      (b) => b && !b.potted && b.kind !== 'cue' && !b.isCue && b.kind !== 0 && (cueId == null || String(b.id) !== cueId) && (
        (b.pos && Number.isFinite(b.pos.x)) || Number.isFinite(b.x)
      )
    );
  }

  function activeAllBalls(state) {
    if (!state || !Array.isArray(state.balls)) return [];
    return state.balls.filter(
      (b) => b && !b.potted && (
        (b.pos && Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)) ||
        (Number.isFinite(b.x) && Number.isFinite(b.y))
      )
    );
  }

  const POCKET_LABELS = {
    'middle-top': '左侧中袋',
    'middle-bottom': '右侧中袋',
    'corner-top-right': '左侧顶袋',
    'corner-bottom-right': '右侧顶袋',
    'corner-top-left': '左侧底袋',
    'corner-bottom-left': '右侧底袋',
    // 兼容可能出现的命名下划线或别名
    'middle_top': '左侧中袋',
    'middle_bottom': '右侧中袋',
    'top_middle': '左侧中袋',
    'bottom_middle': '右侧中袋',
    'corner_top_right': '左侧顶袋',
    'corner_bottom_right': '右侧顶袋',
    'corner_top_left': '左侧底袋',
    'corner_bottom_left': '右侧底袋',
    'pocket_top_right': '左侧顶袋',
    'pocket_bottom_right': '右侧顶袋',
    'pocket_top_left': '左侧底袋',
    'pocket_bottom_left': '右侧底袋',
    'pocket_middle_top': '左侧中袋',
    'pocket_middle_bottom': '右侧中袋',
  };

  // 标准斯诺克视角命名（以底库面向顶库，绿球在左侧，黄球在右侧）
  function formatPocketLabel(p) {
    if (!p) return '袋口';
    if (p.id && POCKET_LABELS[p.id]) return POCKET_LABELS[p.id];
    const pt = p.opening || p.center || p.pos || (Number.isFinite(p.x) ? p : { x: 0, y: 0 });
    const x = Number(pt.x) || 0;
    const y = Number(pt.y) || 0;
    if (Math.abs(x) < 500) {
      return y < 0 ? '左侧中袋' : '右侧中袋';
    }
    if (x > 0) {
      // 顶库 (靠近黑球一侧)
      return y < 0 ? '左侧顶袋' : '右侧顶袋';
    } else {
      // 底库 (靠近咖啡球一侧)
      return y < 0 ? '左侧底袋' : '右侧底袋';
    }
  }

  // 库边标准名称判定：顶库 (靠近黑球一侧)、底库 (靠近咖啡球一侧)、左侧边库、右侧边库
  function getCushionLabel(axis, point) {
    if (axis === 'x') {
      return (point && point.x > 0) ? '顶库' : '底库';
    } else {
      return (point && point.y < 0) ? '左侧边库' : '右侧边库';
    }
  }

  function mergeSources(sources) {
    const byId = new Map();
    sources.forEach((src, si) => {
      if (!Array.isArray(src)) return;
      for (const item of src) {
        if (!item || !item.id) continue;
        if (!byId.has(item.id)) byId.set(item.id, {});
        byId.get(item.id)[`s${si}`] = item;
      }
    });
    return byId;
  }

  function readPockets(state) {
    const colliders = state && state.tableColliderSet && Array.isArray(state.tableColliderSet.pockets)
      ? state.tableColliderSet.pockets : [];
    const simple = state && Array.isArray(state.pockets) ? state.pockets : [];
    const merged = mergeSources([colliders, simple, FALLBACK_POCKETS]);

    const result = [];
    for (const [id, srcs] of merged) {
      const c = srcs.s0 || {};
      const sp = srcs.s1 || {};
      const fb = srcs.s2 || {};
      const center = c.center || sp.center || fb.center || { x: 0, y: 0 };
      const opening = (c.openingDefinition && c.openingDefinition.center) || c.opening || sp.opening || fb.opening || center;
      const throatWidthMm =
        (c.openingDefinition && c.openingDefinition.throatWidthMm) ||
        c.throatWidthMm || sp.throatWidthMm || fb.throatWidthMm || THROAT_WIDTH_MM;
      const drop = c.dropDirection || sp.dropDirection || fb.dropDirection || { x: 0, y: -1 };
      const normal = V.norm(drop);
      const label = formatPocketLabel({ id, opening, center });
      result.push({
        id,
        label,
        type: c.type || sp.type || fb.type || 'corner',
        center,
        opening,
        normal,
        tangent: { x: -normal.y, y: normal.x },
        throatWidthMm,
        captureRadius: c.captureRadius || (c.blackHole && c.blackHole.radius) || sp.captureRadius || fb.captureRadius || DEFAULT_CAPTURE_RADIUS,
      });
    }
    return result;
  }

  /* ================================================================== */
  /* 贴库球与半贴库球专项自适应补偿算法                                   */
  /* ================================================================== */

  /**
   * 检测目标球是否处于贴库（净空 <= 4mm）或半贴库（净空 <= 25mm）状态
   * @param {Object} ballPos 目标球二维坐标 {x, y}
   * @param {Object} [tableBounds] 台面有效边界（包含 boundX, boundY）
   * @returns {Object} 贴库检测结果
   */
  function checkCushionHug(ballPos, tableBounds) {
    if (!ballPos || !Number.isFinite(ballPos.x) || !Number.isFinite(ballPos.y)) {
      return { isHug: false, isTight: false, isNear: false, edgeGap: Infinity, axis: null, railSign: 0, boundVal: 0 };
    }
    const bX = (tableBounds && Number.isFinite(tableBounds.boundX)) ? tableBounds.boundX : (CONFIG.railBoundX || 1758.1);
    const bY = (tableBounds && Number.isFinite(tableBounds.boundY)) ? tableBounds.boundY : (CONFIG.railBoundY || 862.75);

    const gapX = Math.max(0, bX - Math.abs(ballPos.x));
    const gapY = Math.max(0, bY - Math.abs(ballPos.y));

    // 判断更贴近哪面库边（X为顶底短边库，Y为左右长边库）
    const isLongRail = gapY <= gapX;
    const axis = isLongRail ? 'y' : 'x';
    const edgeGap = isLongRail ? gapY : gapX;
    const railSign = isLongRail ? Math.sign(ballPos.y || 1) : Math.sign(ballPos.x || 1);
    const boundVal = isLongRail ? bY : bX;

    const isTight = edgeGap <= 4.0;
    const isNear = edgeGap > 4.0 && edgeGap <= 25.0;
    const isHug = isTight || isNear;

    return {
      isHug,
      isTight,
      isNear,
      axis,        // 'y' (左右长边库) | 'x' (顶底短边库)
      edgeGap: Math.round(edgeGap * 10) / 10,
      railSign,    // 1 或 -1
      boundVal,
    };
  }

  /**
   * 刚体扫掠双平行线擦角碰撞检测（以绿色瞄准线为中间线，左右各一条相距球半径 26.25mm 的平行线）
   * 分析靠库侧外边缘包络线是否会与进入的袋口库嘴（Pocket Jaw）及库木发生擦边碰撞
   * @param {Object} ballPos 目标球二维位置
   * @param {Object} rawTarget 原始目标点（通常为 pk.opening）
   * @param {Object} pk 袋口对象
   * @param {Object} tableBounds 台面有效边界
   * @returns {Object} { isClipping, minGap, compOffset, axis, railSign }
   */
  function checkParallelRayJawClipping(ballPos, rawTarget, pk, tableBounds) {
    if (!pk || (pk.type !== 'corner' && !(pk.id && pk.id.includes('corner')))) {
      return { isClipping: false, minGap: Infinity, compOffset: 0, axis: null, railSign: 0 };
    }
    const bY = (tableBounds && Number.isFinite(tableBounds.boundY)) ? tableBounds.boundY : (CONFIG.railBoundY || 862.75);
    const cY = (tableBounds && Number.isFinite(tableBounds.cushionY)) ? tableBounds.cushionY : (bY + BALL_RADIUS_MM);
    const bX = (tableBounds && Number.isFinite(tableBounds.boundX)) ? tableBounds.boundX : (CONFIG.railBoundX || 1758.1);
    const cX = (tableBounds && Number.isFinite(tableBounds.cushionX)) ? tableBounds.cushionX : (bX + BALL_RADIUS_MM);

    const dx = rawTarget.x - ballPos.x;
    const dy = rawTarget.y - ballPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 30) {
      return { isClipping: false, minGap: Infinity, compOffset: 0, axis: null, railSign: 0 };
    }

    // 1) 长库沿库滑行擦角检测 (例如亨得利球型：半贴长库进角袋)
    const railSignY = Math.sign(ballPos.y || 1);
    const isSameSideLongRail = (Math.sign(rawTarget.y) === railSignY) && (Math.abs(ballPos.y) > 550);
    const isMovingTowardCornerX = (Math.sign(dx) === Math.sign(rawTarget.x)) && (Math.abs(dx) > 10);

    if (isSameSideLongRail && isMovingTowardCornerX) {
      // 沿瞄准线采样，分析靠长库一侧外轮廓平行线与库木的净空
      let minGap = Infinity;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cy = ballPos.y + t * dy;
        const outerY = cy + railSignY * BALL_RADIUS_MM;
        const gap = cY - Math.abs(outerY);
        if (gap < minGap) minGap = gap;
      }

      // 若靠库侧平行线与库木净空小于安全间隙 1.5mm (或为负数，已穿透擦碰库嘴)
      if (minGap < 1.5) {
        const clipDepth = Math.max(0, 1.5 - minGap);
        // 按照贴库球瞄准方式由开口正中平移微调 5~8mm
        const compOffset = clamp(Math.round((5.5 + clipDepth * 0.7) * 10) / 10, 5.0, 8.0);
        return { isClipping: true, minGap: Math.round(minGap * 10) / 10, compOffset, axis: 'y', railSign: railSignY };
      }
    }

    // 2) 顶底短库沿库滑行擦角检测
    const railSignX = Math.sign(ballPos.x || 1);
    const isSameSideShortRail = (Math.sign(rawTarget.x) === railSignX) && (Math.abs(ballPos.x) > 1200);
    const isMovingTowardCornerY = (Math.sign(dy) === Math.sign(rawTarget.y)) && (Math.abs(dy) > 10);

    if (isSameSideShortRail && isMovingTowardCornerY) {
      let minGap = Infinity;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = ballPos.x + t * dx;
        const outerX = cx + railSignX * BALL_RADIUS_MM;
        const gap = cX - Math.abs(outerX);
        if (gap < minGap) minGap = gap;
      }

      if (minGap < 1.5) {
        const clipDepth = Math.max(0, 1.5 - minGap);
        const compOffset = clamp(Math.round((5.5 + clipDepth * 0.7) * 10) / 10, 5.0, 8.0);
        return { isClipping: true, minGap: Math.round(minGap * 10) / 10, compOffset, axis: 'x', railSign: railSignX };
      }
    }

    return { isClipping: false, minGap: Infinity, compOffset: 0, axis: null, railSign: 0 };
  }

  /**
   * 解析入袋目标点：对同侧角袋的贴库/半贴库球执行自适应平移补偿，
   * 采用双平行线擦角检测，自适应由开口正中平移 5~8mm，杜绝擦库撞嘴（Jaw）剧烈晃袋
   * @param {Object} ballPos 目标球位置
   * @param {Object} pk 袋口对象（含 id, type, opening, normal 等）
   * @param {Object} [tableBounds] 台面有效边界
   * @returns {Object} { targetPoint, cushionHug, isCompensated }
   */
  function resolveCompensatedPocketTarget(ballPos, pk, tableBounds) {
    const rawTarget = (pk && (pk.opening || pk.center)) ? { x: (pk.opening || pk.center).x, y: (pk.opening || pk.center).y } : { x: 0, y: 0 };
    if (!ballPos || !pk) {
      return { targetPoint: rawTarget, cushionHug: checkCushionHug(ballPos, tableBounds), isCompensated: false };
    }

    const ch = checkCushionHug(ballPos, tableBounds);
    const isCorner = pk.type === 'corner' || (pk.id && pk.id.includes('corner'));
    if (!isCorner) {
      return { targetPoint: rawTarget, cushionHug: ch, isCompensated: false };
    }

    // 1) 严密检测双平行线（中间线左右各一个球半径 26.25mm）是否会与袋口库嘴擦边
    const clip = checkParallelRayJawClipping(ballPos, rawTarget, pk, tableBounds);

    // 2) 若全贴库(<=4mm): 目标点坐标严格锁定为目标球同轴坐标，形成完全平行于库壁的黄金滑行切线
    if (ch.isTight) {
      let compensated = { x: rawTarget.x, y: rawTarget.y };
      if (ch.axis === 'y') {
        const isSameSide = Math.sign(rawTarget.y) === ch.railSign;
        const dx = rawTarget.x - ballPos.x;
        const isMovingTowardCorner = (Math.sign(dx) === Math.sign(rawTarget.x)) && Math.abs(dx) > 10;
        if (isSameSide && isMovingTowardCorner) {
          const maxSafeY = ch.railSign * ch.boundVal;
          compensated.y = ch.railSign > 0 ? Math.min(ballPos.y, maxSafeY) : Math.max(ballPos.y, maxSafeY);
          return { targetPoint: compensated, cushionHug: { ...ch, isJawClipping: clip.isClipping }, isCompensated: true };
        }
      } else if (ch.axis === 'x') {
        const isSameSide = Math.sign(rawTarget.x) === ch.railSign;
        const dy = rawTarget.y - ballPos.y;
        const isMovingTowardCorner = (Math.sign(dy) === Math.sign(rawTarget.y)) && Math.abs(dy) > 10;
        if (isSameSide && isMovingTowardCorner) {
          const maxSafeX = ch.railSign * ch.boundVal;
          compensated.x = ch.railSign > 0 ? Math.min(ballPos.x, maxSafeX) : Math.max(ballPos.x, maxSafeX);
          return { targetPoint: compensated, cushionHug: { ...ch, isJawClipping: clip.isClipping }, isCompensated: true };
        }
      }
    }

    // 3) 亨得利球型与半贴库球：双平行线检测到擦边碰撞
    if (clip.isClipping) {
      let compensated = { x: rawTarget.x, y: rawTarget.y };
      if (clip.axis === 'y') {
        // 由开口正中沿同侧库边方向安全平移 5~8mm 消除擦边
        compensated.y = rawTarget.y - clip.railSign * clip.compOffset;
        const hugInfo = { ...ch, isNear: true, isJawClipping: true, compOffset: clip.compOffset, minGap: clip.minGap };
        return { targetPoint: compensated, cushionHug: hugInfo, isCompensated: true };
      } else if (clip.axis === 'x') {
        compensated.x = rawTarget.x - clip.railSign * clip.compOffset;
        const hugInfo = { ...ch, isNear: true, isJawClipping: true, compOffset: clip.compOffset, minGap: clip.minGap };
        return { targetPoint: compensated, cushionHug: hugInfo, isCompensated: true };
      }
    }

    // 4) 常规半贴库(4~25mm) 平滑插值兜底
    if (ch.isNear) {
      let compensated = { x: rawTarget.x, y: rawTarget.y };
      if (ch.axis === 'y') {
        const isSameSide = Math.sign(rawTarget.y) === ch.railSign;
        const dx = rawTarget.x - ballPos.x;
        const isMovingTowardCorner = (Math.sign(dx) === Math.sign(rawTarget.x)) && Math.abs(dx) > 10;
        if (isSameSide && isMovingTowardCorner) {
          const t = (25.0 - ch.edgeGap) / (25.0 - 4.0);
          const targetY = rawTarget.y * (1 - t) + ballPos.y * t;
          const maxSafeY = ch.railSign * ch.boundVal;
          compensated.y = ch.railSign > 0 ? Math.min(targetY, maxSafeY) : Math.max(targetY, maxSafeY);
          return { targetPoint: compensated, cushionHug: ch, isCompensated: true };
        }
      } else if (ch.axis === 'x') {
        const isSameSide = Math.sign(rawTarget.x) === ch.railSign;
        const dy = rawTarget.y - ballPos.y;
        const isMovingTowardCorner = (Math.sign(dy) === Math.sign(rawTarget.y)) && Math.abs(dy) > 10;
        if (isSameSide && isMovingTowardCorner) {
          const t = (25.0 - ch.edgeGap) / (25.0 - 4.0);
          const targetX = rawTarget.x * (1 - t) + ballPos.x * t;
          const maxSafeX = ch.railSign * ch.boundVal;
          compensated.x = ch.railSign > 0 ? Math.min(targetX, maxSafeX) : Math.max(targetX, maxSafeX);
          return { targetPoint: compensated, cushionHug: ch, isCompensated: true };
        }
      }
    }

    return { targetPoint: rawTarget, cushionHug: ch, isCompensated: false };
  }

  /* ================================================================== */
  /* 进袋判定（几何扫描与容差置信度评估）                                   */
  /* ================================================================== */

  function evaluatePocket(ballPos, dir, pocket, customTarget = null) {
    if (!pocket || !pocket.opening) return null;
    const targetPt = customTarget || pocket.opening;
    const normal = pocket.normal || V.norm(pocket.dropDirection || { x: 0, y: -1 });
    const tangent = pocket.tangent || { x: -normal.y, y: normal.x };
    const toward = V.dot(dir, normal);
    if (toward <= 1e-6) return null;
    const v = V.sub(targetPt, ballPos);
    const depth = V.dot(v, normal);
    if (depth <= 0) return null;
    const s = depth / toward;
    if (s <= 0) return null;
    const arrive = V.add(ballPos, V.scale(dir, s));
    const tan = V.dot(V.sub(arrive, targetPt), tangent);
    const angleDeg = Math.acos(clamp(toward, -1, 1)) * 180 / Math.PI;
    const inc = incidenceAt(pocket.type, angleDeg);
    const half = inc.widthMm / 2;
    if (half <= 0 || Math.abs(tan) > half) return null;
    const alignConf = 1 - Math.abs(tan) / half;
    const confidence = clamp(alignConf * inc.coef, 0, 1);
    return {
      s, tan, half, angleDeg, widthMm: inc.widthMm, coef: inc.coef,
      alignConf, confidence, enterPoint: arrive,
      targetPoint: targetPt,
    };
  }

  function pathBlocked(start, end, balls, blockedId, cueId) {
    const seg = V.sub(end, start);
    const len2 = seg.x * seg.x + seg.y * seg.y;
    if (len2 <= 1e-9) return false;
    for (const b of balls) {
      if (b.id === blockedId || b.id === cueId || b.potted || !b.pos) continue;
      const w = V.sub(b.pos, start);
      const u = clamp(V.dot(w, seg) / len2, 0, 1);
      const closest = V.add(start, V.scale(seg, u));
      if (V.dist(closest, b.pos) < COLLISION_DIST_MM - 0.5) return true;
    }
    return false;
  }

  let _autoAimAvailable = null;
  let _autoAimCheckTime = 0;
  const AUTO_AIM_CHECK_INTERVAL = 2000;

  function isAutoAimAvailable() {
    const now = performance.now();
    if (_autoAimAvailable !== null && now - _autoAimCheckTime < AUTO_AIM_CHECK_INTERVAL) {
      return _autoAimAvailable;
    }
    _autoAimCheckTime = now;
    const auto = getGameGlobal('SnookerAutoAim');
    _autoAimAvailable = Boolean(
      auto && typeof auto.estimatePotProbability === 'function'
    );
    return _autoAimAvailable;
  }

  function queryEngineRoute(state, cueBall, objectBall, pocketId) {
    if (!isAutoAimAvailable()) return null;
    try {
      const rawPocket = state.tableColliderSet && Array.isArray(state.tableColliderSet.pockets)
        ? state.tableColliderSet.pockets.find((p) => p.id === pocketId) : null;
      if (!rawPocket) return null;
      const auto = getGameGlobal('SnookerAutoAim');
      if (!auto) return null;
      const route = auto.estimatePotProbability({
        cueBall, objectBall, pocket: rawPocket, balls: state.balls || [],
      });
      if (!route) return null;
      return {
        blocked: Boolean(route.blocked),
        hitRate: Number.isFinite(route.hitRate) ? clamp(route.hitRate, 0, 1) : null,
        angleDeg: route.pocketIncidence && Number.isFinite(route.pocketIncidence.angleDeg)
          ? Math.abs(route.pocketIncidence.angleDeg) : null,
      };
    } catch (err) {
      devLog('warn', 'queryEngineRoute 异常:', err);
      return null;
    }
  }

  /* ================================================================== */
  /* 几何与物理联合预测                                                      */
  /* ================================================================== */

  // 精确球体相交检测 (完全对齐 147master 原生 AimContactGeometry.rayCircleHit, 严禁虚假膨胀)
  function rayContact(cuePos, d, ball) {
    const movingRadius = BALL_RADIUS_MM;
    const targetRadius = (ball && ball.radius) || BALL_RADIUS_MM;
    const totalRadius = movingRadius + targetRadius; // 严格等于 52.5mm，绝不额外增加膨胀容差

    const offset = { x: cuePos.x - ball.pos.x, y: cuePos.y - ball.pos.y };
    const b = 2 * (offset.x * d.x + offset.y * d.y);
    const c = (offset.x * offset.x + offset.y * offset.y) - totalRadius * totalRadius;
    if (c <= 0 && b >= 0) return null;
    const disc = b * b - 4 * c;
    if (disc < 0) return null; // 判别式小于0表示未碰撞(擦肩而过)，绝对判定为Miss

    const root = Math.sqrt(disc);
    const t1 = (-b - root) / 2;
    const tHit = c <= 0 ? 0 : (t1 >= 0 ? t1 : null);
    if (tHit === null || tHit <= 0) return null;

    const G = {
      x: cuePos.x + d.x * tHit,
      y: cuePos.y + d.y * tHit,
    };
    return { G, tHit, distance: tHit };
  }

  /* ================================================================== */
  /* 【物理模拟】切向抛投(CIT)、Mathavan 库边动力学与母球走位轨迹        */
  /* ================================================================== */

  // 1. 切向摩擦抛投修正（Cut-Induced Throw）
  function applyCutInducedThrow(dir, normal, impactSpeed) {
    const cosCut = clamp(V.dot(dir, normal), -1, 1);
    const sinCut = Math.sqrt(Math.max(0, 1 - cosCut * cosCut));
    if (sinCut < 0.02 || cosCut < 0.05) return normal;

    const tangent = { x: -normal.y, y: normal.x };
    const sign = V.dot(dir, tangent) >= 0 ? 1 : -1;
    const speedScale = 1 / (1 + (impactSpeed / 2400));
    const throwAngleRad = (CONFIG.throwFrictionCoef || 0.038) * sinCut * cosCut * speedScale * sign;
    return V.rotate(normal, throwAngleRad);
  }

  // 2. 147master 原生库边速度修正样条 (三次 Hermite 样条插值: 1m/s~0.95 -> 7m/s~0.83)
  const CUSHION_SPEED_KNOTS = [
    [1, 0.95], [2, 0.94], [3, 0.92], [3.5, 0.91], [5, 0.865], [7, 0.83],
  ];
  const CUSHION_SECANTS = CUSHION_SPEED_KNOTS.slice(1).map((p, i) =>
    (p[1] - CUSHION_SPEED_KNOTS[i][1]) / (p[0] - CUSHION_SPEED_KNOTS[i][0])
  );
  const CUSHION_SLOPES = CUSHION_SPEED_KNOTS.map((p, i) => {
    if (i === 0 || i === CUSHION_SPEED_KNOTS.length - 1) return 0;
    const left = p[0] - CUSHION_SPEED_KNOTS[i - 1][0];
    const right = CUSHION_SPEED_KNOTS[i + 1][0] - p[0];
    const w1 = 2 * right + left;
    const w2 = right + 2 * left;
    return (w1 + w2) / (w1 / CUSHION_SECANTS[i - 1] + w2 / CUSHION_SECANTS[i]);
  });

  function calibratedCushionRestitution(normalSpeedMmS) {
    const speed = Math.max(0, Number(normalSpeedMmS) || 0) / 1000;
    if (speed <= CUSHION_SPEED_KNOTS[0][0]) return CUSHION_SPEED_KNOTS[0][1];
    const last = CUSHION_SPEED_KNOTS.length - 1;
    if (speed >= CUSHION_SPEED_KNOTS[last][0]) return CUSHION_SPEED_KNOTS[last][1];
    const i = CUSHION_SPEED_KNOTS.findIndex((p, j) => j < last && speed >= p[0] && speed < CUSHION_SPEED_KNOTS[j + 1][0]);
    const [x, y] = CUSHION_SPEED_KNOTS[i];
    const [nextX, nextY] = CUSHION_SPEED_KNOTS[i + 1];
    const h = nextX - x;
    const t = (speed - x) / h;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * y
      + (t ** 3 - 2 * t ** 2 + t) * h * CUSHION_SLOPES[i]
      + (-2 * t ** 3 + 3 * t ** 2) * nextY
      + (t ** 3 - t ** 2) * h * CUSHION_SLOPES[i + 1];
  }

  function getCushionRestitution(base, normalSpeedMmS, strength = 1) {
    const k = clamp(Number(strength) || 0, 0, 1);
    const cal = calibratedCushionRestitution(normalSpeedMmS);
    return Math.max(0, Math.min(1, Number(base) + k * (cal - 0.95)));
  }

  // 3. Mathavan (2010) 64步累积冲量库边碰撞动力学求解器 (完全对齐 147master 原生 v3CushionCollision)
  let _livePhyCache = { at: 0, val: {} };
  function getLivePhysicsOverrides() {
    const now = Date.now();
    if (now - _livePhyCache.at < 2000 && _livePhyCache.val) return _livePhyCache.val;
    let val = {};
    try {
      const cfg = (typeof window !== 'undefined' && window.GAME_CLIENT_CONFIG) || {};
      const core = (typeof window !== 'undefined' && window.threeGame && window.threeGame.core) || null;
      const coreConfig = core ? ((typeof core.getConfig === 'function' ? core.getConfig() : core.config) || {}) : {};
      const sources = [cfg.physics || {}, coreConfig.physics || {}];
      // 必须区分“没有配置”和“配置为 0”：ballContactFrictionMu 就是合法的 0。
      const read = (k) => {
        for (let i = sources.length - 1; i >= 0; i--) {
          const ph = sources[i] || {};
          const ov = ph.overrides || {};
          const st = ph.settings || {};
          if (Object.prototype.hasOwnProperty.call(ov, k)) {
            const v = Number(ov[k]);
            if (Number.isFinite(v)) return v;
          }
          if (Object.prototype.hasOwnProperty.call(st, k)) {
            const v = Number(st[k]);
            if (Number.isFinite(v)) return v;
          }
        }
        return null;
      };
      const first = (...keys) => {
        for (const k of keys) {
          const v = read(k);
          if (v != null) return v;
        }
        return null;
      };
      const clothSlidingMu = first('clothSlidingMu', 'tableFrictionMu') ?? CONFIG.clothSlidingMu;
      const gravityMmS2 = first('gravityMmS2') ?? 9800;
      val = {
        rollingFriction: first('clothRollingDecelMmS2', 'rollingFriction') ?? CONFIG.clothRollingDecelMmS2,
        railRestitution: first('railRestitution', 'cushionEnergeticRestitution') ?? CONFIG.railRestitution,
        cushionEnergeticRestitution: first('cushionEnergeticRestitution', 'railRestitution') ?? CONFIG.railRestitution,
        tableSlidingAccel: first('tableSlidingAccel') ?? (clothSlidingMu * gravityMmS2),
        clothSlidingMu,
        gravityMmS2,
        cushionContactFrictionMu: first('cushionContactFrictionMu', 'railFrictionMu') ?? CONFIG.cushionContactFrictionMu,
        cushionNoseHeightRadiusRatio: first('cushionNoseHeightRadiusRatio') ?? 1.4,
        cushionSpinCorrectionStrength: first('cushionSpinCorrectionStrength') ?? 0,
        cushionSpeedCorrectionStrength: first('cushionSpeedCorrectionStrength') ?? 1,
        cushionImpulseSteps: first('cushionImpulseSteps') ?? 64,
        ballNormalRestitution: first('ballNormalRestitution', 'ballRestitution') ?? CONFIG.ballRestitution,
        ballContactFrictionMu: first('ballContactFrictionMu') ?? 0,
        ballSpinTransfer: first('ballSpinTransfer') ?? 0.4,
        throwVelocityScale: first('throwVelocityScale') ?? 0.009951,
        cueSpinEfficiency: first('cueSpinEfficiency') ?? CONFIG.cueSpinEfficiency,
        maxTipSpeedRetention: first('maxTipSpeedRetention') ?? CONFIG.maxTipSpeedRetention,
        maxTipOffsetRatio: first('maxTipOffsetRatio') ?? CONFIG.maxTipOffsetRatio,
        sideSpinLinearDecay: first('clothSideSpinDecelRadS2', 'sideSpinLinearDecay') ?? CONFIG.clothSideSpinDecelRadS2,
        slipEpsilon: first('slipEpsilon') ?? 7,
        lowSpeedCutoff: first('lowSpeedCutoff') ?? 8,
        lowOmegaCutoff: first('lowOmegaCutoff') ?? 0.7,
      };
    } catch (_) {
      val = {};
    }
    _livePhyCache = { at: now, val };
    return val;
  }

  function resolvePhysicsCushionRebound(vel, omega, normal, params = {}) {
    const approachSpeed = -(vel.x * normal.x + vel.y * normal.y);
    if (approachSpeed <= 0) return { vel: { ...vel }, omega: { ...omega } };

    const R = BALL_RADIUS_MM;
    const mass = 1;
    const livePhy = getLivePhysicsOverrides();
    const noseRatio = clamp(Number(livePhy.cushionNoseHeightRadiusRatio) || 1.4, 1, 2);
    const sinTheta = clamp(noseRatio - 1, 0, 0.999999);
    const cosTheta = Math.sqrt(Math.max(1e-12, 1 - sinTheta * sinTheta));
    const cushionMu = Number(livePhy.cushionContactFrictionMu) || CONFIG.cushionContactFrictionMu || 0.18;
    const clothMu = Number(livePhy.clothSlidingMu) || CONFIG.clothSlidingMu || 0.18;
    const baseRestitution = params.restitution ?? livePhy.cushionEnergeticRestitution ?? livePhy.railRestitution ?? CONFIG.railRestitution ?? 0.91;
    const energeticRestitution = getCushionRestitution(
      baseRestitution,
      approachSpeed,
      livePhy.cushionSpeedCorrectionStrength ?? 1
    );

    const tangent = { x: -normal.y, y: normal.x };
    const towardCushion = { x: -normal.x, y: -normal.y };

    const state = {
      vx: vel.x * tangent.x + vel.y * tangent.y,
      vy: vel.x * towardCushion.x + vel.y * towardCushion.y,
      wx: (omega.x || 0) * tangent.x + (omega.y || 0) * tangent.y,
      wy: (omega.x || 0) * towardCushion.x + (omega.y || 0) * towardCushion.y,
      wz: omega.z || 0,
    };

    const impulseSteps = Math.round(clamp(
      Number(livePhy.cushionImpulseSteps) || 64,
      16,
      20000
    ));
    const dPI = (mass * state.vy / Math.max(cosTheta, 0.1)) / impulseSteps;
    const inverseMass = 1 / mass;
    const angularScale = 5 / (2 * mass * R);

    let compressionWork = 0;
    let recoveryWork = 0;
    let compressed = false;
    let previousNormalSpeed = state.vy * cosTheta;

    for (let iter = 0; iter < impulseSteps * 4; iter++) {
      const cushionX = state.vx + R * (state.wy * sinTheta - state.wz * cosTheta);
      const cushionYPrime = R * state.wx - state.vy * sinTheta;
      const clothX = state.vx - R * state.wy;
      const clothY = state.vy + R * state.wx;

      const cushionMag = Math.hypot(cushionX, cushionYPrime);
      const cushionDirX = cushionMag <= 1e-7 ? 0 : cushionX / cushionMag;
      const cushionDirY = cushionMag <= 1e-7 ? 0 : cushionYPrime / cushionMag;

      const dPxI = -cushionMu * cushionDirX * dPI;
      const dPyPrimeI = -cushionMu * cushionDirY * dPI;
      const dPC = Math.max(0, (sinTheta + cushionMu * cushionDirY * cosTheta) * dPI);

      const clothMag = Math.hypot(clothX, clothY);
      const clothDirX = clothMag <= 1e-7 ? 0 : clothX / clothMag;
      const clothDirY = clothMag <= 1e-7 ? 0 : clothY / clothMag;

      const dPxC = -clothMu * clothDirX * dPC;
      const dPyC = -clothMu * clothDirY * dPC;

      state.vx += (dPxI + dPxC) * inverseMass;
      state.vy += (-dPI * cosTheta - dPyPrimeI * sinTheta + dPyC) * inverseMass;
      state.wx += angularScale * (dPyPrimeI + dPyC);
      state.wy += angularScale * (dPxI * sinTheta - dPxC);
      state.wz -= angularScale * dPxI * cosTheta;

      const normalSpeed = state.vy * cosTheta;
      const avgNormalSpeed = (previousNormalSpeed + normalSpeed) / 2;
      if (!compressed) {
        if (avgNormalSpeed > 0) compressionWork += avgNormalSpeed * dPI;
        if (normalSpeed <= 0) compressed = true;
      } else {
        recoveryWork += Math.max(0, -avgNormalSpeed) * dPI;
        if (recoveryWork >= energeticRestitution * energeticRestitution * compressionWork) break;
      }
      previousNormalSpeed = normalSpeed;
    }

    // 官方 v3CushionCollision 在累积冲量求解之后还有一层库边旋转修正：
    // 用 approachSpeed 将一部分表面滚动旋转削掉，避免强旋转球反弹角过度。
    const spinCorrectionStrength = Number(livePhy.cushionSpinCorrectionStrength) || 0;
    if (spinCorrectionStrength > 0 && approachSpeed > 0) {
      const surfaceSpinSpeed = R * state.wx;
      const removableSurfaceSpinSpeed = spinCorrectionStrength * approachSpeed * cosTheta;
      const correctedMagnitude = Math.max(0, Math.abs(surfaceSpinSpeed) - removableSurfaceSpinSpeed);
      state.wx = Math.sign(surfaceSpinSpeed) * correctedMagnitude / R;
    }

    const newVel = {
      x: tangent.x * state.vx + towardCushion.x * state.vy,
      y: tangent.y * state.vx + towardCushion.y * state.vy,
    };
    const newOmega = {
      x: tangent.x * state.wx + towardCushion.x * state.wy,
      y: tangent.y * state.wx + towardCushion.y * state.wy,
      z: state.wz,
    };

    return { vel: newVel, omega: newOmega };
  }

  // 目标球第一库之后的几何反弹：从接触点按库边法线反射，继续追踪到下一库或袋口。
  // 物理追踪没有生成有效后续段时，用它保证目标球吃库后仍有可见、真实的反弹折线。
  function reflectRailDirection(dir, axis, point) {
    const d = V.norm(dir);
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
    let nx = 0;
    let ny = 0;
    if (axis === 'x') {
      nx = point.x >= 0 ? -1 : 1;
    } else if (axis === 'y') {
      ny = point.y >= 0 ? -1 : 1;
    } else {
      return null;
    }
    const dot = d.x * nx + d.y * ny;
    return V.norm({ x: d.x - 2 * dot * nx, y: d.y - 2 * dot * ny });
  }

  function traceTargetCushionReboundSegments(firstHit, incomingDir, cushionX, cushionY, pockets, maxBounces = 2) {
    const segments = [];
    if (!firstHit || !firstHit.point || (firstHit.axis !== 'x' && firstHit.axis !== 'y')) return segments;
    let pos = { ...firstHit.point };
    let dir = reflectRailDirection(incomingDir, firstHit.axis, firstHit.point);
    if (!dir) return segments;

    for (let b = 0; b < maxBounces; b++) {
      const next = rayRailHit(pos, dir, cushionX, cushionY, pockets);
      if (!next || !next.point) break;
      const length = Math.hypot(next.point.x - pos.x, next.point.y - pos.y);
      if (!(length > 0.5)) break;
      segments.push({ from: { ...pos }, to: { ...next.point }, axis: next.axis });
      if (next.axis === 'jaw') break;
      dir = reflectRailDirection(dir, next.axis, next.point);
      if (!dir) break;
      pos = { ...next.point };
    }
    return segments;
  }

  // 4. 真实物理反弹追踪（综合入杆力度、切球衰减、旋转与吃库冲量积分）
  function tracePhysicsRailReflections(startPos, initialVel, initialOmega, cushionX, cushionY, pockets, maxBounces = 2) {
    const segments = [];
    let curPos = { ...startPos };
    let vel = { ...initialVel };
    let omega = { ...initialOmega };

    for (let b = 0; b < maxBounces; b++) {
      const curSpeed = Math.hypot(vel.x, vel.y);
      if (curSpeed < 25) break;
      const dir = { x: vel.x / curSpeed, y: vel.y / curSpeed };
      const hit = rayRailHit(curPos, dir, cushionX, cushionY, pockets);
      if (!hit) break;

      segments.push({ from: { ...curPos }, to: { ...hit.point }, axis: hit.axis });
      if (hit.axis === 'jaw') break;

      let railNormal = { x: 0, y: 0 };
      if (hit.axis === 'x') {
        railNormal = { x: hit.point.x > 0 ? -1 : 1, y: 0 };
      } else if (hit.axis === 'y') {
        railNormal = { x: 0, y: hit.point.y > 0 ? -1 : 1 };
      } else {
        break;
      }

      const dist = Math.hypot(hit.point.x - curPos.x, hit.point.y - curPos.y);
      const livePhy = getLivePhysicsOverrides();
      const decel = Number(livePhy.rollingFriction) || CONFIG.clothRollingDecelMmS2 || 125;
      const impactSpeed = Math.sqrt(Math.max(100, curSpeed * curSpeed - 2 * decel * dist));
      const speedRatio = impactSpeed / curSpeed;
      vel.x *= speedRatio;
      vel.y *= speedRatio;

      const rebound = resolvePhysicsCushionRebound(vel, omega, railNormal);
      vel = rebound.vel;
      omega = rebound.omega;
      curPos = { ...hit.point };
    }
    return segments;
  }

  // ==================================================================
  // 【v1.9.3 目标球专用物理微模拟】
  // 目标球不是母球：碰后先按官方球-球冲量得到 v/ω，再单独做台呢
  // 滑动→纯滚、侧旋衰减、库边 Mathavan 冲量和多库折线。
  // ==================================================================

  /**
   * 母球从当前位置滚到目标球接触点 G 的到达状态微模拟。
   * 以前直接把初始杆速当成碰撞瞬间杆速，长距离/低力度会明显高估目标球速度。
   * 这里复用目标球同一套台呢摩擦模型，得到碰撞前的 v/ω 后再进入球-球碰撞。
   */
  function simulateCueArrivalAtContact(cueStart, contactPoint, aimDir, cueSpeed, tip, opts = {}) {
    const dir = V.norm(aimDir);
    if (!cueStart || !contactPoint || !dir) return null;
    if (!Number.isFinite(cueSpeed) || cueSpeed <= 0) return null;

    const total = V.dist(cueStart, contactPoint);
    if (!Number.isFinite(total) || total < 0) return null;

    const maxTip = Math.max(1e-6, Number(opts.maxTipOffsetRatio) || CONFIG.maxTipOffsetRatio);
    const tx = clamp(Number(tip && tip.x) || 0, -maxTip, maxTip);
    const ty = clamp(Number(tip && tip.y) || 0, -maxTip, maxTip);
    const spinEff = Math.max(0, Number(opts.cueSpinEfficiency) || CONFIG.cueSpinEfficiency);
    const v = { x: dir.x * cueSpeed, y: dir.y * cueSpeed };
    const cueOmega = {
      x: (-v.y / BALL_RADIUS_MM) * (2.5 * spinEff * ty),
      y: (v.x / BALL_RADIUS_MM) * (2.5 * spinEff * ty),
      z: -(cueSpeed / BALL_RADIUS_MM) * (2.5 * spinEff * tx),
    };
    const ball = {
      vel: { ...v },
      omega: { ...cueOmega },
      sliding: true,
    };
    const dt = Math.max(0.0001, (Number(opts.dtMs) || CONFIG.targetMicroDtMs || 0.65) / 1000);
    const maxSteps = Math.max(100, Number(opts.maxSteps) || CONFIG.targetMaxSteps || 9000);
    const lowSpeed = Math.max(0, Number(opts.lowSpeedCutoff) || 8);
    let travelled = 0;

    if (total < 0.01) {
      return {
        vel: { ...v }, omega: { ...cueOmega },
        speed: cueSpeed, travelledMm: 0,
      };
    }

    for (let step = 0; step < maxSteps; step++) {
      const speed = Math.hypot(ball.vel.x, ball.vel.y);
      if (speed <= lowSpeed) return null;
      const remaining = total - travelled;
      if (remaining <= 0) break;
      const stepTravel = Math.min(speed * dt, remaining);
      if (!(stepTravel > 0)) break;
      applyTargetTableFrictionStep(ball, stepTravel / speed, opts);
      travelled += stepTravel;
      const nextSpeed = Math.hypot(ball.vel.x, ball.vel.y);
      if (travelled >= total - 0.01) {
        if (nextSpeed <= lowSpeed) return null;
        return {
          vel: { ...ball.vel },
          omega: { ...ball.omega },
          speed: nextSpeed,
          travelledMm: travelled,
        };
      }
    }
    return null;
  }

  /**
   * 由母球出杆状态求目标球碰后速度/角速度。
   * 采用官方 applyV3CueStrike 的杆法映射 + resolveBallBallCollision 的
   * 法向冲量/切向冲量公式。官方 live ballContactFrictionMu 为 0 时，
   * 默认不额外注入目标球切向摩擦（CONFIG.targetBallContactFrictionMu=0），
   * 以优先保证真实轨迹精度；需要侧旋增强时才单独打开。
   */
  function resolveTargetBallImpactState(cueSpeed, aimDir, targetPos, contactPoint, tip, opts = {}, cueArrival = null) {
    const R = BALL_RADIUS_MM;
    const n = V.norm(V.sub(targetPos, contactPoint));
    if (!n || !Number.isFinite(cueSpeed) || cueSpeed <= 0) return null;

    // cueArrival 是母球到达接触点的真实 v/ω；没有它时才退回初始杆速。
    const cueVel = cueArrival && cueArrival.vel
      ? { x: cueArrival.vel.x, y: cueArrival.vel.y }
      : { x: aimDir.x * cueSpeed, y: aimDir.y * cueSpeed };
    const cueOmega = cueArrival && cueArrival.omega
      ? { x: cueArrival.omega.x || 0, y: cueArrival.omega.y || 0, z: cueArrival.omega.z || 0 }
      : null;

    const cueNormal = V.dot(cueVel, n);
    if (!(cueNormal > 0)) return null;
    const cosCut = clamp(cueNormal / Math.max(1e-6, cueSpeed), 0, 1);
    if (cosCut <= 1e-4) return null;

    const tangent = { x: -n.y, y: n.x };
    const maxTip = Math.max(1e-6, Number(opts.maxTipOffsetRatio) || CONFIG.maxTipOffsetRatio);
    const tx = clamp(Number(tip && tip.x) || 0, -maxTip, maxTip);
    const ty = clamp(Number(tip && tip.y) || 0, -maxTip, maxTip);
    const spinEff = Math.max(0, Number(opts.cueSpinEfficiency) || CONFIG.cueSpinEfficiency);

    // 没有 cueArrival 时才由杆法构造初始杆速；有到达状态时直接使用其 ω。
    const fallbackOmega = {
      x: (-cueVel.y / R) * (2.5 * spinEff * ty),
      y: (cueVel.x / R) * (2.5 * spinEff * ty),
      z: -(cueSpeed / R) * (2.5 * spinEff * tx),
    };
    const omega = cueOmega || fallbackOmega;

    const eRaw = Number(opts.ballNormalRestitution);
    const e = clamp(Number.isFinite(eRaw) ? eRaw : CONFIG.ballRestitution, 0, 1);
    const targetNormal = cueNormal * (1 + e) * 0.5;
    if (!(targetNormal > 0)) return null;

    // 法向冲量：目标球先沿连心线获得速度（等质量、恢复系数 e）。
    const targetVel = { x: n.x * targetNormal, y: n.y * targetNormal };

    // 官方 getBallBallTangentSpeed：相对速度（目标-母球）切向分量，
    // 再减去母球侧旋在接触点的表面速度 R*ωz。
    const relative = { x: -cueVel.x, y: -cueVel.y };
    const tangentSpeed = V.dot(relative, tangent) - omega.z * R;
    const spinTransferRaw = Number(opts.ballSpinTransfer);
    const spinTransfer = clamp(Number.isFinite(spinTransferRaw) ? spinTransferRaw : 0.4, 0, 1.5);
    const tangentDenominator = 2 + 5 * spinTransfer; // 两个等质量球 + 两个 2.5*R²/I 项

    const liveMu = Number.isFinite(Number(opts.ballContactFrictionMu))
      ? Math.max(0, Number(opts.ballContactFrictionMu))
      : 0;
    const effectiveMu = liveMu > 0
      ? liveMu
      : Math.max(0, Number(CONFIG.targetBallContactFrictionMu) || 0);
    const maxTangentImpulse = targetNormal * effectiveMu;
    const tangentImpulse = clamp(
      -tangentSpeed / tangentDenominator,
      -maxTangentImpulse,
      maxTangentImpulse
    );

    targetVel.x += tangent.x * tangentImpulse;
    targetVel.y += tangent.y * tangentImpulse;

    // 官方 applyTangentImpulseSpin：omega.z -= Jt*R/I*spinTransfer。
    const targetOmega = {
      x: 0,
      y: 0,
      z: -(2.5 * tangentImpulse / R) * spinTransfer,
    };

    // 官方 applyThrowToBall 的极小横向速度；保留以保证和原生接触模型一致。
    const throwScale = Number(opts.throwVelocityScale);
    if (Number.isFinite(throwScale) && throwScale > 0) {
      targetVel.x += tangent.x * tangentImpulse * throwScale;
      targetVel.y += tangent.y * tangentImpulse * throwScale;
    }

    const speed = Math.hypot(targetVel.x, targetVel.y);
    if (!(speed > 0) || !Number.isFinite(speed)) return null;

    return {
      normal: n,
      tangent,
      vel: targetVel,
      omega: targetOmega,
      speed,
      cosCut,
      tangentImpulse,
      effectiveMu,
      sideSpinRatio: 2.5 * spinEff * tx,
    };
  }

  function getTargetContactSlip(ball) {
    const R = BALL_RADIUS_MM;
    return {
      x: ball.vel.x - ball.omega.y * R,
      y: ball.vel.y + ball.omega.x * R,
    };
  }

  function snapTargetToPureRolling(ball) {
    const R = BALL_RADIUS_MM;
    ball.omega.x = -ball.vel.y / R;
    ball.omega.y = ball.vel.x / R;
    ball.sliding = false;
  }

  function decayTargetSideSpin(ball, dt, sideSpinDecay) {
    const z = Number(ball.omega.z) || 0;
    const next = Math.max(0, Math.abs(z) - Math.max(0, sideSpinDecay) * dt);
    ball.omega.z = Math.sign(z) * next;
  }

  /**
   * 精确复刻官方 friction.js 的单球台呢摩擦：
   * - 滑动阶段按 slip 方向施加 slidingAccel，角速度按 2.5/R 耦合；
   * - slip <= slipEpsilon 后吸附为纯滚；
   * - 纯滚阶段按 rollingFriction 线性减速；
   * - 侧旋按 sideSpinLinearDecay 线性衰减。
   */
  function applyTargetTableFrictionStep(ball, dt, opts = {}) {
    const R = BALL_RADIUS_MM;
    const slidingAccel = Math.max(0, Number(opts.tableSlidingAccel) || CONFIG.clothSlidingMu * 9800 || 1667);
    const rollingFriction = Math.max(0, Number(opts.rollingFriction) || CONFIG.clothRollingDecelMmS2 || 125);
    const sideSpinDecay = Math.max(0, Number(opts.sideSpinLinearDecay) || CONFIG.clothSideSpinDecelRadS2 || 18);
    const slipEpsilon = Math.max(0, Number(opts.slipEpsilon) || 7);
    const lowSpeedCutoff = Math.max(0, Number(opts.lowSpeedCutoff) || 8);
    const lowOmegaCutoff = Math.max(0, Number(opts.lowOmegaCutoff) || 0.7);

    const speed = Math.hypot(ball.vel.x, ball.vel.y);
    const slip = getTargetContactSlip(ball);
    const slipSpeed = Math.hypot(slip.x, slip.y);

    if (speed <= 0 && slipSpeed <= slipEpsilon) {
      decayTargetSideSpin(ball, dt, sideSpinDecay);
      return;
    }

    if (slipSpeed > slipEpsilon || ball.sliding) {
      const slipCoupling = 3.5; // 1 + m*R²/I，I=(2/5)mR²
      const maxLinearChange = Math.min(slidingAccel * dt, slipSpeed / slipCoupling);
      if (slipSpeed > 1e-9 && maxLinearChange > 0) {
        const dv = {
          x: -slip.x / slipSpeed * maxLinearChange,
          y: -slip.y / slipSpeed * maxLinearChange,
        };
        ball.vel.x += dv.x;
        ball.vel.y += dv.y;
        // 官方 applyAngularChangeFromFriction: omega.x += R*Jy/I, omega.y -= R*Jx/I
        ball.omega.x += 2.5 * dv.y / R;
        ball.omega.y -= 2.5 * dv.x / R;
      }
      ball.sliding = true;
      const nextSlip = getTargetContactSlip(ball);
      if (Math.hypot(nextSlip.x, nextSlip.y) <= slipEpsilon) {
        snapTargetToPureRolling(ball);
      }
    } else {
      const nextSpeed = Math.max(0, speed - rollingFriction * dt);
      if (nextSpeed <= lowSpeedCutoff) {
        ball.vel.x = 0;
        ball.vel.y = 0;
      } else {
        const ratio = nextSpeed / speed;
        ball.vel.x *= ratio;
        ball.vel.y *= ratio;
      }
      snapTargetToPureRolling(ball);
    }

    decayTargetSideSpin(ball, dt, sideSpinDecay);

    const nextSpeed = Math.hypot(ball.vel.x, ball.vel.y);
    const nextOmega = Math.hypot(ball.omega.x, ball.omega.y, ball.omega.z);
    if (nextSpeed <= lowSpeedCutoff && nextOmega <= lowOmegaCutoff) {
      ball.vel.x = 0;
      ball.vel.y = 0;
      ball.omega.x = 0;
      ball.omega.y = 0;
      ball.omega.z = 0;
      ball.sliding = false;
    }
  }

  /**
   * 目标球单球微模拟：从碰撞点推进到第一库、第二库……直到停下/落袋/撞球。
   * 返回的 segments 已经是从第一库接触点之后开始的“真正反弹折线”，
   * 不再包含 targetBall.pos -> 第一库的绿色入射段。
   */
  function simulateTargetCushionPath(startPos, initialVel, initialOmega, opts = {}) {
    const cushionX = Number(opts.cushionX) || CONFIG.railBoundX;
    const cushionY = Number(opts.cushionY) || CONFIG.railBoundY;
    const pockets = Array.isArray(opts.pockets) ? opts.pockets : null;
    const balls = Array.isArray(opts.balls) ? opts.balls : [];
    const ignoreIds = opts.ignoreIds instanceof Set ? opts.ignoreIds : new Set();
    const lateCueBall = opts.lateCueBall || null;
    const maxBounces = Math.max(0, Number(opts.maxBounces) || 0);
    const maxPathMm = Math.max(1000, Number(opts.maxPathMm) || CONFIG.targetMaxPathMm || 18000);
    const maxSteps = Math.max(100, Number(opts.maxSteps) || CONFIG.targetMaxSteps || 9000);
    const dt = Math.max(0.0001, (Number(opts.dtMs) || CONFIG.targetMicroDtMs || 0.65) / 1000);
    const coreOpts = {
      tableSlidingAccel: opts.tableSlidingAccel,
      rollingFriction: opts.rollingFriction,
      sideSpinLinearDecay: opts.sideSpinLinearDecay,
      slipEpsilon: opts.slipEpsilon,
      lowSpeedCutoff: opts.lowSpeedCutoff,
      lowOmegaCutoff: opts.lowOmegaCutoff,
    };

    const segments = [];
    const ball = {
      vel: { x: initialVel.x, y: initialVel.y },
      omega: { x: initialOmega.x || 0, y: initialOmega.y || 0, z: initialOmega.z || 0 },
      sliding: true,
    };
    let pos = { x: startPos.x, y: startPos.y };
    let lastRailPoint = null;
    let firstRailHit = null;
    let railCount = 0;
    let travelled = 0;
    let terminal = null;
    let stopReason = null;
    let restExact = false;
    let hitPocket = false;
    let hitBall = null;

    const pushSegment = (from, to, axis) => {
      if (!from || !to) return;
      if (Math.hypot(to.x - from.x, to.y - from.y) <= 0.5) return;
      segments.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, axis: axis || null });
    };

    for (let step = 0; step < maxSteps; step++) {
      const speed = Math.hypot(ball.vel.x, ball.vel.y);
      if (speed <= Math.max(8, Number(opts.lowSpeedCutoff) || 8)) {
        stopReason = 'low-speed';
        restExact = true;
        break;
      }

      const dir = { x: ball.vel.x / speed, y: ball.vel.y / speed };
      const railHit = rayRailHit(pos, dir, cushionX, cushionY, pockets);
      // 第一库之前不能把母球当障碍（此时它还贴在目标球接触点）；
      // 第一库反弹之后母球可能停在目标球回弹路径上，必须纳入阻挡，
      // 否则目标球折线会穿过母球，造成“偏差很大”的假长线。
      const scanBalls = (firstRailHit && lateCueBall)
        ? balls.concat([lateCueBall])
        : balls;
      const ballHit = scanBalls.length ? rayFirstBall(pos, dir, scanBalls, ignoreIds) : null;
      const railT = railHit && Number.isFinite(railHit.t) ? railHit.t : Infinity;
      const ballT = ballHit && Number.isFinite(ballHit.tHit) ? ballHit.tHit : Infinity;
      const limit = Math.min(railT, ballT);
      const stepDist = speed * dt;

      if (limit <= stepDist + 0.01) {
        const travel = Math.max(0, Math.min(limit, stepDist));
        const travelTime = travel > 0 ? travel / speed : 0;
        if (travelTime > 0) applyTargetTableFrictionStep(ball, travelTime, coreOpts);
        pos = { x: pos.x + dir.x * travel, y: pos.y + dir.y * travel };
        travelled += travel;

        if (ballHit && ballT <= railT) {
          hitBall = ballHit.ball || true;
          terminal = { x: pos.x, y: pos.y };
          stopReason = 'hit-ball';
          if (firstRailHit) pushSegment(lastRailPoint, terminal, null);
          break;
        }

        if (railHit && railT <= ballT) {
          if (railHit.axis === 'jaw') {
            hitPocket = true;
            terminal = { x: pos.x, y: pos.y };
            stopReason = 'pocket';
            if (firstRailHit) pushSegment(lastRailPoint, terminal, 'jaw');
            break;
          }

          if (!firstRailHit) {
            firstRailHit = {
              point: { x: pos.x, y: pos.y },
              axis: railHit.axis,
              normal: railHit.normal ? { x: railHit.normal.x, y: railHit.normal.y } : null,
              speed,
              omega: { x: ball.omega.x, y: ball.omega.y, z: ball.omega.z },
            };
            lastRailPoint = { x: pos.x, y: pos.y };
            railCount = 1;
          } else {
            pushSegment(lastRailPoint, pos, railHit.axis);
            lastRailPoint = { x: pos.x, y: pos.y };
            railCount += 1;
          }

          const normal = railHit.normal || (railHit.axis === 'x'
            ? { x: pos.x >= 0 ? -1 : 1, y: 0 }
            : { x: 0, y: pos.y >= 0 ? -1 : 1 });
          const rebound = resolvePhysicsCushionRebound(ball.vel, ball.omega, normal);
          if (!rebound || !rebound.vel || !Number.isFinite(rebound.vel.x) || !Number.isFinite(rebound.vel.y)) {
            terminal = { x: pos.x, y: pos.y };
            stopReason = 'rebound-failed';
            break;
          }
          ball.vel = rebound.vel;
          ball.omega = rebound.omega;
          ball.sliding = true;

          if (railCount >= 1 + maxBounces) {
            terminal = { x: pos.x, y: pos.y };
            stopReason = 'max-bounce';
            break;
          }
          continue;
        }

        terminal = { x: pos.x, y: pos.y };
        stopReason = 'stop-limit';
        break;
      }

      applyTargetTableFrictionStep(ball, dt, coreOpts);
      pos = { x: pos.x + ball.vel.x * dt, y: pos.y + ball.vel.y * dt };
      travelled += Math.hypot(ball.vel.x * dt, ball.vel.y * dt);

      if (travelled >= maxPathMm) {
        terminal = { x: pos.x, y: pos.y };
        stopReason = 'max-path';
        break;
      }
    }

    if (!terminal) {
      terminal = { x: pos.x, y: pos.y };
      stopReason = stopReason || 'max-steps';
    }
    // 目标球停在两库之间时，把最后一段补到终点，避免折线在库边半截断掉。
    if (firstRailHit && !hitPocket && !hitBall && lastRailPoint) {
      const hasEndpoint = segments.length > 0
        && Math.hypot(segments[segments.length - 1].to.x - terminal.x,
          segments[segments.length - 1].to.y - terminal.y) < 0.5;
      if (!hasEndpoint) pushSegment(lastRailPoint, terminal, null);
    }

    // v1.9.8：所有目标球反弹段先按球心有效台面矩形裁剪。
    // 即使微模拟异常走到台外，也不会把 18m 级长线交给绘制层。
    const safeSegments = [];
    for (const seg of segments) {
      const clipped = clipSegmentToTableRect(seg.from, seg.to, cushionX, cushionY);
      if (!clipped) continue;
      if (Math.hypot(clipped.to.x - clipped.from.x, clipped.to.y - clipped.from.y) <= 0.5) continue;
      safeSegments.push({ ...seg, from: clipped.from, to: clipped.to });
    }
    const safeTerminal = {
      x: clamp(terminal.x, -cushionX, cushionX),
      y: clamp(terminal.y, -cushionY, cushionY),
    };
    const displayLengthMm = safeSegments.reduce((sum, seg) => {
      return sum + Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
    }, 0);
    const truncated = ['max-bounce', 'max-path', 'max-steps', 'rebound-failed', 'stop-limit']
      .includes(stopReason);

    return {
      segments: safeSegments,
      // v1.9.14：绘制层使用的“第一库之后到真实停点”的路径。
      // 与 segments 保持同一份数据，后续如需单独裁剪只改这个字段。
      displaySegments: safeSegments,
      displayLengthMm,
      firstRailHit,
      terminal: safeTerminal,
      restPoint: safeTerminal,
      restExact: Boolean(restExact && !truncated),
      stopReason,
      truncated,
      bounces: firstRailHit ? railCount : 0,
      hitPocket,
      hitBall,
      travelledMm: travelled,
      model: 'target-physics-v1.9.8',
    };
  }


  // 兼容旧接口别名
  function traceRailReflections(startPos, dir, cushionX, cushionY, pockets, maxBounces = 2) {
    const speed = CONFIG.canonicalSimSpeedMmS || 3400;
    const v = { x: dir.x * speed, y: dir.y * speed };
    const w = { x: -dir.y * (speed / BALL_RADIUS_MM), y: dir.x * (speed / BALL_RADIUS_MM), z: 0 };
    return tracePhysicsRailReflections(startPos, v, w, cushionX, cushionY, pockets, maxBounces);
  }


  /* ================================================================== */
  /* v3.4.2 实测动力学模型与能量守恒插值系统                              */
  /* ================================================================== */

  // 147master 原生物理引擎实测空打总行程（含台呢摩擦与真实滑-滚转换，单位：mm）
  // 9%→904mm, 20%→2700mm, 30%→5360mm, 40%→7720mm, 50%→8670mm, 60%→10480mm, 70%→11950mm, 80%→12690mm, 93%→14450mm, 100%→14870mm
  const CUE_POWER_CURVE = [
    [0, 0], [9, 904], [20, 2700], [30, 5360], [40, 7720], [50, 8670],
    [60, 10480], [70, 11950], [80, 12690], [93, 14450], [100, 14870],
  ];

  /**
   * 正向计算：按出杆力度获取母球真实自由跑总行程（mm）
   */
  function cueTravelByPower(power, retention = 1) {
    const p = clamp(Number(power) || 0, 0, 100);
    if (p <= 0) return 0;
    const tbl = CUE_POWER_CURVE;
    let i = 1;
    while (i < tbl.length - 1 && p > tbl[i][0]) i++;
    const a = tbl[i - 1], b = tbl[i];
    const t = (p - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const mm = a[1] + (b[1] - a[1]) * clamp(t, 0, 1);
    return mm * clamp(Number(retention) || 1, 0, 1);
  }

  /**
   * 逆向反推：根据所需总行进位移（mm）逆向推导所需的基础出杆力度百分比（0~100%）
   */
  function powerByCueTravel(travelMm) {
    const dist = Math.max(0, Number(travelMm) || 0);
    if (dist <= 0) return 0;
    const tbl = CUE_POWER_CURVE;
    const maxMm = tbl[tbl.length - 1][1];
    if (dist >= maxMm) return 100;
    let i = 1;
    while (i < tbl.length - 1 && dist > tbl[i][1]) i++;
    const a = tbl[i - 1], b = tbl[i];
    const t = (dist - a[1]) / Math.max(1e-6, b[1] - a[1]);
    const p = a[0] + (b[0] - a[0]) * clamp(t, 0, 1);
    return clamp(p, 0, 100);
  }

  /**
   * 目标球能量折算可达距离（mm）：E_obj ∝ v_cue^2 * cos^2(cut)
   */
  function reachCapFallback(power, cutCos) {
    const p = Number(power);
    if (!Number.isFinite(p) || p <= 0) return null;
    const cc = Number.isFinite(Number(cutCos)) ? clamp(Number(cutCos), 0, 1) : 1;
    const mm = cueTravelByPower(p, 1) * cc * cc;
    return mm > 0 ? clamp(mm, 60, 6000) : null;
  }

  /**
   * 【v1.9.15】目标球碰后「总行程预算」(mm)。
   *
   * 为什么需要它：本地目标球微模拟 simulateTargetCushionPath() 的台呢滚动阻力
   * 取自 live 物理参数 clothRollingDecelMmS2（缺省 125 mm/s²），而本文件里
   * CUE_POWER_CURVE 是官方引擎实测曲线（满力仅 14870mm）。两者不同源——
   * 满力时目标球碰后速度约 6800mm/s，按 125 mm/s² 纯滚要走约 18 万毫米，
   * 远超 targetRestMaxPathMm(15000)，于是微模拟永远以 'max-path' 截断，
   * 蓝线长度看起来完全不随力度变化。
   *
   * 解法：不动物理常数（会影响推荐力度、力度不足判定、母球到达速度等下游），
   * 只在显示层按「当前力度真正能把目标球推多远」做截断。
   *
   * 精度策略：本函数是官方引擎不可用时的兜底经验模型；
   * 正式显示优先使用 engineSim 官方微模拟返回的 targetPath 总长度（见 predict()），
   * 因为官方引擎会真实计算碰后速度、滑-滚转换、库边/球体碰撞与最终停点。
   *
   * attachShotPowerMetrics() 的 actualReachMm 也优先取官方引擎结果，
   * 仅在引擎未就绪时回退到本函数。
   *
   * @param {number} power       当前有效力度 0~100
   * @param {{x:number,y:number}} tip 杆法偏移
   * @param {number} verticalAngle 杆身仰角
   * @param {number} sCueToContact 母球当前位置到接触点 G 的距离(mm)
   * @param {number} cosCut      瞄准方向与目标球出球方向的夹角余弦
   * @returns {number} 目标球从碰后起点开始能走的总距离(mm)
   */
  function computeTargetTravelBudgetMm(power, tip, verticalAngle, sCueToContact, cosCut) {
    const p = clamp(Number(power) || 0, 0, 100);
    if (p <= 2) return 0;

    const sx = clamp(Number(tip && tip.x) || 0, -1, 1);
    const sy = clamp(Number(tip && tip.y) || 0, -1, 1);
    const backspinRatio = clamp(-sy / 0.5, 0, 1);
    const topspinRatio = clamp(sy / 0.5, 0, 1);
    const sideRatio = clamp(Math.abs(sx) / 0.5, 0, 1);

    // 低杆逆旋强滑移功耗 / 高杆略微增程 / 侧塞小幅折损
    const kBackspin = backspinRatio > 0
      ? (1.0 - 0.35 * Math.pow(backspinRatio, 1.15))
      : (1.0 + 0.08 * Math.pow(topspinRatio, 1.2));
    const kSidespin = 1.0 - 0.10 * (sideRatio * sideRatio);
    const spinDynamicRetention = Math.max(0.40, kBackspin * kSidespin);

    // 碰撞瞬间传递给目标球的正向冲量折减（兜底经验值；官方引擎可用时不走这里）
    const transferEff = 0.88 * (1.0 - 0.10 * backspinRatio);

    const retention = tipSpeedRetention(tip) * resolveV3ElevationRetention(verticalAngle);
    const totalCueTravel = cueTravelByPower(p, retention) * spinDynamicRetention;
    // 母球滚到接触点途中被逆旋滑移额外吃掉的部分（等效行程损耗放大 2.7 倍）
    const sCueLoss = Math.max(0, Number(sCueToContact) || 0) * (1.0 + 1.7 * backspinRatio);
    const remainCueTravel = Math.max(0, totalCueTravel - sCueLoss);
    if (remainCueTravel <= 0) return 0;

    const cc = clamp(Number.isFinite(Number(cosCut)) ? Number(cosCut) : 1, 0.08, 1);
    return Math.max(0, remainCueTravel * cc * cc * transferEff);
  }

  /**
   * 0ms 瞬时解析物理母球走位预测（轻量级无延迟物理引擎 v1.7.7）
   * 依据动量分离定理、切角能量守恒、高低杆滑动-滚动转换冲量及四库级连续弹性反弹
   */
  function simulateInstantCuePostTrajectory(G, targetBallPos, aimDir, power, tip, boundX, boundY, pockets) {
    const p = clamp(Number(power) || 0, 0, 100);
    if (p <= 2 || !G || !targetBallPos) return null;

    const normal = V.norm(V.sub(targetBallPos, G));
    const cosCut = clamp(V.dot(aimDir, normal), -1, 1);
    const sinCut = Math.sqrt(Math.max(0, 1 - cosCut * cosCut));

    const tangentRaw = V.sub(aimDir, V.scale(normal, cosCut));
    const tangent = V.norm(tangentRaw);

    const sy = clamp(Number(tip?.y) || 0, -1, 1);
    const sx = clamp(Number(tip?.x) || 0, -1, 1);

    // 速度与冲量分量分解：
    // 切向速度 (90度正交分离)：母球保留切向分量
    const vt = sinCut;
    // 法向速度 (低杆后退/拉退，高杆向前跟进)：
    const vn = sy < 0
      ? -Math.pow(Math.abs(sy) / 0.5, 1.1) * 0.85 * Math.max(0.2, cosCut)
      : Math.pow(sy / 0.5, 1.1) * 0.65 * Math.max(0.2, cosCut);

    let postDir = V.add(V.scale(tangent, vt), V.scale(normal, vn));
    if (V.len(postDir) < 1e-4) {
      postDir = sy < 0 ? V.scale(normal, -1) : normal;
    } else {
      postDir = V.norm(postDir);
    }

    // 能量守恒行程计算（按切角动能平方分解 + 高低杆自旋能量）
    const Et = sinCut * sinCut;
    const En = sy < 0
      ? Math.pow(Math.abs(sy) / 0.5, 1.2) * 0.55 * (cosCut * cosCut)
      : Math.pow(sy / 0.5, 1.2) * 0.40 * (cosCut * cosCut);
    const energyRetention = clamp(Et + En, 0.02, 1.0);

    const baseTravel = cueTravelByPower(p);
    let remainDist = clamp(baseTravel * energyRetention, 20, 16000);

    // 多库反弹连续推演（支持多达 5 库，彻底消除暴力满力击球 3~4 库截断断崖）
    const points = [G];
    let curPt = G;
    let curDir = postDir;
    const maxBounces = 5;

    for (let b = 0; b < maxBounces; b++) {
      if (remainDist <= 20) break;
      const hit = rayRailHit(curPt, curDir, boundX, boundY, pockets);
      if (hit && hit.t < remainDist && hit.t > 1) {
        points.push(hit.point);
        remainDist -= hit.t;
        curPt = hit.point;

        // 反弹法向翻转
        let rebDir = {
          x: hit.axis === 'x' ? -curDir.x : curDir.x,
          y: hit.axis === 'y' ? -curDir.y : curDir.y,
        };

        // 侧塞微偏角修正 (首库和次库受自旋反弹修正最显著)
        if (Math.abs(sx) > 0.04 && b < 2) {
          const spinSign = Math.sign(sx);
          const spinDecay = b === 0 ? 1.0 : 0.6;
          const spinAng = spinSign * (Math.abs(sx) / 0.5) * 0.12 * spinDecay;
          const curAng = Math.atan2(rebDir.y, rebDir.x);
          rebDir = { x: Math.cos(curAng + spinAng), y: Math.sin(curAng + spinAng) };
        }
        curDir = V.norm(rebDir);

        // 库边胶条弹性衰减 (吸收约 22% 动能，符合斯诺克物理)
        remainDist *= 0.78;
      } else {
        const finalPt = V.add(curPt, V.scale(curDir, remainDist));
        points.push(finalPt);
        remainDist = 0;
        break;
      }
    }

    if (remainDist > 0) {
      const lastHit = rayRailHit(curPt, curDir, boundX, boundY, pockets);
      if (lastHit && lastHit.t < remainDist) {
        points.push(lastHit.point);
      } else {
        const finalPt = V.add(curPt, V.scale(curDir, remainDist));
        points.push(finalPt);
      }
    }

    return points;
  }

  // 4. 最佳入袋推荐出杆力度计算（基于 3.4.2 实测动力学模型、低杆滑移阻力补偿与防停球动力学）
  function calculateRecommendedPower(cuePos, contactPos, targetBallPos, pocketPos, aimDir, tipOffset, verticalAngle) {
    const sObj = V.dist(targetBallPos, pocketPos);
    const sCue = V.dist(cuePos, contactPos);
    const normal = V.norm(V.sub(targetBallPos, contactPos));
    const cosCut = clamp(V.dot(aimDir, normal), 0.08, 1);
    const cosSq = Math.max(0.04, cosCut * cosCut);

    // 目标球保留 250mm 扎实入袋安全缓冲行程（长台自适应追加补偿）
    const distExtra = sObj > 1200 ? Math.min(200, (sObj - 1200) * 0.12) : 0;
    const sObjTotal = sObj + 250 + distExtra;

    // 解析低杆与侧塞滑移额外能量折减（真实逆旋强滑移功耗）
    const sx = Number(tipOffset?.x) || 0;
    const sy = Number(tipOffset?.y) || 0;
    const backspinRatio = clamp(-sy / 0.5, 0, 1);
    const topspinRatio = clamp(sy / 0.5, 0, 1);
    const sideRatio = clamp(Math.abs(sx) / 0.5, 0, 1);

    const kBackspin = backspinRatio > 0 ? (1.0 - 0.35 * Math.pow(backspinRatio, 1.15)) : (1.0 + 0.08 * Math.pow(topspinRatio, 1.2));
    const kSidespin = 1.0 - 0.10 * (sideRatio * sideRatio);
    const spinDynamicRetention = Math.max(0.40, kBackspin * kSidespin);

    // 碰撞传递效率：低杆前向冲量传递
    const transferEff = 0.88 * (1.0 - 0.10 * backspinRatio);

    // 碰撞瞬间母球所需的等效剩余行进能力
    const sCueContactNeeded = (sObjTotal / cosSq) / transferEff;
    // 母球滑行途中的等效损耗行程（强逆旋滑移等效损耗放大 2.7 倍）
    const sCueLoss = sCue * (1.0 + 1.7 * backspinRatio);
    const sCueTotalNeeded = (sCueLoss + sCueContactNeeded) / spinDynamicRetention;

    const idealPower = powerByCueTravel(sCueTotalNeeded);
    const retention = tipSpeedRetention(tipOffset);
    const elevRetention = resolveV3ElevationRetention(verticalAngle);
    const finalPower = idealPower / (Math.max(0.1, retention) * Math.max(0.1, elevRetention));

    // 安全门控：短距离最低 22%，中长台根据总射程平滑提升至 26%~35%
    const totalDist = sCue + sObj;
    const minPowerFloor = clamp(22 + Math.round(Math.max(0, totalDist - 1200) / 120), 22, 35);

    return Math.round(clamp(finalPower, minPowerFloor, 100));
  }

  function predict(state) {
    const cue = getCueBall(state);
    if (!cue || cue.potted || !cue.pos) return null;

    const aim = state.aim;
    if (!aim || !aim.direction) return null;
    const d = V.norm(aim.direction);
    if (V.len(d) < 1e-6) return null;

    const objects = activeObjectBalls(state);
    const allBalls = activeAllBalls(state).map((b) => ({
      id: b.id,
      pos: { x: b.pos.x, y: b.pos.y },
    }));
    const pockets = readPockets(state);
    const { boundX, boundY, cushionX, cushionY } = readTableBounds(state);
    const ap = state.aimPrediction || null;
    const tip = resolveEffectiveTip(state);
    const effPower = resolveEffectivePower(state);

    const centerSpeed = resolveCueSpeed(effPower);
    const retention = tipSpeedRetention(tip);
    const effSpeed = centerSpeed * retention;

    const result = {
      cue: { x: cue.pos.x, y: cue.pos.y },
      aimDir: d,
      target: null,
      balls: allBalls,
      // v1.9.11：把本帧使用的运行时球心边界随预测一起带走，
      // 绘制层裁剪必须和微模拟/首库计算使用同一组边界，不能退回静态 CONFIG。
      tableBounds: { boundX, boundY, cushionX, cushionY },
      activeBallCount: objects.length,
      physics: false,
      shot: {
        power: effPower,
        effSpeed,
      },
    };

    let geo = null;
    for (const ball of objects) {
      const rc = rayContact(cue.pos, d, ball);
      if (rc && (!geo || rc.tHit < geo.tHit)) geo = { ball, ...rc };
    }

    const engBall = ap && ap.contactBallId != null
      ? objects.find((b) => b.id === ap.contactBallId) || null
      : null;

    const targetBall = engBall || (geo && geo.ball) || null;
    result.tip = tip;
    result.power = effPower;

    if (!targetBall) {
      // 准星未指向任何球时：母球瞄准线直接射向库边
      // 终点位于距离库边 1 个球半径处 (即 boundX / boundY 处的母球球心位置，而不是直接接触库边)
      const railHit = rayRailHit(cue.pos, d, boundX, boundY, pockets);
      const vertAngle = Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5);

      // 母球直射库边：只使用官方内核两库段复算。
      // 起点 = 第一库接触点；终点 = 反弹后的第二库接触点。
      if (railHit) result.railHit = railHit;
      result.noTargetEnd = railHit ? railHit.point : null;
      if (railHit && effPower > 0) {
        try {
          const rbPayload = engineSim.buildPayload(state, {
            direction: d,
            power: effPower,
            tip,
            verticalAngle: vertAngle,
          });
          const rbKey = [
            Math.round(effPower * 10),
            Math.round(d.x * 1000),
            Math.round(d.y * 1000),
            Math.round(cue.pos.x),
            Math.round(cue.pos.y),
            Math.round(vertAngle * 10),
            Math.round(Number(tip && tip.x || 0) * 1000),
            Math.round(Number(tip && tip.y || 0) * 1000),
            allBalls.map((b) => `${b.id}:${Math.round(b.pos.x)}:${Math.round(b.pos.y)}`).join(','),
          ].join('|');
          const nativeReb = engineSim.nativeTwoRail(rbPayload, rbKey);
          if (nativeReb) {
            result.noTargetEnd = nativeReb.path[0];
            result.cuePost = {
              cueCushionPaths: [ nativeReb.path ],
              restPos: nativeReb.path[nativeReb.path.length - 1],
              nativeLocal: true,
              travelledMm: nativeReb.travelledMm,
              secondRailHit: Boolean(nativeReb.secondRailHit),
            };
          }
        } catch (err) {
          devLog('warn', '[反弹] 官方内核两库复算调用异常', err);
        }
      }
      return result;
    }
    if (ap && engBall && ap.hit === false) return result;

    let G;
    const rcSelf = rayContact(cue.pos, d, targetBall);
    if (rcSelf) G = rcSelf.G;
    else if (geo && geo.ball === targetBall) G = geo.G;
    else return result;

    const apUsable = ap && engBall && ap.hit !== false;

    let n = null;
    let physics = false;
    let tp = apUsable && Array.isArray(ap.targetPath) ? ap.targetPath : null;
    if (!tp) {
      const nAim = NativeWorkerBridge.latestAim;
      if (nAim && nAim.hit && Array.isArray(nAim.targetPath) && nAim.targetPath.length >= 2 &&
          (performance.now() - NativeWorkerBridge.lastAimTime < 600)) {
        tp = nAim.targetPath;
      }
    }
    if (tp && tp.length >= 2 && tp[0] && tp[1]) {
      const cand = V.norm(V.sub(tp[1], tp[0]));
      if (V.len(cand) > 1e-6) { n = cand; physics = true; }
    }
    if (!n) n = V.norm(V.sub(targetBall.pos, G));
    if (V.len(n) < 1e-6) return result;

    const cutAngleDeg = Math.acos(clamp(V.dot(d, n), -1, 1)) * 180 / Math.PI;

    let pocket = null;
    let engineUsed = false;
    const autoAimReady = isAutoAimAvailable();
    const tableBoundsObj = { boundX, boundY, cushionX, cushionY };
    // v1.9.8：先算目标球到第一库的几何距离。若目标球会先碰库，不能再让
    // 一个勉强的袋口候选直接吞掉 reboundSegments，否则目标球反弹线会长期缺失。
    const targetRailHit = rayRailHit(targetBall.pos, n, boundX, boundY, pockets);
    const minPocketConfidence = clamp(Number(CONFIG.pocketMinConfidence) || 0, 0, 1);
    const pocketRailTolerance = Math.max(0, Number(CONFIG.pocketRailToleranceMm) || 0);
    for (const pk of pockets) {
      const comp = resolveCompensatedPocketTarget(targetBall.pos, pk, tableBoundsObj);
      const ev = evaluatePocket(targetBall.pos, n, pk, comp.targetPoint);
      if (!ev) continue;
      // v1.9.8：低置信度擦袋候选不再压制真实吃库路线。
      if (Number.isFinite(Number(ev.confidence)) && Number(ev.confidence) < minPocketConfidence) continue;
      // 球心先到库边、晚到袋口时，按吃库路线处理；容差用于吸收球半径和袋口目标点差异。
      if (targetRailHit && Number.isFinite(Number(targetRailHit.t)) && Number.isFinite(Number(ev.s)) &&
          Number(ev.s) > Number(targetRailHit.t) + pocketRailTolerance) continue;
      if (CONFIG.checkBlock &&
        pathBlocked(targetBall.pos, ev.enterPoint, objects, targetBall.id, state.cueBallId)) continue;
      const cand = { ...pk, ...ev, dist: Math.abs(ev.tan), cushionHug: comp.cushionHug, isCompensated: comp.isCompensated };
      if (autoAimReady) {
        const route = queryEngineRoute(state, cue, targetBall, pk.id);
        if (route) {
          engineUsed = true;
          if (route.blocked) continue;
          if (route.hitRate != null) cand.confidence = clamp(route.hitRate * ev.alignConf, 0, 1);
          if (route.angleDeg != null) cand.angleDeg = route.angleDeg;
          cand.engine = true;
          // 原生引擎返回的命中率也可能很低，仍不能让它压掉吃库分支。
          if (Number.isFinite(Number(cand.confidence)) && Number(cand.confidence) < minPocketConfidence) continue;
        }
      }
      if (!pocket || cand.s < pocket.s) pocket = cand;
    }
    result.engineUsed = engineUsed;

    // 目标球方向：严格对齐 147master 原生 ThreeLineAssistRenderer 几何/物理轴向 (完全移除人为偏角扰动)
    // 优先采用原生引擎预计算的 targetPath，若无则严格使用质心连心线几何法向 (targetBall.pos - G)
    let objectEnd = null;
    let reboundSegments = null;
    let reboundDisplaySegments = null;
    let reboundRestPoint = null;
    let reboundRestExact = false;
    let reboundStopReason = null;
    let targetReboundMeta = null;
    let targetSimFallback = null;
    // v1.9.15：目标球在当前力度下的总行程预算(mm)。由 computeTargetTravelBudgetMm() 求得，
    // 既用于把微模拟的路径上限压到预算附近（省掉无意义的步进），也用于显示层截断蓝线。
    let targetTravelBudgetMm = null;
    // v1.9.8 调试字段：记录本次目标球反弹线为什么生成/为什么没有生成。
    const targetReboundDebug = {
      reason: pocket ? 'pocket' : 'rail',
      pocketCandidate: pocket
        ? { label: pocket.label, confidence: pocket.confidence, s: pocket.s }
        : null,
      firstRailHit: targetRailHit
        ? { axis: targetRailHit.axis, point: targetRailHit.point, t: targetRailHit.t }
        : null,
      displayLengthMm: 0,
    };
    if (pocket) {
      objectEnd = pocket.enterPoint;
    } else {
      // 绿色目标球瞄准线：目标球是球心运动，库边碰撞点必须用球心有效边界
      // (±1758.1, ±862.75)，不能用库木内沿 (±1784.35, ±889)；
      // 之前多画了 26.25mm（一个球半径），导致预测第一库比真实轨迹远一截。
      const railHit = targetRailHit || rayRailHit(targetBall.pos, n, boundX, boundY, pockets);
      const blockBall = CONFIG.checkBlock
        ? rayFirstBall(targetBall.pos, n, objects, new Set([targetBall.id, state.cueBallId]))
        : null;

      if (blockBall && (!railHit || blockBall.tHit <= railHit.t)) {
        objectEnd = blockBall.G;
        targetReboundDebug.reason = 'blocked-before-rail';
      } else if (railHit) {
        objectEnd = railHit.point;
        targetReboundDebug.reason = 'rail';
        // 【v1.9.3 目标球专用物理微模拟】
        // 不再用“纯滚动 + 几何反射”：从母球杆法/力度求目标球碰后 v/ω，
        // 再单独做滑动→纯滚、侧旋衰减、库边冲量和多库折线。
        if (CONFIG.showObjectRebound) {
          try {
            const livePhy = getLivePhysicsOverrides();
            const targetVertAngle = Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5);
            // v1.9.11：静态瞄准阶段 state.power 往往为 0，不能再用固定的 50%
            // 伪造出一条“看起来能走到”的目标球反弹线；只有玩家真正给到力度才推演。
            const initialPower = effPower > 2 ? effPower : 0;
            const maxTip = Math.max(1e-6, Number(livePhy.maxTipOffsetRatio) || CONFIG.maxTipOffsetRatio);
            const tipMag = Math.min(1, Math.hypot(Number(tip.x) || 0, Number(tip.y) || 0) / maxTip);
            const maxTipRet = Number.isFinite(Number(livePhy.maxTipSpeedRetention))
              ? Number(livePhy.maxTipSpeedRetention)
              : CONFIG.maxTipSpeedRetention;
            const liveTipRetention = 1 - (1 - maxTipRet) * tipMag * tipMag;
            const cueSpeed = resolveCueSpeed(initialPower)
              * liveTipRetention
              * resolveV3ElevationRetention(targetVertAngle);
            // v1.9.15：先算目标球行程预算。后面既用它压缩微模拟的路径上限（改动 4），
            // 也用它把蓝线截到当前力度下的真实停点（改动 2）。
            targetTravelBudgetMm = computeTargetTravelBudgetMm(
              initialPower,
              tip,
              targetVertAngle,
              V.dist(cue.pos, G),
              clamp(V.dot(d, n), 0.08, 1)
            );
            // v1.9.4：先把母球从当前位置推进到接触点 G，得到碰撞瞬间的 v/ω；
            // 不能把出杆初速直接当作碰球速度。
            const cueArrival = initialPower > 0 ? simulateCueArrivalAtContact(
              cue.pos,
              G,
              d,
              cueSpeed,
              tip,
              {
                ...livePhy,
                dtMs: CONFIG.targetMicroDtMs,
                maxSteps: CONFIG.targetMaxSteps,
              }
            ) : null;
            const impactSpeed = cueArrival ? cueArrival.speed : 0;
            const impact = impactSpeed > 0
              ? resolveTargetBallImpactState(
                impactSpeed,
                d,
                targetBall.pos,
                G,
                tip,
                livePhy,
                cueArrival
              )
              : null;
            if (initialPower <= 0 && targetReboundDebug.reason === 'rail') {
              targetReboundDebug.reason = 'no-power';
            }

            if (impact) {
              // v1.9.15（改动 4）：显示层反正要按力度预算截断，微模拟没必要跑满 15m。
              // 本地滚动阻力(125mm/s²)与实测 CUE_POWER_CURVE 不同源，满力时球要"走"十几万毫米，
              // 循环会一路步进到 maxPath/maxSteps 才停——每帧拖力度条都在白烧 CPU。
              // 这里只给预算留 targetReboundBudgetSimMargin 的余量，越界仍由 max-steps/max-path 兜底。
              const fullSimPathMm = Math.max(
                Number(CONFIG.targetMaxPathMm) || 9000,
                Number(CONFIG.targetRestMaxPathMm) || 15000
              );
              const budgetForSim = Number(targetTravelBudgetMm);
              // 关键：路径上限不能压到「目标球到第一库」的距离以内，否则首库接触点会检测不到，
              // 绿线终点和蓝线起点都会断。取「预算余量」与「首库距离 ×1.2」的较大值。
              const railDistForSim = (targetRailHit && Number.isFinite(Number(targetRailHit.t)))
                ? Number(targetRailHit.t) : 0;
              const budgetCapMm = (Number.isFinite(budgetForSim) && budgetForSim > 0)
                ? budgetForSim * (Number(CONFIG.targetReboundBudgetSimMargin) || 1.35) + 300
                : fullSimPathMm;
              const simPathCapMm = clamp(
                Math.max(budgetCapMm, railDistForSim * 1.2),
                1200,
                fullSimPathMm
              );
              const targetSimOpts = {
                // 目标球物理也使用球心有效边界；碰库时球心到达 ±bound，
                // 而不是先穿到库木内沿再反弹。
                cushionX: boundX,
                cushionY: boundY,
                pockets,
                balls: objects,
                ignoreIds: new Set([targetBall.id]),
                // 目标球回弹时，母球已到达接触点 G；用 G 而不是出杆前
                // 的母球位置当回弹障碍，否则会把折线截得过短。
                lateCueBall: { ...cue, pos: { x: G.x, y: G.y } },
                maxBounces: Math.max(
                  Math.max(0, Number(CONFIG.maxRebounds) || 1),
                  Math.max(1, Number(CONFIG.targetRestBounces) || 5)
                ),
                tableSlidingAccel: livePhy.tableSlidingAccel,
                rollingFriction: livePhy.rollingFriction,
                sideSpinLinearDecay: livePhy.sideSpinLinearDecay,
                slipEpsilon: livePhy.slipEpsilon,
                lowSpeedCutoff: livePhy.lowSpeedCutoff,
                lowOmegaCutoff: livePhy.lowOmegaCutoff,
                dtMs: CONFIG.targetMicroDtMs,
                maxPathMm: simPathCapMm,
                maxSteps: Math.max(
                  Number(CONFIG.targetMaxSteps) || 9000,
                  Number(CONFIG.targetRestMaxSteps) || 18000
                ),
              };
              let sim = simulateTargetCushionPath(
                targetBall.pos,
                impact.vel,
                impact.omega,
                targetSimOpts
              );

              // v1.9.15：中大力时，球-球碰撞的微小切向分量可能把
              // 全角度目标球的微模拟方向带偏几度，恰好从袋口夹角穿出，
              // 结果 firstRailHit 为空；但几何连心线明确会先吃库。
              // 此时保留真实碰撞速度，只把初始方向校正到几何第一库点重试。
              // 不能直接把任何无第一库的结果都画成折线，只有目标球确实
              // 能到达该库（按速度/摩擦预算判断）才启用。
              if ((!sim || !sim.firstRailHit || !sim.firstRailHit.point) &&
                  targetRailHit && impact.speed > 0) {
                const railDir = V.norm(V.sub(targetRailHit.point, targetBall.pos));
                if (railDir && Number.isFinite(railDir.x) && Number.isFinite(railDir.y)) {
                  const alignedSim = simulateTargetCushionPath(
                    targetBall.pos,
                    { x: railDir.x * impact.speed, y: railDir.y * impact.speed },
                    impact.omega,
                    targetSimOpts
                  );
                  if (alignedSim && alignedSim.firstRailHit && alignedSim.firstRailHit.point) {
                    sim = alignedSim;
                    targetSimFallback = 'aligned-normal';
                  } else {
                    const railDist = V.dist(targetBall.pos, targetRailHit.point);
                    const decel = Math.max(100, Number(livePhy.rollingFriction) || CONFIG.clothRollingDecelMmS2 || 125);
                    const travelBudget = (impact.speed * impact.speed) / (2 * decel);
                    if (travelBudget >= railDist + 200) {
                      const geo = traceTargetCushionReboundSegments(
                        targetRailHit,
                        railDir,
                        boundX,
                        boundY,
                        pockets,
                        Math.max(2, Number(CONFIG.targetRestBounces) || 5)
                      );
                      if (geo.length) {
                        const end = geo[geo.length - 1].to;
                        const geoLength = geo.reduce((sum, seg) => {
                          return sum + Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
                        }, 0);
                        sim = {
                          segments: geo,
                          displaySegments: geo,
                          displayLengthMm: geoLength,
                          firstRailHit: {
                            point: { ...targetRailHit.point },
                            axis: targetRailHit.axis,
                            speed: impact.speed,
                            omega: impact.omega,
                          },
                          terminal: end,
                          restPoint: end,
                          restExact: false,
                          stopReason: 'geometric-fallback',
                          truncated: true,
                          bounces: geo.length,
                          hitPocket: false,
                          hitBall: null,
                          travelledMm: 0,
                          model: 'target-physics-fallback',
                        };
                        targetSimFallback = 'geometric';
                      }
                    }
                  }
                }
              }

              if (sim && sim.firstRailHit && sim.firstRailHit.point) {
                // 绿色线终点改为物理微模拟真正碰到的第一库点，保证绿/蓝起点相连。
                objectEnd = sim.firstRailHit.point;
                reboundSegments = Array.isArray(sim.segments) && sim.segments.length
                  ? sim.segments
                  : null;
                reboundDisplaySegments = Array.isArray(sim.displaySegments) && sim.displaySegments.length
                  ? sim.displaySegments
                  : reboundSegments;
                reboundRestPoint = sim.restPoint || sim.terminal || null;
                reboundRestExact = Boolean(sim.restExact);
                reboundStopReason = sim.stopReason || null;
                targetReboundMeta = {
                  model: sim.model,
                  power: initialPower,
                  cueSpeed,
                  cueArrivalSpeed: impactSpeed,
                  cueArrivalTravelMm: cueArrival ? cueArrival.travelledMm : 0,
                  tip: { x: tip.x, y: tip.y },
                  cutAngleDeg,
                  impactSpeed: impact.speed,
                  initialTangentImpulse: impact.tangentImpulse,
                  effectiveBallFrictionMu: impact.effectiveMu,
                  firstRailSpeed: sim.firstRailHit.speed,
                  firstRailOmegaZ: sim.firstRailHit.omega ? sim.firstRailHit.omega.z : 0,
                  bounces: sim.bounces,
                  travelledMm: sim.travelledMm,
                  displayLengthMm: sim.displayLengthMm,
                  restPoint: reboundRestPoint,
                  restExact: reboundRestExact,
                  stopReason: reboundStopReason,
                  truncated: Boolean(sim.truncated),
                  fallback: targetSimFallback,
                  hitPocket: sim.hitPocket,
                  hitBall: sim.hitBall && typeof sim.hitBall === 'object'
                    ? { id: sim.hitBall.id, pos: sim.hitBall.pos ? { x: sim.hitBall.pos.x, y: sim.hitBall.pos.y } : null }
                    : sim.hitBall,
                  terminal: sim.terminal,
                };
              } else if (sim) {
                targetReboundMeta = {
                  model: sim.model,
                  power: initialPower,
                  cueSpeed,
                  cueArrivalSpeed: impactSpeed,
                  cueArrivalTravelMm: cueArrival ? cueArrival.travelledMm : 0,
                  terminal: sim.terminal,
                  travelledMm: sim.travelledMm,
                  noFirstRail: true,
                  fallback: targetSimFallback,
                };
              }
            }
          } catch (err) {
            devLog('warn', '[目标球微模拟] 失败，保留绿色线使用几何兜底', err);
          }
        }
      } else {
        objectEnd = V.add(targetBall.pos, V.scale(n, 2000));
        targetReboundDebug.reason = 'no-rail';
      }
    }

    // 基础几何/原生Worker路径兜底
    let verts = [targetBall.pos, objectEnd];
    if (tp && tp.length >= 2) {
      verts = tp.slice();
      if (!pocket && objectEnd) {
        verts[verts.length - 1] = objectEnd;
      }
    }

    // 官方物理引擎无头微模拟器推演 (模块 68 真实复算，未出杆/拉杆力度为0时不启动走位推演)
    const vertAngle = Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5);
    let engine = null;
    if (CONFIG.engineSimEnabled && effPower > 0) {
      const engineKey = [
        Math.round(effPower * 10),
        Math.round(tip.x * 100),
        Math.round(tip.y * 100),
        Math.round(d.x * 1000),
        Math.round(d.y * 1000),
        Math.round(cue.pos.x),
        Math.round(cue.pos.y),
        vertAngle,
        (state.table && state.table.tableBoundaryId) || '',
        allBalls.map((b) => `${b.id}:${Math.round(b.pos.x)}:${Math.round(b.pos.y)}`).join(','),
      ].join('|');

      const aimAngle = Math.atan2(d.y, d.x);
      const simContext = {
        targetBallId: targetBall.id,
        cuePos: { x: cue.pos.x, y: cue.pos.y },
        contactPos: { x: G.x, y: G.y },
        aimAngle,
      };

      engine = engineSim.get(engineKey, () => engineSim.buildPayload(state, {
        direction: d,
        power: effPower,
        tip,
        verticalAngle: vertAngle,
      }), simContext);
    }
    result.engineSim = engine;

    // 官方引擎命中目标必须与几何瞄准目标一致，否则 targetPath 属于另一颗球，
    // 不能拿来当本杆目标球的停点/反弹线。
    const engineTargetMatches = Boolean(
      engine && engine.hit &&
      engine.targetId != null &&
      String(engine.targetId) === String(targetBall.id)
    );

    // v1.9.17：橙色实线不再只借 targetPath 的总长度，而是直接复用它的
    // 「第一库前真实路径」。这样切球、侧旋、先碰球/先碰库时的橙色终点
    // 也来自官方逐帧轨迹，而不是沿绿色几何线截一个标量长度。
    let engineTargetPathBeforeRail = null;
    let engineTargetBeforeRailMm = null;
    if (engineTargetMatches && !engine.stale &&
        Array.isArray(engine.targetPathBeforeRail) && engine.targetPathBeforeRail.length >= 2) {
      const beforeRailMm = polylineLength(engine.targetPathBeforeRail);
      if (Number.isFinite(beforeRailMm) && beforeRailMm > 0) {
        engineTargetPathBeforeRail = engine.targetPathBeforeRail;
        engineTargetBeforeRailMm = beforeRailMm;
      }
    }

    // 【精度优先】官方引擎的 targetPath 是目标球碰后到真实停点的完整逐帧轨迹。
    // 用它的总长度作为目标球行程预算，直接复用官方碰后速度、滑-滚转换与库边/球体
    // 碰撞结果，避免本地经验公式在不同力度下出现“有时多跑、有时少跑”的双向误差。
    // stale 结果是上一力度/上几帧的缓存，不用于停点判断，继续走本文件兜底模型。
    let engineTargetReachMm = null;
    if (engineTargetMatches && !engine.stale &&
        Array.isArray(engine.targetPath) && engine.targetPath.length >= 2) {
      const engineTravelMm = polylineLength(engine.targetPath);
      if (Number.isFinite(engineTravelMm) && engineTravelMm > 0) {
        engineTargetReachMm = engineTravelMm;
        targetTravelBudgetMm = engineTravelMm;
      }
    }

    if (engine) {
      if (engine.hit === false) {
        result.unreachable = true;
      } else {
        // 【解耦绿色瞄准线】：绝对不让 engine.targetPath 覆盖 verts！
        // verts 始终保持笔直延伸至目标袋口或库边，确保瞄准视线与手感 100% 稳定
        if (Array.isArray(engine.targetPath) && engine.targetPath.length >= 2) {
          result.engineTargetPath = engine.targetPath;
        }
        if (engine.potted) {
          result.enginePotted = true;
        }
        if (engine.cuePotted) {
          result.cuePottedWarning = true;
        }
      }
    }

    // 【目标球反弹线借鉴母球落位预测】官方 targetPath 与母球 cuePath 同源，
    // 都是 simulateShot() 的真实逐帧物理结果。直接截取第一库之后的轨迹作为蓝线，
    // 形状、库边衰减与最终停点全部来自官方引擎，不再依赖本地经验预算截断。
    let reboundFromEngineSim = false;
    if (engineTargetMatches && !engine.stale &&
        targetReboundDebug.reason === 'rail' &&
        Array.isArray(engine.targetPath) && engine.targetPath.length >= 2) {
      let engineReboundPts = null;
      if (Array.isArray(engine.targetPathAfterRail) && engine.targetPathAfterRail.length >= 1) {
        engineReboundPts = [{ x: objectEnd.x, y: objectEnd.y }];
        for (const p of engine.targetPathAfterRail) {
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          const last = engineReboundPts[engineReboundPts.length - 1];
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
          engineReboundPts.push({ x: p.x, y: p.y });
        }
        if (engineReboundPts.length < 2) engineReboundPts = null;
      }
      if (!engineReboundPts) {
        engineReboundPts = sliceEngineReboundPath(engine.targetPath, objectEnd);
      }
      if (engineReboundPts && engineReboundPts.length >= 2) {
        const sampledRebound = samplePolylineByDistance(
          engineReboundPts,
          CONFIG.targetReboundSampleStepMm || 50
        );
        const engineReboundSegments = [];
        for (let i = 0; i < sampledRebound.length - 1; i++) {
          engineReboundSegments.push({
            from: { x: sampledRebound[i].x, y: sampledRebound[i].y },
            to: { x: sampledRebound[i + 1].x, y: sampledRebound[i + 1].y },
            axis: null,
          });
        }
        if (engineReboundSegments.length) {
          reboundSegments = engineReboundSegments;
          reboundDisplaySegments = engineReboundSegments;
          reboundRestPoint = engineReboundPts[engineReboundPts.length - 1];
          reboundRestExact = true;
          reboundStopReason = 'engineSim';
          reboundFromEngineSim = true;
          targetReboundMeta = {
            model: 'engineSim-target-path',
            power: effPower,
            cutAngleDeg,
            engineTravelMm: polylineLength(engine.targetPath),
            displayLengthMm: polylineLength(engineReboundPts),
            bounces: detectJunctions(engineReboundPts).length,
            restPoint: reboundRestPoint,
            restExact: true,
            stopReason: 'engineSim',
            hitPocket: Boolean(engine.potted),
            terminal: reboundRestPoint,
          };
        }
      }
    }

    // 母球碰后真实走位弧线：高精微仿真优先，节流期间 0ms 瞬时解析物理折线无缝兜底
    if (CONFIG.showCuePostTrajectory && effPower > 0) {
      let cuePostPath = null;
      let cuePostMethod = 'algo';
      if (engine && Array.isArray(engine.cuePath) && engine.cuePath.length >= 1) {
        cuePostPath = [{ x: G.x, y: G.y }, ...engine.cuePath];
        cuePostMethod = 'engineSim';
      } else {
        // 0ms 瞬时解析物理走位线：拖动力度条时 60FPS 实时丝滑跟手变动，彻底告别 1~2 秒僵滞！
        cuePostPath = simulateInstantCuePostTrajectory(G, targetBall.pos, d, effPower, tip, boundX, boundY, pockets);
        cuePostMethod = 'algo';
      }
      if (cuePostPath && cuePostPath.length >= 2) {
        result.cuePostTrajectory = cuePostPath;
        result.cueRestPos = cuePostPath[cuePostPath.length - 1];
        result.cuePostMethod = cuePostMethod;
      }
    }

    result.physics = physics || Boolean(engine && engine.hit);
    const rawDisplayReboundPath = Array.isArray(reboundDisplaySegments)
      ? reboundDisplaySegments
      : reboundSegments;

    /* 【v1.9.15 · 改动 2】目标球吃库反弹蓝线：随当前力度动态伸缩，终点 = 该力度下的真实停点。
     *
     * 母球「直接吃库」那条蓝线之所以准，是因为它走 engineSim.nativeTwoRail() 的官方内核
     * physics.step()，逐帧推进到 isTableMoving() 为 false 才收尾，长度天然等于真实停点。
     *
     * 目标球这条走的是本地微模拟，台呢滚动阻力(clothRollingDecelMmS2，缺省 125mm/s²)与
     * 实测的 CUE_POWER_CURVE(满力仅 14870mm)不同源：满力时目标球碰后速度约 6800mm/s，
     * 按 125mm/s² 纯滚要走约 18 万毫米，所以永远撞在 targetRestMaxPathMm(15000) 上被截断，
     * 拖力度条时长度几乎不动。
     *
     * 这里不动物理常数（会连累推荐力度/力度不足判定/母球到达速度），只在显示层按
     * 「当前力度真正能把目标球推多远」截断。公式与 attachShotPowerMetrics().actualReachMm
     * 完全同源，保证蓝线长度和「橙色实线力度条」不会互相打架。
     */
    let displayReboundPath = rawDisplayReboundPath;
    let reboundBudgetMm = null;
    let reboundBudgetTrimmedMm = 0;
    let reboundBudgetLimited = false;
    if (!reboundFromEngineSim && CONFIG.targetReboundBudgetEnabled && Array.isArray(rawDisplayReboundPath) && rawDisplayReboundPath.length) {
      // 极端情况下（预算在别处算过但为 null）在这里兜底重算，口径保持一致。
      let budgetMm = Number(targetTravelBudgetMm);
      if (!Number.isFinite(budgetMm) || budgetMm <= 0) {
        budgetMm = computeTargetTravelBudgetMm(
          effPower,
          tip,
          vertAngle,
          V.dist(cue.pos, G),
          clamp(V.dot(d, n), 0.08, 1)
        );
      }

      const firstSegStart = (() => {
        const seg = rawDisplayReboundPath[0];
        const p = seg && (seg.from || seg.p1);
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
      })();
      // 预算覆盖的是「目标球从碰后起点到最终停点」的总路程，蓝线只负责第一库之后那一段，
      // 所以要先扣掉绿线(碰点→第一库)已经占用的距离。
      const greenLenMm = firstSegStart ? V.dist(targetBall.pos, firstSegStart) : 0;
      const blueBudgetMm = Math.max(0, budgetMm - greenLenMm);

      const rawLenMm = rawDisplayReboundPath.reduce((sum, seg) => {
        if (!seg) return sum;
        const p1 = seg.from || seg.p1;
        const p2 = seg.to || seg.p2;
        return (p1 && p2) ? sum + Math.hypot(p2.x - p1.x, p2.y - p1.y) : sum;
      }, 0);

      const cut = trimReboundSegmentsByLength(rawDisplayReboundPath, blueBudgetMm);
      const keptLenMm = cut.segments.reduce((sum, seg) => {
        return sum + Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
      }, 0);

      reboundBudgetMm = Math.round(budgetMm);
      reboundBudgetTrimmedMm = Math.max(0, Math.round(rawLenMm - keptLenMm));
      reboundBudgetLimited = Boolean(cut.trimmed);

      if (cut.segments.length) {
        displayReboundPath = cut.segments;
        if (cut.endPoint) reboundRestPoint = cut.endPoint;
        // 被力度预算截断的终点不是物理停稳点，别让外部把它当真实 restPoint。
        if (cut.trimmed) reboundRestExact = false;
      } else {
        // 力度根本推不到第一库：整条蓝线不画（绿线保持实线，橙色力度条会停在第一库前）。
        displayReboundPath = [];
        reboundRestPoint = null;
        reboundRestExact = false;
        reboundStopReason = 'power-budget';
      }
    }

    targetReboundDebug.displayLengthMm = Array.isArray(displayReboundPath)
      ? displayReboundPath.reduce((sum, seg) => {
        const p1 = seg && (seg.from || seg.p1);
        const p2 = seg && (seg.to || seg.p2);
        return p1 && p2 ? sum + Math.hypot(p2.x - p1.x, p2.y - p1.y) : sum;
      }, 0)
      : 0;
    targetReboundDebug.restPoint = reboundRestPoint;
    targetReboundDebug.restExact = reboundRestExact;
    targetReboundDebug.stopReason = reboundStopReason;
    // v1.9.15：预算诊断字段，实机拖力度条时可直接看 budgetMm / displayLengthMm 是否同步变化。
    targetReboundDebug.budgetMm = reboundBudgetMm;
    targetReboundDebug.budgetTrimmedMm = reboundBudgetTrimmedMm;
    targetReboundDebug.budgetLimited = reboundBudgetLimited;
    // 微模拟元数据里的停点也要跟着截断结果走，否则导出的 reboundMeta 会和实际画出来的线不一致。
    if (targetReboundMeta) {
      targetReboundMeta.restPoint = reboundRestPoint;
      targetReboundMeta.restExact = reboundRestExact;
      targetReboundMeta.budgetMm = reboundBudgetMm;
    }
    if (targetReboundMeta) targetReboundMeta.displayLengthMm = targetReboundDebug.displayLengthMm;
    result.target = {
      ball: targetBall,
      contact: G,
      objectDir: n,
      cutAngleDeg,
      pocket,
      objectPath: verts,
      objectEnd: (verts && verts.length >= 2) ? verts[verts.length - 1] : objectEnd,
      reboundSegments,
      // v1.9.14：目标球蓝线使用“第一库后到真实停点”的完整折线；
      // v1.9.15：再按当前力度的行程预算截断，长度随力度实时伸缩，终点即该力度下的停点。
      reboundDisplaySegments: displayReboundPath,
      reboundRestPoint,
      reboundDisplayLengthMm: targetReboundDebug.displayLengthMm,
      reboundRestExact,
      reboundStopReason,
      reboundMeta: targetReboundMeta,
      reboundDebug: targetReboundDebug,
      targetReboundReason: targetReboundDebug.reason,
      targetFirstRailHit: targetReboundDebug.firstRailHit,
      targetPocketCandidate: targetReboundDebug.pocketCandidate,
      targetReboundDisplayLengthMm: targetReboundDebug.displayLengthMm,
      // v1.9.15：本次蓝线使用的力度行程预算与截断量（mm），供 HUD / 控制台核对。
      reboundBudgetMm,
      reboundBudgetTrimmedMm,
      reboundBudgetLimited,
      pathLengthMm: polylineLength(verts),
      // 橙色实线力度条使用的目标球行程预算；出杆冻结快照也要带着它。
      // 优先官方引擎 targetPath 总长度；引擎不可用/结果 stale 时回退经验模型。
      targetReachMm: Number.isFinite(Number(engineTargetReachMm)) && Number(engineTargetReachMm) > 0
        ? Number(engineTargetReachMm)
        : (Number.isFinite(Number(targetTravelBudgetMm)) && Number(targetTravelBudgetMm) > 0
          ? Number(targetTravelBudgetMm)
          : computeTargetTravelBudgetMm(
            effPower,
            tip,
            Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5),
            V.dist(cue.pos, G),
            clamp(V.dot(d, n), 0.08, 1)
          )),
      // v1.9.17：橙色实线优先使用官方引擎的「第一库前真实路径」。
      // 引擎不可用或结果 stale 时为 null，绘制层回退到原来的绿线长度截断。
      orangePath: engineTargetPathBeforeRail,
      orangeReachMm: Number.isFinite(Number(engineTargetBeforeRailMm))
        ? Number(engineTargetBeforeRailMm) : null,
      source: (engine && engine.hit) ? 'engineSim' : (physics ? 'engine' : 'geometry'),
      cushionHug: pocket?.cushionHug || checkCushionHug(targetBall.pos, tableBoundsObj),
    };

    result.cuePost = null;
    return result;
  }

  function attachShotPowerMetrics(geomPred, state) {
    if (!geomPred) return null;
    const power = resolveEffectivePower(state);
    const tip = resolveEffectiveTip(state);
    const vertAngle = Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5);

    const centerSpeed = resolveCueSpeed(power);
    const retention = tipSpeedRetention(tip);
    const elevRetention = resolveV3ElevationRetention(vertAngle);
    const effSpeed = centerSpeed * retention * elevRetention;

    let insufficientPower = false;
    let recPower = null;
    let actualReachMm = null;

    if (geomPred.target) {
      const sCue = V.dist(geomPred.cue, geomPred.target.contact || geomPred.target.ball.pos);
      const cosCut = clamp(V.dot(geomPred.aimDir, geomPred.target.objectDir), 0.08, 1);

      // 官方引擎已经给出目标球真实停点时，直接采用；否则回退经验模型。
      const engineReachMm = Number(geomPred.target && geomPred.target.targetReachMm);
      actualReachMm = (Number.isFinite(engineReachMm) && engineReachMm > 0)
        ? engineReachMm
        : computeTargetTravelBudgetMm(power, tip, vertAngle, sCue, cosCut);

      const targetPathLen = Number(geomPred.target.pathLengthMm) ||
        (geomPred.target.pocket ? V.dist(geomPred.target.ball.pos, geomPred.target.pocket.enterPoint || geomPred.target.pocket.opening) : 0);

      if (power > 2 && targetPathLen > 0) {
        // 当实际可达距离不足以到达袋口并具备 150mm 扎实落袋余量时，判定为力度不足；
        // 该状态只用于 HUD 文案，不再改变绿色瞄准线线型（改由橙色实线力度条显示停点）。
        if (actualReachMm < targetPathLen + 150) {
          insufficientPower = true;
        }
      }

      if (CONFIG.showRecPower) {
        recPower = calculateRecommendedPower(
          geomPred.cue,
          geomPred.target.contact,
          geomPred.target.ball.pos,
          geomPred.target.pocket ? (geomPred.target.pocket.enterPoint || geomPred.target.pocket.opening) : V.add(geomPred.target.ball.pos, V.scale(geomPred.target.objectDir, targetPathLen || 800)),
          geomPred.aimDir,
          tip,
          vertAngle
        );
        // 贴库球与半贴库擦角补偿专项推荐力度压制：避免系统错误推荐过大力量导致晃袋弹飞
        const ch = geomPred.target.cushionHug || geomPred.target.pocket?.cushionHug;
        if (ch && ch.isTight) {
          recPower = clamp(recPower, 22, 32);
        } else if (ch && (ch.isNear || ch.isJawClipping)) {
          recPower = clamp(recPower, 22, 38);
        }
      }
    }

    return {
      ...geomPred,
      power,
      effSpeed,
      actualReachMm,
      // 橙色实线力度条的显示长度：与 actualReachMm/蓝线预算完全同源。
      targetReachMm: actualReachMm,
      insufficientPower,
      recPower,
      roomMode: detectCurrentRoomMode(state),
    };
  }

  /* ================================================================== */
  /* 3D 台面平铺投影（局部参考点归一化，防止近距离镜头推近时法向符号翻转）   */
  /* ================================================================== */

  const projection = {
    source: 'none',
    _internalRef: null,
    homography: null,
    canvas: null,
    _initialized: false,
    _clothCache: null,
    _clothCamKey: null,

    init() {
      const current = this.canvas;
      const currentUsable = isCanvasActuallyVisible(current);

      const next = findGameCanvas();
      if (!next && !currentUsable) {
        this.canvas = null;
        this._initialized = false;
        return;
      }
      const target = next || current;
      if (target === current && this._initialized) return;

      this.canvas = target;
      this._initialized = true;
      this._clothCache = null;
      this._clothCamKey = null;
      this.loadHomography();
      if (_resizeObserver) {
        try { _resizeObserver.disconnect(); } catch (_) {}
        _resizeObserver = null;
      }
      _installResizeObserver(target);
      _sizesDirty = true;
      _lastRenderKey = null;
    },

    threeGameProject() {
      const tg = getGameGlobal('threeGame');
      return tg && typeof tg.project === 'function' ? tg.project : null;
    },

    get internal() {
      if (this._internalRef) {
        const obj = this._internalRef.deref();
        if (obj) return obj;
        this._internalRef = null;
      }
      return null;
    },
    set internal(val) {
      this._internalRef = val ? new WeakRef(val) : null;
    },

    findInternalTransform(root, depth, seen) {
      if (!root || (depth || 0) > 4 || typeof root !== 'object') return null;
      if (!seen) seen = new Set();
      if (seen.has(root)) return null;
      seen.add(root);
      if (typeof root.toScreen === 'function') return root;
      for (const key of Object.keys(root)) {
        let val;
        try { val = root[key]; } catch (_) { continue; }
        if (val && typeof val === 'object') {
          const found = this.findInternalTransform(val, (depth || 0) + 1, seen);
          if (found) return found;
        }
      }
      return null;
    },

    _lastScan: 0,
    refreshInternal() {
      if (this.internal) return;
      const now = performance.now();
      if (now - this._lastScan < 2000) return;
      this._lastScan = now;
      const wins = collectCandidateWindows();
      const candidates = [capturedCore];
      for (const w of wins) {
        try {
          candidates.push(w.SnookerProduct, w.SnookerProductLite, w.SnookerThreeCore);
        } catch (_) {}
      }
      for (const c of candidates) {
        const t = this.findInternalTransform(c);
        if (t) {
          this.internal = t;
          return;
        }
      }
    },

    resolveSource() {
      if (this.threeGameProject()) return 'threeGame';
      this.refreshInternal();
      if (this.internal) return 'internal';
      if (this.homography) return 'homography';
      return 'none';
    },

    loadHomography() {
      try {
        const raw = localStorage.getItem(CONFIG.calibrationKey);
        if (raw) this.homography = JSON.parse(raw);
      } catch (_) { this.homography = null; }
    },

    saveHomography(H) {
      this.homography = H;
      this._clothCache = null;
      this._clothCamKey = null;
      _lastRenderKey = null;
      try { localStorage.setItem(CONFIG.calibrationKey, JSON.stringify(H)); } catch (_) {}
    },

    toScreen(p) {
      const tgp = this.threeGameProject();
      if (tgp) {
        try { return tgp({ x: p.x, y: p.y }); } catch (_) {}
      }
      const intl = this.internal;
      if (intl) {
        const s = intl.toScreen({ x: p.x, y: p.y });
        return { x: s.x, y: s.y };
      }
      if (this.homography) return this.applyHomography(p);
      return null;
    },

    computeClothProjector(refPos) {
      const rect = this.canvas ? this.canvas.getBoundingClientRect() : null;
      const winW = rect ? rect.width : window.innerWidth;
      const winH = rect ? rect.height : window.innerHeight;
      const cx = rect ? (rect.left + winW * 0.5) : (winW * 0.5);
      const cy = rect ? (rect.top + winH * 0.5) : (winH * 0.5);

      const ref = refPos && Number.isFinite(refPos.x) && Number.isFinite(refPos.y)
        ? { x: refPos.x, y: refPos.y }
        : { x: 0, y: 0 };

      const span = 350;
      const localPts = [
        { x: -span, y: -span },
        { x: span, y: -span },
        { x: span, y: span },
        { x: -span, y: span },
      ];
      const worldPts = localPts.map((lp) => ({ x: ref.x + lp.x, y: ref.y + lp.y }));
      const sPts = worldPts.map((wp) => this.toScreen(wp));
      if (sPts.some((s) => !s || !Number.isFinite(s.x) || !Number.isFinite(s.y))) {
        return null;
      }

      const H = computeHomography(localPts, sPts);
      if (!H) return null;

      const a1 = H[0] - cx * H[6];
      const b1 = H[3] - cy * H[6];
      const c1 = H[6];

      const a2 = H[1] - cx * H[7];
      const b2 = H[4] - cy * H[7];
      const c2 = H[7];

      const m1 = -(a1 * a2 + b1 * b2);
      const d1 = c1 * c2;
      const m2 = 0.5 * ((a1 * a1 + b1 * b1) - (a2 * a2 + b2 * b2));
      const d2 = 0.5 * (c2 * c2 - c1 * c1);
      const denom = d1 * d1 + d2 * d2;

      const defaultF = Math.max(600, winW * 0.92);
      let f = defaultF;
      if (denom > 1e-13) {
        const f2 = (m1 * d1 + m2 * d2) / denom;
        if (f2 > 0) {
          const minF = Math.max(250, winW * 0.35);
          const maxF = Math.max(2000, winW * 4.0);
          f = clamp(Math.sqrt(f2), minF, maxF);
        }
      }

      const u1 = [a1 / f, b1 / f, c1];
      const u2 = [a2 / f, b2 / f, c2];
      const l1 = Math.hypot(u1[0], u1[1], u1[2]);
      const l2 = Math.hypot(u2[0], u2[1], u2[2]);
      if (l1 < 1e-9 || l2 < 1e-9) return null;

      const lambda = (l1 + l2) * 0.5;
      const r1 = [u1[0] / l1, u1[1] / l1, u1[2] / l1];
      const dot12 = u2[0] * r1[0] + u2[1] * r1[1] + u2[2] * r1[2];
      const r2Raw = [u2[0] - dot12 * r1[0], u2[1] - dot12 * r1[1], u2[2] - dot12 * r1[2]];
      const l2Ortho = Math.hypot(r2Raw[0], r2Raw[1], r2Raw[2]) || 1;
      const r2 = [r2Raw[0] / l2Ortho, r2Raw[1] / l2Ortho, r2Raw[2] / l2Ortho];

      const r3 = [
        r1[1] * r2[2] - r1[2] * r2[1],
        r1[2] * r2[0] - r1[0] * r2[2],
        r1[0] * r2[1] - r1[1] * r2[0],
      ];

      const s = lambda * BALL_RADIUS_MM;
      const dX = f * s * r3[0];
      const dY = f * s * r3[1];
      const dZ = s * r3[2];

      return {
        ref,
        H,
        cx,
        cy,
        dX,
        dY,
        dZ,
      };
    },

    toClothScreen(p, refPos) {
      if (!CONFIG.flatOnCloth) return this.toScreen(p);
      const tgp = this.threeGameProject();
      if (tgp) {
        try {
          // 147master 原生 project(p2, height = 0.02625):
          // 传递 height = 0 时直接投影到台呢表面 (与原生 aimPlane 瞄准线完全像素级一致)
          const s = tgp({ x: p.x, y: p.y }, 0);
          if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return s;
        } catch (_) {}
      }
      return this.toScreen(p);
    },

    radius(mm, ref) {
      const base = ref || { x: 0, y: 0 };
      if (this.source === 'threeGame') {
        const tgp = this.threeGameProject();
        if (tgp) {
          const a = tgp(base);
          const b = tgp({ x: base.x + mm, y: base.y });
          return Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
        }
      }
      const intl = this.internal;
      if (intl && typeof intl.radius === 'function') {
        return intl.radius(mm);
      }
      if (intl) {
        const a = intl.toScreen(base);
        const b = intl.toScreen({ x: base.x + mm, y: base.y });
        return Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
      }
      if (this.homography) {
        const a = this.applyHomography(base);
        const b = this.applyHomography({ x: base.x + mm, y: base.y });
        return Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
      }
      return 3;
    },

    applyHomography(p) {
      const H = this.homography;
      const w = H[6] * p.x + H[7] * p.y + H[8];
      return {
        x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
        y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
      };
    },
  };

  /* ================================================================== */
  /* 单应矩阵求解                                                      */
  /* ================================================================== */

  function computeHomography(mmPts, pxPts) {
    const n = mmPts.length;
    if (n < 4) return null;
    const A = [];
    const b = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = [mmPts[i].x, mmPts[i].y];
      const [u, v] = [pxPts[i].x, pxPts[i].y];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solveLinear(A, b);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function solveLinear(A, b) {
    const m = A.length, n = A[0].length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < m; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-9) return null;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < m; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  /* ================================================================== */
  /* ResizeObserver 尺寸同步                                            */
  /* ================================================================== */

  let _sizesDirty = true;
  let _resizeObserver = null;
  let _resizeListenersBound = false;

  function _installResizeObserver(sceneCanvas) {
    if (_resizeObserver || !sceneCanvas) return;
    try {
      _resizeObserver = new ResizeObserver(() => {
        _sizesDirty = true;
        _lastRenderKey = null;
      });
      _resizeObserver.observe(sceneCanvas);
    } catch (_) {}
    if (!_resizeListenersBound) {
      _resizeListenersBound = true;
      window.addEventListener('resize', () => {
        _sizesDirty = true;
        _lastRenderKey = null;
      }, { passive: true });
      document.addEventListener('fullscreenchange', () => {
        _sizesDirty = true;
        _lastRenderKey = null;
      });
    }
  }

  /* ================================================================== */
  /* 状态指纹脏检测                                                      */
  /* ================================================================== */

  let _lastGeomKey = null;
  let _lastGeomPred = null;
  let _lastRenderKey = null;
  let _lastFullPred = null;
  let _lastShotPred = null; // 击球出杆快照，用于目标球吃库线冻结
  // v1.9.9：出杆瞬间的冻结快照。目标球吃库反弹线从这一刻起只读快照：
  // 运动中不随球移动、停球后继续保留，直到下一杆出杆时被新快照替换。
  // v1.9.12：母球吃库反弹折线也改为独立冻结，不再依赖 predToDraw 的实时对象。
  let _retainedShotPred = null;
  let _retainedCueCushionPath = null;
  let _retainedCueCushionBounds = null;
  let _lastConfigVersion = -1;

  function buildStateKeys(state) {
    if (!state) return null;
    const cue = getCueBall(state);
    const aim = state && state.aim;
    if (!cue || !cue.pos || !aim || !aim.direction) return null;
    const balls = Array.isArray(state.balls) ? state.balls : [];
    const active = balls.filter((b) => b && !b.potted && b.pos && Number.isFinite(b.pos.x));
    const ballPositions = active
      .map((b) => `${b.id != null ? b.id : b.kind || '?'}:${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)}`)
      .join('|');
    const contactId = (state.aimPrediction && state.aimPrediction.contactBallId) || '';
    const apHit = state.aimPrediction && state.aimPrediction.hit === false ? '0' : '1';
    const phase = String(state.phase || state.status || state.gameState || state.state || '');

    let camSig = 'nocam';
    const tg = getGameGlobal('threeGame');
    const cam = (tg && tg.camera) || (tg && tg.core && tg.core.camera);
    if (cam && cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      camSig = `${e[0].toFixed(2)},${e[5].toFixed(2)},${e[10].toFixed(2)},${e[12].toFixed(1)},${e[13].toFixed(1)},${e[14].toFixed(1)}`;
    } else {
      const sCue = projection.toScreen(cue.pos);
      const sCenter = projection.toScreen({ x: 0, y: 0 });
      camSig = (sCue && sCenter) ? `${sCue.x.toFixed(1)},${sCue.y.toFixed(1)},${sCenter.x.toFixed(1)},${sCenter.y.toFixed(1)}` : 'nocam';
    }

    const effTip = resolveEffectiveTip(state);
    const effPower = resolveEffectivePower(state);
    const vertAngle = Number(state.shot?.verticalAngle ?? state.aim?.verticalAngle ?? 2.5);

    const geomKey = [
      cue.pos.x.toFixed(1), cue.pos.y.toFixed(1),
      aim.direction.x.toFixed(4), aim.direction.y.toFixed(4),
      effTip.x.toFixed(3), effTip.y.toFixed(3),
      effPower.toFixed(1),
      vertAngle.toFixed(1),
      active.length, ballPositions, contactId, apHit, phase,
    ].join(',');

    const renderKey = `${geomKey}|p:${effPower.toFixed(1)}|c:${camSig}`;

    return { geomKey, renderKey };
  }

  /* ================================================================== */
  /* v1.9.4 出杆瞬间冻结快照                                             */
  /* ================================================================== */

  // 优先读取真正出杆时的力度；静态瞄准阶段 state.power 可能为 0，
  // 不能用 resolveEffectivePower() 的 0 结果覆盖 shot.power。
  function resolveShotSnapshotPower(state) {
    if (!state) return null;
    const candidates = [
      state.shot && state.shot.power,
      state.shot && state.shot.force,
      state.power,
      state.aim && state.aim.power,
      state.cue && state.cue.power,
      (performance.now() - _lastRequestedShotAt < 1500) ? _lastRequestedShotPower : null,
      _lastAimPowerObserved,
    ];
    for (const raw of candidates) {
      const p = Number(raw);
      if (Number.isFinite(p) && p > 2) return clamp(p, 0, 100);
    }
    // 出杆瞬间游戏可能已经把 state.power 清零，但上一帧静态预览
    // 已经按实际力度算过目标球微模拟；用它作为最后兜底，避免冻结成 0%/50%。
    const lastPower = Number(
      (_lastShotPred && _lastShotPred.target && _lastShotPred.target.reboundMeta &&
        _lastShotPred.target.reboundMeta.power) ||
      (_lastFullPred && _lastFullPred.target && _lastFullPred.target.reboundMeta &&
        _lastFullPred.target.reboundMeta.power) ||
      0
    );
    if (Number.isFinite(lastPower) && lastPower > 2) return clamp(lastPower, 0, 100);
    return null;
  }

  let _lastSnapshotError = null;

  // 用实际出杆力度重建一次预测，避免把出杆前 50% 兜底预览当成冻结快照。
  function buildShotSnapshotPrediction(state) {
    if (!state) return null;
    const actualPower = resolveShotSnapshotPower(state);
    if (actualPower == null) return null;
    try {
      _lastSnapshotError = null;
      const snapshotState = {
        ...state,
        power: actualPower,
        shot: {
          ...(state.shot || {}),
          power: actualPower,
        },
        aim: state.aim
          ? { ...state.aim, power: actualPower }
          : state.aim,
      };
      const snapshot = predict(snapshotState);
      if (snapshot) {
        // predict 内部的 resolveEffectivePower 可能受 state.power 的历史值影响；
        // 冻结快照和 HUD 必须明确记录这次实际出杆力度。
        snapshot.power = actualPower;
        snapshot.shot = { ...(snapshot.shot || {}), power: actualPower };
      }
      return snapshot;
    } catch (e) {
      _lastSnapshotError = String(e && e.message || e);
      return null;
    }
  }

  // 兜底快照可能来自上一帧静态预览：目标球微模拟已经按实际力度算过，
  // 但游戏在出杆瞬间把 state.power 清零，导致 HUD / shot.power 显示 0。
  // 用目标球微模拟记录的实际力度回填，避免冻结层看起来像 0% 出杆。
  function normalizeRetainedPower(pred) {
    if (!pred) return pred;
    const metaPower = Number(pred.target && pred.target.reboundMeta && pred.target.reboundMeta.power);
    const shotPower = Number(pred.shot && pred.shot.power);
    const p = (Number.isFinite(metaPower) && metaPower > 2)
      ? metaPower
      : (Number.isFinite(shotPower) && shotPower > 2 ? shotPower : null);
    const fallbackPower = (performance.now() - _lastRequestedShotAt < 1500 &&
      Number.isFinite(Number(_lastRequestedShotPower)) && Number(_lastRequestedShotPower) > 2)
      ? Number(_lastRequestedShotPower)
      : (Number.isFinite(Number(_lastAimPowerObserved)) && Number(_lastAimPowerObserved) > 2
        ? Number(_lastAimPowerObserved)
        : null);
    const resolved = p != null ? p : fallbackPower;
    if (resolved != null) {
      pred.power = resolved;
      pred.shot = { ...(pred.shot || {}), power: resolved };
    }
    return pred;
  }

  // v1.9.11：冻结快照只保留绘制/UI需要的纯数据字段，绝不把游戏球对象
  // （可能带 Three.js mesh / 循环引用）整体 structuredClone，避免克隆失败后
  // 目标球反弹线在出杆瞬间直接消失。
  function snapshotPoint(p) {
    if (!p || typeof p !== 'object') return null;
    const x = Number(p.x);
    const y = Number(p.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function snapshotPoints(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const p of list) {
      const q = snapshotPoint(p);
      if (q) out.push(q);
    }
    return out;
  }

  function snapshotBall(ball) {
    if (!ball || typeof ball !== 'object') return null;
    const out = {
      id: ball.id != null ? ball.id : null,
      kind: ball.kind,
    };
    const pos = snapshotPoint(ball.pos);
    if (pos) out.pos = pos;
    if (Number.isFinite(Number(ball.radius))) out.radius = Number(ball.radius);
    const vel = snapshotPoint(ball.vel);
    if (vel) out.vel = vel;
    if (ball.omega && Number.isFinite(Number(ball.omega.x))) {
      out.omega = { x: Number(ball.omega.x), y: Number(ball.omega.y), z: Number(ball.omega.z) };
    }
    return out;
  }

  function snapshotReboundSegments(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const seg of list) {
      if (!seg) continue;
      const from = snapshotPoint(seg.from || seg.p1);
      const to = snapshotPoint(seg.to || seg.p2);
      if (!from || !to) continue;
      out.push({ from, to, axis: seg.axis || null });
    }
    return out.length ? out : null;
  }

  function buildRetainedSnapshot(pred) {
    if (!pred) return null;
    const t = pred.target || null;
    const target = t ? {
      ball: snapshotBall(t.ball),
      contact: snapshotPoint(t.contact),
      objectDir: snapshotPoint(t.objectDir),
      objectPath: snapshotPoints(t.objectPath),
      objectEnd: snapshotPoint(t.objectEnd),
      reboundSegments: snapshotReboundSegments(t.reboundSegments),
      // v1.9.14：冻结层也要保留“到真实停点”的显示路径，否则出杆后
      // 只能退回旧的 reboundSegments，动态长度会在击球瞬间丢失。
      // v1.9.15：预算把蓝线清空时，快照必须保留“显式空数组”——snapshotReboundSegments([])
      // 会返回 null，而 null 会让绘制层回退到未截断的 reboundSegments，把长线又画回来。
      reboundDisplaySegments: (
        Array.isArray(t.reboundDisplaySegments) &&
        t.reboundDisplaySegments.length === 0 &&
        t.reboundBudgetLimited
      ) ? [] : snapshotReboundSegments(t.reboundDisplaySegments),
      reboundBudgetMm: Number.isFinite(Number(t.reboundBudgetMm)) ? Number(t.reboundBudgetMm) : null,
      reboundBudgetLimited: Boolean(t.reboundBudgetLimited),
      reboundRestPoint: snapshotPoint(t.reboundRestPoint),
      reboundDisplayLengthMm: Number.isFinite(Number(t.reboundDisplayLengthMm))
        ? Number(t.reboundDisplayLengthMm) : null,
      reboundRestExact: Boolean(t.reboundRestExact),
      reboundStopReason: t.reboundStopReason || null,
      reboundMeta: t.reboundMeta ? { ...t.reboundMeta } : null,
      reboundDebug: t.reboundDebug ? { ...t.reboundDebug } : null,
      pocket: t.pocket ? { ...t.pocket } : null,
      cushionHug: t.cushionHug ? { ...t.cushionHug } : null,
      cutAngleDeg: Number.isFinite(Number(t.cutAngleDeg)) ? Number(t.cutAngleDeg) : null,
      pathLengthMm: Number.isFinite(Number(t.pathLengthMm)) ? Number(t.pathLengthMm) : null,
      targetReachMm: Number.isFinite(Number(t.targetReachMm)) ? Number(t.targetReachMm) : null,
      // v1.9.17：橙色线若使用官方第一库前路径，冻结快照也必须保留这条路径，
      // 否则出杆瞬间会退回绿色几何线截断，造成橙色线突变。
      orangePath: snapshotPoints(t.orangePath),
      orangeReachMm: Number.isFinite(Number(t.orangeReachMm)) ? Number(t.orangeReachMm) : null,
      noFirstRail: Boolean(t.noFirstRail),
    } : null;
    return {
      cue: snapshotPoint(pred.cue),
      aimDir: snapshotPoint(pred.aimDir),
      target,
      balls: Array.isArray(pred.balls)
        ? pred.balls.map((b) => (b ? { id: b.id, kind: b.kind, pos: snapshotPoint(b.pos) } : null)).filter(Boolean)
        : [],
      activeBallCount: pred.activeBallCount,
      physics: Boolean(pred.physics),
      shot: pred.shot ? { ...pred.shot } : null,
      power: pred.power,
      tip: snapshotPoint(pred.tip),
      cuePost: pred.cuePost && Array.isArray(pred.cuePost.cueCushionPaths)
        ? { cueCushionPaths: pred.cuePost.cueCushionPaths.map((p) => snapshotPoints(p)).filter(Boolean) }
        : null,
      cuePostTrajectory: snapshotPoints(pred.cuePostTrajectory),
      noTargetEnd: snapshotPoint(pred.noTargetEnd),
      railHit: pred.railHit ? {
        t: pred.railHit.t,
        axis: pred.railHit.axis,
        normal: snapshotPoint(pred.railHit.normal),
        point: snapshotPoint(pred.railHit.point),
      } : null,
      unreachable: Boolean(pred.unreachable),
      cuePottedWarning: Boolean(pred.cuePottedWarning),
      enginePotted: Boolean(pred.enginePotted),
      insufficientPower: Boolean(pred.insufficientPower),
      recPower: pred.recPower,
      tableBounds: pred.tableBounds ? { ...pred.tableBounds } : null,
    };
  }

  function freezeRetainedPrediction(pred) {
    if (!pred) return null;
    const snapshot = buildRetainedSnapshot(pred);
    try {
      if (typeof structuredClone === 'function') return structuredClone(snapshot);
      return JSON.parse(JSON.stringify(snapshot));
    } catch (_) {
      try {
        return JSON.parse(JSON.stringify(snapshot));
      } catch (__) {
        return null;
      }
    }
  }

  function clearRetainedShotPrediction() {
    _retainedShotPred = null;
    _retainedCueCushionPath = null;
    _retainedCueCushionBounds = null;
  }

  // v1.9.12：把母球吃库折线单独冻结成纯点阵，出杆后只读这份路径。
  // 这样即使 _retainedShotPred 为空、predToDraw 回退到某个实时对象，
  // 蓝线也不会在运动途中被重新计算或被动态裁剪。
  function retainCueCushionPath(source) {
    _retainedCueCushionPath = null;
    _retainedCueCushionBounds = null;
    if (!source || !source.cuePost || !Array.isArray(source.cuePost.cueCushionPaths)) return;
    const path = source.cuePost.cueCushionPaths[0];
    if (!Array.isArray(path) || path.length < 2) return;
    _retainedCueCushionPath = snapshotPoints(path);
    _retainedCueCushionBounds = source.tableBounds ? { ...source.tableBounds } : null;
  }

  const hudPill = {
    el: null,
    dotEl: null,
    textEl: null,
    _lastText: '',
    _lastColor: '',
    _visible: false,

    getTargetDoc() {
      if (typeof overlay !== 'undefined' && overlay.getTargetDoc) {
        return overlay.getTargetDoc();
      }
      return (projection.canvas && projection.canvas.ownerDocument) || document;
    },

    ensure() {
      const targetDoc = this.getTargetDoc();
      if (!targetDoc || !targetDoc.body) return;

      if (this.el && this.el.isConnected && this.el.ownerDocument === targetDoc) {
        return;
      }

      // 若旧节点存在于不同文档或已失效，先彻底从 DOM 移除
      if (this.el) {
        try { this.el.remove(); } catch (_) {}
        this.el = null;
      }

      // 全局穿透清除所有跨窗口、跨 iframe 残留的孤立浮标节点，保障整个标签页绝对单例
      cleanAllOrphanHudPills(false);

      const el = targetDoc.createElement('div');
      el.id = 'snooker-aim-hud-pill';
      el.style.cssText = [
        'position: fixed !important',
        'top: 14px !important',
        'left: 50% !important',
        'transform: translateX(-50%) !important',
        'z-index: 2147483647 !important',
        'pointer-events: none !important',
        'user-select: none !important',
        '-webkit-user-select: none !important',
        'display: none',
        'align-items: center !important',
        'justify-content: center !important',
        'padding: 3px 12px 3px 9px !important',
        'height: 24px !important',
        'box-sizing: border-box !important',
        'border-radius: 12px !important',
        'background: rgba(12, 24, 18, 0.92) !important',
        'backdrop-filter: blur(8px) !important',
        '-webkit-backdrop-filter: blur(8px) !important',
        'border: 1px solid #00ff88 !important',
        'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 10px rgba(0, 255, 136, 0.25) !important',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif !important',
        'font-size: 11px !important',
        'font-weight: 600 !important',
        'color: #f2f7f2 !important',
        'white-space: nowrap !important',
        'transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease !important',
        'opacity: 0',
      ].join(';');

      const dot = targetDoc.createElement('span');
      dot.style.cssText = [
        'width: 6.5px !important',
        'height: 6.5px !important',
        'border-radius: 50% !important',
        'background: #00ff88 !important',
        'margin-right: 7px !important',
        'flex-shrink: 0 !important',
        'box-shadow: 0 0 6px #00ff88 !important',
        'transition: background 0.15s ease, box-shadow 0.15s ease !important',
      ].join(';');

      const txt = targetDoc.createElement('span');
      txt.style.cssText = [
        'line-height: 1 !important',
        'letter-spacing: 0.3px !important',
      ].join(';');

      el.appendChild(dot);
      el.appendChild(txt);
      targetDoc.body.appendChild(el);

      this.el = el;
      this.dotEl = dot;
      this.textEl = txt;
      this._lastText = '';
      this._lastColor = '';
      this._visible = false;
    },

    show(text, accentColor) {
      if (!CONFIG.showHudPill || !text) {
        this.hide();
        return;
      }
      this.ensure();
      if (!this.el) return;

      const color = accentColor || CONFIG.pocketRingColor || '#00ff88';
      if (this._lastText !== text) {
        this.textEl.textContent = text;
        this._lastText = text;
      }
      if (this._lastColor !== color) {
        this.el.style.borderColor = color;
        this.el.style.boxShadow = `0 4px 14px rgba(0, 0, 0, 0.4), 0 0 10px ${color}44`;
        this.dotEl.style.background = color;
        this.dotEl.style.boxShadow = `0 0 6px ${color}`;
        this._lastColor = color;
      }
      if (!this._visible) {
        this.el.style.display = 'inline-flex';
        void this.el.offsetWidth;
        this.el.style.opacity = '1';
        this._visible = true;
      }
    },

    hide() {
      if (this.el) {
        this.el.style.opacity = '0';
        this.el.style.display = 'none';
      }
      this._visible = false;
      this._lastText = '';
      this._lastColor = '';
    },

    destroy() {
      if (this.el) {
        try { this.el.remove(); } catch (_) {}
      }
      this.el = null;
      this.dotEl = null;
      this.textEl = null;
      this._visible = false;
      this._lastText = '';
      this._lastColor = '';
      cleanAllOrphanHudPills(false);
    }
  };

  /* ================================================================== */
  /* 击球走位动态擦除与几何裁剪辅助算法 (v1.7.5)                           */
  /* ================================================================== */

  let _cueLineCompleted = false;
  let _targetLineCompleted = false;
  let _targetMaxTravel = 0;
  let _targetReachBarCompleted = false;
  let _targetReboundCompleted = false;
  let _targetReboundEngaged = false;
  let _targetReboundMaxTravel = 0;
  let _cueCushionCompleted = false;
  let _cueCushionEngaged = false;
  let _cueCushionMaxTravel = 0;
  let _lastCueCushionPred = null;
  let _trackedTargetBallId = null;
  let _trackedTargetPos = null;

  function resetCueMotionState() {
    _cueLineCompleted = false;
    _cueCushionCompleted = false;
    _cueCushionEngaged = false;
    _cueCushionMaxTravel = 0;
  }

  function resetTargetMotionState() {
    _targetLineCompleted = false;
    _targetMaxTravel = 0;
    _targetReachBarCompleted = false;
    _targetReboundCompleted = false;
    _targetReboundEngaged = false;
    _targetReboundMaxTravel = 0;
    _trackedTargetBallId = null;
    _trackedTargetPos = null;
  }

  function extractBallPos(b) {
    if (!b) return null;
    if (b.pos && Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)) return { x: b.pos.x, y: b.pos.y };
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) return { x: b.x, y: b.y };
    if (b.position && Number.isFinite(b.position.x) && Number.isFinite(b.position.y)) return { x: b.position.x, y: b.position.y };
    return null;
  }

  /* ================================================================== */
  /* 点与折线欧氏几何工具函数 (用于真实走位与预测折线距离误差计算)        */
  /* ================================================================== */

  function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
  }

  function distPointToPolyline(p, polyline) {
    if (!p || !Array.isArray(polyline) || polyline.length === 0) return 0;
    if (polyline.length === 1) return Math.hypot(p.x - polyline[0].x, p.y - polyline[0].y);
    let minDistSq = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      const dSq = distToSegmentSquared(p, polyline[i], polyline[i + 1]);
      if (dSq < minDistSq) minDistSq = dSq;
    }
    return Math.sqrt(minDistSq);
  }

  /* ================================================================== */
  /* 真实走位 vs 蓝色落位预测线 录制与对比导出引擎 (v1.7.7)                 */
  /* ================================================================== */

  const TrajectoryRecorder = {
    isRecording: false,
    records: [],
    activeSession: null,

    toggleRecording() {
      this.isRecording = !this.isRecording;
      if (this.isRecording) {
        showToast('🔴 已开启轨迹录制，击打目标球将自动记录走位', 1800);
      } else {
        const count = this.records.length;
        showToast(`⏹️ 已停止轨迹录制 (当前已存 ${count} 杆数据)`, 1800);
      }
      if (ui && typeof ui.updateRecordButtons === 'function') {
        ui.updateRecordButtons();
      }
    },

    onShotStart(state, pred) {
      if (!this.isRecording) return;
      if (!pred) return;

      const cueBall = getCueBall(state);
      const cuePos = extractBallPos(cueBall) || (pred.cue ? { x: pred.cue.x, y: pred.cue.y } : null);
      if (!cuePos) return;

      const targetBall = pred.target?.ball || null;
      const targetPos = targetBall ? extractBallPos(targetBall) : null;
      const targetId = targetBall ? (targetBall.id != null ? String(targetBall.id) : null) : null;

      // 提取蓝色走位预测线的折线点序列
      const blueLineTrajectory = Array.isArray(pred.cuePostTrajectory)
        ? pred.cuePostTrajectory.map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) }))
        : [];
      const blueRestPos = pred.cueRestPos
        ? { x: Number(pred.cueRestPos.x.toFixed(2)), y: Number(pred.cueRestPos.y.toFixed(2)) }
        : (blueLineTrajectory.length > 0 ? blueLineTrajectory[blueLineTrajectory.length - 1] : null);

      // 目标球预测折线
      const predictedObjectPath = (pred.target && Array.isArray(pred.target.objectPath))
        ? pred.target.objectPath.map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) }))
        : [];
      const predictedTargetReboundSegments = (pred.target
        && Array.isArray(pred.target.reboundDisplaySegments || pred.target.reboundSegments))
        ? (pred.target.reboundDisplaySegments || pred.target.reboundSegments).map((seg) => ({
          from: seg.from ? { x: Number(seg.from.x.toFixed(2)), y: Number(seg.from.y.toFixed(2)) } : null,
          to: seg.to ? { x: Number(seg.to.x.toFixed(2)), y: Number(seg.to.y.toFixed(2)) } : null,
          axis: seg.axis || null,
        }))
        : [];
      const predictedTargetReboundPath = (() => {
        const out = [];
        const push = (p) => {
          if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return;
          const last = out[out.length - 1];
          if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) out.push({ x: Number(p.x), y: Number(p.y) });
        };
        for (const p of predictedObjectPath) push(p);
        for (const seg of predictedTargetReboundSegments) {
          push(seg.from);
          push(seg.to);
        }
        return out;
      })();

      this.activeSession = {
        shotId: this.records.length + 1,
        startTimeMs: performance.now(),
        dateStr: new Date().toISOString(),
        shotParams: {
          power: Math.round(Number(pred.shot?.power ?? pred.power ?? 0)),
          tip: pred.tip ? { x: Number(Number(pred.tip.x || 0).toFixed(3)), y: Number(Number(pred.tip.y || 0).toFixed(3)) } : { x: 0, y: 0 },
          aimDir: pred.aimDir ? { x: Number(Number(pred.aimDir.x || 0).toFixed(3)), y: Number(Number(pred.aimDir.y || 0).toFixed(3)) } : null,
          cutAngleDeg: pred.target?.cutAngleDeg != null ? Math.round(pred.target.cutAngleDeg) : null,
          targetPocket: pred.target?.pocket?.label || null,
          method: pred.cuePostMethod || (pred.cuePostTrajectory && pred.cuePostTrajectory.length > 4 ? 'engineSim' : 'algo'),
        },
        predicted: {
          contactPoint: pred.target?.contact ? { x: Number(pred.target.contact.x.toFixed(2)), y: Number(pred.target.contact.y.toFixed(2)) } : null,
          cueRestPos: blueRestPos,
          cuePostTrajectory: blueLineTrajectory,
          objectPath: predictedObjectPath,
          targetReboundSegments: predictedTargetReboundSegments,
          targetReboundPath: predictedTargetReboundPath,
          targetFirstRailPoint: pred.target?.objectEnd ? { x: Number(pred.target.objectEnd.x.toFixed(2)), y: Number(pred.target.objectEnd.y.toFixed(2)) } : null,
          targetReboundMeta: pred.target?.reboundMeta ? { ...pred.target.reboundMeta, hitBall: undefined } : null,
          targetBall: targetBall ? { id: targetId, kind: kindLabel(targetBall.kind) } : null,
        },
        actual: {
          initialCuePos: { x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) },
          initialTargetPos: targetPos ? { x: Number(targetPos.x.toFixed(2)), y: Number(targetPos.y.toFixed(2)) } : null,
          cueTotalPath: [{ tMs: 0, x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) }],
          cuePostImpactPath: [], // 碰球后的真实母球走位轨迹点序列
          targetBallPath: targetPos ? [{ tMs: 0, x: Number(targetPos.x.toFixed(2)), y: Number(targetPos.y.toFixed(2)) }] : [],
          impactOccurred: false,
          impactTimeMs: null,
          impactCuePos: null,
          impactTargetPos: null,
          finalCueRestPos: null,
          finalTargetRestPos: null,
          targetPotted: false,
        },
        targetId: targetId,
      };
    },

    onFrame(state) {
      if (!this.isRecording || !this.activeSession) return;
      const s = this.activeSession;
      const now = performance.now();
      const elapsedMs = Math.round(now - s.startTimeMs);

      const cueBall = getCueBall(state);
      const cuePos = extractBallPos(cueBall);
      if (cuePos) {
        const curCue = { tMs: elapsedMs, x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) };
        const lastCue = s.actual.cueTotalPath[s.actual.cueTotalPath.length - 1];
        if (!lastCue || Math.hypot(curCue.x - lastCue.x, curCue.y - lastCue.y) >= 0.5) {
          s.actual.cueTotalPath.push(curCue);
        }
      }

      // 跟踪目标球
      let targetBall = null;
      if (s.targetId != null && Array.isArray(state?.balls)) {
        targetBall = state.balls.find((b) => b && (String(b.id) === s.targetId));
      }
      const targetPos = targetBall ? extractBallPos(targetBall) : null;
      if (targetPos) {
        const curTarget = { tMs: elapsedMs, x: Number(targetPos.x.toFixed(2)), y: Number(targetPos.y.toFixed(2)) };
        const lastTarget = s.actual.targetBallPath[s.actual.targetBallPath.length - 1];
        if (!lastTarget || Math.hypot(curTarget.x - lastTarget.x, curTarget.y - lastTarget.y) >= 0.5) {
          s.actual.targetBallPath.push(curTarget);
        }
      }

      // 检测撞击目标球的瞬间 (Impact Detection)
      if (!s.actual.impactOccurred && cuePos && targetPos) {
        const dist = Math.hypot(cuePos.x - targetPos.x, cuePos.y - targetPos.y);
        const targetInit = s.actual.initialTargetPos;
        const targetMoved = targetInit ? Math.hypot(targetPos.x - targetInit.x, targetPos.y - targetInit.y) : 0;
        // 碰撞判据：中心距离达到两球半径 (<= 53.5mm) 或目标球产生位移 (> 1.2mm)
        if (dist <= (BALL_RADIUS_MM * 2 + 1.2) || targetMoved > 1.2) {
          s.actual.impactOccurred = true;
          s.actual.impactTimeMs = elapsedMs;
          s.actual.impactCuePos = { x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) };
          s.actual.impactTargetPos = { x: Number(targetPos.x.toFixed(2)), y: Number(targetPos.y.toFixed(2)) };
          s.actual.cuePostImpactPath.push({ tMs: elapsedMs, x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) });
        }
      } else if (s.actual.impactOccurred && cuePos) {
        // 撞击发生之后：实时记录击打目标球之后的母球实际走位轨迹点
        const curCue = { tMs: elapsedMs, x: Number(cuePos.x.toFixed(2)), y: Number(cuePos.y.toFixed(2)) };
        const lastPost = s.actual.cuePostImpactPath[s.actual.cuePostImpactPath.length - 1];
        if (!lastPost || Math.hypot(curCue.x - lastPost.x, curCue.y - lastPost.y) >= 0.5) {
          s.actual.cuePostImpactPath.push(curCue);
        }
      }
    },

    computeMetrics(session) {
      const pred = session.predicted;
      const actual = session.actual;

      // 1. 最终落位距离误差 (mm)
      let finalRestErrorMm = null;
      let deltaXMm = null;
      let deltaYMm = null;
      if (actual.finalCueRestPos && pred.cueRestPos) {
        deltaXMm = Number((actual.finalCueRestPos.x - pred.cueRestPos.x).toFixed(2));
        deltaYMm = Number((actual.finalCueRestPos.y - pred.cueRestPos.y).toFixed(2));
        finalRestErrorMm = Number(Math.hypot(deltaXMm, deltaYMm).toFixed(2));
      }

      // 2. 假想球撞击点误差 (mm)
      let contactPointErrorMm = null;
      if (actual.impactCuePos && pred.contactPoint) {
        contactPointErrorMm = Number(Math.hypot(
          actual.impactCuePos.x - pred.contactPoint.x,
          actual.impactCuePos.y - pred.contactPoint.y
        ).toFixed(2));
      }

      // 3. 走位轨迹与蓝色预测折线离线偏离度 (mm)
      const postPath = (actual.cuePostImpactPath && actual.cuePostImpactPath.length > 0)
        ? actual.cuePostImpactPath
        : actual.cueTotalPath;
      const blueLine = pred.cuePostTrajectory || [];

      let maxTrajectoryDeviationMm = 0;
      let meanTrajectoryDeviationMm = 0;
      if (postPath.length > 0 && blueLine.length >= 2) {
        let totalDev = 0;
        let maxDev = 0;
        for (const pt of postPath) {
          const dev = distPointToPolyline(pt, blueLine);
          totalDev += dev;
          if (dev > maxDev) maxDev = dev;
        }
        meanTrajectoryDeviationMm = Number((totalDev / postPath.length).toFixed(2));
        maxTrajectoryDeviationMm = Number(maxDev.toFixed(2));
      }

      // 4. 行进总路程对比 (mm)
      let actualTravelLengthMm = 0;
      for (let i = 1; i < postPath.length; i++) {
        actualTravelLengthMm += Math.hypot(postPath[i].x - postPath[i - 1].x, postPath[i].y - postPath[i - 1].y);
      }
      actualTravelLengthMm = Number(actualTravelLengthMm.toFixed(1));

      let predictedTravelLengthMm = 0;
      for (let i = 1; i < blueLine.length; i++) {
        predictedTravelLengthMm += Math.hypot(blueLine[i].x - blueLine[i - 1].x, blueLine[i].y - blueLine[i - 1].y);
      }
      predictedTravelLengthMm = Number(predictedTravelLengthMm.toFixed(1));

      // 目标球吃库反弹折线 vs 真实目标球轨迹
      const targetPredPath = Array.isArray(pred.targetReboundPath) ? pred.targetReboundPath : [];
      const targetActualAll = Array.isArray(actual.targetBallPath) ? actual.targetBallPath : [];
      const targetActualPost = actual.impactTimeMs != null
        ? targetActualAll.filter((p) => p.tMs >= actual.impactTimeMs)
        : targetActualAll;
      let targetReboundMaxDeviationMm = null;
      let targetReboundMeanDeviationMm = null;
      let targetFirstRailErrorMm = null;
      let targetActualTravelLengthMm = 0;
      let targetPredictedTravelLengthMm = 0;
      if (targetActualPost.length > 0 && targetPredPath.length >= 2) {
        let totalDev = 0;
        let maxDev = 0;
        for (const pt of targetActualPost) {
          const dev = distPointToPolyline(pt, targetPredPath);
          totalDev += dev;
          if (dev > maxDev) maxDev = dev;
        }
        targetReboundMeanDeviationMm = Number((totalDev / targetActualPost.length).toFixed(2));
        targetReboundMaxDeviationMm = Number(maxDev.toFixed(2));
      }
      if (pred.targetFirstRailPoint && targetActualPost.length > 0) {
        let minDist = Infinity;
        for (const pt of targetActualPost) {
          const d = Math.hypot(pt.x - pred.targetFirstRailPoint.x, pt.y - pred.targetFirstRailPoint.y);
          if (d < minDist) minDist = d;
        }
        if (Number.isFinite(minDist)) targetFirstRailErrorMm = Number(minDist.toFixed(2));
      }
      for (let i = 1; i < targetActualPost.length; i++) {
        targetActualTravelLengthMm += Math.hypot(
          targetActualPost[i].x - targetActualPost[i - 1].x,
          targetActualPost[i].y - targetActualPost[i - 1].y
        );
      }
      for (let i = 1; i < targetPredPath.length; i++) {
        targetPredictedTravelLengthMm += Math.hypot(
          targetPredPath[i].x - targetPredPath[i - 1].x,
          targetPredPath[i].y - targetPredPath[i - 1].y
        );
      }
      targetActualTravelLengthMm = Number(targetActualTravelLengthMm.toFixed(1));
      targetPredictedTravelLengthMm = Number(targetPredictedTravelLengthMm.toFixed(1));

      // 5. 综合吻合度等级判定
      let accuracyRating = '未知';
      if (Number.isFinite(finalRestErrorMm)) {
        if (finalRestErrorMm < 15) accuracyRating = '🎯 极高吻合 (<15mm)';
        else if (finalRestErrorMm < 35) accuracyRating = '🟢 良好吻合 (<35mm)';
        else if (finalRestErrorMm < 70) accuracyRating = '🟡 中度吻合 (<70mm)';
        else accuracyRating = '🔴 偏差较大 (≥70mm)';
      }

      return {
        finalRestErrorMm,
        deltaXMm,
        deltaYMm,
        contactPointErrorMm,
        maxTrajectoryDeviationMm,
        meanTrajectoryDeviationMm,
        actualTravelLengthMm,
        predictedTravelLengthMm,
        travelLengthDiffMm: Number((actualTravelLengthMm - predictedTravelLengthMm).toFixed(1)),
        targetReboundMaxDeviationMm,
        targetReboundMeanDeviationMm,
        targetFirstRailErrorMm,
        targetActualTravelLengthMm,
        targetPredictedTravelLengthMm,
        targetTravelLengthDiffMm: Number((targetActualTravelLengthMm - targetPredictedTravelLengthMm).toFixed(1)),
        accuracyRating,
      };
    },

    onShotEnd(state) {
      if (!this.isRecording || !this.activeSession) return;
      const s = this.activeSession;
      this.activeSession = null;

      const cueBall = getCueBall(state);
      const finalCuePos = extractBallPos(cueBall);
      if (finalCuePos) {
        s.actual.finalCueRestPos = { x: Number(finalCuePos.x.toFixed(2)), y: Number(finalCuePos.y.toFixed(2)) };
      } else if (s.actual.cueTotalPath.length > 0) {
        const last = s.actual.cueTotalPath[s.actual.cueTotalPath.length - 1];
        s.actual.finalCueRestPos = { x: last.x, y: last.y };
      }

      let targetBall = null;
      if (s.targetId != null && Array.isArray(state?.balls)) {
        targetBall = state.balls.find((b) => b && (String(b.id) === s.targetId));
      }
      if (targetBall) {
        s.actual.targetPotted = Boolean(targetBall.potted);
        const tPos = extractBallPos(targetBall);
        if (tPos) s.actual.finalTargetRestPos = { x: Number(tPos.x.toFixed(2)), y: Number(tPos.y.toFixed(2)) };
      }

      // 如果未曾触发碰撞判定，以母球与目标球距离最近点兜底切分
      if (!s.actual.impactOccurred && s.actual.initialTargetPos) {
        let minDist = Infinity;
        let bestIdx = 0;
        const tInit = s.actual.initialTargetPos;
        for (let i = 0; i < s.actual.cueTotalPath.length; i++) {
          const pt = s.actual.cueTotalPath[i];
          const d = Math.hypot(pt.x - tInit.x, pt.y - tInit.y);
          if (d < minDist) {
            minDist = d;
            bestIdx = i;
          }
        }
        if (minDist <= BALL_RADIUS_MM * 2 + 10) {
          s.actual.impactOccurred = true;
          s.actual.impactCuePos = { x: s.actual.cueTotalPath[bestIdx].x, y: s.actual.cueTotalPath[bestIdx].y };
          s.actual.cuePostImpactPath = s.actual.cueTotalPath.slice(bestIdx);
        }
      }

      // 确保撞击后轨迹末端包含停球终点
      if (s.actual.finalCueRestPos && s.actual.cuePostImpactPath.length > 0) {
        const lastPost = s.actual.cuePostImpactPath[s.actual.cuePostImpactPath.length - 1];
        if (Math.hypot(lastPost.x - s.actual.finalCueRestPos.x, lastPost.y - s.actual.finalCueRestPos.y) > 0.1) {
          s.actual.cuePostImpactPath.push({
            tMs: Math.round(performance.now() - s.startTimeMs),
            x: s.actual.finalCueRestPos.x,
            y: s.actual.finalCueRestPos.y,
          });
        }
      }

      // 计算量化对比指标
      s.comparisonMetrics = this.computeMetrics(s);

      // 归档存入记录列表
      this.records.push(s);

      // 更新界面按钮状态与调试信息
      if (ui && typeof ui.updateRecordButtons === 'function') {
        ui.updateRecordButtons();
      }

      const err = s.comparisonMetrics?.finalRestErrorMm;
      const errStr = err != null ? `${err.toFixed(1)}mm` : '未知';
      showToast(`🎯 已记录第 ${this.records.length} 杆走位 (母球落位误差: ${errStr})`, 2200);
      console.log(`[SnookerAimAssistant] 击球录制 #${s.shotId} 完成:`, s);
    },

    exportRecords() {
      if (this.records.length === 0) {
        showToast('⚠️ 暂无录制的击球数据，请先击球录制', 1800);
        return;
      }

      const errors = this.records.map((r) => r.comparisonMetrics?.finalRestErrorMm).filter(Number.isFinite);
      const avgError = errors.length ? (errors.reduce((a, b) => a + b, 0) / errors.length) : 0;
      const maxError = errors.length ? Math.max(...errors) : 0;
      const minError = errors.length ? Math.min(...errors) : 0;

      const exportData = {
        title: '斯诺克大师 - 真实轨迹 vs 蓝色走位预测线对比记录',
        version: SCRIPT_VERSION,
        exportTime: new Date().toISOString(),
        totalShots: this.records.length,
        summary: {
          averageRestErrorMm: Number(avgError.toFixed(2)),
          maxRestErrorMm: Number(maxError.toFixed(2)),
          minRestErrorMm: Number(minError.toFixed(2)),
        },
        shots: this.records,
      };

      try {
        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `snooker-trajectory-compare-${nowStr}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(url);
        }, 1500);

        showToast(`✅ 成功导出 ${this.records.length} 杆对比记录文件！`, 2500);
        console.table(this.records.map((r) => ({
          '杆号': r.shotId,
          '出杆力度': `${r.shotParams.power}%`,
          '预测落位(X,Y)': `(${r.predicted.cueRestPos?.x}, ${r.predicted.cueRestPos?.y})`,
          '实际落位(X,Y)': `(${r.actual.finalCueRestPos?.x}, ${r.actual.finalCueRestPos?.y})`,
          '落位距离误差': `${r.comparisonMetrics?.finalRestErrorMm?.toFixed(1)}mm`,
          '走位平均偏差': `${r.comparisonMetrics?.meanTrajectoryDeviationMm?.toFixed(1)}mm`,
          '评定': r.comparisonMetrics?.accuracyRating || '-',
        })));
      } catch (err) {
        console.error('导出轨迹数据失败:', err);
        showToast('❌ 导出失败，请检查浏览器权限', 2000);
      }
    },
  };

  /**
   * 计算母球瞄准线随母球向前行进的动态裁剪线段：
   * 母球向前滚动时，瞄准线从母球实时球心画到假想球接触点（已走过的后方路径被擦除）；
   * 当母球物理行进到达接触点（或大幅侧向偏角走位），白色瞄准线彻底完成消失（返回 null）。
   */
  function trimCueAimLineFromLive(cueStart, contactEnd, liveCuePos) {
    if (!cueStart || !contactEnd) return null;
    if (_cueLineCompleted) return null;

    const dx = contactEnd.x - cueStart.x;
    const dy = contactEnd.y - cueStart.y;
    const totalLen = Math.hypot(dx, dy);
    if (totalLen < 1) return null;

    if (!liveCuePos) {
      return _cueLineCompleted ? null : { start: cueStart, end: contactEnd, showGhost: true };
    }

    const ux = dx / totalLen;
    const uy = dy / totalLen;
    // 投影母球在瞄准线方向的前进距离 t
    const relX = liveCuePos.x - cueStart.x;
    const relY = liveCuePos.y - cueStart.y;
    const t = relX * ux + relY * uy;

    // 若母球偏离瞄准线横向距离过大 (> 50mm) 且向前有实质位移 (t > 20mm)，说明已撞击目标球并发生侧向走位/吃库反弹，白线彻底完成
    const lateralDistSq = (relX - t * ux) ** 2 + (relY - t * uy) ** 2;
    if (lateralDistSq > 50 * 50 && t > 20) {
      _cueLineCompleted = true;
      return null;
    }

    // 若母球尚未明显移动 (t <= 5mm)，画全长线段并显示假想球
    if (t <= 5) {
      return { start: cueStart, end: contactEnd, showGhost: true };
    }

    // 若母球已经到达或撞击目标球 (t >= totalLen - (BALL_RADIUS_MM || 26.25))，白色线与假想球彻底消失
    if (t >= totalLen - (BALL_RADIUS_MM || 26.25)) {
      _cueLineCompleted = true;
      return null;
    }

    // 母球向前运动中：起点移至母球当前实时位置，假想球在撞击前依然显示
    return {
      start: { x: liveCuePos.x, y: liveCuePos.y },
      end: contactEnd,
      showGhost: true
    };
  }

  /**
   * 母球吃库反弹折线动态擦除：
   * 路径起点为第一库接触点。母球到达第一库前保持全段；
   * 过第一库后，折线起点跟随母球实时位置向后吞噬；
   * 母球接近第二库终点或偏离路径过大时终结。
   */
  function trimCueCushionPathFromLive(originalPath, liveCuePos) {
    if (!Array.isArray(originalPath) || originalPath.length < 2) return null;
    if (_cueCushionCompleted) return null;

    const startPt = originalPath[0];
    const endPt = originalPath[originalPath.length - 1];

    if (!liveCuePos) return originalPath;

    // 关键：折线起点在第一库接触点，路径本身会横穿台面，母球在出杆初始
    // 位置可能恰好投影到中段。未到达第一库前绝不能按投影裁剪，否则会一杆出
    // 手就被误判成「已经走完大半」，表现就是蓝线瞬间消失。
    if (!_cueCushionEngaged) {
      // 白色瞄准线已经走完，说明母球已到达第一库接触点；即使实际接触点
      // 与预测点有少量偏差，也直接进入反弹擦除阶段。
      if (_cueLineCompleted) {
        _cueCushionEngaged = true;
        _cueCushionMaxTravel = 0;
      } else {
        const distToStart = Math.hypot(liveCuePos.x - startPt.x, liveCuePos.y - startPt.y);
        if (distToStart > 35) return originalPath;
        _cueCushionEngaged = true;
        _cueCushionMaxTravel = 0;
      }
    }

    let bestSegmentIdx = -1;
    let bestDistSq = Infinity;
    let accumulatedLen = 0;
    let projTravel = 0;
    let totalLen = 0;

    for (let i = 0; i < originalPath.length - 1; i++) {
      const p1 = originalPath[i];
      const p2 = originalPath[i + 1];
      const segDx = p2.x - p1.x;
      const segDy = p2.y - p1.y;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 1e-4) continue;

      let t = ((liveCuePos.x - p1.x) * segDx + (liveCuePos.y - p1.y) * segDy) / (segLen * segLen);
      t = clamp(t, 0, 1);
      const projX = p1.x + t * segDx;
      const projY = p1.y + t * segDy;
      const dSq = (liveCuePos.x - projX) ** 2 + (liveCuePos.y - projY) ** 2;

      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSegmentIdx = i;
        projTravel = accumulatedLen + t * segLen;
      }
      accumulatedLen += segLen;
    }
    totalLen = accumulatedLen;

    if (projTravel > _cueCushionMaxTravel) {
      _cueCushionMaxTravel = projTravel;
    }

    // 异常折返：母球沿折线大幅倒退，直接终结，避免残线重新出现。
    if (_cueCushionMaxTravel > 120 && projTravel < _cueCushionMaxTravel - 15) {
      _cueCushionCompleted = true;
      return null;
    }

    // 母球还在飞向第一库：投影会钳制在路径起点，保持完整两库折线。
    if (projTravel <= 5) return originalPath;

    // 过第一库后明显偏离预测反弹路径（例如撞到中途球或被实际物理修正）。
    if (bestDistSq > 70 * 70 && projTravel > 20) {
      _cueCushionCompleted = true;
      return null;
    }

    if (bestSegmentIdx < 0) {
      _cueCushionCompleted = true;
      return null;
    }

    // 母球已经走到第二库终点附近：整条折线吃完，不再留下残段。
    if (Math.hypot(liveCuePos.x - endPt.x, liveCuePos.y - endPt.y) <= 30 ||
        totalLen - projTravel <= 20) {
      _cueCushionCompleted = true;
      return null;
    }

    // 从母球实时位置开始保留尚未走过的折线，形成白线/绿线同款单向吞噬。
    const trimmed = [{ x: liveCuePos.x, y: liveCuePos.y }];
    for (let i = bestSegmentIdx + 1; i < originalPath.length; i++) {
      trimmed.push({ x: originalPath[i].x, y: originalPath[i].y });
    }
    return trimmed.length >= 2 ? trimmed : null;
  }

  /**
   * 目标球吃库反弹折线的动态裁剪：
   * 目标球尚未到达第一库时保留全长；
   * 目标球进入第一库后，从其实时位置开始保留未走的反弹段；
   * 只有目标球落袋或真正走完预测反弹路径时才彻底销毁，避免残留。
   */
  function trimTargetReboundFromLive(segments, liveTargetPos, isTargetPotted) {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    if (_targetReboundCompleted || isTargetPotted) {
      _targetReboundCompleted = true;
      return null;
    }

    const path = [];
    for (const seg of segments) {
      if (!seg || !seg.from || !seg.to) continue;
      if (!path.length) path.push({ x: seg.from.x, y: seg.from.y });
      const last = path[path.length - 1];
      if (Math.hypot(seg.to.x - last.x, seg.to.y - last.y) > 1e-4) {
        path.push({ x: seg.to.x, y: seg.to.y });
      }
    }
    if (path.length < 2) return null;

    if (!liveTargetPos) return path;

    const startPt = path[0];
    const endPt = path[path.length - 1];

    // 目标球还没走到第一库接触点时，反弹折线保持完整；这与母球蓝线
    // 在到达第一库前不被提前裁剪的处理一致。
    if (!_targetReboundEngaged) {
      const distToStart = Math.hypot(liveTargetPos.x - startPt.x, liveTargetPos.y - startPt.y);
      if (distToStart > 35) return path;
      _targetReboundEngaged = true;
      _targetReboundMaxTravel = 0;
    }

    let bestSegmentIdx = -1;
    let bestT = 0;
    let bestDistSq = Infinity;
    let accumulatedLen = 0;
    let projTravel = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const segDx = p2.x - p1.x;
      const segDy = p2.y - p1.y;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 1e-4) continue;

      let t = ((liveTargetPos.x - p1.x) * segDx + (liveTargetPos.y - p1.y) * segDy) / (segLen * segLen);
      t = clamp(t, 0, 1);
      const projX = p1.x + t * segDx;
      const projY = p1.y + t * segDy;
      const dSq = (liveTargetPos.x - projX) ** 2 + (liveTargetPos.y - projY) ** 2;

      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSegmentIdx = i;
        bestT = t;
        projTravel = accumulatedLen + t * segLen;
      }
      accumulatedLen += segLen;
    }

    if (projTravel > _targetReboundMaxTravel) {
      _targetReboundMaxTravel = projTravel;
    }

    // 目标球与预测反弹线存在少量横向偏差时，不再提前判定完成。
    // 实际目标球受库边摩擦/旋转影响，轨迹不会与几何预测完全重合；
    // 之前在这里直接 completed，会导致蓝线还没走到终点就消失。
    // 仅保留“目标球落袋”和“真正到达路径终点”两种完成条件。

    if (bestSegmentIdx < 0) {
      return path;
    }

    // 目标球已到反弹路径终点（下一库/袋口）。阈值收紧到 6mm，
    // 避免球离终点还有一个球半径时就提前清空折线。
    const distToEnd = Math.hypot(liveTargetPos.x - endPt.x, liveTargetPos.y - endPt.y);
    if (distToEnd <= 6 || accumulatedLen - projTravel <= 6) {
      _targetReboundCompleted = true;
      return null;
    }

    if (projTravel <= 5) return path;

    // 从目标球实时位置开始，保留尚未走过的反弹路径，形成与母球蓝线
    // 同款的单向吞噬擦除。
    const trimmed = [{ x: liveTargetPos.x, y: liveTargetPos.y }];
    for (let i = bestSegmentIdx + 1; i < path.length; i++) {
      trimmed.push({ x: path[i].x, y: path[i].y });
    }
    return trimmed.length >= 2 ? trimmed : null;
  }

  /**
   * 计算目标球瞄准折线/直线随目标球向前行进的动态裁剪折线：
   * 目标球被撞动前（母球飞行阶段），100% 完整全长保留；
   * 目标球受撞向前行进时，起点跟随目标球推进，后方路径动态擦除；
   * 目标球走完现有瞄准线（到达袋口、进袋、或未进袋撞库反弹）后，立即彻底消失，弹库后绝不绘制任何残影。
   */
  function trimObjectPathFromLive(originalPath, liveTargetPos, isTargetPotted) {
    if (!Array.isArray(originalPath) || originalPath.length < 2) return null;
    // 若已走完或已进袋，永久销毁，杜绝弹库后重新画线
    if (_targetLineCompleted || isTargetPotted) {
      _targetLineCompleted = true;
      return null;
    }

    const startPt = originalPath[0];
    const endPt = originalPath[originalPath.length - 1];

    if (!liveTargetPos) {
      return _targetLineCompleted ? null : originalPath;
    }

    // 判断目标球是否已明显离开初始碰撞点 (> 6mm)
    const movedDist = Math.hypot(liveTargetPos.x - startPt.x, liveTargetPos.y - startPt.y);
    if (movedDist <= 6) {
      // 目标球尚未被撞动（母球正向其移动中）：绿色瞄准线 100% 完整保留显示！
      return originalPath;
    }

    // 1. 到达路径终点（袋口/库边）附近才判定走完。原先 30mm 的提前量
    // 会让目标球尚未到终点时绿色线就消失，必须收紧到接触终点本身。
    const distToEnd = Math.hypot(liveTargetPos.x - endPt.x, liveTargetPos.y - endPt.y);
    if (distToEnd <= 1.5) {
      _targetLineCompleted = true;
      return null;
    }

    // 在折线中寻找目标球当前的投影点与沿线累加位移
    let bestSegmentIdx = -1;
    let bestT = 0;
    let bestDistSq = Infinity;
    let accumulatedLen = 0;
    let projTravel = 0;

    for (let i = 0; i < originalPath.length - 1; i++) {
      const p1 = originalPath[i];
      const p2 = originalPath[i + 1];
      const segDx = p2.x - p1.x;
      const segDy = p2.y - p1.y;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 1e-4) continue;

      let t = ((liveTargetPos.x - p1.x) * segDx + (liveTargetPos.y - p1.y) * segDy) / (segLen * segLen);
      t = clamp(t, 0, 1);
      const projX = p1.x + t * segDx;
      const projY = p1.y + t * segDy;
      const dSq = (liveTargetPos.x - projX) ** 2 + (liveTargetPos.y - projY) ** 2;

      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSegmentIdx = i;
        bestT = t;
        projTravel = accumulatedLen + t * segLen;
      }
      accumulatedLen += segLen;
    }

    // 记录最大向前投影行程
    if (projTravel > _targetMaxTravel) {
      _targetMaxTravel = projTravel;
    }

    // 2. 偏离路径过大 (> 60mm) 且已开始运动 (> 40mm)：说明目标球发生撞库反弹或大幅偏角变线，绿色线彻底终结！
    if (bestDistSq > 60 * 60 && movedDist > 40) {
      _targetLineCompleted = true;
      return null;
    }

    // 3. 目标球曾经向前移动超过 60mm，而当前投影距离比历史最大距离倒退超过 15mm（碰库反弹折返），立即销毁！
    if (_targetMaxTravel > 60 && projTravel < _targetMaxTravel - 15) {
      _targetLineCompleted = true;
      return null;
    }

    // 4. 只有目标球真正走到路径尽头（剩余距离 <= 1.5mm）才结束。
    if (accumulatedLen - projTravel <= 1.5) {
      _targetLineCompleted = true;
      return null;
    }

    if (bestSegmentIdx < 0) {
      _targetLineCompleted = true;
      return null;
    }

    // 构建裁剪后的路径：首点使用实时目标球位置，后续保留未走过的路径节点
    const trimmed = [{ x: liveTargetPos.x, y: liveTargetPos.y }];
    for (let i = bestSegmentIdx + 1; i < originalPath.length; i++) {
      trimmed.push(originalPath[i]);
    }
    return trimmed.length >= 2 ? trimmed : null;
  }

  /**
   * 橙色力度条专用擦除：与绿色瞄准线同观感，但使用独立完成状态，
   * 不污染绿色线的 _targetMaxTravel / _targetLineCompleted 判定。
   * 橙条终点只是当前力度下的预计停点，可能早于绿线终点（袋口/库边）。
   */
  function trimTargetReachBarFromLive(originalPath, liveTargetPos, isTargetPotted) {
    if (!Array.isArray(originalPath) || originalPath.length < 2) return null;
    if (_targetLineCompleted || _targetReachBarCompleted || isTargetPotted) {
      _targetReachBarCompleted = true;
      return null;
    }
    if (!liveTargetPos) return originalPath;

    const startPt = originalPath[0];
    const endPt = originalPath[originalPath.length - 1];
    const movedDist = Math.hypot(liveTargetPos.x - startPt.x, liveTargetPos.y - startPt.y);
    if (movedDist <= 6) return originalPath;

    const distToEnd = Math.hypot(liveTargetPos.x - endPt.x, liveTargetPos.y - endPt.y);
    if (distToEnd <= 1.5) {
      _targetReachBarCompleted = true;
      return null;
    }

    let bestSegmentIdx = -1;
    let bestDistSq = Infinity;
    let accumulatedLen = 0;
    let projTravel = 0;

    for (let i = 0; i < originalPath.length - 1; i++) {
      const p1 = originalPath[i];
      const p2 = originalPath[i + 1];
      const segDx = p2.x - p1.x;
      const segDy = p2.y - p1.y;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 1e-4) continue;

      let t = ((liveTargetPos.x - p1.x) * segDx + (liveTargetPos.y - p1.y) * segDy) / (segLen * segLen);
      t = clamp(t, 0, 1);
      const projX = p1.x + t * segDx;
      const projY = p1.y + t * segDy;
      const dSq = (liveTargetPos.x - projX) ** 2 + (liveTargetPos.y - projY) ** 2;

      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSegmentIdx = i;
        projTravel = accumulatedLen + t * segLen;
      }
      accumulatedLen += segLen;
    }

    if (bestDistSq > 60 * 60 && movedDist > 40) {
      _targetReachBarCompleted = true;
      return null;
    }
    if (accumulatedLen - projTravel <= 1.5) {
      _targetReachBarCompleted = true;
      return null;
    }
    if (bestSegmentIdx < 0) {
      _targetReachBarCompleted = true;
      return null;
    }

    const trimmed = [{ x: liveTargetPos.x, y: liveTargetPos.y }];
    for (let i = bestSegmentIdx + 1; i < originalPath.length; i++) {
      trimmed.push(originalPath[i]);
    }
    return trimmed.length >= 2 ? trimmed : null;
  }

  /**
   * v1.9.8：按固定世界距离把折线采样成短段。
   * 目标球反弹线经常是一条第一库→第二库的整台长段，直接交给 projectPolyline
   * 时会被 3 倍画布跳变保护整段丢弃；采样后只可能丢失局部，不会整线消失。
   */
  function samplePolylineByDistance(points, stepMm = 50, maxPoints = 600) {
    if (!Array.isArray(points) || points.length < 2) return points;
    const step = Math.max(10, Number(stepMm) || 50);
    const limit = Math.max(4, Number(maxPoints) || 600);
    const out = [];
    const push = (p) => {
      if (!p) return;
      const last = out[out.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-5) return;
      out.push({ x: p.x, y: p.y });
    };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const count = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < count; k++) {
        const t = k / count;
        push({ x: a.x + dx * t, y: a.y + dy * t });
        if (out.length >= limit) break;
      }
      push(b);
      if (out.length >= limit) break;
    }
    return out.length >= 2 ? out : points;
  }

  /**
   * v1.9.8：世界坐标台面矩形裁剪（Liang-Barsky）。
   * 目标球微模拟的终端点一旦因异常路径落到台外，先在这里截断，
   * 不让 18m 级长线进入投影和 Canvas。
   */
  function clipSegmentToTableRect(a, b, maxX, maxY) {
    if (!a || !b) return null;
    const limitX = Math.abs(Number(maxX) || 0);
    const limitY = Math.abs(Number(maxY) || 0);
    if (!(limitX > 0) || !(limitY > 0)) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const tests = [
      [-dx, a.x + limitX],
      [dx, limitX - a.x],
      [-dy, a.y + limitY],
      [dy, limitY - a.y],
    ];
    for (const [p, q] of tests) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    if (t0 > t1) return null;
    return {
      from: { x: a.x + dx * t0, y: a.y + dy * t0 },
      to: { x: a.x + dx * t1, y: a.y + dy * t1 },
    };
  }


  /* ================================================================== */
  /* overlay 画布与高清渲染层                                            */
  /* ================================================================== */

  // v1.9.14：目标球蓝线优先使用“第一库后到真实停点”的显示折线。
  // 旧快照/旧对象没有该字段时回退到 reboundSegments，保证兼容。
  function getTargetReboundDisplaySegments(target) {
    if (!target || typeof target !== 'object') return null;
    if (Array.isArray(target.reboundDisplaySegments)) {
      if (target.reboundDisplaySegments.length) return target.reboundDisplaySegments;
      // v1.9.15：力度预算把蓝线截成空数组 = 明确「这个力度推不到第一库，不画」。
      // 必须在这里挡住，否则会回退到未截断的 reboundSegments，把整条长线又画回来。
      if (target.reboundBudgetLimited) return null;
    }
    return Array.isArray(target.reboundSegments) && target.reboundSegments.length
      ? target.reboundSegments
      : null;
  }

  const overlay = {
    canvas: null,
    ctx: null,
    dpr: 1,
    rect: null,
    debug: { source: 'none', balls: 0, target: '-', pocket: '-', ready: false },
    _created: false,

    getTargetDoc() {
      if (projection.canvas && projection.canvas.ownerDocument) {
        return projection.canvas.ownerDocument;
      }
      return document;
    },

    destroy() {
      if (this.canvas) {
        try { this.canvas.remove(); } catch (_) {}
      }
      this.canvas = null;
      this.ctx = null;
      this.rect = null;
      this._created = false;
      _lastRenderKey = null;
    },

    ensure() {
      const targetDoc = this.getTargetDoc();
      if (!targetDoc || !targetDoc.body) return;

      if (targetDoc !== document && targetDoc.__snookerAimFrameManaged) {
        if (this.canvas) this.destroy();
        return;
      }

      if (this._created && this.canvas && this.canvas.isConnected && this.canvas.ownerDocument === targetDoc) {
        const all = targetDoc.querySelectorAll('#snooker-aim-overlay');
        if (all.length > 1) {
          all.forEach((el) => { if (el !== this.canvas) el.remove(); });
        }
        return;
      }

      targetDoc.querySelectorAll('#snooker-aim-overlay').forEach((el) => el.remove());
      this._created = false;
      const c = targetDoc.createElement('canvas');
      c.id = 'snooker-aim-overlay';
      c.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;';
      targetDoc.body.appendChild(c);
      this.canvas = c;
      this.ctx = c.getContext('2d');
      this.rect = null;
      const targetWin = targetDoc.defaultView || window;
      this.dpr = targetWin.devicePixelRatio || 1;
      this._created = true;
      _sizesDirty = true;
      _lastRenderKey = null;
    },

    syncSize() {
      if (!this.canvas) return;
      const scene = projection.canvas;
      if (!scene || !scene.isConnected) return;
      const rect = scene.getBoundingClientRect();
      const targetWin = (scene.ownerDocument && scene.ownerDocument.defaultView) || window;
      const dpr = targetWin.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      const prev = this.rect;
      const unchanged = Boolean(
        prev && this.dpr === dpr &&
        Math.abs(prev.left - rect.left) < 0.5 &&
        Math.abs(prev.top - rect.top) < 0.5 &&
        Math.abs(prev.width - rect.width) < 0.5 &&
        Math.abs(prev.height - rect.height) < 0.5 &&
        this.canvas.width === width && this.canvas.height === height
      );
      if (unchanged) return;

      this.dpr = dpr;
      this.rect = rect;
      this.canvas.style.left = rect.left + 'px';
      this.canvas.style.top = rect.top + 'px';
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.canvas.width = width;
      this.canvas.height = height;
      projection._clothCache = null;
      _sizesDirty = true;
      _lastRenderKey = null;
    },

    clear() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const dpr = this.dpr || 1;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    localCloth(p, refPos) {
      const s = projection.toClothScreen(p, refPos);
      if (!s) return null;
      if (projection.source === 'homography') return s;
      if (!this.rect) return s;
      return { x: s.x - this.rect.left, y: s.y - this.rect.top };
    },

    localScreen(p) {
      const s = projection.toScreen(p);
      if (!s) return null;
      if (projection.source === 'homography') return s;
      if (!this.rect) return s;
      return { x: s.x - this.rect.left, y: s.y - this.rect.top };
    },

    // v1.8.5：相机后方/近平面投影会产生有限但极大的坐标，必须在进入 Canvas 前拦截，
    // 否则一条跨越相机平面的折线会被画成横贯整个画面的错误长线。
    projectedScreenLimit() {
      const rect = this.rect;
      const w = Math.max(1, rect ? rect.width : (window.innerWidth || 1));
      const h = Math.max(1, rect ? rect.height : (window.innerHeight || 1));
      return Math.max(w, h) * 4;
    },

    isSafeProjectedPoint(s) {
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
      const limit = this.projectedScreenLimit();
      return Math.abs(s.x) <= limit && Math.abs(s.y) <= limit;
    },

    // 将世界坐标路径投影为若干条安全线段：
    // 1) 投影点非有限或坐标极大（相机后方/近平面）时断开；
    // 2) 相邻两个投影点发生异常大跳变时断开；
    // 3) 返回 endValid，供白线终点假想球判断，避免在无效终点继续绘制假想球。
    projectPolyline(points, refPos, options = {}) {
      const list = Array.isArray(points) ? points : [];
      const rect = this.rect;
      const baseSize = Math.max(
        rect ? rect.width : (window.innerWidth || 1),
        rect ? rect.height : (window.innerHeight || 1)
      );
      const maxStep = options.maxStepPx || baseSize * 3;
      const segments = [];
      let last = null;
      let endValid = false;
      let truncated = false;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p) {
          last = null;
          truncated = true;
          continue;
        }
        const s = this.localCloth(p, refPos);
        if (!this.isSafeProjectedPoint(s)) {
          last = null;
          truncated = true;
          continue;
        }
        if (last) {
          const jump = Math.hypot(s.x - last.x, s.y - last.y);
          if (jump > maxStep) {
            truncated = true;
            last = s;
            continue;
          }
          segments.push([last, s]);
        }
        last = s;
        if (i === list.length - 1) endValid = true;
      }
      return { segments, endValid, truncated };
    },

    // 台面投影四边形裁剪。没有这层裁剪时，即使投影点只是正常越界，
    // 线也会画到场景 canvas 上方的观众席、黑色背景和 HUD 区域。
    tableClipPoints(bounds = null) {
      const source = projection.source;
      // v1.9.8：homography 回退投影也有明确的台面四角，同样可以做台面裁剪；
      // 只有完全没有投影源时才跳过，避免投影切换帧出现无裁剪长线。
      if (source === 'none' || !source) return null;
      if (!this.rect) return null;
      // 台面裁剪必须使用“库边接触面”边界，而不是球心有效边界 railBoundX/Y。
      // railBound 是扣除球半径后的球心活动边界，目标球/母球吃库接触点在它外侧
      // 一个球半径的位置；若按 railBound 裁剪，绿线端点和蓝色反弹线起点会被各裁掉
      // 约一个球半径的屏幕投影，导致两线在库边处出现可见断口。
      // v1.9.11：优先使用本次预测携带的运行时边界，和微模拟/首库计算保持一致。
      const runtimeX = Number(bounds && bounds.boundX);
      const runtimeY = Number(bounds && bounds.boundY);
      const bx = (Number.isFinite(runtimeX) && runtimeX > 0 ? runtimeX : Number(CONFIG.railBoundX)) + BALL_RADIUS_MM;
      const by = (Number.isFinite(runtimeY) && runtimeY > 0 ? runtimeY : Number(CONFIG.railBoundY)) + BALL_RADIUS_MM;
      if (!Number.isFinite(bx) || !Number.isFinite(by) || bx <= 0 || by <= 0) return null;

      const corners = [
        { x: -bx, y: -by },
        { x: bx, y: -by },
        { x: bx, y: by },
        { x: -bx, y: by },
      ];
      const pts = [];
      const limit = Math.max(this.rect.width, this.rect.height) * 12;
      for (const corner of corners) {
        const s = this.localCloth(corner, { x: 0, y: 0 });
        if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
        if (Math.abs(s.x) > limit || Math.abs(s.y) > limit) return null;
        pts.push(s);
      }

      // 透视投影后的台面四点顺序可能随视角翻转（例如 top 视角 x 轴在屏幕上反向），
      // 直接按世界坐标顺序连边会形成自交的“蝴蝶结”。这里用凸包恢复简单四边形。
      const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const sorted = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
      const lower = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      if (hull.length !== 4) return null;

      // 视角切换过渡期间偶尔会拿到一帧方向错误的投影，四个角虽然有限，
      // 但围出的四边形已经不在台面中心附近。这种情况下退回仅 canvas 裁剪，
      // 避免用错误四边形把整条瞄准线裁没。
      const center = this.localCloth({ x: 0, y: 0 }, { x: 0, y: 0 });
      if (!this.isSafeProjectedPoint(center)) return null;
      let centerSign = 0;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        const side = (b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x);
        if (Math.abs(side) < 1e-4) continue;
        const s = side > 0 ? 1 : -1;
        if (centerSign && s !== centerSign) return null;
        centerSign = s;
      }
      return hull;
    },

    clipToTable(ctx, bounds = null) {
      const pts = this.tableClipPoints(bounds);
      if (!pts || !ctx) return false;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.clip();
      return true;
    },

    getBallScreenCircle(ballPos) {
      if (!ballPos) return null;
      const center = this.localScreen(ballPos);
      if (!center) return null;

      let rPx = 0;
      const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
      ];
      for (const [dx, dy] of dirs) {
        const edge = this.localScreen({
          x: ballPos.x + dx * BALL_RADIUS_MM,
          y: ballPos.y + dy * BALL_RADIUS_MM,
        });
        if (edge) rPx = Math.max(rPx, Math.hypot(edge.x - center.x, edge.y - center.y));
      }
      if (rPx < 2) rPx = projection.radius(BALL_RADIUS_MM, ballPos);
      rPx = clamp(rPx, 2, 80);
      return { center, rPx };
    },

    maskOccludingBalls(balls, segments, ghostPx) {
      const ctx = this.ctx;
      if (!ctx || !Array.isArray(balls) || !balls.length) return;
      if ((!segments || !segments.length) && !ghostPx) return;

      const circles = [];
      for (const b of balls) {
        if (!b || !b.pos) continue;
        const sc = this.getBallScreenCircle(b.pos);
        if (!sc) continue;

        const pad = sc.rPx + 2.2;
        let occludes = false;

        if (segments) {
          for (const [a, e] of segments) {
            if (distToSegment(sc.center, a, e) <= pad) {
              occludes = true;
              break;
            }
          }
        }
        if (!occludes && ghostPx) {
          if (Math.hypot(sc.center.x - ghostPx.x, sc.center.y - ghostPx.y) <= sc.rPx * 2 + 2.2) {
            occludes = true;
          }
        }
        if (occludes) circles.push(sc);
      }

      if (!circles.length) return;

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      for (const { center, rPx } of circles) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, rPx + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    // 绘制白色假想球 (完全复刻游戏原生：3D平铺投影 + 实心白色圆周线圈包裹 + 半透明白填充)
    drawGhostBall(worldPos, refPos) {
      const ctx = this.ctx;
      if (!ctx) return;

      const steps = 36;
      ctx.save();
      ctx.fillStyle = CONFIG.ghostBallColor || 'rgba(255, 255, 255, 0.35)';
      ctx.strokeStyle = CONFIG.ghostBallStrokeColor || '#ffffff';
      ctx.lineWidth = CONFIG.ghostBallStrokeWidthPx || 1.1;
      ctx.beginPath();
      let validPts = 0;
      for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const pt = this.localCloth({
          x: worldPos.x + BALL_RADIUS_MM * Math.cos(theta),
          y: worldPos.y + BALL_RADIUS_MM * Math.sin(theta),
        }, refPos);
        if (!pt || !this.isSafeProjectedPoint(pt)) { validPts = 0; break; }
        if (validPts === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
        validPts++;
      }
      if (validPts >= 3) {
        ctx.closePath();
        ctx.fill();
        ctx.stroke(); // 实心圆周线圈包裹
      }
      ctx.restore();
    },

    // 绘制母球停球点假想球 (淡蓝色实心线圈包裹 + 半透明填充)
    drawGhostCueBall(worldPos, refPos) {
      const ctx = this.ctx;
      if (!ctx) return;

      const steps = 36;
      ctx.save();
      ctx.fillStyle = CONFIG.ghostCueBallColor || 'rgba(96, 205, 255, 0.35)';
      ctx.strokeStyle = CONFIG.cueCushionReboundColor || '#60cdff';
      ctx.lineWidth = CONFIG.ghostBallStrokeWidthPx || 1.1;
      ctx.beginPath();
      let validPts = 0;
      for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const pt = this.localCloth({
          x: worldPos.x + BALL_RADIUS_MM * Math.cos(theta),
          y: worldPos.y + BALL_RADIUS_MM * Math.sin(theta),
        }, refPos);
        if (!pt || !this.isSafeProjectedPoint(pt)) { validPts = 0; break; }
        if (validPts === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
        validPts++;
      }
      if (validPts >= 3) {
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },

    drawTopHudPill(text, accentColor) {
      if (!CONFIG.showHudPill || !text) {
        hudPill.hide();
        return;
      }

      // 顶层原生 DOM 悬浮胶囊：独占高清置顶渲染、无惧遮挡与清屏，彻底消除底层 Canvas 影子重影
      hudPill.show(text, accentColor);
    },

    /* ---------- 核心瞄准线绘制（返回是否有效绘制，防止投影瞬时失败锁定空帧） ---------- */

    // v1.9.10：冻结层只保留目标球吃库反弹线；白线、绿线、母球吃库线、落位线
    // 不进入冻结层，停球后由静态层清除，避免旧线残留到下一杆。
    drawRetainedLines(pred, options = {}) {
      if (!pred || !this.ctx) return [];
      const ctx = this.ctx;
      const collected = [];
      const showWhite = options.white !== false;
      const showGreen = options.green !== false;
      const showCueCushion = options.cueCushion !== false;
      const showTargetRebound = options.targetRebound !== false;
      const showCuePost = options.cuePost !== false;
      const alpha = Number.isFinite(Number(CONFIG.retainedShotLineAlpha))
        ? CONFIG.retainedShotLineAlpha
        : 0.72;
      const targetAlpha = Number.isFinite(Number(options.targetAlpha))
        ? Number(options.targetAlpha)
        : (Number.isFinite(Number(CONFIG.retainedTargetReboundAlpha))
          ? CONFIG.retainedTargetReboundAlpha
          : alpha);
      const drawPath = (points, color, width, dash, alphaOverride) => {
        if (!Array.isArray(points) || points.length < 2) return;
        const proj = this.projectPolyline(points, pred.cue);
        if (!proj || !proj.segments || proj.segments.length === 0) return;
        ctx.save();
        ctx.globalAlpha = Number.isFinite(Number(alphaOverride)) ? Number(alphaOverride) : alpha;
        this.clipToTable(ctx, pred.tableBounds);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        for (const seg of proj.segments) {
          ctx.moveTo(seg[0].x, seg[0].y);
          ctx.lineTo(seg[1].x, seg[1].y);
          // v1.9.11：保留线的投影段也要进入遮挡挖洞集合，
          // 否则旧目标球反弹线会直接压在母球/目标球/其他球上。
          collected.push(seg);
        }
        ctx.stroke();
        ctx.restore();
      };

      const t = pred.target || null;
      // 白色母球瞄准线
      if (showWhite && CONFIG.showCueLine && pred.cue) {
        const end = (t && t.contact) || pred.noTargetEnd || (pred.railHit && pred.railHit.point);
        if (end) drawPath([pred.cue, end], CONFIG.cueLineColor, CONFIG.cueLineWidthPx);
      }
      // 绿色目标球瞄准线
      if (showGreen && CONFIG.showObjectLine && t && Array.isArray(t.objectPath) && t.objectPath.length >= 2) {
        drawPath(t.objectPath, CONFIG.objectLineColor, CONFIG.objectLineWidthPx);
      }
      // 母球吃库反弹折线
      if (showCueCushion && CONFIG.showCushionRebound && pred.cuePost && Array.isArray(pred.cuePost.cueCushionPaths)) {
        const cPath = pred.cuePost.cueCushionPaths[0];
        if (Array.isArray(cPath) && cPath.length >= 2) {
          drawPath(cPath, CONFIG.cueCushionReboundColor || '#86cfff', CONFIG.cueCushionReboundWidthPx || 1.6);
        }
      }
      // 目标球吃库反弹折线
      const retainedTargetSegments = t ? getTargetReboundDisplaySegments(t) : null;
      if (showTargetRebound && CONFIG.showObjectRebound && t && retainedTargetSegments) {
        const boundX = Number(pred.tableBounds && pred.tableBounds.boundX) || CONFIG.railBoundX;
        const boundY = Number(pred.tableBounds && pred.tableBounds.boundY) || CONFIG.railBoundY;
        for (const seg of retainedTargetSegments) {
          const p1 = seg && (seg.p1 || seg.from);
          const p2 = seg && (seg.p2 || seg.to);
          if (!p1 || !p2) continue;
          // v1.9.11：裁剪边界和本次预测的运行时球心边界保持一致。
          const clipped = clipSegmentToTableRect(p1, p2, boundX, boundY);
          if (!clipped) continue;
          let dash = [];
          if (t.objectDir) {
            const r = V.norm(V.sub(clipped.to, clipped.from));
            const o = V.norm(t.objectDir);
            if (r && o) {
              const cross = Math.abs(o.x * r.y - o.y * r.x);
              const dot = V.dot(o, r);
              if (cross < 0.04 && dot < -0.7) dash = [5, 4];
            }
          }
          const sampled = samplePolylineByDistance(
            [clipped.from, clipped.to],
            CONFIG.targetReboundSampleStepMm || 50
          );
          drawPath(sampled, CONFIG.cueCushionReboundColor || '#86cfff', CONFIG.objectLineWidthPx || 1.6, dash, targetAlpha);
        }
      }
      // 母球落位预测线 / 碰后走位线
      if (showCuePost && CONFIG.showCuePostTrajectory && Array.isArray(pred.cuePostTrajectory) && pred.cuePostTrajectory.length >= 2) {
        drawPath(
          pred.cuePostTrajectory,
          CONFIG.cuePostTrajectoryColor || CONFIG.cueLineColor || 'rgba(255,255,255,0.95)',
          CONFIG.cuePostTrajectoryWidthPx || 1.6
        );
      }
      return collected;
    },

    drawPrediction(pred, currentBalls = null, inMotion = false, retainedPred = null, options = {}) {
      const ctx = this.ctx;
      if (!ctx) return false;
      // v1.9.10：母球吃库线与落位线同样整条保留到全台停球；
      // 目标球吃库线继续使用冻结层，保持不随目标球移动。
      const lineOptions = {
        liveWhite: options.liveWhite !== false,
        liveGreen: options.liveGreen !== false,
        liveCueCushion: options.liveCueCushion !== false,
        liveTargetRebound: options.liveTargetRebound !== false,
        liveCuePost: options.liveCuePost !== false,
        frozenCueCushionPath: Array.isArray(options.frozenCueCushionPath) && options.frozenCueCushionPath.length >= 2
          ? options.frozenCueCushionPath
          : null,
        frozenCueCushionBounds: options.frozenCueCushionBounds || null,
        retainedWhite: options.retainedWhite !== false,
        retainedGreen: options.retainedGreen !== false,
        retainedCueCushion: options.retainedCueCushion !== false,
        retainedTargetRebound: options.retainedTargetRebound !== false,
        retainedCuePost: options.retainedCuePost !== false,
      };
      this.clear();
      // v1.9.11：先建立本帧遮挡集合，冻结层的投影段也会被注册进来；
      // 后面的 maskOccludingBalls 才能同时对“上一杆旧线”做球体挖洞。
      const drawnSegments = [];
      if (retainedPred && CONFIG.retainShotAssistLines) {
        // 旧的冻结线先画在底层，当前瞄准线再画在上面；下一杆出杆时旧快照才被替换。
        const retainedSegments = this.drawRetainedLines(retainedPred, {
          white: lineOptions.retainedWhite,
          green: lineOptions.retainedGreen,
          cueCushion: lineOptions.retainedCueCushion,
          targetRebound: lineOptions.retainedTargetRebound,
          cuePost: lineOptions.retainedCuePost,
          // 运动中这条冻结线就是本杆唯一的反弹预测，保持原亮度；
          // 静态瞄准时才把它当“上一杆历史线”压低透明度。
          targetAlpha: inMotion ? CONFIG.retainedShotLineAlpha : undefined,
        }) || [];
        for (const seg of retainedSegments) drawnSegments.push(seg);
      }
      if (!pred) {
        hudPill.hide();
        return false;
      }

      const cueWorld = pred.cue;
      const aimDir = pred.aimDir;
      if (!cueWorld || !aimDir) {
        hudPill.hide();
        return false;
      }

      // 核心修复：直接在入口最顶部声明计算当前有效出杆力度，彻底根除后续使用时的 TDZ ReferenceError 异常！
      const currentEffPower = Math.max(0, Math.round(Number(pred.shot?.power ?? pred.power ?? 0)));

      const t = pred.target || null;

      if (!inMotion) {
        // 静态瞄准预览阶段：绝对直通保护！
        // 强制复位所有动态走位裁剪与终结状态，严防任何上一杆走位残留标记污染当前瞄准预览
        _cueLineCompleted = false;
        _targetLineCompleted = false;
        _targetMaxTravel = 0;
        _targetReachBarCompleted = false;
        _targetReboundCompleted = false;
        _targetReboundEngaged = false;
        _targetReboundMaxTravel = 0;
        _cueCushionCompleted = false;
        _cueCushionEngaged = false;
        _cueCushionMaxTravel = 0;
        _trackedTargetBallId = null;
        _trackedTargetPos = null;
      }

      // 提取母球与目标球的实时球位 (仅在出杆击球 inMotion === true 阶段才读取并用于击球走位动态擦除)
      let liveCuePos = null;
      let liveTargetPos = null;
      let liveTargetPotted = false;
      const targetBall = pred.target?.ball || null;
      const origTargetPos = targetBall?.pos || null;
      const targetBallKind = targetBall?.kind;
      const targetBallId = targetBall?.id != null ? String(targetBall.id) : null;

      if (inMotion && Array.isArray(currentBalls) && currentBalls.length > 0) {
        // 1. 查找母球实时位置
        for (const b of currentBalls) {
          if (!b || b.potted) continue;
          if (b.isCue || b.kind === 'cue' || b.kind === 0) {
            liveCuePos = extractBallPos(b);
            break;
          }
        }

        // 2. 精准查找目标球实时位置（基于唯一ID与初始坐标空间欧氏距离，彻底杜绝红球同色覆盖）
        let matchedTargetBall = null;

        // 2.1 优先使用已锁定的目标球 ID 或快照目标球 ID 严格匹配
        const searchId = _trackedTargetBallId || targetBallId;
        if (searchId != null) {
          matchedTargetBall = currentBalls.find((b) => b && !b.potted && b.id != null && String(b.id) === String(searchId)) || null;
        }

        // 2.2 若无 ID 或按 ID 未能匹配到，根据快照初始坐标与历史坐标就近锁定（距离初始点最近的同色球）
        if (!matchedTargetBall && origTargetPos) {
          const refPos = _trackedTargetPos || origTargetPos;
          let bestDist = Infinity;
          for (const b of currentBalls) {
            if (!b || b.potted) continue;
            if (b.isCue || b.kind === 'cue' || b.kind === 0) continue;
            // 若有类型信息，优先匹配同类型球
            if (targetBallKind != null && b.kind != null && b.kind !== targetBallKind) continue;
            const p = extractBallPos(b);
            if (!p) continue;
            const d = Math.hypot(p.x - refPos.x, p.y - refPos.y);
            // 挑选距离参考位置最近的球
            if (d < bestDist) {
              bestDist = d;
              matchedTargetBall = b;
            }
          }
        }

        if (matchedTargetBall) {
          liveTargetPos = extractBallPos(matchedTargetBall);
          if (liveTargetPos) {
            _trackedTargetPos = liveTargetPos;
            if (matchedTargetBall.id != null) {
              _trackedTargetBallId = String(matchedTargetBall.id);
            }
          }
          if (matchedTargetBall.potted === true) {
            liveTargetPotted = true;
          }
        } else {
          // 未在当前台面球列表中找到目标球：只有在目标球曾开始运动且靠近袋口时才算落袋，绝不在第一帧误判落袋！
          if (_targetMaxTravel > 30 && _trackedTargetPos && t && t.objectPath && t.objectPath.length >= 2) {
            const endPt = t.objectPath[t.objectPath.length - 1];
            if (Math.hypot(_trackedTargetPos.x - endPt.x, _trackedTargetPos.y - endPt.y) < 55) {
              liveTargetPotted = true;
            }
          }
        }
      }

      let ghostPx = null;
      let hasProjected = drawnSegments.length > 0;

      // 1) 母球瞄准线：静态预览全长绘制；出杆后随母球向前移动逐步擦除，撞击目标球瞬间完全消失
      if (lineOptions.liveWhite && CONFIG.showCueLine) {
        const contactTarget = (t && t.contact)
          ? t.contact
          : (pred.noTargetEnd || (pred.railHit && pred.railHit.point) || null);
        if (contactTarget) {
          let startPt = cueWorld;
          let endPt = contactTarget;
          // 有目标球时在目标接触点显示假想球；直吃库边时在白线终点（第一库接触点）也显示假想球。
          let showGhost = Boolean(t && t.contact) || Boolean(!t && pred.railHit && contactTarget);

          if (inMotion) {
            // 只有在出杆击球运动中才进行动态实时吞噬裁剪
            const trimmed = trimCueAimLineFromLive(cueWorld, contactTarget, liveCuePos);
            if (trimmed) {
              startPt = trimmed.start;
              endPt = trimmed.end;
              showGhost = trimmed.showGhost;
            } else {
              startPt = null;
            }
          }

          if (startPt && endPt) {
            // v1.8.5：白线不能只投影两个端点。端点一旦越过相机近平面，
            // 两端会得到有限但巨大的坐标，直接连成横贯画面的错误长线。
            // 这里沿线采样并分段校验，异常段断线，但保留仍可见的段。
            const lineDist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
            const sampleCount = Math.max(2, Math.min(40, Math.ceil(lineDist / 35)));
            const samplePts = [startPt];
            for (let i = 1; i < sampleCount - 1; i++) {
              const t = i / (sampleCount - 1);
              samplePts.push({
                x: startPt.x + (endPt.x - startPt.x) * t,
                y: startPt.y + (endPt.y - startPt.y) * t,
              });
            }
            samplePts.push(endPt);

            const lineProj = this.projectPolyline(samplePts, cueWorld);
            const endPx = this.localCloth(endPt, cueWorld);
            if (lineProj.segments.length > 0) {
              hasProjected = true;
              ctx.save();
              this.clipToTable(ctx, pred.tableBounds);
              ctx.strokeStyle = CONFIG.cueLineColor;
              ctx.lineWidth = CONFIG.cueLineWidthPx;
              ctx.lineCap = 'round';
              ctx.setLineDash([]);
              ctx.beginPath();
              for (const seg of lineProj.segments) {
                ctx.moveTo(seg[0].x, seg[0].y);
                ctx.lineTo(seg[1].x, seg[1].y);
                drawnSegments.push(seg);
              }
              ctx.stroke();
              ctx.restore();

              // 假想球单独绘制，避免被台面裁剪切掉第一库接触点半圆。
              if (showGhost && contactTarget && lineProj.endValid &&
                  endPx && this.isSafeProjectedPoint(endPx)) {
                this.drawGhostBall(contactTarget, cueWorld);
                ghostPx = endPx;
              }
            }
          }
        }
      }

      // 2) 目标球延长线：静态预览全长绘制；出杆撞击后随目标球向前移动逐步擦除，进袋或弹库走完瞬间彻底消失。
      // 力度不足不再改变线型，统一由下方橙色实线力度条显示当前力度的真实停点。
      if (lineOptions.liveGreen && t && CONFIG.showObjectLine && Array.isArray(t.objectPath) && t.objectPath.length >= 2) {
        let pathToDraw = t.objectPath;
        if (inMotion) {
          // 仅在真实出杆运动中执行动态单向擦除与终结销毁
          pathToDraw = trimObjectPathFromLive(t.objectPath, liveTargetPos, liveTargetPotted);
        }

        if (pathToDraw && pathToDraw.length >= 2) {
          const objectProj = this.projectPolyline(pathToDraw, cueWorld);

          if (objectProj.segments.length > 0) {
            hasProjected = true;
            ctx.save();
            this.clipToTable(ctx, pred.tableBounds);
            ctx.strokeStyle = CONFIG.objectLineColor || '#00ff88';
            ctx.lineWidth = CONFIG.objectLineWidthPx || 1.6;
            ctx.setLineDash([]);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const seg of objectProj.segments) {
              ctx.moveTo(seg[0].x, seg[0].y);
              ctx.lineTo(seg[1].x, seg[1].y);
              drawnSegments.push(seg);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 2.1) 【目标球橙色实线力度条】沿绿色瞄准线显示当前力度下目标球能走到的位置。
      //      长度 = 当前力度下的目标球行程预算（与蓝线预算同源），终点 = 该力度下的预计停点。
      //      只覆盖第一库/袋口之前的绿线段，不进入吃库反弹段；始终实线绘制，替代原橙色虚线。
      //      出杆运动阶段与绿色瞄准线同观感：随目标球实时位置从起点单向擦除，走到预算终点即消失。
      if (!pred.unreachable && lineOptions.liveGreen && t && CONFIG.showObjectLine &&
          currentEffPower > 2 && Array.isArray(t.objectPath) && t.objectPath.length >= 2) {
        const reachMm = Number(
          pred.targetReachMm != null ? pred.targetReachMm :
          (t.targetReachMm != null ? t.targetReachMm : pred.actualReachMm)
        );
        const minBarMm = Math.max(1, Number(CONFIG.targetReachBarMinMm) || 5);
        // v1.9.17：官方引擎给出第一库前真实路径时，橙色线直接沿这条路径绘制；
        // 不再把「总长度」套到绿色几何线上。引擎不可用/结果 stale 时才回退旧逻辑。
        const engineOrangePath = (Array.isArray(t.orangePath) && t.orangePath.length >= 2)
          ? t.orangePath : null;
        const engineOrangeLen = engineOrangePath ? polylineLength(engineOrangePath) : 0;
        const hasEngineOrange = Boolean(engineOrangePath);
        const hasFallbackReach = Number.isFinite(reachMm) && reachMm > minBarMm;
        if (hasEngineOrange || hasFallbackReach) {
          const preRailEnd = t.pocket
            ? (t.pocket.enterPoint || t.pocket.opening || t.objectEnd)
            : (t.objectEnd || null);
          const preRailLen = (t.ball && t.ball.pos && preRailEnd)
            ? V.dist(t.ball.pos, preRailEnd)
            : polylineLength(t.objectPath);
          const barLenMm = Number.isFinite(reachMm)
            ? Math.min(reachMm, preRailLen)
            : preRailLen;
          // 有官方路径时即使它很短也优先使用；只有官方路径不可用时才走长度截断兜底。
          if ((hasEngineOrange && engineOrangeLen > minBarMm) || (!hasEngineOrange && barLenMm > minBarMm)) {
            let barPts = hasEngineOrange
              ? engineOrangePath
              : trimPolyline(t.objectPath, barLenMm);
            if (inMotion) {
              barPts = trimTargetReachBarFromLive(barPts, liveTargetPos, liveTargetPotted);
            }
            if (barPts && barPts.length >= 2) {
              const sampledBar = samplePolylineByDistance(
                barPts,
                CONFIG.targetReboundSampleStepMm || 50
              );
              const barProj = this.projectPolyline(sampledBar, cueWorld);
              if (barProj.segments.length > 0) {
                hasProjected = true;
                ctx.save();
                this.clipToTable(ctx, pred.tableBounds);
                ctx.strokeStyle = CONFIG.targetReachBarColor || '#ff9f43';
                // 与绿色瞄准线保持完全一致的粗细，避免覆盖时出现视觉差异。
                ctx.lineWidth = CONFIG.objectLineWidthPx || 1.6;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.setLineDash([]);
                ctx.beginPath();
                for (const seg of barProj.segments) {
                  ctx.moveTo(seg[0].x, seg[0].y);
                  ctx.lineTo(seg[1].x, seg[1].y);
                  drawnSegments.push(seg);
                }
                ctx.stroke();
                ctx.restore();
              }
            }
          }
        }
      }

      // 3) 【母球吃库反弹折线】：天蓝色 #86cfff，实线 1.6px。
      // v1.9.12：出杆瞬间冻结成 _retainedCueCushionPath，运动期间整条只读绘制；
      // 直到全台所有球（含母球）停稳后，由主循环清空冻结路径。
      if (lineOptions.liveCueCushion && CONFIG.showCushionRebound) {
        // 有冻结路径时优先绘制冻结路径；没有冻结路径才退回当前预测。
        // 这样即使 predToDraw 在运动途中回退到别的对象，也不会换线。
        let cPath = lineOptions.frozenCueCushionPath;
        if (!Array.isArray(cPath) || cPath.length < 2) {
          cPath = (pred.cuePost && Array.isArray(pred.cuePost.cueCushionPaths))
            ? pred.cuePost.cueCushionPaths[0]
            : null;
        }
        if (Array.isArray(cPath) && cPath.length >= 2) {
          const cueCushionBounds = lineOptions.frozenCueCushionBounds || pred.tableBounds;
          const cueCushionProj = this.projectPolyline(cPath, cueWorld);
          if (cueCushionProj.segments.length > 0) {
            hasProjected = true;
            ctx.save();
            this.clipToTable(ctx, cueCushionBounds);
            ctx.strokeStyle = CONFIG.cueCushionReboundColor || '#86cfff'; // '#86cfff' 天蓝色
            ctx.lineWidth = CONFIG.cueCushionReboundWidthPx || 1.6;     // 1.6px (与绿色瞄准线一致)
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([]); // 实线显示
            ctx.beginPath();
            for (const seg of cueCushionProj.segments) {
              ctx.moveTo(seg[0].x, seg[0].y);
              ctx.lineTo(seg[1].x, seg[1].y);
              drawnSegments.push(seg);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 3.2) 【目标球吃库反弹折线】：静态预览画到当前力度下的真实停点；
      // 出杆后目标球吃库线保持冻结，不随实时球位裁剪。
      const staticTargetSegments = t ? getTargetReboundDisplaySegments(t) : null;
      if (lineOptions.liveTargetRebound && CONFIG.showObjectRebound && t && staticTargetSegments) {
        let objectReboundSegments = staticTargetSegments;
        const reboundBoundX = Number(pred.tableBounds && pred.tableBounds.boundX) || CONFIG.railBoundX;
        const reboundBoundY = Number(pred.tableBounds && pred.tableBounds.boundY) || CONFIG.railBoundY;
        if (inMotion) {
          const trimmedReboundPath = trimTargetReboundFromLive(staticTargetSegments, liveTargetPos, liveTargetPotted);
          objectReboundSegments = [];
          if (Array.isArray(trimmedReboundPath) && trimmedReboundPath.length >= 2) {
            for (let i = 0; i < trimmedReboundPath.length - 1; i++) {
              objectReboundSegments.push({
                from: trimmedReboundPath[i],
                to: trimmedReboundPath[i + 1],
              });
            }
          }
        }

        if (objectReboundSegments.length > 0) {
          for (const seg of objectReboundSegments) {
            const p1 = seg && (seg.p1 || seg.from);
            const p2 = seg && (seg.p2 || seg.to);
            if (!p1 || !p2) continue;
            // v1.9.8：与冻结层一致，先裁到球心台面，再采样投影。
            // v1.9.11：球心台面使用本次预测的运行时边界，和微模拟保持一致。
            const clipped = clipSegmentToTableRect(p1, p2, reboundBoundX, reboundBoundY);
            if (!clipped) continue;
            const sampled = samplePolylineByDistance(
              [clipped.from, clipped.to],
              CONFIG.targetReboundSampleStepMm || 50
            );
            const reboundProj = this.projectPolyline(sampled, cueWorld);
            if (reboundProj.segments.length > 0) {
              hasProjected = true;
              ctx.save();
              this.clipToTable(ctx, pred.tableBounds);
              ctx.strokeStyle = CONFIG.cueCushionReboundColor || '#86cfff';
              ctx.lineWidth = CONFIG.objectLineWidthPx || 1.6;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              // 垂直撞库时，真实反弹方向与绿色入射线共线；用虚线区分“回弹方向”，
              // 避免又出现一条实线蓝线看起来像在覆盖绿色瞄准线。
              let collinearRebound = false;
              if (t && t.ball && t.objectDir && staticTargetSegments[0]) {
                const r = V.norm(V.sub(staticTargetSegments[0].to, staticTargetSegments[0].from));
                const o = V.norm(t.objectDir);
                const cross = Math.abs(o.x * r.y - o.y * r.x);
                const dot = V.dot(o, r);
                collinearRebound = cross < 0.04 && dot < -0.7;
              }
              ctx.setLineDash(collinearRebound ? [5, 4] : []);
              ctx.beginPath();
              for (const reboundSeg of reboundProj.segments) {
                ctx.moveTo(reboundSeg[0].x, reboundSeg[0].y);
                ctx.lineTo(reboundSeg[1].x, reboundSeg[1].y);
                drawnSegments.push(reboundSeg);
              }
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // 官方引擎轨迹的真实停点标记：只在该蓝线确实来自 engine targetPath 时显示。
        // 力度变化时 engine targetPath 会同步更新，标记随预测停点实时移动。
        if (!inMotion && CONFIG.showTargetReboundStop &&
            t.reboundRestExact && t.reboundStopReason === 'engineSim' && t.reboundRestPoint) {
          const stopPx = this.localCloth(t.reboundRestPoint, cueWorld);
          if (stopPx && this.isSafeProjectedPoint(stopPx)) {
            ctx.save();
            this.clipToTable(ctx, pred.tableBounds);
            ctx.beginPath();
            ctx.arc(stopPx.x, stopPx.y, CONFIG.targetReboundStopRadiusPx || 2.6, 0, Math.PI * 2);
            ctx.fillStyle = CONFIG.targetReboundStopColor || CONFIG.cueCushionReboundColor || '#86cfff';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 3.3) 【物理引擎母球真实碰后走位弧线与多库反弹】(低杆回缩、跟杆、偏塞加塞弧线，出杆运动期间整条保留，停球后不再保留)
      if (lineOptions.liveCuePost && CONFIG.showCuePostTrajectory && Array.isArray(pred.cuePostTrajectory) && pred.cuePostTrajectory.length >= 2) {
        const cuePostProj = this.projectPolyline(pred.cuePostTrajectory, cueWorld);
        if (cuePostProj.segments.length > 0) {
          hasProjected = true;
          ctx.save();
          this.clipToTable(ctx, pred.tableBounds);
          ctx.strokeStyle = CONFIG.cuePostTrajectoryColor || CONFIG.cueLineColor || 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = CONFIG.cuePostTrajectoryWidthPx || 1.6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([]);
          ctx.beginPath();
          for (const seg of cuePostProj.segments) {
            ctx.moveTo(seg[0].x, seg[0].y);
            ctx.lineTo(seg[1].x, seg[1].y);
            drawnSegments.push(seg);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4) 反向擦除所有遮挡瞄准线的球体 3D 投影区域 (优先使用台面实时球位，确保出杆运动中实时遮挡贴合)
      const allBalls = (Array.isArray(currentBalls) && currentBalls.length)
        ? currentBalls
        : (Array.isArray(pred.balls) && pred.balls.length
          ? pred.balls
          : [{ pos: cueWorld }, t && t.ball && t.ball.pos ? { pos: t.ball.pos } : null].filter(Boolean));
      this.maskOccludingBalls(allBalls, drawnSegments, ghostPx);

      // 5) 屏幕正上方切角与出杆状态信息浮标 (实时显示出杆加塞与力度，外框颜色动态变化)
      if (CONFIG.showHudPill && currentEffPower > 0) {
        const effPower = currentEffPower;
        const tipText = formatTipEnglish(pred.tip || (pred.shot && pred.shot.tip));
        const potWarning = (effPower > 0 && pred.cuePottedWarning) ? ' · ⚠️母球摔袋' : '';

        if (effPower > 0 && pred.unreachable) {
          this.drawTopHudPill(
            `无法触碰目标球 (力度过小或被阻挡) · 力度 ${effPower}% · ${tipText}`,
            '#ff5555'
          );
        } else if (t && t.pocket) {
          const cutDeg = Math.round(t.cutAngleDeg || 0);
          const isUnderpowered = effPower > 2 && Boolean(pred.insufficientPower);
          const conf = isUnderpowered ? 0.25 : (t.pocket.confidence ?? 1);
          const solid = !isUnderpowered && conf >= POCKET_SOLID_THRESHOLD;

          const ch = t.cushionHug || t.pocket.cushionHug || (t.ball && checkCushionHug(t.ball.pos, { boundX: CONFIG.railBoundX, boundY: CONFIG.railBoundY }));
          let hugPrefix = '';
          if (ch && ch.isTight) {
            hugPrefix = `📌贴库(${ch.edgeGap}mm) · `;
          } else if (ch && ch.isJawClipping) {
            hugPrefix = `📐擦角补偿(${ch.compOffset}mm) · `;
          } else if (ch && ch.isNear) {
            hugPrefix = `📐半贴库(${ch.edgeGap}mm) · `;
          }

          if (isUnderpowered) {
            // 力度不足将目标球送入袋口时：使用警示橙红边框，将【力小推不到袋】放在最醒目首位
            const recText = pred.recPower ? `需${pred.recPower}%, 当前${effPower}%` : `当前仅${effPower}%`;
            this.drawTopHudPill(
              `${hugPrefix}⚠️力小推不到袋 (${recText}) · ${t.pocket.label} · 切角 ${cutDeg}°${potWarning}`,
              '#ff5500'
            );
          } else {
            const hudRingColor = (effPower > 0 && pred.cuePottedWarning)
              ? '#ff4444'
              : (solid ? (CONFIG.pocketRingColor || '#00ff88') : (CONFIG.pocketEdgeColor || '#ff8c33'));
            this.drawTopHudPill(
              `${hugPrefix}${t.pocket.label} · 切角 ${cutDeg}° · 力度 ${effPower}% · ${tipText}${potWarning}`,
              hudRingColor
            );
          }
        } else if (t && t.ball) {
          const cutDeg = Math.round(t.cutAngleDeg || 0);
          const ch = t.cushionHug || (t.ball && checkCushionHug(t.ball.pos, { boundX: CONFIG.railBoundX, boundY: CONFIG.railBoundY }));
          let hugPrefix = '';
          if (ch && ch.isTight) {
            hugPrefix = `📌贴库(${ch.edgeGap}mm) · `;
          } else if (ch && ch.isNear) {
            hugPrefix = `📐半贴库(${ch.edgeGap}mm) · `;
          }
          this.drawTopHudPill(
            `${hugPrefix}${kindLabel(t.ball.kind)} · 切角 ${cutDeg}° · 力度 ${effPower}% · ${tipText}${potWarning}`,
            (effPower > 0 && pred.cuePottedWarning) ? '#ff4444' : 'rgba(255, 255, 255, 0.75)'
          );
        } else if (pred.noTargetEnd) {
          const cushionName = pred.railHit ? getCushionLabel(pred.railHit.axis, pred.railHit.point) : '库边';
          this.drawTopHudPill(
            `直吃${cushionName} · 力度 ${effPower}% · ${tipText}`,
            '#86cfff'
          );
        } else {
          hudPill.hide();
        }
      } else {
        hudPill.hide();
      }

      if ((CONFIG.showCueLine || CONFIG.showObjectLine || CONFIG.showCuePostTrajectory) && !hasProjected) {
        return false;
      }

      return true;
    },
  };

  /* ================================================================== */
  /* 控制面板 UI                                                         */
  /* ================================================================== */

  const ui = {
    panel: null,
    body: null,
    headerEl: null,
    titleBoxEl: null,
    titleEl: null,
    versionBadgeEl: null,
    toggleBtn: null,
    debugLine: null,
    collapsed: true,
    circleHidden: false,
    _built: false,
    _checkboxes: {},
    _suppressClickUntil: 0,

    handlePlusClick() {
      if (performance.now() < this._suppressClickUntil) return;
      this._suppressClickUntil = performance.now() + 350;
      this.setCollapsed(false);
    },

    loadCircleHidden() {
      try {
        return localStorage.getItem(CONFIG.panelCircleHiddenKey) === '1';
      } catch (_) {
        return false;
      }
    },

    saveCircleHidden(hidden) {
      this.circleHidden = Boolean(hidden);
      try {
        localStorage.setItem(CONFIG.panelCircleHiddenKey, this.circleHidden ? '1' : '0');
      } catch (_) {}
    },

    toggleCircleHidden() {
      const next = !this.circleHidden;
      this.setCircleHidden(next);
      if (next) {
        showToast('🙈 控制面板加号已隐藏 (双击屏幕重新显示)', 1800);
      } else {
        showToast('👁️ 控制面板加号已显示 (双击屏幕重新隐藏)', 1500);
      }
      return this.circleHidden;
    },

    setCircleHidden(hidden) {
      this.saveCircleHidden(hidden);
      if (this.circleHidden) {
        this.collapsed = true;
      }
      if (!this.panel) return;
      if (this.circleHidden) {
        this.panel.style.setProperty('display', 'none', 'important');
      } else {
        this.panel.style.removeProperty('display');
        this.setCollapsed(true);
      }
    },

    _circlePos: { left: 0, top: 0 },
    _circlePosInitialized: false,

    loadPanelPos() {
      try {
        const raw = localStorage.getItem(CONFIG.panelPosKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
            return parsed;
          }
        }
      } catch (_) {}
      return null;
    },

    saveCirclePos(left, top) {
      this._circlePos = { left, top };
      try {
        localStorage.setItem(CONFIG.panelPosKey, JSON.stringify({ left, top }));
      } catch (_) {}
    },

    savePanelPos(left, top) {
      this.saveCirclePos(left, top);
    },

    clampPanelIntoViewport() {
      if (!this.panel || !this.panel.isConnected) return;
      if (this.circleHidden) {
        this.panel.style.setProperty('display', 'none', 'important');
        return;
      }
      const vv = window.visualViewport;
      const winW = (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1920;
      const winH = (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 1080;

      if (this.collapsed) {
        if (!this._circlePos) return;
        const safeLeft = clamp(this._circlePos.left, 0, Math.max(0, winW - 21));
        const safeTop = clamp(this._circlePos.top, 0, Math.max(0, winH - 21));
        this._circlePos.left = safeLeft;
        this._circlePos.top = safeTop;
        this.panel.style.left = Math.round(safeLeft) + 'px';
        this.panel.style.top = Math.round(safeTop) + 'px';
        this.panel.style.right = 'auto';
        this.panel.style.bottom = 'auto';
      } else {
        const pW = this.panel.offsetWidth || 300;
        const pH = this.panel.offsetHeight || 280;
        const anchorLeft = (this._circlePos && Number.isFinite(this._circlePos.left)) ? this._circlePos.left : (this.panel.offsetLeft || 14);
        const anchorTop = (this._circlePos && Number.isFinite(this._circlePos.top)) ? this._circlePos.top : (this.panel.offsetTop || 14);
        const displayLeft = Math.max(4, Math.min(anchorLeft, winW - pW - 4));
        const displayTop = Math.max(4, Math.min(anchorTop, winH - pH - 4));
        this.panel.style.left = Math.round(displayLeft) + 'px';
        this.panel.style.top = Math.round(displayTop) + 'px';
        this.panel.style.right = 'auto';
        this.panel.style.bottom = 'auto';
      }
    },

    setDragVisual(active) {
      if (!this.panel) return;
      if (active) {
        this.panel.style.cursor = 'grabbing';
        this.panel.style.setProperty(
          'box-shadow',
          '0 8px 30px rgba(0, 255, 136, 0.45), 0 0 0 2.5px #00ff88',
          'important'
        );
      } else {
        this.panel.style.cursor = this.collapsed ? 'pointer' : 'default';
        if (this.collapsed) {
          this.panel.style.setProperty(
            'box-shadow',
            '0 4px 14px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.25)',
            'important'
          );
        } else {
          this.panel.style.setProperty(
            'box-shadow',
            '0 6px 22px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.10)',
            'important'
          );
        }
      }
    },

    ensure() {
      if (this._built && this.panel && this.panel.isConnected) {
        if (this.circleHidden) {
          this.panel.style.setProperty('display', 'none', 'important');
        }
        return;
      }
      this.circleHidden = this.loadCircleHidden();
      this._built = false;
      this._suppressClickUntil = 0;
      this.panel = null;
      this.body = null;
      this.headerEl = null;
      this.titleBoxEl = null;
      this.titleEl = null;
      this.versionBadgeEl = null;
      this.toggleBtn = null;
      this.debugLine = null;
      this._checkboxes = {};

      try {
        if (typeof document !== 'undefined') {
          let style = document.getElementById('snooker-scrollbar-style');
          if (!style) {
            style = document.createElement('style');
            style.id = 'snooker-scrollbar-style';
            (document.head || document.body || document.documentElement).appendChild(style);
          }
          style.textContent = `
            #snooker-aim-panel::-webkit-scrollbar,
            #snooker-panel-body::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
            #snooker-aim-panel,
            #snooker-panel-body {
              -ms-overflow-style: none !important;
              scrollbar-width: none !important;
            }
          `;
        }
      } catch (_) {}

      this.build();
    },

    build() {
      if (this._built && this.panel && this.panel.isConnected) return;
      this._built = false;
      document.querySelectorAll('#snooker-aim-panel').forEach((el) => el.remove());

      this.panel = document.createElement('div');
      this.panel.id = 'snooker-aim-panel';
      this.panel.style.cssText = [
        'position: fixed !important;',
        'z-index: 2147483647 !important;',
        'box-sizing: border-box !important;',
        'color: #f0f4ee !important;',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif !important;',
        'font-size: 13px !important;',
        'line-height: 1.5 !important;',
        'pointer-events: auto !important;',
        'user-select: none !important;',
        '-webkit-user-select: none !important;',
        'text-align: left !important;',
      ].join(' ');

      const vv = window.visualViewport;
      const winW = (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 800;
      const winH = (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 600;

      if (!this._circlePosInitialized) {
        const savedPos = this.loadPanelPos();
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
          this._circlePos = {
            left: clamp(savedPos.left, 0, Math.max(0, winW - 21)),
            top: clamp(savedPos.top, 0, Math.max(0, winH - 21)),
          };
        } else {
          this._circlePos = {
            left: Math.max(8, winW - 35),
            top: 14,
          };
        }
        this._circlePosInitialized = true;
      }
      this.panel.style.left = this._circlePos.left + 'px';
      this.panel.style.top = this._circlePos.top + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';

      this.bindDragEvents();

      const header = document.createElement('div');
      header.style.cssText = [
        'display: flex !important;',
        'align-items: center !important;',
        'justify-content: space-between !important;',
        'gap: 8px !important;',
        'width: 100% !important;',
        'height: 22px !important;',
        'cursor: default !important;',
        'box-sizing: border-box !important;',
      ].join(' ');
      this.headerEl = header;

      const titleBox = document.createElement('div');
      titleBox.id = 'snooker-panel-title-box';
      titleBox.style.cssText = [
        'display: flex !important;',
        'align-items: center !important;',
        'gap: 6px !important;',
        'min-width: 0 !important;',
      ].join(' ');
      this.titleBoxEl = titleBox;

      const title = document.createElement('span');
      title.textContent = '斯诺克瞄准·辅助';
      title.title = '控制面板';
      title.style.cssText = [
        'font-weight: 600 !important;',
        'font-size: 13px !important;',
        'color: #f0f4ee !important;',
        'letter-spacing: 0.5px !important;',
        'white-space: nowrap !important;',
        'user-select: none !important;',
      ].join(' ');
      this.titleEl = title;

      const versionBadge = document.createElement('span');
      versionBadge.id = 'snooker-panel-version-badge';
      versionBadge.textContent = 'v' + SCRIPT_VERSION;
      versionBadge.title = '当前脚本版本: v' + SCRIPT_VERSION;
      versionBadge.style.cssText = [
        'font-size: 10px !important;',
        'font-weight: 700 !important;',
        'color: #00ff88 !important;',
        'background: rgba(0, 255, 136, 0.12) !important;',
        'border: 1px solid rgba(0, 255, 136, 0.35) !important;',
        'border-radius: 4px !important;',
        'padding: 1px 5px !important;',
        'line-height: 1.2 !important;',
        'display: inline-flex !important;',
        'align-items: center !important;',
        'justify-content: center !important;',
        'letter-spacing: 0.3px !important;',
        'user-select: none !important;',
      ].join(' ');
      this.versionBadgeEl = versionBadge;

      titleBox.append(title, versionBadge);

      this.toggleBtn = document.createElement('button');
      this.toggleBtn.type = 'button';
      this.toggleBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (performance.now() < this._suppressClickUntil) return;
        this._suppressClickUntil = performance.now() + 350;
        if (!this.collapsed) {
          this.setCollapsed(true);
        } else {
          this.setCollapsed(false);
        }
      };
      header.append(titleBox, this.toggleBtn);
      this.panel.appendChild(header);

      this.panel.addEventListener('click', (e) => {
        if (performance.now() < this._suppressClickUntil) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (this.collapsed) {
          e.stopPropagation();
          this._suppressClickUntil = performance.now() + 350;
          this.setCollapsed(false);
        }
      });

      this.body = document.createElement('div');
      this.body.id = 'snooker-panel-body';
      this.body.style.cssText = [
        'margin-top: 6px !important;',
        'width: 100% !important;',
        'flex: 1 1 auto !important;',
        'min-height: 0 !important;',
        'overflow-y: auto !important;',
        'overflow-x: hidden !important;',
        'padding-right: 12px !important;',
        'box-sizing: border-box !important;',
        'touch-action: pan-y !important;',
        '-webkit-overflow-scrolling: touch !important;',
        'overscroll-behavior: contain !important;',
      ].join(' ');
      this.panel.appendChild(this.body);

      // 【每日挑战自动化】一键完成按钮 + 按钮下方状态提示 (v1.7.11)
      const dailyBtn = document.createElement('button');
      dailyBtn.id = 'snooker-daily-challenge-btn';
      dailyBtn.type = 'button';
      this.dailyChallengeBtn = dailyBtn;

      const dailyMsg = document.createElement('div');
      dailyMsg.id = 'snooker-daily-status';
      dailyMsg.style.cssText = [
        'display: none !important;',
        'width: 100% !important;',
        'box-sizing: border-box !important;',
        'margin: 0 0 8px 0 !important;',
        'padding: 6px 8px !important;',
        'border-radius: 6px !important;',
        'font-size: 11.5px !important;',
        'line-height: 1.45 !important;',
        'font-weight: 600 !important;',
        'text-align: left !important;',
        'white-space: normal !important;',
        'word-break: break-all !important;',
        'border: 1px solid rgba(0, 255, 136, 0.45) !important;',
        'background: rgba(6, 18, 12, 0.92) !important;',
        'color: #d9ffe9 !important;',
        'user-select: none !important;',
      ].join(' ');
      this.dailyStatusEl = dailyMsg;
      this._dailyMsgTimer = null;

      const setImp = (el, prop, value) => {
        try { el.style.setProperty(prop, value, 'important'); } catch (_) {}
      };

      this.showDailyMessage = (text, tone, duration) => {
        if (!this.dailyStatusEl) return;
        const palette = {
          info: { border: 'rgba(0, 255, 136, 0.45)', bg: 'rgba(6, 18, 12, 0.92)', fg: '#d9ffe9' },
          success: { border: 'rgba(0, 255, 136, 0.82)', bg: 'rgba(0, 34, 18, 0.95)', fg: '#c9ffde' },
          warn: { border: 'rgba(255, 170, 60, 0.72)', bg: 'rgba(32, 23, 6, 0.95)', fg: '#ffe2b0' },
          error: { border: 'rgba(255, 90, 90, 0.82)', bg: 'rgba(34, 8, 8, 0.95)', fg: '#ffc9c9' },
        };
        const c = palette[tone] || palette.info;
        this.dailyStatusEl.textContent = String(text || '');
        setImp(this.dailyStatusEl, 'border', '1px solid ' + c.border);
        setImp(this.dailyStatusEl, 'background', c.bg);
        setImp(this.dailyStatusEl, 'color', c.fg);
        setImp(this.dailyStatusEl, 'display', 'block');
        if (this._dailyMsgTimer) { clearTimeout(this._dailyMsgTimer); this._dailyMsgTimer = null; }
        const ms = Number(duration);
        if (ms > 0) {
          this._dailyMsgTimer = setTimeout(() => {
            try { if (this.dailyStatusEl) setImp(this.dailyStatusEl, 'display', 'none'); } catch (_) {}
          }, ms);
        }
      };

      this.clearDailyMessage = () => {
        if (this._dailyMsgTimer) { clearTimeout(this._dailyMsgTimer); this._dailyMsgTimer = null; }
        if (this.dailyStatusEl) setImp(this.dailyStatusEl, 'display', 'none');
      };

      this.updateDailyChallengeBtn = () => {
        if (!this.dailyChallengeBtn) return;
        let engineRunning = false;
        let phase = 'idle';
        let progress = '';
        try {
          engineRunning = Boolean(typeof DailyChallengeEngine !== 'undefined' && DailyChallengeEngine && DailyChallengeEngine.running);
        } catch (_) {}
        try {
          if (typeof DailyRunner !== 'undefined' && DailyRunner) {
            phase = DailyRunner.phase || 'idle';
            progress = typeof DailyRunner.progressText === 'function' ? DailyRunner.progressText() : '';
          }
        } catch (_) {}
        const busy = engineRunning || phase === 'playing' || phase === 'claiming' || phase === 'advancing';
        let canSkip = false;
        try {
          if (typeof DailyRunner !== 'undefined' && DailyRunner && phase !== 'idle' && phase !== 'done') {
            canSkip = Boolean(DailyRunner.currentId || DailyRunner.nextId);
          }
        } catch (_) {}
        if (this.dailySkipBtn) {
          setImp(this.dailySkipBtn, 'display', canSkip ? 'flex' : 'none');
        }
        if (busy) {
          this.dailyChallengeBtn.textContent = '⏸️ 暂停自动化' + (progress ? '（' + progress + '）' : '');
          this.dailyChallengeBtn.style.background = 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)';
          this.dailyChallengeBtn.style.color = '#ffffff';
          this.dailyChallengeBtn.style.boxShadow = '0 0 10px rgba(255, 77, 79, 0.5)';
          return;
        }
        if (phase === 'done') {
          this.dailyChallengeBtn.textContent = '✅ 今日每日挑战已完成';
          this.dailyChallengeBtn.style.background = 'linear-gradient(135deg, #2f6b4f 0%, #3fa878 100%)';
          this.dailyChallengeBtn.style.color = '#ffffff';
          this.dailyChallengeBtn.style.boxShadow = '0 0 10px rgba(63, 168, 120, 0.35)';
          return;
        }
        this.dailyChallengeBtn.textContent = '🚀 开始自动化完成每日挑战';
        this.dailyChallengeBtn.style.background = 'linear-gradient(135deg, #00b05b 0%, #00ff88 100%)';
        this.dailyChallengeBtn.style.color = '#081726';
        this.dailyChallengeBtn.style.boxShadow = '0 0 10px rgba(0, 255, 136, 0.4)';
      };

      dailyBtn.style.cssText = [
        'width: 100% !important;',
        'padding: 8px 10px !important;',
        'margin: 2px 0 8px 0 !important;',
        'border: none !important;',
        'border-radius: 6px !important;',
        'font-size: 12.5px !important;',
        'font-weight: 700 !important;',
        'cursor: pointer !important;',
        'text-align: center !important;',
        'display: flex !important;',
        'align-items: center !important;',
        'justify-content: center !important;',
        'letter-spacing: 0.5px !important;',
        'transition: all 0.2s ease !important;',
        'user-select: none !important;',
      ].join(' ');

      dailyBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof DailyRunner !== 'undefined' && DailyRunner && DailyRunner._startBusy) return;
        try {
          if (typeof DailyRunner !== 'undefined' && DailyRunner && typeof DailyRunner.startAutoRun === 'function') {
            if (typeof DailyRunner.isBusy === 'function' && DailyRunner.isBusy()) {
              DailyRunner.pause('已从面板暂停自动完成每日挑战');
            } else {
              Promise.resolve(DailyRunner.startAutoRun()).catch((err) => {
                try { this.showDailyMessage('启动失败：' + (err && err.message ? err.message : err), 'error', 5000); } catch (_) {}
              });
            }
          } else if (typeof DailyChallengeEngine !== 'undefined' && DailyChallengeEngine) {
            DailyChallengeEngine.toggle();
          }
        } catch (_) {}
        this.updateDailyChallengeBtn();
      };
      this.updateDailyChallengeBtn();
      this.body.appendChild(dailyBtn);
      this.body.appendChild(dailyMsg);

      // 【跳过本关】某关反复清不掉时，保留未完成并继续下一关（v1.7.11）
      const skipBtn = document.createElement('button');
      skipBtn.id = 'snooker-daily-skip-btn';
      skipBtn.type = 'button';
      skipBtn.textContent = '⏭️ 跳过当前关卡（保留未完成）';
      skipBtn.style.cssText = [
        'width: 100% !important;',
        'padding: 6px 8px !important;',
        'margin: -2px 0 8px 0 !important;',
        'border: 1px solid rgba(255, 170, 60, 0.55) !important;',
        'border-radius: 6px !important;',
        'background: rgba(255, 170, 60, 0.14) !important;',
        'color: #ffcf8a !important;',
        'font-size: 11.5px !important;',
        'font-weight: 600 !important;',
        'cursor: pointer !important;',
        'display: none !important;',
        'align-items: center !important;',
        'justify-content: center !important;',
        'user-select: none !important;',
      ].join(' ');
      skipBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          if (typeof DailyRunner !== 'undefined' && DailyRunner && typeof DailyRunner.skipCurrent === 'function') {
            DailyRunner.skipCurrent();
          }
        } catch (_) {}
        this.updateDailyChallengeBtn();
      };
      this.dailySkipBtn = skipBtn;
      this.body.appendChild(skipBtn);
      this.updateDailyChallengeBtn();

      // 【真实走位 vs 蓝色落位预测线】轨迹对比记录与导出按钮组 (v1.7.7)
      const recordRow = document.createElement('div');
      recordRow.id = 'snooker-trajectory-record-group';
      recordRow.style.cssText = [
        'display: grid !important;',
        'grid-template-columns: 1fr 1fr !important;',
        'gap: 6px !important;',
        'margin: 0 0 8px 0 !important;',
        'width: 100% !important;',
        'box-sizing: border-box !important;',
      ].join(' ');

      const recordBtn = document.createElement('button');
      recordBtn.id = 'snooker-record-toggle-btn';
      recordBtn.type = 'button';
      this.recordBtn = recordBtn;

      const exportBtn = document.createElement('button');
      exportBtn.id = 'snooker-record-export-btn';
      exportBtn.type = 'button';
      this.exportBtn = exportBtn;

      recordBtn.style.cssText = [
        'width: 100% !important;',
        'padding: 7px 4px !important;',
        'border: 1px solid rgba(0, 255, 136, 0.35) !important;',
        'border-radius: 6px !important;',
        'font-size: 11.5px !important;',
        'font-weight: 700 !important;',
        'cursor: pointer !important;',
        'text-align: center !important;',
        'display: flex !important;',
        'align-items: center !important;',
        'justify-content: center !important;',
        'letter-spacing: 0.3px !important;',
        'transition: all 0.2s ease !important;',
        'user-select: none !important;',
        'white-space: nowrap !important;',
      ].join(' ');

      exportBtn.style.cssText = [
        'width: 100% !important;',
        'padding: 7px 4px !important;',
        'border: 1px solid rgba(134, 207, 255, 0.45) !important;',
        'border-radius: 6px !important;',
        'font-size: 11.5px !important;',
        'font-weight: 700 !important;',
        'cursor: pointer !important;',
        'text-align: center !important;',
        'display: flex !important;',
        'align-items: center !important;',
        'justify-content: center !important;',
        'letter-spacing: 0.3px !important;',
        'transition: all 0.2s ease !important;',
        'user-select: none !important;',
        'white-space: nowrap !important;',
      ].join(' ');

      this.updateRecordButtons = () => {
        if (!this.recordBtn || !this.exportBtn) return;
        const isRec = Boolean(typeof TrajectoryRecorder !== 'undefined' && TrajectoryRecorder.isRecording);
        const count = (typeof TrajectoryRecorder !== 'undefined' && Array.isArray(TrajectoryRecorder.records))
          ? TrajectoryRecorder.records.length
          : 0;

        if (isRec) {
          this.recordBtn.textContent = count > 0 ? `⏹️ 停止记录 (${count}杆)` : '⏹️ 停止记录';
          this.recordBtn.style.background = 'linear-gradient(135deg, #d32f2f 0%, #ff5252 100%)';
          this.recordBtn.style.color = '#ffffff';
          this.recordBtn.style.borderColor = 'rgba(255, 82, 82, 0.8)';
          this.recordBtn.style.boxShadow = '0 0 10px rgba(255, 82, 82, 0.5)';
        } else {
          this.recordBtn.textContent = count > 0 ? `⏺️ 开始记录 (${count}杆)` : '⏺️ 开始记录';
          this.recordBtn.style.background = 'linear-gradient(135deg, #1b382b 0%, #24523b 100%)';
          this.recordBtn.style.color = '#7df7b0';
          this.recordBtn.style.borderColor = 'rgba(0, 255, 136, 0.35)';
          this.recordBtn.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
        }

        this.exportBtn.textContent = count > 0 ? `💾 导出记录 (${count}杆)` : '💾 导出记录';
        if (count > 0) {
          this.exportBtn.style.background = 'linear-gradient(135deg, #174266 0%, #1f649c 100%)';
          this.exportBtn.style.color = '#d6f0ff';
          this.exportBtn.style.borderColor = 'rgba(134, 207, 255, 0.6)';
          this.exportBtn.style.boxShadow = '0 0 8px rgba(134, 207, 255, 0.35)';
        } else {
          this.exportBtn.style.background = 'rgba(25, 45, 65, 0.65)';
          this.exportBtn.style.color = '#9bb0c4';
          this.exportBtn.style.borderColor = 'rgba(134, 207, 255, 0.2)';
          this.exportBtn.style.boxShadow = 'none';
        }
      };

      recordBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof TrajectoryRecorder !== 'undefined') {
          TrajectoryRecorder.toggleRecording();
        }
        this.updateRecordButtons();
      };

      exportBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof TrajectoryRecorder !== 'undefined') {
          TrajectoryRecorder.exportRecords();
        }
        this.updateRecordButtons();
      };

      this.updateRecordButtons();
      recordRow.appendChild(recordBtn);
      recordRow.appendChild(exportBtn);
      this.body.appendChild(recordRow);

      const row = (label, key) => {
        const div = document.createElement('label');
        div.style.cssText = [
          'display: flex !important;',
          'align-items: center !important;',
          'justify-content: flex-start !important;',
          'gap: 7px !important;',
          'margin: 3px 0 !important;',
          'padding: 2px 0 !important;',
          'cursor: pointer !important;',
          'font-size: 12px !important;',
          'color: #e2ebe0 !important;',
          'width: 100% !important;',
          'box-sizing: border-box !important;',
          'white-space: nowrap !important;',
        ].join(' ');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = CONFIG[key];
        cb.style.cssText = [
          'margin: 0 !important;',
          'padding: 0 !important;',
          'width: 14px !important;',
          'height: 14px !important;',
          'min-width: 14px !important;',
          'min-height: 14px !important;',
          'flex-shrink: 0 !important;',
          'cursor: pointer !important;',
          'accent-color: #00ff88 !important;',
        ].join(' ');
        cb.onchange = () => {
          if (performance.now() < this._suppressClickUntil) return;
          CONFIG[key] = cb.checked;
          if (key === 'showHudPill' && !cb.checked) {
            hudPill.hide();
          }
          saveToggles();
        };
        this._checkboxes[key] = cb;

        const span = document.createElement('span');
        span.textContent = label;
        span.style.cssText = [
          'font-size: 12px !important;',
          'color: #e2ebe0 !important;',
          'white-space: nowrap !important;',
          'user-select: none !important;',
          'line-height: 1.4 !important;',
        ].join(' ');

        div.append(cb, span);
        this.body.appendChild(div);
      };

      row('目标球→袋口（绿色瞄准线）', 'showObjectLine');
      row('母球→目标球（白色瞄准线）', 'showCueLine');
      row('物理引擎母球走位预测弧线', 'showCuePostTrajectory');
      row('母球吃库反弹折线', 'showCushionRebound');


      row('信息浮标', 'showHudPill');
      row('调试信息', 'showDebug');

      const tipHint = document.createElement('div');
      tipHint.textContent = '💡 提示: 单指双击屏幕可隐藏/重新显示控制面板 (空格键亦可启停自动击球)';
      tipHint.style.cssText = 'font-size: 11px !important; color: #a8b8a5 !important; margin: 3px 0 6px 0 !important;';
      this.body.appendChild(tipHint);

      this.debugLine = document.createElement('div');
      this.debugLine.style.cssText = [
        'margin-top: 6px !important;',
        'color: #9cb09b !important;',
        'font-size: 11px !important;',
        'white-space: pre-line !important;',
        'line-height: 1.4 !important;',
        'width: 100% !important;',
        'box-sizing: border-box !important;',
      ].join(' ');
      this.body.appendChild(this.debugLine);

      document.body.appendChild(this.panel);
      this._built = true;

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => this.clampPanelIntoViewport(), { passive: true });
      }

      let initialCollapsed = true;
      try {
        const saved = localStorage.getItem(CONFIG.panelCollapseKey);
        if (saved !== null) initialCollapsed = saved === '1';
      } catch (_) {}
      this.circleHidden = this.loadCircleHidden();
      this.setCollapsed(initialCollapsed);
      if (this.circleHidden && this.panel) {
        this.panel.style.setProperty('display', 'none', 'important');
      }
    },

    bindDragEvents() {
      let isPointerDown = false;
      let isLongPressActive = false;
      let didDrag = false;
      let activePointerId = null;
      let startX = 0, startY = 0;
      let panelStartLeft = 0, panelStartTop = 0;
      let pressTimer = null;

      // 展开状态下支持在控制面板界面直接上下滑动来查看完整内容（无需显式滚动条）
      let isPanelSwiping = false;
      let swipeStartY = 0;
      let swipeStartScroll = 0;
      let hasSwiped = false;

      this.panel.addEventListener('click', (e) => {
        if (performance.now() < this._suppressClickUntil) {
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);

      this.panel.addEventListener('pointerdown', (e) => {
        // 如果当前是展开状态：严禁拖拽移动面板！仅支持在面板界面直接滑动查看内容
        if (!this.collapsed) {
          // 允许收起按钮点击正常工作
          if (this.toggleBtn && (e.target === this.toggleBtn || this.toggleBtn.contains(e.target))) {
            return;
          }
          if (!this.body) return;
          isPanelSwiping = true;
          hasSwiped = false;
          swipeStartY = e.clientY;
          swipeStartScroll = this.body.scrollTop;
          return;
        }

        // 仅在收起为加号圆圈时：长按0.3秒才允许拖动圆圈位置！
        isPointerDown = true;
        isLongPressActive = false;
        didDrag = false;
        activePointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;

        const rect = this.panel.getBoundingClientRect();
        panelStartLeft = rect.left;
        panelStartTop = rect.top;

        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          pressTimer = null;
          isLongPressActive = true;
          try {
            if (activePointerId != null && this.panel.setPointerCapture) {
              this.panel.setPointerCapture(activePointerId);
            }
          } catch (_) {}
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) {}
          this.setDragVisual(true);
        }, 300);
      });

      window.addEventListener('pointermove', (e) => {
        // 1. 展开状态下：用户直接在面板界面上下滑动浏览内容
        if (isPanelSwiping && this.body && !this.collapsed) {
          const dy = e.clientY - swipeStartY;
          if (Math.abs(dy) > 3) {
            hasSwiped = true;
            this.body.scrollTop = swipeStartScroll - dy;
          }
          return;
        }

        // 2. 收起状态下：长按加号圆圈后的拖动移动
        if (!isPointerDown || !this.collapsed) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.hypot(dx, dy);

        if (!isLongPressActive) {
          if (dist > 8 && pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
          return;
        }

        e.preventDefault();
        didDrag = true;

        const vv = window.visualViewport;
        const winW = (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 800;
        const winH = (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 600;
        const pW = 21;
        const pH = 21;

        const newLeft = clamp(panelStartLeft + dx, 0, Math.max(0, winW - pW));
        const newTop = clamp(panelStartTop + dy, 0, Math.max(0, winH - pH));

        this.panel.style.left = newLeft + 'px';
        this.panel.style.top = newTop + 'px';
        this.panel.style.right = 'auto';
        this.panel.style.bottom = 'auto';
      });

      const onPointerUp = (e) => {
        // 处理直接滑动结束
        if (isPanelSwiping) {
          if (hasSwiped) {
            // 滑动过，阻止触发随后的点击事件（防止滑动时光标/手指松开误触复选框或按钮）
            this._suppressClickUntil = performance.now() + 200;
          }
          isPanelSwiping = false;
          hasSwiped = false;
        }

        // 处理圆圈拖动结束
        if (!isPointerDown) return;
        isPointerDown = false;
        clearTimeout(pressTimer);
        pressTimer = null;

        try {
          if (activePointerId != null && this.panel.hasPointerCapture && this.panel.hasPointerCapture(activePointerId)) {
            this.panel.releasePointerCapture(activePointerId);
          }
        } catch (_) {}
        activePointerId = null;

        if (isLongPressActive) {
          this.setDragVisual(false);
          this._suppressClickUntil = performance.now() + 350;
          if (didDrag) {
            const rect = this.panel.getBoundingClientRect();
            const left = Math.round(rect.left);
            const top = Math.round(rect.top);
            this.saveCirclePos(left, top);
          }
          isLongPressActive = false;
          didDrag = false;
        } else {
          if (this.collapsed) {
            e.stopPropagation();
            this.handlePlusClick();
          }
        }
      };

      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    },

    setCollapsed(collapsed) {
      this.collapsed = Boolean(collapsed);
      const c = this.collapsed;

      if (!c && this._plusExpandTimer) {
        clearTimeout(this._plusExpandTimer);
        this._plusExpandTimer = null;
      }

      if (this.circleHidden) {
        if (this.panel) {
          this.panel.style.setProperty('display', 'none', 'important');
        }
        return;
      }

      if (c) {
        if (this.body) this.body.style.display = 'none';
        if (this.titleBoxEl) this.titleBoxEl.style.display = 'none';
        if (this.titleEl) this.titleEl.style.display = 'none';
        if (this.headerEl) {
          this.headerEl.style.cssText = [
            'display: flex !important;',
            'align-items: center !important;',
            'justify-content: center !important;',
            'width: 21px !important;',
            'height: 21px !important;',
            'padding: 0 !important;',
            'margin: 0 !important;',
            'cursor: pointer !important;',
            'pointer-events: auto !important;',
          ].join(' ');
        }
        if (this.toggleBtn) {
          this.toggleBtn.textContent = '＋';
          this.toggleBtn.title = '单击展开面板 (长按0.3s拖动)';
          this.toggleBtn.style.cssText = [
            'all: unset !important;',
            'display: inline-flex !important;',
            'align-items: center !important;',
            'justify-content: center !important;',
            'width: 21px !important;',
            'height: 21px !important;',
            'color: #173121 !important;',
            'font-size: 14px !important;',
            'font-weight: 700 !important;',
            'line-height: 1 !important;',
            'cursor: pointer !important;',
            'pointer-events: auto !important;',
          ].join(' ');
        }
        if (this.panel) {
          this.panel.style.display = 'block';
          this.panel.style.width = '21px';
          this.panel.style.minWidth = '21px';
          this.panel.style.maxWidth = '21px';
          this.panel.style.height = '21px';
          this.panel.style.minHeight = '21px';
          this.panel.style.maxHeight = '21px';
          this.panel.style.padding = '0';
          this.panel.style.borderRadius = '50%';
          this.panel.style.background = '#d8c694';
          this.panel.style.setProperty(
            'box-shadow',
            '0 4px 14px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.25)',
            'important'
          );
          this.panel.style.backdropFilter = 'none';
          this.panel.style.overflow = 'hidden';
          this.panel.style.cursor = 'pointer';
          this.panel.style.touchAction = 'none';
          this.panel.style.pointerEvents = 'auto';
          this.panel.title = '单击展开控制面板 (长按0.3秒可拖动)';
          // 绝对恢复到用户设定的加号圆圈位置，绝不改变
          this.panel.style.left = this._circlePos.left + 'px';
          this.panel.style.top = this._circlePos.top + 'px';
          this.panel.style.right = 'auto';
          this.panel.style.bottom = 'auto';
        }
      } else {
        if (this.panel) {
          this.panel.style.display = 'flex';
          this.panel.style.flexDirection = 'column';
          this.panel.style.width = '300px';
          this.panel.style.minWidth = '295px';
          this.panel.style.maxWidth = '315px';
          this.panel.style.height = 'auto';
          this.panel.style.minHeight = 'auto';
          this.panel.style.maxHeight = 'min(92vh, 92svh, 440px)';
          this.panel.style.padding = '8px 8px 8px 12px';
          this.panel.style.borderRadius = '8px';
          this.panel.style.background = 'rgba(14, 28, 20, 0.94)';
          this.panel.style.setProperty(
            'box-shadow',
            '0 6px 22px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.10)',
            'important'
          );
          this.panel.style.backdropFilter = 'blur(8px)';
          this.panel.style.overflow = 'hidden';
          this.panel.style.cursor = 'default';
          this.panel.style.touchAction = 'pan-y'; // 展开时支持直接上下滑动
          this.panel.title = '';
        }

        if (this.titleBoxEl) this.titleBoxEl.style.display = 'flex';
        if (this.titleEl) this.titleEl.style.display = 'inline';
        if (this.body) {
          this.body.style.display = 'block';
          this.body.style.maxHeight = 'calc(min(92vh, 92svh, 440px) - 34px)';
        }
        if (this.headerEl) {
          this.headerEl.style.cssText = [
            'display: flex !important;',
            'align-items: center !important;',
            'justify-content: space-between !important;',
            'gap: 8px !important;',
            'width: 100% !important;',
            'height: 22px !important;',
            'flex-shrink: 0 !important;',
            'cursor: default !important;',
            'box-sizing: border-box !important;',
          ].join(' ');
        }
        if (this.toggleBtn) {
          this.toggleBtn.textContent = '－';
          this.toggleBtn.title = '收起为圆圈加号';
          this.toggleBtn.style.cssText = [
            'all: unset !important;',
            'display: inline-flex !important;',
            'align-items: center !important;',
            'justify-content: center !important;',
            'width: 20px !important;',
            'height: 20px !important;',
            'min-width: 20px !important;',
            'min-height: 20px !important;',
            'max-width: 20px !important;',
            'max-height: 20px !important;',
            'box-sizing: border-box !important;',
            'border: none !important;',
            'border-radius: 4px !important;',
            'background: rgba(255, 255, 255, 0.16) !important;',
            'color: #f0f2e9 !important;',
            'cursor: pointer !important;',
            'font-size: 13px !important;',
            'font-weight: 500 !important;',
            'line-height: 1 !important;',
            'padding: 0 !important;',
            'margin: 0 !important;',
          ].join(' ');
        }
        // 计算展开时的临时展示位置，保证在屏幕内完整显示，绝不污染 _circlePos
        this.clampPanelIntoViewport();
      }

      try {
        localStorage.setItem(CONFIG.panelCollapseKey, c ? '1' : '0');
      } catch (_) {}
    },

    formatDebugText(pred, ready, customStatus) {
      const frameTag = window === window.top
        ? (projection.canvas && projection.canvas.ownerDocument !== document ? '顶层穿透(iframe)' : '顶层窗口')
        : '子框架(iframe)';

      if (customStatus) {
        return `状态: ${customStatus}\n运行帧: ${frameTag}`;
      }
      const d = overlay.debug;
      const srcMap = {
        geometry: '几何预测',
        engine: '原生Worker',
        engineSim: '物理引擎微仿真',
      };
      const predSrc = pred && pred.target ? (srcMap[pred.target.source] || pred.target.source) : '-';
      let powerLine = '力度: -';
      if (pred && pred.shot) {
        const s = pred.shot;
        powerLine = `力度: ${Math.round(s.power)}% (初速${Math.round(s.effSpeed)}mm/s)`;
      }
      const roomLine = (pred && pred.roomMode && pred.roomMode.label) ? `模式: ${pred.roomMode.label}\n` : '';
      const engLine = `仿真: ${engineSim.status === 'ready' ? `就绪 (${engineSim.simMs}ms/${engineSim.frames}帧)` : (engineSim.status === 'loading' ? '加载中...' : '备轨/未启用')}\n`;
      let recLine = '';
      if (typeof TrajectoryRecorder !== 'undefined') {
        const isRec = TrajectoryRecorder.isRecording;
        const count = TrajectoryRecorder.records.length;
        if (isRec) {
          recLine = `\n[🔴 录制中] 已录 ${count} 杆`;
        } else if (count > 0) {
          const last = TrajectoryRecorder.records[count - 1];
          const err = last.comparisonMetrics?.finalRestErrorMm;
          recLine = `\n[已录 ${count} 杆] 上杆误差: ${err != null ? err.toFixed(1) + 'mm' : '-'}`;
        }
      }
      return `${roomLine}${powerLine}\n${engLine}投影: ${d.source}${CONFIG.flatOnCloth ? '(3D贴台)' : ''}\n预测: ${predSrc}\n活跃球: ${d.balls}\n目标: ${d.target}\n袋口: ${d.pocket}\n状态: ${ready ? '就绪' : '未就绪'}\n运行帧: ${frameTag}${recLine}`;
    },

    updateDebug(pred, ready, customStatus) {
      const text = CONFIG.showDebug ? this.formatDebugText(pred, ready, customStatus) : '';

      if (window !== window.top && projection.canvas && projection.canvas.isConnected) {
        publishFrameDebugToTop(text);
      }

      if (!this.debugLine) return;
      this.debugLine.textContent = text;
    },
  };

  /* ================================================================== */
  /* 主循环                                                              */
  /* ================================================================== */

  function kindLabel(kind) {
    return ({ cue: '母球', red: '红球', yellow: '黄球', green: '绿球', brown: '咖啡球', blue: '蓝球', pink: '粉球', black: '黑球' })[kind] || kind || '?';
  }

  let _lastDomDedupe = 0;

  function enforceDomSingletons() {
    const now = performance.now();
    if (now - _lastDomDedupe < 1500) return;
    _lastDomDedupe = now;

    const panels = document.querySelectorAll('#snooker-aim-panel');
    if (panels.length > 1 && ui.panel) {
      for (const el of panels) {
        if (el !== ui.panel) el.remove();
      }
    }

    const targetDoc = overlay.getTargetDoc();
    const overlays = targetDoc.querySelectorAll('#snooker-aim-overlay');
    if (overlays.length > 1 && overlay.canvas) {
      for (const el of overlays) {
        if (el !== overlay.canvas) el.remove();
      }
    }

    // 全局穿透式信息浮标单例清理：清除所有 candidate windows 下任何非当前活跃 hudPill.el 的幽灵浮标
    cleanAllOrphanHudPills(true);
  }

  function scheduleNextFrame(idle) {
    if (idle) {
      setTimeout(() => requestAnimationFrame(frame), 250);
    } else {
      requestAnimationFrame(frame);
    }
  }

  let _lastFrameCleanTime = 0;
  let _nonTableFrames = 0;

  function frame() {
    try {
      ensureUiBuilt();
      enforceDomSingletons();
      bindKeyboardShortcuts(document);

      const nowMs = performance.now();
      if (nowMs - _lastFrameCleanTime > 2500) {
        _lastFrameCleanTime = nowMs;
        removeUiFromOtherFrames();
      }

      if (window !== window.top) {
        const localC = findGameCanvasInDoc(document);
        try { document.__snookerAimFrameManaged = Boolean(localC); } catch (_) {}
      }

      if (window === window.top) {
        const remote = readActiveRemoteDebug();
        if (remote) {
          if (overlay.canvas) overlay.destroy();
          _lastGeomKey = null;
          _lastGeomPred = null;
          _lastRenderKey = null;
          _lastFullPred = null;
          if (ui.debugLine) {
            ui.debugLine.textContent = CONFIG.showDebug ? remote.text : '';
          }
          scheduleNextFrame(true);
          return;
        }
      }

      installCoreHook();
      projection.init();

      const hasCanvas = Boolean(projection.canvas && isCanvasActuallyVisible(projection.canvas));
      const rawState = hasCanvas ? extractRawState() : null;
      const isPlayable = isPlayableTableState(rawState);
      const inLobby = isPlayable ? false : isLobbyMenuVisible();
      const isSettlement = (inLobby || isPlayable) ? false : isSettlementOrGameOverScreen(rawState);
      const isLoading = (inLobby || isPlayable || isSettlement) ? false : isLoadingScreen(rawState);
      const inLobbyOrSettlementOrLoading = isPlayable ? false : (inLobby || isSettlement || isLoading);

      // 【每日挑战全自动 v1.7.11】每帧驱动：进房免点击开局 / 清台领取 / 状态机推进
      try {
        if (typeof DailyRunner !== 'undefined' && DailyRunner) {
          DailyRunner.tick(rawState, { isPlayable, inLobby, isSettlement, isLoading, hasCanvas });
        }
      } catch (err) {
        devLog('warn', '[每日挑战] tick 异常', err);
      }

      // 核心防护 (v1.7.5)：若已离开可玩台面进入大厅、结算或未检测到有效画布，强制解除击球走位锁
      if (inLobby || isSettlement || !hasCanvas) {
        _shotMotionLocked = false;
        _wasInShot = false;
        _lastShotPred = null;
        _lastCueCushionPred = null;
        clearRetainedShotPrediction();
      }

      const state = (hasCanvas && (!inLobbyOrSettlementOrLoading || _shotMotionLocked)) ? rawState : null;

      if ((!hasCanvas || !state || inLobbyOrSettlementOrLoading) && !_shotMotionLocked) {
        _nonTableFrames++;
        if (overlay.canvas) {
          overlay.clear();
          if (!hasCanvas) overlay.destroy();
        }
        // 核心修复 (v1.7.5)：离开球桌、处于大厅或结算时，立即隐藏并销毁信息浮标，彻底清除跨文档幽灵浮标
        hudPill.hide();
        hudPill.destroy();
        cleanAllOrphanHudPills(false);
        if (typeof TrajectoryRecorder !== 'undefined' && TrajectoryRecorder.activeSession) {
          TrajectoryRecorder.activeSession = null;
        }

        _lastGeomKey = null;
        _lastGeomPred = null;
        _lastRenderKey = null;
        _lastFullPred = null;
        _lastShotPred = null;
        _lastCueCushionPred = null;
        clearRetainedShotPrediction();
        _wasInShot = false;
        _shotMotionLocked = false;
        _shotHiddenSince = 0;
        resetTurnPowerState();
        if (DailyChallengeEngine.running && _nonTableFrames > 25) {
          DailyChallengeEngine.stop('离开球桌或对局结束，已退出自动化击球');
        }

        let waitReason = '辅助脚本已就绪 · 待进入球桌';
        if (isSettlement) {
          waitReason = '本局已结束 · 结算展示中';
        } else if (isLoading) {
          waitReason = '加载对局中 · 请稍候...';
        } else if (inLobby) {
          waitReason = '大厅待机中 · 待进入球桌';
        } else if (hasCanvas && !rawState) {
          waitReason = '已检测到画布 · 等待对局状态初始化';
        }
        ui.updateDebug(null, false, waitReason);
        scheduleNextFrame(true);
        return;
      }

      _nonTableFrames = 0;

      if (projection.canvas.ownerDocument) {
        bindKeyboardShortcuts(projection.canvas.ownerDocument);
      }
      overlay.ensure();
      overlay.syncSize();
      projection.source = projection.resolveSource();

      const configChanged = _lastConfigVersion !== _configVersion;
      const shot = isShotOrMoving(state);
      const still = ballsActuallyStill(state);
      if (!shot) {
        // 只记录玩家真正交互后的力度；停球后游戏回填的上一杆旧力度会被 gate 成 0，
        // 不能让它污染下一杆的快照兜底力度。
        const observedPower = resolveEffectivePower(state);
        if (observedPower > 2) {
          _lastAimPowerObserved = clamp(observedPower, 0, 100);
        }
      }

      if (shot || (_wasInShot && !still) || _shotMotionLocked) {
        // 出杆运动阶段持续清空“本杆蓄力”状态；必须在 buildShotSnapshotPrediction 之前重置，
        // 否则上一杆停球基准会把本杆真实力度 gate 成 0，导致冻结快照按 0% 推演。
        _turnPowerActive = false;
        _turnHasInteracted = false;
        _settledRawPower = null;

        if (!_wasInShot) {
          // 本杆刚刚触发击球出杆！用实际出杆力度重建一次预测并冻结，
          // 其中目标球吃库线使用冻结快照；白线/绿线按实时球位擦除，
          // 母球吃库线与落位线整条保留到全台停球后清除。
          _wasInShot = true;
          _shotMotionLocked = true;
          resetTargetMotionState();
          resetCueMotionState();
          // v1.9.9：下一杆出杆瞬间先清掉上一杆的目标球反弹冻结线，再建立本杆快照。
          // 这样旧线严格在“下一杆出杆”这一帧消失，而不是停球后再被新瞄准线覆盖。
          clearRetainedShotPrediction();
          // 先清空上一杆的力度基准，避免本杆力度缺失时把上一杆的值继续当成本杆。
          _lastShotPowerForTurn = null;
          const shotSnapshot = buildShotSnapshotPrediction(state);
          const retainedSource = shotSnapshot || _lastActualAimPred || _lastFullPred || _lastShotPred || _lastCueCushionPred;
          _retainedShotPred = freezeRetainedPrediction(
            normalizeRetainedPower(retainedSource)
          );
          // v1.9.12：母球吃库反弹折线同样在出杆这一帧定格；
          // 若快照为空则退回本杆实际来源，绝不使用之后重新预测的路径。
          retainCueCushionPath(_retainedShotPred || retainedSource);
          // 记录本杆真实出杆力度，停球后作为下一杆的旧力度基准。
          const retainedPower = Number(
            _retainedShotPred && _retainedShotPred.shot && _retainedShotPred.shot.power != null
              ? _retainedShotPred.shot.power
              : (_retainedShotPred && _retainedShotPred.power)
          );
          const fallbackShotPower = Number(resolveShotSnapshotPower(state));
          const gatePower = (Number.isFinite(retainedPower) && retainedPower > 2)
            ? retainedPower
            : (Number.isFinite(fallbackShotPower) && fallbackShotPower > 2 ? fallbackShotPower : null);
          if (gatePower != null) _lastShotPowerForTurn = clamp(gatePower, 0, 100);
          if (typeof TrajectoryRecorder !== 'undefined') {
            TrajectoryRecorder.onShotStart(state, _retainedShotPred || retainedSource);
          }
        }
        if (!_shotHiddenSince) _shotHiddenSince = performance.now();
        const now = performance.now();
        const forceShow = configChanged || now < _forceShowUntil;
        const autoRecover = (now - _shotHiddenSince > 18000);
        // 出杆第一帧有时 game state 还没更新球速，ballsActuallyStill 会短暂误报“已静止”。
        // 给 120ms 启动宽限，避免刚出杆就把整条母球吃库折线 clear 掉。
        const shotGraceActive = _shotHiddenSince > 0 && (now - _shotHiddenSince) < 120;

        if (still && !shotGraceActive) {
          if (typeof TrajectoryRecorder !== 'undefined') {
            TrajectoryRecorder.onShotEnd(state);
          }
          // v1.9.13：全台完全停球即结束本轮快照生命周期。
          // 上一版的“目标球吃库线保留到下一杆”会让蓝色虚影停在台面，
          // 与母球吃库线同色时尤其容易被看成未清除；现在统一丢弃全部冻结线，
          // 静态层只绘制当前瞄准方向的实时预测。
          _shotMotionLocked = false;
          _wasInShot = false;
          _lastShotPred = null;
          _lastCueCushionPred = null;
          clearRetainedShotPrediction();
          // 强制丢弃可能还停留在出杆前的几何缓存，避免静态层复用旧 cuePost。
          _lastGeomPred = null;
          _lastGeomKey = null;
          _lastFullPred = null;
          _shotHiddenSince = 0;
          resetTargetMotionState();
          resetCueMotionState();
          _lastRenderKey = null;
          _settledRawPower = resolveSettledPowerBaseline(state);
          // 本杆已结束：清掉上一杆的力度兜底，下一杆必须重新观测/重建。
          resetShotPowerFallbacks();
        } else {
          // 只要有任何球（尤其是母球）还在运动，强制保持锁定！
          _shotMotionLocked = true;
          if (autoRecover) {
            if (typeof TrajectoryRecorder !== 'undefined') {
              TrajectoryRecorder.onShotEnd(state);
            }
            _shotMotionLocked = false;
            _wasInShot = false;
            _lastShotPred = null;
            _lastCueCushionPred = null;
            clearRetainedShotPrediction();
            _shotHiddenSince = 0;
            resetTargetMotionState();
            resetCueMotionState();
            overlay.clear();
            _settledRawPower = resolveSettledPowerBaseline(state);
            resetShotPowerFallbacks();
          } else if (!forceShow) {
            if (typeof TrajectoryRecorder !== 'undefined') {
              TrajectoryRecorder.onFrame(state);
            }
            // v1.9.10：白线/绿线继续实时擦除；母球吃库线与落位线整条保留；
            // 目标球吃库反弹线只画冻结快照。
            const predToDraw = _retainedShotPred || _lastShotPred || _lastCueCushionPred || _lastFullPred;
            if (predToDraw) {
              overlay.drawPrediction(
                predToDraw,
                state?.balls,
                true /* inMotion: 白/绿线实时擦除；母球吃库线与落位线整条保留 */,
                _retainedShotPred && CONFIG.retainShotAssistLines ? _retainedShotPred : predToDraw,
                {
                  liveWhite: true,
                  liveGreen: true,
                  liveCueCushion: true,
                  // v1.9.12：母球吃库折线从出杆瞬间的快照里整条绘制，
                  // 不随母球位置裁剪；停球后统一清除。
                  frozenCueCushionPath: _retainedCueCushionPath,
                  frozenCueCushionBounds: _retainedCueCushionBounds,
                  liveTargetRebound: false,
                  liveCuePost: true,
                  retainedWhite: false,
                  retainedGreen: false,
                  retainedCueCushion: false,
                  retainedTargetRebound: true,
                  retainedCuePost: false,
                }
              );
              if (DailyChallengeEngine.running) {
                hudPill.show('🤖 自动化击球进行中 · 目标球走位中...', '#00ff88');
              } else {
                const effPower = Math.max(0, Math.round(Number(predToDraw.shot?.power ?? predToDraw.power ?? 0)));
                const targetPocket = predToDraw.target?.pocket?.label || '';
                const statusText = targetPocket
                  ? `🎯 击球走位中... · 目标${targetPocket} · 力度 ${effPower}%`
                  : `🎯 击球走位中... · 力度 ${effPower}%`;
                hudPill.show(statusText, '#00ff88');
              }
            }
            ui.updateDebug(predToDraw, true, '击球走位进行中...');
            DailyChallengeEngine.onFrame(state, shot, still);
            scheduleNextFrame(false);
            return;
          }
        }
      } else {
        if (_wasInShot) {
          if (typeof TrajectoryRecorder !== 'undefined') {
            TrajectoryRecorder.onShotEnd(state);
          }
          _wasInShot = false;
          _shotMotionLocked = false;
          _lastShotPred = null;
          _lastCueCushionPred = null;
          _retainedCueCushionPath = null;
          _retainedCueCushionBounds = null;
          resetTargetMotionState();
          resetCueMotionState();
          _lastRenderKey = null;
          // 弃用本杆的动态预测缓存；下一杆静态帧必须按新的门槛力度重新预测，
          // 不能复用带上一杆力度的 _lastFullPred / _lastGeomPred。
          _lastGeomPred = null;
          _lastGeomKey = null;
          _lastFullPred = null;
          // 不清理 _retainedShotPred，也不 overlay.clear()：仅目标球吃库线冻结保留到下一杆。
          // 白线、绿线、母球吃库线、落位线不再从冻结层绘制，全台停球后即消失。
          _turnPowerActive = false;
          _turnHasInteracted = false;
          _settledRawPower = resolveSettledPowerBaseline(state);
          // 本杆已结束：清掉上一杆的力度兜底，下一杆必须重新观测/重建。
          resetShotPowerFallbacks();
        }
        _shotHiddenSince = 0;
      }

      DailyChallengeEngine.onFrame(state, shot, still);

      const keys = buildStateKeys(state);
      if (!keys) {
        if (overlay.canvas) overlay.clear();
        hudPill.hide();
        _lastRenderKey = null;
        scheduleNextFrame(false);
        return;
      }

      if (_lastRenderKey === keys.renderKey && !configChanged && _lastFullPred && !_sizesDirty) {
        ui.updateDebug(_lastFullPred, overlay.debug.ready);
        scheduleNextFrame(false);
        return;
      }

      if (_lastGeomKey !== keys.geomKey || configChanged || !_lastGeomPred) {
        _lastGeomKey = keys.geomKey;
        _lastGeomPred = predict(state);
      }

      const pred = attachShotPowerMetrics(_lastGeomPred, state);
      // v1.9.13：全台停球后冻结快照已经清空；静态瞄准只画当前预测。
      // 这里的保留入口仅用于极端情况下尚未进入停球分支的瞬态帧兜底。
      // v1.9.15：判定改用「显示层真正会画的那条路径」，而不是未截断的 reboundSegments。
      // 否则预算已把蓝线清空时，还会白传一份什么都画不出来的快照。
      const retainedTargetDisplaySegments = _retainedShotPred
        ? getTargetReboundDisplaySegments(_retainedShotPred.target)
        : null;
      const retainedTargetPred = (_retainedShotPred &&
        CONFIG.retainShotAssistLines &&
        Array.isArray(retainedTargetDisplaySegments) &&
        retainedTargetDisplaySegments.length > 0)
        ? _retainedShotPred
        : null;
      const didDraw = overlay.drawPrediction(
        pred,
        state?.balls,
        false /* inMotion: 静态瞄准预览 */,
        retainedTargetPred,
        {
          liveWhite: true,
          liveGreen: true,
          liveCueCushion: true,
          // 当前瞄准的反弹线始终实时绘制；旧线由 retainedTargetRebound 单独以低 alpha 保留。
          liveTargetRebound: true,
          liveCuePost: true,
          retainedWhite: false,
          retainedGreen: false,
          retainedCueCushion: false,
          retainedTargetRebound: true,
          retainedCuePost: false,
        }
      );
      _lastRenderKey = didDraw ? keys.renderKey : null;
      _lastFullPred = pred;
      const aimPowerNow = Math.max(0, Math.round(Number(pred.shot?.power ?? pred.power ?? 0)));
      if (!shot && aimPowerNow > 2) {
        // 记住“最后一帧高力度静态瞄准预测”：出杆后游戏会清零 power，
        // 但这份预测仍是按实际力度算出的，可作为冻结快照的可靠来源。
        _lastActualAimPred = pred;
      }
      if (pred && pred.cue) {
        const hasValidTrajectory = Array.isArray(pred.cuePostTrajectory) && pred.cuePostTrajectory.length >= 2;
        const hasCushionPath = Boolean(pred.cuePost && Array.isArray(pred.cuePost.cueCushionPaths) &&
          pred.cuePost.cueCushionPaths[0] && pred.cuePost.cueCushionPaths[0].length >= 2);
        const curPower = Math.max(0, Math.round(Number(pred.shot?.power ?? pred.power ?? 0)));
        const isDifferentAim = !_lastShotPred ||
          _lastShotPred.target?.ball?.id !== pred.target?.ball?.id ||
          Math.hypot((_lastShotPred.cue?.x || 0) - pred.cue.x, (_lastShotPred.cue?.y || 0) - pred.cue.y) > 20;

        // 缓存有效瞄准预测快照，供出杆击球过程中持续保留绘制
        if (isDifferentAim || hasValidTrajectory || hasCushionPath || curPower > 2 || !_lastShotPred || !Array.isArray(_lastShotPred.cuePostTrajectory)) {
          _lastShotPred = pred;
        }
        // 吃库折线单独留一份快照：避免出杆后主预测被刷新成没有 cuePost 的版本，
        // 导致白线还在擦除、蓝线却因为找不到路径直接消失。
        if (hasCushionPath) _lastCueCushionPred = pred;
      }
      _lastConfigVersion = _configVersion;
      _sizesDirty = false;

      overlay.debug.source = projection.source;
      overlay.debug.balls = pred ? pred.activeBallCount : 0;
      overlay.debug.target = pred?.target ? kindLabel(pred.target.ball.kind) : '-';
      if (pred?.target?.pocket) {
        const p = pred.target.pocket;
        const pct = Math.round((p.confidence ?? 1) * 100);
        const ang = Number.isFinite(p.angleDeg) ? ` 角${Math.round(p.angleDeg)}°` : '';
        overlay.debug.pocket = pred.insufficientPower ? `${p.label} (力度不足)` : `${p.label} ${pct}%${ang}`;
      } else {
        overlay.debug.pocket = '-';
      }
      overlay.debug.ready = Boolean(pred && pred.cue && projection.toClothScreen(pred.cue, pred.cue));

      ui.updateDebug(pred, overlay.debug.ready);
    } catch (err) {
      devLog('error', '主循环异常:', err);
    }
    scheduleNextFrame(false);
  }

  /* ================================================================== */
  /* 启动                                                                */
  /* ================================================================== */

  let rafStarted = false;

  function startLoop() {
    if (rafStarted) return;
    rafStarted = true;
    requestAnimationFrame(frame);
  }

  let _pollCount = 0;
  function pollCoreNamespace() {
    installCoreHook();
    _pollCount++;
    if (!capturedCore && !readState() && _pollCount < 60) {
      setTimeout(pollCoreNamespace, _pollCount < 20 ? 50 : 300);
    }
  }

  function boot() {
    installCoreHook();
    if (window === window.top) {
      try { installDailyEntryHook(); } catch (_) {}
      try { if (typeof DailyRunner !== 'undefined' && DailyRunner) DailyRunner.init(); } catch (_) {}
    }
    pollCoreNamespace();
    loadToggles();
    ensureUiBuilt();
    try {
      engineSim.load();
    } catch (_) {}
    startLoop();

    setInterval(() => {
      ensureUiBuilt();
      removeUiFromOtherFrames();
    }, 1500);
  }

  /* ================================================================== */
  /* 控制台调试与测试导出接口                                             */
  /* ================================================================== */

  try {
    window.__snookerAimUi__ = ui;
    window.__snookerAimAssistant__ = {
      version: SCRIPT_VERSION,
      SCRIPT_VERSION,
      CONFIG,
      TOGGLE_KEYS,
      BALL_RADIUS_MM,
      V,
      predict,
      predictAim: predict,
      readTableBounds,
      checkCushionHug,
      checkParallelRayJawClipping,
      resolveCompensatedPocketTarget,
      rayRailHit,
      trimPolyline,
      trimReboundSegmentsByLength,
      computeTargetTravelBudgetMm,
      detectJunctions,
      evaluatePocket,
      formatPocketLabel,
      getCushionLabel,
      formatTipEnglish,
      resolveEffectiveTip,
      resolveEffectivePower,
      resetTurnPowerState,
      extractRawStatePower,
      buildStateKeys,
      simulateInstantCuePostTrajectory,
      traceRailReflections,
      tracePhysicsRailReflections,
      resolvePhysicsCushionRebound,
      applyCutInducedThrow,
      snapToPerfectPot,
      triggerFullPowerStrike,
      DailyChallengeEngine,
      DailyRunner,
      detectDailyChallengeRoom,
      writeDailyEntryMarker,
      clearDailyEntryMarker,
      togglePanelCircleVisibility,
      ui,
      engineSim,
      NativeWorkerBridge,
      detectCurrentRoomMode,
      extractRawState,
      readState,
      isPlayableTableState,
      isSettlementOrGameOverScreen,
      hasVisibleDarkMaskInDoc,
      hasVisibleSettlementUiInDoc,
      isLobbyMenuVisible,
      calculateRecommendedPower,
      attachShotPowerMetrics,
      getLastShotPred: () => _lastShotPred,
      getRetainedShotPred: () => _retainedShotPred,
      getRetainedDebug: () => ({
        wasInShot: _wasInShot,
        motionLocked: _shotMotionLocked,
        requestedPower: _lastRequestedShotPower,
        requestedAgeMs: _lastRequestedShotAt ? Math.round(performance.now() - _lastRequestedShotAt) : null,
        observedPower: _lastAimPowerObserved,
        snapshotError: _lastSnapshotError,
        retainedPower: _retainedShotPred && _retainedShotPred.power,
        retainedShotPower: _retainedShotPred && _retainedShotPred.shot && _retainedShotPred.shot.power,
      }),
      resolveShotSnapshotPower,
      buildShotSnapshotPrediction,
      simulateCueArrivalAtContact,
      resolveTargetBallImpactState,
      TrajectoryRecorder,
      hudPill,
      overlay,
      projection,
      NativeWorkerBridge,
      FALLBACK_POCKETS,
    };
  } catch (_) {}

  boot();
})();



