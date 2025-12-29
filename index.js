// GitHub Pages client
// Worker 응답(JSON): { v, tz, day, range, fetchedAt, ttlMs, items[], refreshed, summary }
// items[]: { id, title, startMs, endMs, type, product, games, people, channel }

const WORKER_URL = "https://lts.foalcozm2.workers.dev";
const POLL_MS = 15000;

const els = {
  subtitle: document.getElementById("subtitle"),
  pillState: document.getElementById("pillState"),

  kpiActiveCount: document.getElementById("kpiActiveCount"),
  kpiNextVisitPeople: document.getElementById("kpiNextVisitPeople"),
  kpiNextVisitTime: document.getElementById("kpiNextVisitTime"),
  kpiNextEnd: document.getElementById("kpiNextEnd"),
  metaLine: document.getElementById("metaLine"),

  activeList: document.getElementById("activeList"),
  activeHint: document.getElementById("activeHint"),
  timeline: document.getElementById("timeline"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnForce: document.getElementById("btnForce"),

  errLog: document.getElementById("errLog"),
};

let lastPayload = null;
let pollTimer = null;
const errRing = [];

function logErr(msg) {
  const line = `[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`;
  errRing.unshift(line);
  while (errRing.length > 5) errRing.pop();
  els.errLog.textContent = errRing.join("\n");
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function minutesLeft(endMs, nowMs) {
  return Math.ceil((endMs - nowMs) / 60000);
}

/**
 * 예약 판정
 * 규칙상 예약만 "n명 via Naver/Call" 형태로 인원과 채널이 들어온다.
 * 그래서 people + channel 있으면 예약으로 취급한다.
 */
function isReservation(item) {
  return item && item.people != null && !!item.channel;
}

function computeActiveNonReservation(items, nowMs) {
  const active = items
    .filter((x) => !isReservation(x))
    .filter((x) => x.startMs <= nowMs && nowMs < x.endMs)
    .sort((a, b) => a.endMs - b.endMs);

  const nextEnd = active.length ? active[0].endMs : null;
  return { active, nextEnd };
}

function pickNextVisit(reservations, nowMs) {
  const sorted = reservations.slice().sort((a, b) => a.startMs - b.startMs);
  return (
    sorted.find((x) => x.startMs > nowMs) ||
    sorted.find((x) => x.endMs > nowMs) ||
    null
  );
}

function badgeFor(item, nowMs) {
  if (item.endMs <= nowMs) return { text: "끝남", cls: "" };
  if (item.startMs > nowMs) return { text: "예정", cls: "warn" };
  const left = minutesLeft(item.endMs, nowMs);
  return { text: `${left}분 남음`, cls: "good" };
}

/**
 * 24시간 팔레트 + 시간 보간
 * 가까운 시간대는 비슷한 색, 멀어질수록 다음 색으로 이동.
 */
const HOUR_PALETTE = [
  "#6aa9ff", "#5fb6ff", "#53c3ff", "#45d0ff",
  "#38dcff", "#2ee6f0", "#32efdb", "#43f6c1",
  "#5efaa4", "#7efc86", "#a1fb6a", "#c6f651",
  "#e7ec46", "#ffd24b", "#ffb45a", "#ff966b",
  "#ff7c7c", "#ff6b9a", "#ff63b8", "#e06bff",
  "#b07bff", "#8d8cff", "#779bff", "#6aa9ff"
];

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const x = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(x, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const f = (v) => v.toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(aHex, bHex, t) {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  });
}

function groupColorByStart(startMs) {
  const d = new Date(startMs);
  const hh = Number(
    d.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Seoul" })
  );
  const mm = Number(
    d.toLocaleString("en-US", { minute: "2-digit", timeZone: "Asia/Seoul" })
  );
  const p = hh + mm / 60;
  const i = Math.floor(p) % 24;
  const t = p - Math.floor(p);
  return lerpColor(HOUR_PALETTE[i], HOUR_PALETTE[(i + 1) % 24], t);
}

function render(payload) {
  lastPayload = payload;

  const nowMs = Date.now();
  const items = Array.isArray(payload.items) ? payload.items : [];

  const reservations = items.filter(isReservation);
  const { active, nextEnd } = computeActiveNonReservation(items, nowMs);

  // KPI 1: 진행 중 = 스케줄 1개당 고객 1명, 뒤에 "명"
  els.kpiActiveCount.textContent = `${active.length}명`;

  // KPI 2: 방문 예정 고객 = 다음 예약의 people + 시작시간
  const nextVisit = pickNextVisit(reservations, nowMs);
  els.kpiNextVisitPeople.textContent = nextVisit?.people != null ? `${nextVisit.people}명` : "-";
  els.kpiNextVisitTime.textContent = nextVisit ? fmtTime(nextVisit.startMs) : "-";

  // KPI 3: 다음 종료 = 진행 중(예약 제외) 중 가장 빠른 종료
  els.kpiNextEnd.textContent = nextEnd ? fmtTime(nextEnd) : "-";

  // 상단 상태/메타
  const ttlMs = payload.ttlMs ?? 0;
  const ageMs = payload.fetchedAt ? nowMs - payload.fetchedAt : null;

  els.subtitle.textContent = `오늘 ${payload.day} · ${payload.tz}`;
  els.pillState.textContent = payload.refreshed ? "갱신됨" : "캐시";

  if (payload.fetchedAt) {
    const freshness = ageMs != null ? `${Math.max(0, Math.floor(ageMs / 1000))}초 전` : "-";
    els.metaLine.textContent = `데이터: ${freshness} 업데이트 · TTL ${Math.floor(ttlMs / 1000)}초`;
  } else {
    els.metaLine.textContent = "-";
  }

  // 진행중(예약 제외)
  els.activeHint.textContent = active.length ? `가장 빠른 종료: ${fmtTime(active[0].endMs)}` : "진행 중 없음";
  els.activeList.innerHTML = active.length ? "" : `<div class="small">진행 중 이벤트가 없습니다.</div>`;

  for (const x of active) {
    const left = minutesLeft(x.endMs, nowMs);
    const badge = { text: `${left}분 남음`, cls: "good" };
    els.activeList.appendChild(itemCard(x, badge, nowMs));
  }

  // 오늘 예약(예약만, 과거는 기본 숨김: endMs > now)
  const rows = reservations
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .filter((x) => x.endMs > nowMs);

  els.timeline.innerHTML = rows.length ? "" : `<div class="small">표시할 예약이 없습니다.</div>`;

  for (const x of rows) {
    const b = badgeFor(x, nowMs);
    els.timeline.appendChild(timelineRowReservation(x, b, nowMs));
  }
}

function itemCard(x, badge, nowMs) {
  const wrap = document.createElement("div");
  wrap.className = "item";

  const top = document.createElement("div");
  top.className = "itemTop";

  const title = document.createElement("div");
  title.className = "itemTitle";
  title.textContent = x.title || "(no title)";

  const pill = document.createElement("div");
  pill.className = `badge ${badge.cls || ""}`.trim();
  pill.textContent = badge.text;

  top.appendChild(title);
  top.appendChild(pill);

  const line1 = document.createElement("div");
  line1.className = "itemMeta";
  line1.textContent = `${fmtTime(x.startMs)} ~ ${fmtTime(x.endMs)} · ${x.type}${
    x.product ? `/${x.product}` : ""
  }${x.games ? ` · ${x.games}게임` : ""}`;

  wrap.appendChild(top);
  wrap.appendChild(line1);

  return wrap;
}

function timelineRowReservation(x, badge, nowMs) {
  const row = document.createElement("div");
  row.className = "row grouped";

  const color = groupColorByStart(x.startMs);
  row.style.borderColor = color;
  row.style.boxShadow = `0 0 0 1px ${color} inset, 0 0 18px ${color}33`;

  const t = document.createElement("div");
  t.className = "time";
  t.textContent = `${fmtTime(x.startMs)} ~ ${fmtTime(x.endMs)}`;

  const mid = document.createElement("div");

  const title = document.createElement("div");
  title.className = "itemTitle";
  title.textContent = x.people != null ? `${x.people}명 방문 예정` : (x.title || "(no title)");

  const meta = document.createElement("div");
  meta.className = "itemMeta";
  meta.textContent = [x.channel ? `via ${x.channel}` : ""].filter(Boolean).join(" · ");

  mid.appendChild(title);
  mid.appendChild(meta);

  const end = document.createElement("div");
  end.className = "end";

  const b = document.createElement("span");
  b.className = `badge ${badge.cls || ""}`.trim();
  b.textContent = badge.text;

  end.appendChild(b);

  row.appendChild(t);
  row.appendChild(mid);
  row.appendChild(end);

  return row;
}

async function fetchWorker(force = false) {
  const u = new URL(WORKER_URL);
  if (force) u.searchParams.set("force", "1");

  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function refresh(force = false) {
  try {
    els.pillState.textContent = "로딩";
    const data = await fetchWorker(force);
    render(data);
  } catch (e) {
    logErr(String(e?.message ?? e));
    els.pillState.textContent = "오류";
  }
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(false), POLL_MS);
}

els.btnRefresh.addEventListener("click", () => refresh(false));
els.btnForce.addEventListener("click", () => refresh(true));

refresh(false);
startPoll();
