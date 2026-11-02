// 登录接口：手机号 + 短信验证码，新号码自动注册；登录后发 30 天的随机令牌。
// 挂在 Colyseus 的 express 上，路径 /api/...；网页经同源的 /colyseus/api/... 访问（代理去掉前缀）。
import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PHONE_RE } from '../shared/social.ts';
import type { Db, User } from './db.ts';
import type { SmsSender } from './sms.ts';

const MIN = 60_000;
export const SMS_RULES = {
  /** 验证码有效期 */
  ttl: 5 * MIN,
  /** 最多试几次 */
  tries: 5,
  /** 同一号码两次发送的最短间隔 */
  gap: MIN,
  /** 同一号码一天最多 */
  phoneDay: 10,
  /** 同一 IP 10 分钟最多、一天最多 */
  ip10: 5,
  ipDay: 30,
} as const;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 给客户端看的账号信息 */
export function publicUser(u: User) {
  return { id: u.id, name: u.name, look: u.look, created: u.created, mutedUntil: u.mutedUntil };
}

/** 登录逻辑，不依赖 HTTP，测试直接调 */
export class Auth {
  readonly db: Db;
  readonly sms: SmsSender | undefined;

  constructor(db: Db, sms: SmsSender | undefined) {
    this.db = db;
    this.sms = sms;
  }

  async sendCode(phone: unknown, ip: string, now = Date.now()): Promise<void> {
    if (!this.sms) throw new ApiError(503, '短信登录暂未开放');
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) throw new ApiError(400, '手机号格式不对');
    const h = this.db.phoneHash(phone);
    const r = SMS_RULES;
    if (this.db.smsCount('phone', h, r.gap, now) > 0) throw new ApiError(429, '发送太频繁，请一分钟后再试');
    if (this.db.smsCount('phone', h, 86_400_000, now) >= r.phoneDay) throw new ApiError(429, '这个号码今天的验证码次数用完了');
    if (this.db.smsCount('ip', ip, 10 * MIN, now) >= r.ip10 || this.db.smsCount('ip', ip, 86_400_000, now) >= r.ipDay)
      throw new ApiError(429, '发送太频繁，请稍后再试');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.db.saveCode(h, ip, code, r.ttl, now);
    try {
      await this.sms.send(phone, code);
    } catch (e) {
      console.error('短信发送失败', e);
      throw new ApiError(502, '短信发送失败，请稍后再试');
    }
  }

  login(phone: unknown, code: unknown, now = Date.now()): { token: string; user: User; created: boolean } {
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) throw new ApiError(400, '手机号格式不对');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new ApiError(400, '验证码是 6 位数字');
    const h = this.db.phoneHash(phone);
    const c = this.db.checkCode(h, code, SMS_RULES.tries, now);
    if (c === 'expired') throw new ApiError(400, '验证码已失效，请重新获取');
    if (c === 'wrong') throw new ApiError(400, '验证码不对');
    const { user, created } = this.db.userByPhone(h, now);
    if (user.banned) throw new ApiError(403, '这个账号已被封禁');
    const token = randomBytes(24).toString('base64url');
    this.db.saveToken(token, user.id, now);
    return { token, user, created };
  }
}

type Req = IncomingMessage & { body?: unknown };
type Handler = (body: Record<string, unknown>, ctx: { ip: string; token: string; user?: User }) => unknown;

/** 读 JSON 请求体，最多 4 KB */
function readBody(req: Req): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 4096) {
        reject(new ApiError(413, '请求太大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new ApiError(400, '请求格式不对'));
      }
    });
    req.on('error', reject);
  });
}

/** 客户端 IP：服务只监听本机，前面一定有代理（Vite 或 nginx），取代理写的头 */
export function clientIp(headers: IncomingMessage['headers'], fallback = ''): string {
  const real = headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || fallback;
}

function bearer(req: IncomingMessage): string {
  const a = req.headers.authorization;
  return typeof a === 'string' && a.startsWith('Bearer ') ? a.slice(7) : '';
}

/** 把接口挂到 express app 上 */
export function mountAuth(app: { post(path: string, h: (req: Req, res: ServerResponse) => void): void }, auth: Auth): void {
  const route = (path: string, needUser: boolean, h: Handler) =>
    app.post(path, async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      try {
        const body = await readBody(req);
        const token = bearer(req);
        const user = token ? auth.db.userByToken(token) : undefined;
        if (needUser && !user) throw new ApiError(401, '请先登录');
        const out = await h(body, { ip: clientIp(req.headers, req.socket.remoteAddress), token, user });
        res.end(JSON.stringify(out ?? { ok: true }));
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 500;
        if (status === 500) console.error(e);
        res.statusCode = status;
        res.end(JSON.stringify({ error: e instanceof ApiError ? e.message : '服务器出错了' }));
      }
    });

  route('/api/sms', false, async (b, c) => {
    await auth.sendCode(b.phone, c.ip);
    return { ok: true, ttl: SMS_RULES.ttl };
  });
  route('/api/login', false, (b) => {
    const r = auth.login(b.phone, b.code);
    return { token: r.token, user: publicUser(r.user), created: r.created };
  });
  route('/api/me', true, (_b, c) => ({ user: publicUser(c.user!), blocks: auth.db.blockList(c.user!.id) }));
  route('/api/profile', true, (b, c) => ({ user: publicUser(auth.db.setProfile(c.user!.id, b.name, b.look)!) }));
  route('/api/logout', false, (b, c) => {
    if (b.all === true && c.user) auth.db.dropTokens(c.user.id);
    else if (c.token) auth.db.dropToken(c.token);
  });
  /** 客户端用来决定登录面板显示什么 */
  route('/api/status', false, () => ({ sms: !!auth.sms }));
}
