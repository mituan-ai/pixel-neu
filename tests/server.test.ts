import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { Auth, ApiError, RateLimit, clientIp } from '../server/auth.ts';
import { ChatHub, type Peer } from '../server/chat.ts';
import { Db } from '../server/db.ts';
import { aliyunSign, smsSender } from '../server/sms.ts';
import { parseOpenMeteo } from '../server/weather.ts';
import { CHAT, cleanText, isChannel, type ChatLine } from '../shared/social.ts';

const PHONE = '13800138000';

function setup() {
  const db = new Db(':memory:', 'test-salt');
  const sent: string[] = [];
  const auth = new Auth(db, { send: async (_p, code) => void sent.push(code) });
  return { db, auth, sent };
}

async function login(auth: Auth, sent: string[], phone = PHONE, now = 1e12) {
  await auth.sendCode(phone, '1.1.1.1', now);
  return auth.login(phone, sent.at(-1), now);
}

describe('登录', () => {
  it('新号码自动注册，第二次登录还是同一个账号', async () => {
    const { db, auth, sent } = setup();
    const a = await login(auth, sent);
    expect(a.created).toBe(true);
    expect(db.userByToken(a.token, 1e12)?.id).toBe(a.user.id);
    const b = await login(auth, sent, PHONE, 1e12 + 120_000);
    expect(b.created).toBe(false);
    expect(b.user.id).toBe(a.user.id);
  });

  it('不存明文手机号', async () => {
    const { db, auth, sent } = setup();
    await login(auth, sent);
    const dump = JSON.stringify(db.sql.prepare('SELECT * FROM users').all()) + JSON.stringify(db.sql.prepare('SELECT * FROM sms_log').all());
    expect(dump).not.toContain(PHONE);
  });

  it('验证码错 5 次作废，过期作废，用过作废', async () => {
    const { auth, sent } = setup();
    await auth.sendCode(PHONE, 'ip', 1e12);
    const wrong = sent[0] === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(() => auth.login(PHONE, wrong, 1e12)).toThrow('验证码不对');
    expect(() => auth.login(PHONE, sent[0], 1e12)).toThrow('失效');
    await auth.sendCode(PHONE, 'ip', 1e12 + 61_000);
    expect(() => auth.login(PHONE, sent[1], 1e12 + 61_000 + 5 * 60_000 + 1)).toThrow('失效');
    await auth.sendCode(PHONE, 'ip', 1e12 + 1e6);
    auth.login(PHONE, sent[2], 1e12 + 1e6);
    expect(() => auth.login(PHONE, sent[2], 1e12 + 1e6)).toThrow('失效');
  });

  it('同一号码 60 秒一次、一天 10 次；同一 IP 10 分钟 5 次', async () => {
    const { auth } = setup();
    await auth.sendCode(PHONE, 'a', 0 + 1e12);
    await expect(auth.sendCode(PHONE, 'a', 1e12 + 30_000)).rejects.toThrow(ApiError);
    for (let i = 1; i < 10; i++) await auth.sendCode(PHONE, `ip${i}`, 1e12 + i * 61_000);
    await expect(auth.sendCode(PHONE, 'z', 1e12 + 11 * 61_000)).rejects.toThrow('今天');
    for (let i = 0; i < 5; i++) await auth.sendCode(`1390000000${i}`, 'same', 2e12 + i);
    await expect(auth.sendCode('13900000009', 'same', 2e12 + 10)).rejects.toThrow('频繁');
  });

  it('没配短信服务商时不开放', async () => {
    const auth = new Auth(new Db(':memory:', 's'), undefined);
    await expect(auth.sendCode(PHONE, 'ip')).rejects.toMatchObject({ status: 503 });
  });

  it('手机号格式、封号、吊销', async () => {
    const { db, auth, sent } = setup();
    await expect(auth.sendCode('12345', 'ip')).rejects.toThrow('格式');
    const a = await login(auth, sent);
    expect(db.userByToken(a.token, 1e12)?.id).toBe(a.user.id);
    db.setBanned(a.user.id, true);
    expect(db.userByToken(a.token, 1e12)).toBeUndefined();
    await auth.sendCode(PHONE, 'ip', 1e12 + 1e6);
    expect(() => auth.login(PHONE, sent.at(-1), 1e12 + 1e6)).toThrow('封禁');
  });

  it('代理头取 IP', () => {
    expect(clientIp({ 'x-real-ip': '9.9.9.9' })).toBe('9.9.9.9');
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })).toBe('1.2.3.4');
    expect(clientIp({}, '127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('接口限频', () => {
  it('每个 IP 每分钟超过上限就拒绝，过了一分钟恢复', () => {
    const r = new RateLimit(3);
    for (let i = 0; i < 3; i++) expect(r.take('1.1.1.1', 1000)).toBe(true);
    expect(r.take('1.1.1.1', 1000)).toBe(false);
    expect(r.take('2.2.2.2', 1000)).toBe(true);
    expect(r.take('1.1.1.1', 61_000)).toBe(true);
  });
});

describe('聊天', () => {
  function chat() {
    const { db, auth, sent } = setup();
    const hub = new ChatHub(db, ['坏词']);
    const inbox = new Map<string, ChatLine[]>();
    const peer = (sid: string, uid: number): Peer => {
      inbox.set(sid, []);
      const p: Peer = { sid, uid, blocked: db.blocked(uid), send: (_t, m) => inbox.get(sid)!.push(m as ChatLine) };
      hub.peers.set(sid, p);
      return p;
    };
    return { db, auth, sent, hub, inbox, peer };
  }

  it('访客不能说话；新号只能在附近说；限频；敏感词', async () => {
    const { auth, sent, hub } = chat();
    const { user } = await login(auth, sent);
    const t0 = user.created;
    expect(hub.post(undefined, 's', 'near', 'hi')).toBe('登录后才能发言');
    expect(hub.post(user, 's', 'square', 'hi', t0 + 1000)).toMatch('10 分钟');
    const line = hub.post(user, 's', 'near', '有坏词', t0 + 1000);
    expect(typeof line === 'object' && line.text).toBe('有＊＊');
    expect(hub.post(user, 's', 'near', 'again', t0 + 1500)).toMatch('太快');
    expect(typeof hub.post(user, 's', 'square', 'ok', t0 + CHAT.newbie + 1)).toBe('object');
  });

  it('广场跨房间投递，拉黑后互相看不到，历史也过滤', async () => {
    const { auth, sent, hub, inbox, peer, db } = chat();
    const a = (await login(auth, sent, '13800000001')).user;
    const b = (await login(auth, sent, '13800000002')).user;
    peer('A', a.id);
    peer('B', b.id);
    peer('G', 0);
    const t = a.created + CHAT.newbie + 1;
    hub.post(a, 'A', 'square', '大家好', t);
    expect(inbox.get('B')!.map((l) => l.text)).toEqual(['大家好']);
    expect(inbox.get('G')!.length).toBe(1);
    expect(inbox.get('A')![0].sid).toBe('A');
    expect(inbox.get('B')![0].sid).toBe('');
    hub.block(b, a.id, true);
    hub.post(a, 'A', 'square', '还在吗', t + 3000);
    expect(inbox.get('B')!.length).toBe(1);
    expect(inbox.get('G')!.length).toBe(2);
    expect(hub.history(hub.peers.get('B')!, 'square')!.lines.length).toBe(0);
    expect(hub.history(hub.peers.get('G')!, 'square')!.lines.length).toBe(2);
    hub.block(b, a.id, false);
    expect(db.blocked(b.id).size).toBe(0);
  });

  it('举报自己的消息无效，举报别人的进队列', async () => {
    const { auth, sent, hub, db } = chat();
    const a = (await login(auth, sent, '13800000001')).user;
    const b = (await login(auth, sent, '13800000002')).user;
    const line = hub.post(a, 'A', 'near', 'x', a.created + 1) as ChatLine;
    expect(hub.report(a, line.id)).toBe(false);
    expect(hub.report(b, line.id)).toBe(true);
    expect(db.reports()[0]).toMatchObject({ message: line.id, count: 1 });
  });

  it('禁言', async () => {
    const { auth, sent, hub, db } = chat();
    const a = (await login(auth, sent)).user;
    db.setMuted(a.id, a.created + 1e6);
    expect(hub.post(a, 'A', 'near', 'x', a.created + 1)).toMatch('禁言');
  });

  it('文字清洗和频道名', () => {
    expect(cleanText(' a\n\tb\u0000 ')).toBe('a b');
    expect([...cleanText('字'.repeat(200))].length).toBe(CHAT.max);
    expect(isChannel('room:study')).toBe(true);
    expect(isChannel('room:nope')).toBe(false);
  });
});

describe('阿里云短信', () => {
  it('密钥没配全就不开放', () => {
    expect(smsSender({ SMS_PROVIDER: 'aliyun', ALIYUN_ACCESS_KEY_ID: 'id' })).toBeUndefined();
  });

  it('签名可复算，模板参数带验证码和分钟数，返回不是 OK 就抛错', async () => {
    const got: Record<string, string>[] = [];
    let reply = { Code: 'OK' };
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c)).on('end', () => {
        got.push(Object.fromEntries(new URLSearchParams(b)));
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const env = {
      SMS_PROVIDER: 'aliyun', ALIYUN_ACCESS_KEY_ID: 'id', ALIYUN_ACCESS_KEY_SECRET: 'secret', ALIYUN_SMS_SIGN_NAME: '签名',
      ALIYUN_SMS_TEMPLATE_CODE: '100001', ALIYUN_SMS_ENDPOINT: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`,
    };
    try {
      const sms = smsSender(env)!;
      await sms.send(PHONE, '012345');
      const { Signature, ...rest } = got[0];
      expect(aliyunSign(rest, 'secret').Signature).toBe(Signature);
      expect(rest).toMatchObject({ Action: 'SendSmsVerifyCode', PhoneNumber: PHONE, SignName: '签名', TemplateCode: '100001' });
      expect(JSON.parse(rest.TemplateParam)).toEqual({ code: '012345', min: '5' });
      reply = { Code: 'BUSINESS_LIMIT_CONTROL' };
      await expect(sms.send(PHONE, '012345')).rejects.toThrow('BUSINESS_LIMIT_CONTROL');
    } finally {
      srv.close();
    }
  });
});

describe('天气', () => {
  it('整理 Open-Meteo 的返回', () => {
    const w = parseOpenMeteo(
      {
        current: { temperature_2m: 6.24, weather_code: 71, snow_depth: 0.05, precipitation: 0.2, wind_speed_10m: 9.6, relative_humidity_2m: 63 },
        hourly: { time: [1793613600], temperature_2m: [5.6], weather_code: [3], precipitation_probability: [10] },
      },
      42,
    );
    expect(w).toMatchObject({ code: 71, temp: 6.2, snow: 5, updated: 42, stale: false });
    expect(w.hourly[0]).toEqual({ t: 1793613600000, code: 3, temp: 6, pop: 10 });
  });
});
