import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRide, evaluateRide, planRoute, pickupAt, hasKeyword, addLandmark, LANDMARKS, findLandmark as L } from './engine.js';

const NOON = new Date('2026-11-13T12:00:00+07:00').getTime();

test('bóc tách tin khách', () => {
  const r = parseRide('Cần 2 ghế Phúc Yên đi Cầu Giấy, đi luôn. 0912.345.678 200k');
  assert.equal(r.isRide, true);
  assert.equal(r.pickup.name, 'Phúc Yên');
  assert.equal(r.dropoff.name, 'Cầu Giấy');
  assert.equal(r.seats, 2);
  assert.equal(r.phone, '0912345678');
  assert.equal(r.price, 200000);
  const rev = parseRide('1 khách về Vĩnh Yên từ Mỹ Đình');
  assert.equal(rev.pickup.name, 'Mỹ Đình');
  assert.equal(rev.dropoff.name, 'Vĩnh Yên');
  assert.equal(parseRide('Cầu Giấy HN đi Vĩnh Yên 1 khách').pickup.name, 'Cầu Giấy');
});

test('đọc code nhóm, giờ đón, tin chưa rõ tuyến', () => {
  const r = parseRide('1k chợ Lương Sơn đi Bv Nam Học 300k Ct. code 88');
  assert.equal(r.code, '88');
  assert.equal(r.isRide, false);
  assert.equal(r.maybe, true); // Lương Sơn ngoài danh bạ nhưng vẫn phải báo
  assert.equal(r.price, 300000);
  const t = parseRide('12h30-13h 1 khách ghép Mỹ Đình đi Vĩnh Yên 250k');
  assert.equal(t.time, '12h30');
  assert.equal(t.isRide, true);
  assert.equal(parseRide('Cần 2 ghế Phúc Yên đi Cầu Giấy, đi luôn').time, 'Đi ngay');
  assert.equal(parseRide('mọi người cho hỏi hôm nay trời mưa to không').maybe, false);
  assert.equal(hasKeyword('Nhận ship hàng Phúc Yên', ['hàng']), 'hàng');
});

test('admin thêm địa danh thì đọc được ngay', () => {
  const text = '1 khách Lương Sơn đi Hà Đông 300k';
  assert.equal(parseRide(text).isRide, false);
  addLandmark('Lương Sơn', 20.8820, 105.5180, ['luong son', 'cho luong son']);
  const r = parseRide(text);
  assert.equal(r.isRide, true);
  assert.equal(r.pickup.name, 'Lương Sơn');
  assert.equal(r.dropoff.name, 'Hà Đông');
  addLandmark('Lương Sơn', 20.9, 105.5, ['luong son']); // thêm lại = cập nhật, không nhân đôi
  assert.equal(LANDMARKS.filter(l => l.name === 'Lương Sơn').length, 1);
  addLandmark('Ngã ba (Ba La)', 20.95, 105.76, ['ba la.']); // ký tự đặc biệt không làm hỏng regex
  assert.equal(parseRide('1 khách Ba La. đi Cầu Giấy').pickup.name, 'Ngã ba (Ba La)');
});

test('bỏ tin tài xế / nhiễu', () => {
  assert.equal(parseRide('Xe 7c VY-HN còn 3 ghế ae ib').isRide, false);
  assert.equal(parseRide('em nhận').isRide, false);
  assert.equal(parseRide('Nhận khách Vĩnh Yên đi Hà Nội').isRide, false);
});

const driver = (over = {}) => ({
  pos: L('Bình Xuyên'), dest: L('Hà Nội'), totalSeats: 4, walkIns: 0, maxDetour: 20, rides: [], ...over,
});
const ride = (p, d, seats = 1) => ({ pickup: L(p), dropoff: L(d), seats });

test('nhận cuốc thuận đường, loại ngược đường', () => {
  assert.equal(evaluateRide(driver(), ride('Phúc Yên', 'Cầu Giấy'), NOON).ok, true);
  assert.match(evaluateRide(driver(), ride('Tam Đảo', 'Cầu Giấy'), NOON).reason, /Ngược đường/);
  assert.match(evaluateRide(driver(), ride('Mỹ Đình', 'Vĩnh Yên'), NOON).reason, /Ngược chiều/);
  assert.match(evaluateRide(driver({ walkIns: 4 }), ride('Phúc Yên', 'Cầu Giấy'), NOON).reason, /Kín xe/);
  assert.match(evaluateRide(driver({ maxDetour: 1 }), ride('Sóc Sơn', 'Long Biên'), NOON).reason, /Lệch/);
});

test('khách ngồi lâu được trả trước nếu không làm người khác trễ quá 12p', () => {
  const pos = L('Phạm Văn Đồng');
  const long = { id: 'a', status: 'onboard', dropoff: L('Đống Đa'), boardedAt: NOON - 95 * 60000, seats: 1 };
  const fresh = { id: 'b', status: 'onboard', dropoff: L('Láng'), boardedAt: NOON - 10 * 60000, seats: 1 };
  const plan = planRoute(pos, L('Hà Nội'), [long, fresh], NOON);
  assert.equal(plan.stops[0].ride.id, 'a');
  assert.equal(plan.reordered, true);
  // bình thường thì trả Láng (gần) trước
  const far = { ...fresh, dropoff: L('Cầu Giấy') }; // đổi thứ tự làm khách kia trễ >12p -> giữ nguyên
  assert.equal(planRoute(pos, L('Hà Nội'), [long, far], NOON).stops[0].ride.id, 'b');
  const normal = planRoute(pos, L('Hà Nội'), [{ ...long, boardedAt: NOON }, fresh], NOON);
  assert.equal(normal.stops[0].ride.id, 'b');
});

test('đón trước khi trả, 7 khách vẫn nhanh', () => {
  const names = ['Cầu Giấy', 'Đống Đa', 'Thanh Xuân', 'Hà Đông', 'Long Biên', 'Hoàn Kiếm', 'Tây Hồ'];
  const rides = names.map((d, i) => ({ id: i, status: i < 3 ? 'assigned' : 'onboard', pickup: L('Phúc Yên'), dropoff: L(d), boardedAt: NOON, seats: 1 }));
  const t = performance.now();
  const plan = planRoute(L('Vĩnh Yên'), L('Hà Nội'), rides, NOON);
  assert.ok(performance.now() - t < 1500, 'quá chậm');
  for (const r of rides.filter(r => r.status === 'assigned')) {
    const i = plan.stops.findIndex(s => s.ride === r && s.type === 'pickup');
    assert.ok(i >= 0 && i < plan.stops.findIndex(s => s.ride === r && s.type === 'dropoff'));
  }
});

test('giờ hẹn đón và giá tối thiểu', () => {
  assert.equal(pickupAt('12h30', NOON), NOON + 30 * 60000);
  assert.equal(pickupAt('9h', NOON), NOON + 21 * 3600e3); // đã qua hơn 2 tiếng → sáng mai
  assert.equal(pickupAt('Đi ngay', NOON), undefined);
  assert.equal(pickupAt('25h', NOON), undefined);
  const r = t => ({ ...ride('Phúc Yên', 'Cầu Giấy'), time: t });
  assert.equal(evaluateRide(driver(), r('12h15'), NOON).ok, true);
  assert.match(evaluateRide(driver(), r('14h'), NOON).reason, /tới sớm/);
  assert.match(evaluateRide(driver(), r('11h'), NOON).reason, /tới trễ/);
  const cheap = { ...ride('Phúc Yên', 'Cầu Giấy'), price: 80000 };
  assert.match(evaluateRide(driver({ minPrice: 150000 }), cheap, NOON).reason, /Giá 80k \(dưới 150k\)/);
  assert.equal(evaluateRide(driver({ minPrice: 150000 }), ride('Phúc Yên', 'Cầu Giấy'), NOON).ok, true); // không ghi giá: không lọc
});
