// Kết nối Zalo cá nhân của 1 tài xế (zca-js, API không chính thức).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Zalo, ThreadType, LoginQRCallbackEventType as QR, Reactions } from 'zca-js';

const LINES = ['Em nhận cuốc {p} nhé bác', 'Xe em đang qua {p}, cho em chốt ạ', '+1 nhận {p} nhé', 'Cho em chốt khách {p} ạ', 'Em nhận ạ, xe gần {p}'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtPhone = p => p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1.$2.$3');
export const claimText = (pickupName, { reply, code, mainPhone }) =>
  (reply || pick(LINES).replace('{p}', pickupName || 'cuốc này')) + (code ? ` ${code}` : '') + (mainPhone ? `, alo số em: ${fmtPhone(mainPhone)}` : '');

// Phiên đăng nhập (cookie, imei, userAgent) lưu mã hoá AES-256-GCM, quét QR 1 lần là dùng mãi
const keyOf = secret => crypto.createHash('sha256').update(secret).digest();
function saveSession(file, secret, data) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
  fs.writeFileSync(file, JSON.stringify({ iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: enc.toString('hex') }));
}
function loadSession(file, secret) {
  const { iv, tag, data } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString());
}

// hooks: { alive(), onQR(dataUrl), onStatus(text), onMessage(text, source) }
export async function connectZalo(credFile, secret, hooks) {
  const zalo = new Zalo({ selfListen: false, logging: false });
  let api;
  try {
    if (fs.existsSync(credFile)) api = await zalo.login(loadSession(credFile, secret));
  } catch { hooks.onStatus('Phiên cũ hết hạn, quét QR lại'); }
  if (!api) {
    let expired = 0;
    api = await zalo.loginQR({}, ev => {
      if (!hooks.alive() && ev.actions?.abort) return ev.actions.abort();
      if (ev.type === QR.QRCodeGenerated) hooks.onQR('data:image/png;base64,' + ev.data.image);
      // mỗi mã sống ~1 phút; làm mới tối đa 5 lần rồi dừng, tránh treo phiên chờ mãi
      if (ev.type === QR.QRCodeExpired) ++expired < 5 ? ev.actions.retry() : ev.actions.abort();
      if (ev.type === QR.QRCodeScanned) hooks.onStatus('Đã quét, xác nhận trên điện thoại...');
      if (ev.type === QR.GotLoginInfo) saveSession(credFile, secret, ev.data);
    }).catch(() => null);
    if (!api) throw new Error('Mã QR hết hạn, bấm kết nối lại');
  }
  hooks.onQR(null);
  hooks.onStatus('Đã kết nối Zalo');
  // tên tài khoản + danh sách nhóm, để tài xế chọn nhóm nào canh / tự nhận
  api.fetchAccountInfo().then(r => hooks.onAccount(r.profile.displayName || r.profile.zaloName)).catch(() => {});
  api.getAllGroups().then(async ({ gridVerMap }) => {
    const ids = Object.keys(gridVerMap), list = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { gridInfoMap } = await api.getGroupInfo(ids.slice(i, i + 50));
      for (const [id, g] of Object.entries(gridInfoMap)) list.push({ id, name: g.name });
    }
    hooks.onGroups(list);
  }).catch(() => {});

  api.listener.on('message', m => {
    if (m.type !== ThreadType.Group || m.isSelf || typeof m.data.content !== 'string') return;
    hooks.onMessage(m.data.content, { threadId: m.threadId, data: m.data });
  });
  api.listener.on('closed', () => hooks.onStatus('Mất kết nối Zalo'));
  api.listener.on('error', () => {});
  api.listener.start();

  return {
    // mode 'reply': trả lời trích dẫn trong nhóm; 'inbox': thả tim + nhắn riêng người đăng
    // reply: câu chốt tài xế tự đặt (vd "Ok"), trống thì xoay vòng câu mẫu chống khoá
    // text: câu tài xế tự sửa cho riêng tin này (gửi nguyên văn)
    // code: nhóm bắt trả lời kèm code ("Ok 88"); mainPhone: để khách gọi số chính dù nick phụ đi chốt
    async claim(source, pickupName, mode = 'reply', { reply = '', code = '', mainPhone = '', text = '' } = {}) {
      // chống bị nhận diện là bot: hiện "đang gõ" rồi trễ ngẫu nhiên
      const [to, type] = mode === 'inbox' ? [source.data.uidFrom, ThreadType.User] : [source.threadId, ThreadType.Group];
      await api.sendTypingEvent(to, type).catch(() => {});
      await sleep(600 + Math.random() * 600);
      const msg = text || claimText(pickupName, { reply, code, mainPhone }); // text: câu tài xế tự sửa, gửi nguyên văn
      if (mode === 'inbox') {
        await api.addReaction(Reactions.HEART, { data: { msgId: source.data.msgId, cliMsgId: source.data.cliMsgId }, threadId: source.threadId, type: ThreadType.Group });
        return api.sendMessage(msg, to, ThreadType.User);
      }
      return api.sendMessage({ msg, quote: source.data }, to, ThreadType.Group);
    },
    logout() { api.listener.stop(); fs.rmSync(credFile, { force: true }); },
  };
}

// tự kiểm tra mã hoá phiên: node zalo.js --selftest
if (process.argv[2] === '--selftest') {
  const f = `${process.env.TEMP || '/tmp'}/zalo-selftest.json`;
  saveSession(f, 'k', { cookie: [1], imei: 'x' });
  console.assert(loadSession(f, 'k').imei === 'x', 'giải mã sai');
  let bad = false; try { loadSession(f, 'sai'); } catch { bad = true; }
  console.assert(bad, 'sai khoá vẫn giải mã được');
  console.assert(fmtPhone('0912345678') === '0912.345.678');
  console.assert(claimText('X', { reply: 'Ok', code: '88' }) === 'Ok 88', 'thiếu code nhóm');
  console.assert(claimText('X', { reply: 'Ok', mainPhone: '0912345678' }) === 'Ok, alo số em: 0912.345.678');
  console.assert(LINES.map(l => l.replace('{p}', 'X')).includes(claimText('X', {})), 'câu mẫu sai');
  fs.rmSync(f); console.log('zalo selftest ok');
}
