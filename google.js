// Thời gian chạy xe theo giao thông thực của Google (Routes API, computeRoutes TRAFFIC_AWARE).
// Tính tiền theo lần gọi, không theo cặp điểm: mỗi lần hỏi 1 đường qua mọi điểm dừng.
// Thời gian từng chặng được lưu lại + dùng để học hệ số tắc đường cho các ước lượng còn lại.
import { estimateMinutes, inCity } from './engine.js';

const KEY = process.env.GOOGLE_MAPS_KEY;
const PER_DRIVER_DAY = +process.env.GOOGLE_ROUTES_PER_DRIVER_DAY || 60; // trần chi phí: ~60 x $0,01
export const enabled = !!KEY;

const pk = p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`; // ~100m
const legs = new Map();           // "a>b" -> { min, at }
const ratios = { city: [], out: [] }; // Google / ước lượng gần đây theo vùng
const usage = new Map();          // mã tài xế -> { day, n }

// hệ số tắc đường = trung vị tỉ lệ thật/ước lượng trong 30 phút gần nhất
export function trafficFactor(zone) {
  const r = ratios[zone].filter(x => Date.now() - x.at < 30 * 60000).map(x => x.r).sort((a, b) => a - b);
  return r.length ? Math.min(3, Math.max(0.6, r[r.length >> 1])) : 1;
}

export function travelMinutes(a, b, now) {
  const c = legs.get(pk(a) + '>' + pk(b));
  if (c && Date.now() - c.at < 15 * 60000) return c.min;
  return estimateMinutes(a, b, now) * trafficFactor(inCity(a, b) ? 'city' : 'out');
}

function allow(code) {
  const day = new Date().toDateString(), u = usage.get(code);
  if (!u || u.day !== day) { usage.set(code, { day, n: 1 }); return true; }
  return u.n < PER_DRIVER_DAY && ++u.n;
}

// points: [vị trí xe, ...điểm dừng, điểm cuối]. Trả về null nếu không có khoá / hết ngân sách / lỗi mạng.
export async function route(code, points) {
  if (!KEY || points.length < 2 || !allow(code)) return null;
  const ll = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
      },
      body: JSON.stringify({
        origin: ll(points[0]), destination: ll(points.at(-1)), intermediates: points.slice(1, -1).map(ll),
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', polylineQuality: 'OVERVIEW', languageCode: 'vi', units: 'METRIC',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { console.warn('Google Routes', res.status, (await res.text()).slice(0, 200)); return null; }
    const r = (await res.json()).routes?.[0];
    if (!r) return null;
    const at = Date.now();
    const out = r.legs.map((l, i) => {
      const a = points[i], b = points[i + 1], min = parseInt(l.duration) / 60, est = estimateMinutes(a, b, at);
      legs.set(pk(a) + '>' + pk(b), { min, at });
      if (est > 2) {
        const z = ratios[inCity(a, b) ? 'city' : 'out'];
        z.push({ r: min / est, at }); if (z.length > 200) z.shift();
      }
      return { min, km: (l.distanceMeters || 0) / 1000 };
    });
    return { total: parseInt(r.duration) / 60, legs: out, polyline: r.polyline?.encodedPolyline || '', at };
  } catch (e) {
    console.warn('Google Routes lỗi mạng:', e.message);
    return null;
  }
}
