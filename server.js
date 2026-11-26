import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseRide, evaluateRide, planRoute, freeSeats, findLandmark, LANDMARKS, minutes, km, hasKeyword, setTravelTime, addLandmark } from './engine.js';
import { connectZalo } from './zalo.js';
import * as google from './google.js';

if (google.enabled) setTravelTime(google.travelMinutes);
console.log(google.enabled ? 'Thời gian chạy xe: Google theo giao thông thực' : 'Thời gian chạy xe: ước lượng (chưa đặt GOOGLE_MAPS_KEY)');
const ROUTE_REFRESH = (+process.env.GOOGLE_ROUTE_REFRESH_MIN || 10) * 60000;

const PORT = process.env.PORT || 3000;
const DATA = './data';
fs.mkdirSync(DATA, { recursive: true });
const ADMIN_KEY = process.env.ADMIN_KEY || 'doi-mat-khau-nay';
const SESSION_KEY = process.env.SESSION_KEY || ADMIN_KEY; // khoá mã hoá phiên Zalo lưu trên đĩa
if (!process.env.ADMIN_KEY) console.warn('⚠ Chưa đặt ADMIN_KEY, đang dùng mặc định "doi-mat-khau-nay"');

// ---------- Mã kích hoạt (bán theo gói ngày) ----------
const LIC_FILE = `${DATA}/licenses.json`;
const licenses = fs.existsSync(LIC_FILE) ? JSON.parse(fs.readFileSync(LIC_FILE, 'utf8')) : {};
licenses.DEMO ??= { name: 'Dùng thử', expires: '2099-01-01' };
const saveLic = () => fs.writeFileSync(LIC_FILE, JSON.stringify(licenses, null, 1));
const valid = code => licenses[code] && !licenses[code].locked && new Date(licenses[code].expires) > new Date();

// ---------- Trạng thái từng tài xế ----------
// Lộ trình đang chạy + cài đặt được lưu xuống đĩa (khởi động lại server không mất). Tin trong dòng cuốc thì không lưu.
const STATE_FILE = `${DATA}/state.json`;
const saved = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const plain = p => p && { name: p.name, lat: p.lat, lng: p.lng };
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  for (const d of drivers.values()) if (!d.sim) saved[d.code] = {
    stats: d.stats,
    st: { ...d.st, pos: plain(d.st.pos), dest: d.st.dest.name, rides: d.st.rides.map(r => ({ ...r, pickup: plain(r.pickup), dropoff: plain(r.dropoff) })) },
  };
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(saved));
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); // ghi file tạm rồi đổi tên: mất điện giữa chừng không hỏng file
}
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 2000); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveState(); process.exit(0); });
// nạp lại lộ trình thật (lúc khởi động, hoặc khi tắt chạy thử)
function loadSaved(d) {
  const s = saved[d.code];
  if (!s) return;
  Object.assign(d.st, s.st, { dest: findLandmark(s.st.dest) || d.st.dest });
  Object.assign(d.stats, s.stats);
}

const drivers = new Map();
function driver(code) {
  if (!drivers.has(code)) {
    const d = {
      code, clients: new Set(), feed: [], qr: null, zaloStatus: 'Chưa kết nối', zaloOk: false, zalo: null, sim: false, clock: Date.now(), order: '',
      stats: { seen: 0, skipped: 0, taken: 0 },
      // mặc định an toàn cho tài xế mới: tự bắt tắt, khi bật thì đếm ngược 5 giây để kịp huỷ
      st: { pos: findLandmark('Vĩnh Yên'), dest: findLandmark('Hà Nội'), totalSeats: 4, walkIns: 0, maxDetour: 20, auto: false, grace: 5, claimMode: 'reply', rides: [] },
    };
    loadSaved(d);
    drivers.set(code, d);
  }
  return drivers.get(code);
}
const now = d => d.sim ? d.clock : Date.now();
// đẩy tới mọi màn hình đang mở: luồng SSE + các câu hỏi long-poll đang chờ
const emit = (d, ev) => {
  for (const res of d.clients) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const w = d.waiters || []; d.waiters = []; for (const done of w) done();
};
// giữ 20 câu đọc gần nhất cho trang hỏi lại bằng /state khi luồng SSE bị chặn (vd. qua Cloudflare, 4G)
const say = (d, text) => {
  const ev = { type: 'say', text, id: d.sayId = (d.sayId || 0) + 1 };
  (d.says ??= []).push(ev); if (d.says.length > 20) d.says.shift();
  emit(d, ev);
};

function broadcast(d) {
  if (!d.sim) scheduleSave(); // mọi thay đổi đều đi qua đây
  const t = now(d), plan = planRoute(d.st.pos, d.st.dest, d.st.rides, t);
  const order = plan.stops.map(s => s.type + s.ride.id).join();
  refreshRoute(d, order);
  // đường Google còn khớp thứ tự điểm dừng: ETA = cộng dồn từng chặng thật, trừ thời gian đã chạy
  const live = d.route?.sig === order ? d.route : null;
  const ran = live ? (t - live.clockAt) / 60000 : 0;
  let eta = 0, from = d.st.pos;
  const stops = plan.stops.map((s, i) => {
    eta = live ? live.cum[i] - ran : eta + minutes(from, s.at, t); from = s.at;
    eta = Math.max(eta, 0);
    const seated = s.ride.status === 'onboard' ? (t - s.ride.boardedAt) / 60000 : null;
    return {
      type: s.type, rideId: s.ride.id, name: s.at.name, lat: s.at.lat, lng: s.at.lng, seats: s.ride.seats, phone: s.ride.phone, eta: Math.round(eta),
      seated: seated === null ? null : Math.round(seated), seatedAtDrop: seated === null ? null : Math.round(seated + eta),
    };
  });
  if (stops[0]) stops[0].km = +km(d.st.pos, plan.stops[0].at).toFixed(1);
  if (order !== d.order && plan.reordered) say(d, `Khách ngồi lâu, ưu tiên trả ${stops.find(s => s.type === 'dropoff').name} trước`);
  d.order = order;
  emit(d, d.last = {
    type: 'state', v: d.version = (d.version || 0) + 1, stops, free: freeSeats(d.st), traffic: google.enabled, live: !!live, polyline: live?.polyline || '', sim: d.sim, clock: t, qr: d.qr, zaloStatus: d.zaloStatus, zaloOk: d.zaloOk,
    groups: Object.values(cfgOf(d).groups).filter(g => g.watch).length, stats: d.stats, expires: licenses[d.code]?.expires, qrToken: d.qrToken,
    mainPhone: licenses[d.code]?.mainPhone || '', terms: !!licenses[d.code]?.termsAt, zaloName: licenses[d.code]?.zaloName || '',
    cfg: { reply: cfgOf(d).reply, block: cfgOf(d).block.join(', '), allow: cfgOf(d).allow.join(', ') },
    groupList: Object.entries(cfgOf(d).groups).map(([id, g]) => ({ id, ...g })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    feed: d.feed.slice(0, 40).map(({ source, ride, timer, ...f }) => f),
    st: { ...d.st, rides: undefined, dest: d.st.dest.name },
  });
}

// cài đặt lưu cùng mã kích hoạt: câu chốt, từ khoá, bật/tắt từng nhóm Zalo
const cfgOf = d => licenses[d.code].cfg ??= { reply: '', block: [], allow: [], groups: {} };

// ---------- Giao thông thực (Google) ----------
const routePoints = (d, stops) => [d.st.pos, ...stops.map(s => s.at), d.st.dest];

// Hỏi lại Google khi thứ tự điểm dừng đổi, hoặc định kỳ (mặc định 10 phút) khi còn khách
function refreshRoute(d, order) {
  if (!google.enabled || d.routing || !d.st.rides.length) return;
  if (d.route?.sig === order && Date.now() - d.route.at < ROUTE_REFRESH) return;
  d.routing = true;
  const stops = planRoute(d.st.pos, d.st.dest, d.st.rides, now(d)).stops, clockAt = now(d);
  google.route(d.code, routePoints(d, stops)).then(r => {
    if (!r) return;
    let c = 0;
    d.route = { ...r, sig: order, clockAt, cum: r.legs.map(l => c += l.min) };
    broadcast(d);
  }).finally(() => { d.routing = false; });
}

// Thời gian vòng thật = (đường qua mọi điểm dừng có thêm khách mới) − (đường hiện tại), cùng giao thông lúc này
async function liveDetour(d, ride) {
  const t = now(d);
  const cur = planRoute(d.st.pos, d.st.dest, d.st.rides, t).stops;
  const cand = planRoute(d.st.pos, d.st.dest, [...d.st.rides, { ...ride, id: '_new', status: 'assigned' }], t).stops;
  const sig = cur.map(s => s.type + s.ride.id).join();
  const fresh = d.route?.sig === sig && Date.now() - d.route.at < 3 * 60000;
  const [base, next] = await Promise.all([
    fresh ? { total: d.route.total - (t - d.route.clockAt) / 60000 } : google.route(d.code, routePoints(d, cur)),
    google.route(d.code, routePoints(d, cand)),
  ]);
  if (!base || !next) return null;
  const detour = Math.max(0, Math.round(next.total - base.total));
  return detour <= d.st.maxDetour ? { ok: true, detour, live: true }
    : { ok: false, detour, live: true, reason: `Lệch +${detour}p theo giao thông (quá ${d.st.maxDetour}p)` };
}

async function ingest(d, text, source) {
  const cfg = cfgOf(d);
  // tin demo giả nhóm Zalo nhưng không ghi vào danh sách nhóm thật
  const g = source && (source.demo ? { name: source.group, watch: true, auto: true } : cfg.groups[source.threadId] ??= { name: '', watch: true, auto: true, waitMinute: false });
  if (g && !g.watch) return;
  const t = now(d);
  // cùng tin đăng nhiều nhóm (kể cả tin đang chờ Google trả lời)
  if (d.feed.some(f => f.text === text && t - f.at < 5 * 60000) || (d.inflight ??= new Set()).has(text)) return;
  d.stats.seen++;
  const p = parseRide(text), blocked = hasKeyword(text, cfg.block), allowed = hasKeyword(text, cfg.allow);
  const msgTs = Number(source?.data?.ts) || Date.now();
  const item = {
    id: crypto.randomUUID(), at: t, realAt: Date.now(), text, source, group: g?.name || '',
    seats: p.seats, phone: p.phone, price: p.price, code: p.code, time: p.time,
    // nhóm có luật "sau 1 phút mới được trả lời": chốt vào đầu phút kế tiếp
    waitUntil: g?.waitMinute ? (Math.floor(msgTs / 60000) + 1) * 60000 + 500 : 0,
  };
  const push = (extra) => { d.feed.unshift(Object.assign(item, extra)); d.feed.length = Math.min(d.feed.length, 50); broadcast(d); };
  if (blocked && (p.isRide || p.maybe)) { d.stats.skipped++; return push({ status: 'skip', reason: `Từ khoá chặn: ${blocked}` }); }
  if (!p.isRide) {
    if (p.maybe) logUnparsed(d, text, g?.name);
    if (p.maybe || allowed) return push({ status: 'maybe', reason: p.reason });
    if (!source) push({ status: 'skip', reason: p.reason });
    return;
  }
  let ev = evaluateRide(d.st, p, t);
  // lọc rẻ bằng ước lượng trước; cuốc có khả năng mới hỏi Google (tốn ~2 lượt gọi)
  if (google.enabled && (ev.ok || (ev.detour !== undefined && ev.detour <= d.st.maxDetour * 2))) {
    d.inflight.add(text);
    try { ev = await liveDetour(d, p) || ev; } finally { d.inflight.delete(text); }
  }
  Object.assign(item, { ride: p, status: ev.ok ? 'offer' : 'skip', reason: ev.reason, detour: ev.detour, live: !!ev.live, pickup: p.pickup.name, dropoff: p.dropoff.name });
  if (!ev.ok && allowed) item.status = 'maybe'; // từ khoá "luôn báo": vẫn cho tài xế tự quyết
  d.feed.unshift(item);
  d.feed.length = Math.min(d.feed.length, 50);
  const auto = d.st.auto && (!g || g.auto);
  if (item.status === 'skip') d.stats.skipped++;
  else if (item.status === 'maybe') {}
  else if (auto && d.st.grace > 0) {
    // đếm ngược để tài xế kịp huỷ; tính theo giờ thật kể cả khi mô phỏng
    Object.assign(item, { status: 'pending', deadline: Date.now() + d.st.grace * 1000 });
    item.timer = setTimeout(() => { if (item.status === 'pending') { claim(d, item); broadcast(d); } }, d.st.grace * 1000);
    say(d, `Sắp nhận ${item.seats} ghế ${item.pickup} đi ${item.dropoff}`);
  } else if (auto) claim(d, item);
  else say(d, `${item.seats} ghế, ${item.pickup} đi ${item.dropoff}, lệch ${item.detour} phút`);
  broadcast(d);
}

function claim(d, item) {
  if (!item.ride) {
    // tin chưa rõ tuyến: chỉ chốt trên Zalo, tài xế tự xếp khách (chạm ghế trống)
    item.status = 'taken'; d.stats.taken++;
    say(d, `Đã chốt tin${item.group ? ' nhóm ' + item.group : ''}`);
    return sendClaim(d, item);
  }
  // tình hình có thể đã đổi từ lúc báo; cuốc đã kiểm bằng Google thì chỉ kiểm lại số ghế
  // tài xế tự bấm nhận (kể cả cuốc bộ lọc đã loại) hoặc cuốc đã kiểm bằng Google: chỉ kiểm lại số ghế
  const ev = item.live || item.manual ? (freeSeats(d.st) >= item.seats ? { ok: true, detour: item.detour } : { ok: false, reason: 'Kín xe' })
    : evaluateRide(d.st, item.ride, now(d));
  if (!ev.ok) { Object.assign(item, { status: 'skip', reason: ev.reason }); d.stats.skipped++; return; }
  item.status = 'taken';
  d.stats.taken++;
  d.st.rides.push({ id: item.id, pickup: item.ride.pickup, dropoff: item.ride.dropoff, seats: item.seats, phone: item.phone, status: 'assigned' });
  const left = freeSeats(d.st);
  say(d, `Đã ${d.st.auto ? 'tự ' : ''}nhận ${item.seats} ghế ${item.pickup} đi ${item.dropoff}${ev.detour !== undefined ? `, lệch ${ev.detour} phút` : ''}. ${left ? `Trống ${left} ghế.` : 'Xe đã kín chỗ.'}`);
  sendClaim(d, item);
}

function sendClaim(d, item) {
  if (!item.source || item.source.demo || !d.zalo) return; // tin demo không được gửi lên Zalo thật
  const wait = Math.max(0, item.waitUntil - Date.now()), cfg = cfgOf(d);
  if (wait) item.sendAt = item.waitUntil;
  setTimeout(() => d.zalo?.claim(item.source, item.pickup || '', d.st.claimMode, { mainPhone: licenses[d.code].mainPhone, reply: cfg.reply, code: item.code, text: item.replyText })
    .catch(e => { d.zaloStatus = 'Lỗi gửi Zalo: ' + e.message; broadcast(d); }), wait);
}

function zaloLogout(d) {
  if (d.zalo) d.zalo.logout(); else fs.rmSync(`${DATA}/${d.code}.zalo.json`, { force: true });
  Object.assign(d, { zalo: null, zaloOk: false, qr: null, zaloStatus: 'Chưa kết nối' });
  delete licenses[d.code].zaloName; saveLic();
}

// cuốc chờ bấm quá 5 phút thì coi như đã có xe khác nhận
setInterval(() => {
  for (const d of drivers.values()) {
    const old = d.feed.filter(f => (f.status === 'offer' || f.status === 'maybe') && Date.now() - f.realAt > 5 * 60000);
    for (const f of old) Object.assign(f, { status: 'skip', reason: 'Quá 5 phút' });
    if (old.length) broadcast(d);
  }
}, 10000);

function finishStop(d, rideId) {
  const r = d.st.rides.find(r => r.id === rideId);
  if (!r) return;
  if (r.status === 'assigned') { r.status = 'onboard'; r.boardedAt = now(d); say(d, `Đã đón khách ${r.pickup.name}`); }
  else { d.st.rides = d.st.rides.filter(x => x !== r); say(d, `Đã trả khách ${r.dropoff.name}`); }
}

function startZalo(d) {
  if (d.zalo || d.connecting) return;
  d.connecting = true;
  d.zaloStatus = 'Đang kết nối...';
  connectZalo(`${DATA}/${d.code}.zalo.json`, SESSION_KEY, {
    alive: () => valid(d.code), // bị khoá / hết hạn thì bỏ dở việc chờ quét QR
    onQR: qr => {
      d.qr = qr;
      if (qr) { d.qrToken ??= crypto.randomBytes(16).toString('hex'); d.zaloStatus = 'Chờ quét QR'; }
      broadcast(d);
    },
    onStatus: s => {
      d.zaloStatus = s; d.zaloOk = s === 'Đã kết nối Zalo';
      if (d.zaloOk) setTimeout(() => { d.qrToken = null; }, 60000); // trang QR còn kịp báo "đã kết nối"
      if (s.startsWith('Mất')) say(d, 'Cảnh báo: mất kết nối Zalo');
      broadcast(d);
    },
    onMessage: (text, source) => ingest(d, text, source).catch(console.error),
    onAccount: name => { licenses[d.code].zaloName = name; saveLic(); broadcast(d); },
    onGroups: list => {
      const groups = cfgOf(d).groups;
      for (const { id, name } of list) Object.assign(groups[id] ??= { watch: true, auto: true, waitMinute: false }, { name });
      saveLic(); broadcast(d);
    },
  }).then(z => { d.zalo = z; }).catch(e => { d.qr = null; d.zaloStatus = e.message || 'Lỗi kết nối Zalo'; broadcast(d); })
    .finally(() => { d.connecting = false; });
}
// tự nối lại Zalo cho tài xế đã đăng nhập trước đó
for (const f of fs.readdirSync(DATA)) {
  const code = f.match(/^(.+)\.zalo\.json$/)?.[1];
  if (code && valid(code)) startZalo(driver(code));
}

const actions = {
  settings(d, b) {
    for (const k of ['auto', 'maxDetour', 'totalSeats', 'claimMode', 'grace']) if (k in b) d.st[k] = b[k];
    if (b.dest) d.st.dest = findLandmark(b.dest) || d.st.dest;
    // tài xế chạm số ghế còn trống (khách vẫy dọc đường chiếm phần còn lại)
    if (Number.isInteger(b.free)) d.st.walkIns = Math.max(0, d.st.walkIns + freeSeats(d.st) - b.free);
    if ('mainPhone' in b) {
      const p = String(b.mainPhone).replace(/\D/g, '');
      if (p === '' || /^0\d{9}$/.test(p)) { licenses[d.code].mainPhone = p; saveLic(); }
    }
  },
  terms(d) { licenses[d.code].termsAt = new Date().toISOString(); saveLic(); },
  cfg(d, b) {
    const cfg = cfgOf(d), list = v => String(v).split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);
    if ('reply' in b) cfg.reply = String(b.reply).trim().slice(0, 100);
    if ('block' in b) cfg.block = list(b.block);
    if ('allow' in b) cfg.allow = list(b.allow);
    saveLic();
  },
  group(d, b) {
    const g = cfgOf(d).groups[b.id];
    if (!g) return;
    for (const k of ['watch', 'auto', 'waitMinute']) if (k in b) g[k] = !!b[k];
    saveLic();
  },
  unlink: d => zaloLogout(d),
  message: (d, b) => ingest(d, String(b.text || '').slice(0, 1000)).catch(console.error),
  accept(d, b) {
    // bấm tay: nhận được cả cuốc bộ lọc đã loại; text = câu tài xế sửa trước khi gửi
    const f = d.feed.find(f => f.id === b.id && ['offer', 'pending', 'maybe', 'skip'].includes(f.status));
    if (!f) return;
    clearTimeout(f.timer);
    Object.assign(f, { manual: true, replyText: String(b.text || '').trim().slice(0, 300) });
    claim(d, f);
  },
  reject(d, b) {
    const f = d.feed.find(f => f.id === b.id && ['offer', 'pending', 'maybe', 'skip'].includes(f.status));
    if (f) { clearTimeout(f.timer); Object.assign(f, { status: 'skip', reason: 'Đã bỏ qua' }); }
  },
  stop: (d, b) => finishStop(d, b.rideId),
  cancel(d, b) { d.st.rides = d.st.rides.filter(r => r.id !== b.rideId); },
  gps(d, b) { if (!d.sim && Number.isFinite(b.lat) && Number.isFinite(b.lng)) d.st.pos = { lat: b.lat, lng: b.lng, name: 'Vị trí xe' }; },
  sim(d, b) {
    if (b.on && !d.sim) saveState(); // giữ lộ trình thật trước khi chạy thử ghi đè
    d.sim = !!b.on;
    for (const t of d.demoTimers || []) clearTimeout(t);
    d.demoTimers = [];
    if (d.sim) Object.assign(d.st, { pos: findLandmark(b.from) || findLandmark('Vĩnh Yên'), rides: [], walkIns: 0 }), d.clock = Date.now();
    else { Object.assign(d.st, { rides: [], walkIns: 0 }); loadSaved(d); } // tắt chạy thử: bỏ khách giả, trả lại lộ trình thật
    if (d.sim && b.demo) {
      // demo: xe Vĩnh Yên → Hà Nội, tự bắt cuốc, tin nhóm Zalo giả tự đến theo kịch bản (cài đặt thật được trả lại khi dừng)
      Object.assign(d.st, { pos: findLandmark('Vĩnh Yên'), dest: findLandmark('Hà Nội'), totalSeats: 4, maxDetour: 20, auto: true, grace: 5 });
      d.feed = []; d.stats = { seen: 0, skipped: 0, taken: 0 };
      d.demoTimers = DEMO_SCRIPT.map(([sec, group, text]) => setTimeout(() => {
        if (d.sim) ingest(d, text, { demo: true, group }).catch(console.error);
      }, sec * 1000));
    }
  },
  zalo(d) { if (licenses[d.code].termsAt) startZalo(d); },
};

// ---------- Địa danh: nhật ký tin chưa đọc được + địa danh admin thêm ----------
// Tin trông như cuốc nhưng không nhận ra điểm đón/trả → ghi lại để admin bổ sung danh bạ sau mỗi ngày chạy thử
const UNPARSED_FILE = `${DATA}/unparsed.jsonl`;
function logUnparsed(d, text, group) {
  try {
    if (fs.existsSync(UNPARSED_FILE) && fs.statSync(UNPARSED_FILE).size > 2e6) fs.renameSync(UNPARSED_FILE, UNPARSED_FILE + '.1');
    fs.appendFileSync(UNPARSED_FILE, JSON.stringify({ at: new Date().toISOString(), code: d.code, group: group || '', test: d.sim || !group, text }) + '\n');
  } catch (e) { console.warn('Không ghi được nhật ký tin:', e.message); }
}
function unparsedList() {
  if (!fs.existsSync(UNPARSED_FILE)) return [];
  const seen = new Set();
  return fs.readFileSync(UNPARSED_FILE, 'utf8').trim().split('\n').reverse()
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x && !seen.has(x.text) && seen.add(x.text)).slice(0, 200);
}
const PLACES_FILE = `${DATA}/places.json`;
const BUILTIN = new Set(LANDMARKS.map(l => l.name));
const places = fs.existsSync(PLACES_FILE) ? JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8')) : [];
for (const p of places) addLandmark(p.name, p.lat, p.lng, p.aliases);
const savePlaces = () => fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 1));
const placesView = () => ({ unparsed: unparsedList(), places });

// ---------- Admin: tài xế, thu phí thuê bao, Zalo hộ, địa danh ----------
// mỗi hàm trả về chuỗi lỗi, hoặc object gộp vào kết quả
const adminActions = {
  list() {},
  unparsed: () => placesView(),
  addPlace(b) {
    const name = String(b.name || '').trim().slice(0, 60), lat = +b.lat, lng = +b.lng;
    if (!name) return 'Thiếu tên địa danh';
    if (BUILTIN.has(name)) return 'Địa danh này đã có sẵn trong danh bạ';
    if (!(lat > 8 && lat < 24 && lng > 102 && lng < 110)) return 'Toạ độ không nằm ở Việt Nam. Dán dạng: 21.0285, 105.8048';
    const aliases = String(b.aliases || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
    const i = places.findIndex(p => p.name === name);
    if (i >= 0) places.splice(i, 1);
    places.push({ name, lat, lng, aliases });
    addLandmark(name, lat, lng, aliases);
    savePlaces();
    return placesView();
  },
  removePlace(b) {
    const i = places.findIndex(p => p.name === b.name);
    if (i < 0) return 'Không có địa danh này';
    places.splice(i, 1);
    LANDMARKS.splice(LANDMARKS.findIndex(l => l.name === b.name), 1);
    savePlaces();
    return placesView();
  },
  save(b) {
    const c = String(b.code || crypto.randomBytes(3).toString('hex')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!c) return 'Mã không hợp lệ';
    const lic = licenses[c] ??= { name: '', phone: '', expires: new Date().toISOString(), payments: [] };
    if (b.name) lic.name = String(b.name).slice(0, 80);
    if (b.phone) lic.phone = String(b.phone).replace(/\D/g, '').slice(0, 11);
    const days = Math.round(+b.days || 0), amount = Math.round(+b.amount || 0);
    if (days < 0 || amount < 0 || days > 3660) return 'Số ngày / số tiền không hợp lệ';
    if (days) lic.expires = new Date(Math.max(Date.now(), new Date(lic.expires).getTime()) + days * 864e5).toISOString();
    if (days || amount) (lic.payments ??= []).push({ at: new Date().toISOString(), amount, days, note: String(b.note || '').slice(0, 120) });
    saveLic();
    return { saved: c };
  },
  lock(b) {
    if (!licenses[b.code]) return 'Không có mã này';
    licenses[b.code].locked = !!b.locked;
    saveLic();
    const d = drivers.get(b.code);
    // QR đang chờ (nếu có) tự bỏ ở lần làm mới kế tiếp nhờ hook alive()
    if (d && b.locked) { for (const r of d.clients) r.end(); d.zalo?.logout(); Object.assign(d, { zalo: null, zaloOk: false, qr: null, zaloStatus: 'Chưa kết nối' }); }
  },
  zalo(b) {
    if (!valid(b.code)) return 'Mã hết hạn hoặc bị khoá';
    if (!licenses[b.code].termsAt) return 'Tài xế chưa bấm đồng ý điều khoản dùng nick phụ trong app';
    startZalo(driver(b.code));
  },
  logout(b) {
    if (!licenses[b.code]) return 'Không có mã này';
    const d = driver(b.code);
    zaloLogout(d); broadcast(d);
  },
};

function adminView() {
  const nowMs = Date.now(), month = new Date().toISOString().slice(0, 7);
  const list = Object.entries(licenses).map(([code, l]) => {
    const d = drivers.get(code), pays = l.payments || [];
    return {
      code, name: l.name, phone: l.phone, mainPhone: l.mainPhone, expires: l.expires, locked: !!l.locked, terms: !!l.termsAt,
      daysLeft: Math.ceil((new Date(l.expires) - nowMs) / 864e5), paid: pays.reduce((s, p) => s + p.amount, 0), lastPay: pays.at(-1), payments: pays.slice(-20).reverse(),
      online: !!d?.clients.size, zaloOk: !!d?.zaloOk, zaloStatus: d?.zaloStatus || (fs.existsSync(`${DATA}/${code}.zalo.json`) ? 'Có phiên đã lưu' : 'Chưa kết nối'),
      qr: d?.qr || null, groups: Object.values(l.cfg?.groups || {}).filter(g => g.watch).length, zaloName: l.zaloName || '', taken: d?.stats.taken || 0,
    };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
  const allPays = Object.values(licenses).flatMap(l => l.payments || []);
  return {
    drivers: list,
    summary: {
      active: list.filter(x => x.daysLeft > 0 && !x.locked && x.code !== 'DEMO').length,
      expiring: list.filter(x => x.daysLeft > 0 && x.daysLeft <= 3 && x.code !== 'DEMO').length,
      monthRevenue: allPays.filter(p => p.at.startsWith(month)).reduce((s, p) => s + p.amount, 0),
      totalRevenue: allPays.reduce((s, p) => s + p.amount, 0),
    },
  };
}

// Kịch bản demo: [giây thật kể từ lúc bắt đầu, tên nhóm, tin]. 1 giây thật = 30 giây đường.
const DEMO_SCRIPT = [
  [3, 'Xe ghép VY – HN', 'Xe 7c VY-HN còn 3 ghế ae ib'], // tin xe chào khách: bỏ qua im lặng
  [6, 'Xe ghép VY – HN', 'Cần 2 ghế Phúc Yên đi Cầu Giấy, đi luôn. 0912.345.678 200k'], // hợp đường: tự nhận
  [14, 'Taxi Phúc Yên', 'Cầu Giấy HN đi Vĩnh Yên 1 khách'], // ngược chiều: chặn
  [22, 'Xe ghép Mê Linh', 'Có 1 khách Mê Linh đi Thanh Xuân'], // tự nhận
  [30, 'Xe ghép VY – HN', 'Đón 1 khách Nội Bài về Hoàn Kiếm 0901222333'], // lệch quá ngưỡng
  [38, 'Taxi Phúc Yên', '1 khách Phúc Yên đi Mỹ Đình 150k'], // tự nhận, kín xe
  [46, 'Xe ghép Mê Linh', 'Cần 1 ghế Mê Linh đi Cầu Giấy'], // kín xe: bỏ
  [54, 'Taxi Phúc Yên', '1k chợ Lương Sơn đi Bv Nam Học 300k Ct. code 88'], // chưa rõ tuyến: vào "Cuốc khác"
];

// Mô phỏng: mỗi giây thật = 30 giây đường, xe chạy tới điểm dừng kế tiếp rồi tự đón/trả
setInterval(() => {
  for (const d of drivers.values()) {
    if (!d.sim) continue;
    d.clock += 30000;
    const next = planRoute(d.st.pos, d.st.dest, d.st.rides, d.clock).stops[0];
    const target = next ? next.at : d.st.dest, t = minutes(d.st.pos, target, d.clock);
    if (t <= 0.5) {
      d.st.pos = { ...target };
      if (next) finishStop(d, next.ride.id);
    } else {
      const f = 0.5 / t, p = d.st.pos;
      d.st.pos = { lat: p.lat + (target.lat - p.lat) * f, lng: p.lng + (target.lng - p.lng) * f };
    }
    broadcast(d);
  }
}, 1000);

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const code = (url.searchParams.get('code') || '').toUpperCase();

  if (url.pathname === '/events') {
    if (!valid(code)) return json(res, 403, { error: 'Mã hết hạn hoặc không đúng' });
    const d = driver(code);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`:${' '.repeat(2048)}

`); // đệm 2KB để proxy đẩy luồng đi ngay
    d.clients.add(res);
    req.on('close', () => d.clients.delete(res));
    return broadcast(d);
  }
  // dự phòng khi SSE bị proxy giữ lại: trang hỏi trạng thái + câu đọc mới sau id `after`
  if (url.pathname === '/state') {
    if (!valid(code)) return json(res, 403, { error: 'Mã hết hạn hoặc không đúng' });
    const d = driver(code);
    if (!d.last) broadcast(d);
    const after = +url.searchParams.get('after') || 0;
    const reply = () => res.writableEnded || json(res, 200, { state: d.last, says: (d.says || []).filter(x => x.id > after), sayId: d.sayId || 0 });
    // long-poll: màn hình đã có bản mới nhất thì giữ câu hỏi lại, có thay đổi là trả ngay (tối đa 25 giây)
    if (url.searchParams.has('wait') && +url.searchParams.get('v') >= d.last.v && after >= (d.sayId || 0)) {
      const timer = setTimeout(() => { d.waiters = (d.waiters || []).filter(x => x !== done); reply(); }, 25000);
      const done = () => { clearTimeout(timer); reply(); };
      (d.waiters ??= []).push(done);
      req.on('close', () => { clearTimeout(timer); d.waiters = (d.waiters || []).filter(x => x !== done); });
      return;
    }
    return reply();
  }
  // trang QR công khai tạm thời: mở trên máy khác để quét khi tài xế chỉ có 1 điện thoại
  const qrM = url.pathname.match(/^\/qr(-data)?\/([0-9a-f]{32})$/);
  if (qrM) {
    const d = [...drivers.values()].find(d => d.qrToken === qrM[2]);
    if (!d) return json(res, 404, { error: 'Link hết hạn' });
    if (qrM[1]) return json(res, 200, { qr: d.qr, status: d.zaloStatus, ok: d.zaloOk });
    req.url = '/qr.html'; url.pathname = '/qr.html';
  }
  if (url.pathname === '/config') return json(res, 200, { mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '' });
  if (url.pathname === '/landmarks') return json(res, 200, LANDMARKS.map(l => l.name));
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const fn = actions[url.pathname.slice(5)];
    if (!valid(code)) return json(res, 403, { error: 'Mã hết hạn hoặc không đúng' });
    if (!fn) return json(res, 404, {});
    const d = driver(code);
    fn(d, await body(req));
    broadcast(d);
    return json(res, 200, d.last); // trả luôn trạng thái mới để màn hình đổi ngay, không chờ lần đẩy kế tiếp
  }
  if (url.pathname.startsWith('/admin/')) {
    const b = req.method === 'POST' ? await body(req) : {};
    const key = b.key || url.searchParams.get('key');
    if (!key || key.length !== ADMIN_KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY))) return json(res, 403, { error: 'Sai mật khẩu admin' });
    const fn = adminActions[url.pathname.slice(7)];
    if (!fn) return json(res, 404, {});
    const r = fn(b);
    if (typeof r === 'string') return json(res, 400, { error: r });
    return json(res, 200, { ...adminView(), ...r });
  }

  const file = path.join('public', path.normalize(url.pathname === '/' ? 'index.html' : url.pathname).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    // icon/logo ít đổi: cho điện thoại giữ 1 ngày; trang HTML luôn hỏi lại để nhận bản mới
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': /\.(png|svg)$/.test(file) ? 'public, max-age=86400' : 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, process.env.HOST, () => console.log(`Blue DM: http://localhost:${PORT}  (admin: /admin.html)`));
