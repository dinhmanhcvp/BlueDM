import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_MAPS_KEY = 'test-key';
process.env.GOOGLE_ROUTES_PER_DRIVER_DAY = '3';
const { findLandmark: L, estimateMinutes } = await import('./engine.js');
const g = await import('./google.js');

// giả lập Google: chặng nào cũng chậm gấp đôi ước lượng
let calls = 0;
globalThis.fetch = async (url, opt) => {
  calls++;
  const body = JSON.parse(opt.body);
  assert.equal(opt.headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(body.routingPreference, 'TRAFFIC_AWARE');
  const pts = [body.origin, ...body.intermediates, body.destination].map(w => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude }));
  const legs = pts.slice(1).map((b, i) => ({ duration: `${Math.round(estimateMinutes(pts[i], b) * 2 * 60)}s`, distanceMeters: 1000 }));
  const total = legs.reduce((s, l) => s + parseInt(l.duration), 0);
  return { ok: true, json: async () => ({ routes: [{ duration: `${total}s`, distanceMeters: 5000, polyline: { encodedPolyline: 'abc' }, legs }] }) };
};

test('đọc đường Google, lưu chặng, học hệ số tắc, có trần chi phí', async () => {
  const pts = [L('Vĩnh Yên'), L('Phúc Yên'), L('Cầu Giấy')];
  const r = await g.route('A', pts);
  assert.equal(r.legs.length, 2);
  assert.equal(r.polyline, 'abc');
  // chặng đã hỏi: dùng đúng số Google
  assert.ok(Math.abs(g.travelMinutes(pts[0], pts[1], Date.now()) - r.legs[0].min) < 0.01);
  // chặng chưa hỏi: ước lượng nhân hệ số học được (~2)
  const est = estimateMinutes(L('Mê Linh'), L('Nội Bài'));
  assert.ok(Math.abs(g.travelMinutes(L('Mê Linh'), L('Nội Bài'), Date.now()) / est - 2) < 0.1);
  await g.route('A', pts); await g.route('A', pts);
  assert.equal(await g.route('A', pts), null, 'vượt trần mà vẫn gọi');
  assert.equal(calls, 3);
  assert.ok(await g.route('B', pts), 'trần phải tính riêng từng tài xế');
});
