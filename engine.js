// Lõi: địa danh, bóc tách tin nhắn, lập lộ trình đón/trả, đánh giá cuốc mới.

// [tên hiển thị, lat, lng, ...alias (không dấu, chữ thường)]
const RAW = [
  ['Vĩnh Yên', 21.3089, 105.6049, 'vinh yen', 'vy', 'tp vinh yen'],
  ['Tam Đảo', 21.4560, 105.6450, 'tam dao'],
  ['Tam Dương', 21.3640, 105.5500, 'tam duong', 'hop hoa'],
  ['Lập Thạch', 21.4140, 105.4600, 'lap thach'],
  ['Yên Lạc', 21.2190, 105.5770, 'yen lac'],
  ['Vĩnh Tường', 21.2330, 105.5000, 'vinh tuong', 'tho tang'],
  ['Bình Xuyên', 21.2790, 105.6510, 'binh xuyen', 'huong canh', 'thien ke'],
  ['Phúc Yên', 21.2370, 105.7050, 'phuc yen', 'py'],
  ['Xuân Hòa', 21.2650, 105.7180, 'xuan hoa', 'su pham 2'],
  ['Mê Linh', 21.1830, 105.7180, 'me linh'],
  ['Quang Minh', 21.1940, 105.7650, 'quang minh', 'kcn quang minh'],
  ['Nội Bài', 21.2187, 105.8042, 'noi bai', 'san bay', 'sb noi bai', 'nb'],
  ['Sóc Sơn', 21.2560, 105.8490, 'soc son'],
  ['Đông Anh', 21.1380, 105.8480, 'dong anh'],
  ['Bắc Từ Liêm', 21.0700, 105.7650, 'bac tu liem'],
  ['Cổ Nhuế', 21.0660, 105.7800, 'co nhue'],
  ['Phạm Văn Đồng', 21.0550, 105.7820, 'pham van dong', 'pvd'],
  ['Hoàng Quốc Việt', 21.0460, 105.7980, 'hoang quoc viet', 'hqv'],
  ['Xuân Thủy', 21.0365, 105.7830, 'xuan thuy', 'dhqg'],
  ['Cầu Giấy', 21.0330, 105.7980, 'cau giay', 'cg'],
  ['Mỹ Đình', 21.0285, 105.7787, 'my dinh', 'md', 'ben xe my dinh'],
  ['Phạm Hùng', 21.0170, 105.7840, 'pham hung', 'keangnam'],
  ['Nam Từ Liêm', 21.0130, 105.7650, 'nam tu liem'],
  ['Trần Duy Hưng', 21.0110, 105.8000, 'tran duy hung', 'big c', 'tdh'],
  ['Lê Văn Lương', 21.0030, 105.8050, 'le van luong'],
  ['Láng', 21.0180, 105.8100, 'duong lang', 'nga tu lang', 'lang ha'],
  ['Thanh Xuân', 20.9950, 105.8100, 'thanh xuan', 'royal city', 'nguyen trai'],
  ['Ngã Tư Sở', 21.0030, 105.8200, 'nga tu so'],
  ['Hà Đông', 20.9710, 105.7780, 'ha dong'],
  ['Kim Mã', 21.0310, 105.8250, 'kim ma'],
  ['Ba Đình', 21.0340, 105.8190, 'ba dinh'],
  ['Tây Hồ', 21.0700, 105.8180, 'tay ho', 'ho tay'],
  ['Đống Đa', 21.0150, 105.8270, 'dong da'],
  ['Hoàn Kiếm', 21.0285, 105.8520, 'hoan kiem', 'ho guom', 'pho co'],
  ['Hai Bà Trưng', 21.0060, 105.8580, 'hai ba trung', 'hbt'],
  ['Bách Khoa', 21.0050, 105.8430, 'bach khoa', 'dhbk'],
  ['Giải Phóng', 20.9800, 105.8410, 'giai phong', 'giap bat', 'ben xe giap bat'],
  ['Linh Đàm', 20.9640, 105.8270, 'linh dam'],
  ['Hoàng Mai', 20.9750, 105.8630, 'hoang mai'],
  ['Times City', 20.9950, 105.8680, 'times city', 'minh khai'],
  ['Long Biên', 21.0450, 105.8900, 'long bien'],
  // chung chung để cuối: chỉ khớp khi không có địa danh cụ thể hơn
  ['Hà Nội', 21.0285, 105.8300, 'ha noi', 'hn', 'noi thanh'],
  ['Vĩnh Phúc', 21.3089, 105.6049, 'vinh phuc', 'vp'],
];

export const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const landmark = (name, lat, lng, aliases) => ({
  name, lat, lng,
  re: new RegExp(`(^|[^a-z0-9])(${aliases.map(escRe).join('|')})(?=[^a-z0-9]|$)`, 'g'),
});
export const LANDMARKS = RAW.map(([name, lat, lng, ...aliases]) => landmark(name, lat, lng, aliases));

// địa danh admin thêm khi chạy thử (từ tin chưa đọc được); tên gọi khác viết thường, bỏ dấu
export function addLandmark(name, lat, lng, aliases = []) {
  const all = [...new Set([name, ...aliases].map(a => strip(a).trim()).filter(Boolean))];
  const i = LANDMARKS.findIndex(l => l.name === name);
  if (i >= 0) LANDMARKS.splice(i, 1);
  LANDMARKS.push(landmark(name, lat, lng, all));
}
const GENERIC = new Set(['Hà Nội', 'Vĩnh Phúc']);

export const findLandmark = name => LANDMARKS.find(l => l.name === name || strip(l.name) === strip(name || ''));

// ---------- Bóc tách tin nhắn ----------
const DRIVER_AD = /con \d+ ?(ghe|cho|g)\b|xe trong|nhan (khach|cho|cuoc)|tim khach|can (tim )?khach/;
const NOISE = /^(\+?1|ok|oke|nhan|em nhan|da nhan|chot|da chot|ib|inbox|xong|da du|du roi|full)[\s.!]*$/;

export function parseRide(text) {
  const t = strip(text).replace(/\s+/g, ' ').trim();
  if (t.length < 8 || NOISE.test(t)) return { isRide: false, reason: 'Tin nhiễu' };
  if (DRIVER_AD.test(t)) return { isRide: false, reason: 'Tin xe chào khách' };

  const seatM = t.match(/(\d)\s*(g|ghe|khach|kh|nguoi|ng|cho|slot)\b/);
  const priceM = t.match(/(\d{2,4})\s*(k|nghin|ng)\b/);
  const timeM = t.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/);
  const extra = {
    seats: /bao xe|bao chuyen/.test(t) ? 4 : seatM ? +seatM[1] : 1,
    phone: (text.replace(/[.\s-]/g, '').match(/(\+84|0)\d{9}/) || [])[0],
    price: priceM ? +priceM[1] * 1000 : undefined,
    code: t.match(/\b(?:code|ma)\s*[:#]?\s*(\d{1,6})\b/)?.[1], // nhóm bắt trả lời kèm code, vd "Ok 88"
    time: timeM ? `${timeM[1]}h${timeM[2] || ''}` : /di (luon|ngay)|\bgap\b/.test(t) ? 'Đi ngay' : undefined,
    text,
  };

  let hits = [];
  for (const l of LANDMARKS) for (const m of t.matchAll(l.re)) {
    const at = m.index + m[1].length, before = t.slice(Math.max(0, at - 8), at);
    hits.push({ l, at, hint: /(tu|don( o| tai)?) $/.test(before) ? 'from' : /(ve|di|xuong|len|toi|den|tra( o| tai)?) $/.test(before) ? 'to' : '' });
  }
  hits.sort((a, b) => a.at - b.at);
  hits = hits.filter((h, i) => hits.findIndex(x => x.l === h.l) === i);
  if (hits.length > 2) hits = hits.filter(h => !GENERIC.has(h.l.name)); // "HN" thừa khi đã có "Cầu Giấy"
  if (hits.length < 2) {
    // nơi ngoài danh bạ nhưng trông như cuốc xe: vẫn báo để tài xế tự đọc, không bao giờ tự nhận
    const maybe = !!(priceM || seatM || extra.code || /\bkhach\b|bao xe|lai ho/.test(t));
    return { isRide: false, maybe, reason: 'Không rõ điểm đón/trả', ...extra };
  }
  const from = hits.find(h => h.hint === 'from') || hits.find(h => h.hint !== 'to') || hits[0];
  const to = hits.find(h => h !== from && h.hint === 'to') || hits.find(h => h !== from);
  return { isRide: true, pickup: from.l, dropoff: to.l, ...extra };
}

export const hasKeyword = (text, list) => list.find(k => k && strip(text).includes(strip(k)));

// ---------- Hình học & thời gian ----------
const HN_CENTER = { lat: 21.0285, lng: 105.8300 };
const toXY = (p, o) => ({ x: (p.lng - o.lng) * 111.32 * Math.cos(o.lat * Math.PI / 180), y: (p.lat - o.lat) * 110.57 });
export const km = (a, b) => { const v = toXY(b, a); return Math.hypot(v.x, v.y); };

export const inCity = (a, b) => km({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, HN_CENTER) < 9;

// Ước lượng không cần mạng: đường chim bay x1.3 + tốc độ cố định, giờ cao điểm nội thành chậm hơn
export function estimateMinutes(a, b, now = Date.now()) {
  const h = new Date(now).getHours();
  const rush = (h >= 7 && h < 9) || (h >= 16 && h < 19);
  const speed = inCity(a, b) ? (rush ? 13 : 22) : 45;
  return km(a, b) * 1.3 / speed * 60;
}

// Nguồn thời gian có thể thay (vd. Google theo giao thông thực); mặc định là ước lượng
let travelTime = estimateMinutes;
export const setTravelTime = fn => { travelTime = fn; };
export const minutes = (a, b, now = Date.now()) => travelTime(a, b, now);

// tiến độ (km) của điểm p dọc trục pos -> dest
const progress = (p, pos, dest) => {
  const u = toXY(dest, pos), w = toXY(p, pos), n = Math.hypot(u.x, u.y) || 1;
  return (w.x * u.x + w.y * u.y) / n;
};

// ---------- Lập lộ trình ----------
// rides: [{id, pickup, dropoff, seats, status:'assigned'|'onboard', boardedAt}]
// Duyệt toàn bộ thứ tự (đón trước trả, các điểm đón theo đúng chiều đi), nhánh-cận theo chi phí.
// Lượt 1: tối thiểu thời gian chạy. Lượt 2: thêm phạt ngồi lâu, nhưng không khách nào bị trễ quá maxExtra phút so với lượt 1.
export function planRoute(pos, dest, rides, now, opt = {}) {
  const { maxRideMin = 90, maxExtra = 12, beta = 0.5 } = opt;
  const stops = [];
  for (const r of rides) {
    if (r.status === 'assigned') stops.push({ type: 'pickup', ride: r, at: r.pickup });
    stops.push({ type: 'dropoff', ride: r, at: r.dropoff });
  }
  const pickupsInOrder = stops.filter(s => s.type === 'pickup')
    .sort((a, b) => progress(a.at, pos, dest) - progress(b.at, pos, dest));

  function search(withPenalty, base) {
    let best = null;
    const seq = [], picked = new Set(), arrival = {};
    const dfs = (from, t, cost, nextPick) => {
      if (best && cost >= best.cost) return;
      if (seq.length === stops.length) { best = { cost, time: t, stops: [...seq], arrival: { ...arrival } }; return; }
      for (const s of stops) {
        if (seq.includes(s)) continue;
        if (s.type === 'pickup' && s !== pickupsInOrder[nextPick]) continue;
        if (s.type === 'dropoff' && s.ride.status === 'assigned' && !picked.has(s.ride.id)) continue;
        const t2 = t + minutes(from, s.at, now);
        let c2 = cost + (t2 - t);
        if (s.type === 'dropoff') {
          if (base && t2 > base[s.ride.id] + maxExtra) continue;
          const startedAt = s.ride.status === 'onboard' ? -(now - s.ride.boardedAt) / 60000 : arrival['p' + s.ride.id];
          const ride = t2 - startedAt;
          if (withPenalty && ride > maxRideMin) c2 += beta * (ride - maxRideMin) ** 2;
          arrival[s.ride.id] = t2;
        } else { picked.add(s.ride.id); arrival['p' + s.ride.id] = t2; }
        seq.push(s);
        dfs(s.at, t2, c2, nextPick + (s.type === 'pickup'));
        seq.pop();
        if (s.type === 'pickup') picked.delete(s.ride.id);
      }
    };
    dfs(pos, 0, 0, 0);
    return best;
  }
  const fastest = search(false);
  const plan = search(true, fastest.arrival) || fastest;
  plan.endTime = plan.time + minutes(plan.stops.at(-1)?.at || pos, dest, now);
  plan.reordered = plan.stops.some((s, i) => s !== fastest.stops[i]);
  return plan;
}

export const freeSeats = st => st.totalSeats - st.walkIns - st.rides.reduce((n, r) => n + r.seats, 0);

// Giờ hẹn "12h30" → mốc thời gian (giờ Việt Nam) gần nhất: đã qua hơn 2 tiếng thì hiểu là ngày mai
export function pickupAt(time, now) {
  const m = /^(\d{1,2})h(\d{2})?$/.exec(time || '');
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return undefined;
  const vn = new Date(now + 7 * 3600e3);
  let t = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), +m[1], +(m[2] || 0)) - 7 * 3600e3;
  if (t < now - 2 * 3600e3) t += 864e5;
  return t;
}
const EARLY = 30, LATE = 15; // phút: xe tới sớm hơn giờ hẹn quá 30p (phải chờ) hoặc trễ quá 15p thì bỏ
const fmtK = v => `${Math.round(v / 1000)}k`;

// ---------- Đánh giá cuốc mới ----------
export function evaluateRide(st, ride, now) {
  if (freeSeats(st) < ride.seats) return { ok: false, reason: freeSeats(st) ? `Chỉ trống ${freeSeats(st)} ghế` : 'Kín xe' };
  // tin không ghi giá thì không lọc (đa số tin không ghi)
  if (st.minPrice && ride.price && ride.price < st.minPrice) return { ok: false, reason: `Giá ${fmtK(ride.price)} (dưới ${fmtK(st.minPrice)})` };
  const { pos, dest } = st;
  const pp = progress(ride.pickup, pos, dest), pd = progress(ride.dropoff, pos, dest);
  const dPick = km(pos, ride.pickup);
  if (dPick > 1) {
    const cos = pp / dPick;
    if (cos < Math.cos(75 * Math.PI / 180)) return { ok: false, reason: 'Ngược đường (đã chặn)' };
  }
  if (pd < pp - 1) return { ok: false, reason: 'Ngược chiều (đã chặn)' };
  if (pd > progress(dest, pos, dest) + 15) return { ok: false, reason: 'Trả quá xa điểm cuối' };

  const before = planRoute(pos, dest, st.rides, now).endTime;
  const plan = planRoute(pos, dest, [...st.rides, { ...ride, id: '_new', status: 'assigned' }], now);
  const detour = Math.round(plan.endTime - before);
  if (detour > st.maxDetour) return { ok: false, reason: `Lệch +${detour}p (quá ${st.maxDetour}p)`, detour };
  const at = pickupAt(ride.time, now);
  if (at) {
    const late = Math.round(plan.arrival.p_new - (at - now) / 60000);
    if (late > LATE) return { ok: false, reason: `Hẹn ${ride.time}, tới trễ ${late}p`, detour };
    if (late < -EARLY) return { ok: false, reason: `Hẹn ${ride.time}, tới sớm ${-late}p`, detour };
  }
  return { ok: true, detour };
}
