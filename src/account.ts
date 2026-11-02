// 账号：登录令牌存在 localStorage，接口走同源的 /colyseus/api/...（和联机同一个代理）。
import { cleanLook, cleanName, DEFAULT_LOOK, TOP_COLOR, type Look } from '../shared/social.ts';

export interface Me {
  id: number;
  name: string;
  look: Look;
  created: number;
  mutedUntil: number;
}

const TOKEN_KEY = 'pixel-neu:token';
const GUEST_KEY = 'pixel-neu:profile';

function store(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* 隐私模式存不了：这次能用，下次要重新登录 */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, body: object = {}): Promise<T> {
  const token = account.token;
  let r: Response;
  try {
    r = await fetch(new URL(`colyseus/api/${path}`, location.href), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '连不上服务器，请检查网络');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? '服务器出错了');
  return j as T;
}

export const account = {
  token: read(TOKEN_KEY),
  me: null as Me | null,
  blocks: new Set<number>(),

  /** 用存着的令牌读账号；令牌失效就清掉 */
  async restore(): Promise<Me | null> {
    if (!this.token) return null;
    try {
      const r = await api<{ user: Me; blocks: number[] }>('me');
      this.me = r.user;
      this.blocks = new Set(r.blocks);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.setToken(null);
      this.me = null;
    }
    return this.me;
  },

  setToken(t: string | null): void {
    this.token = t;
    store(TOKEN_KEY, t);
  },

  status: () => api<{ sms: boolean }>('status'),
  sendCode: (phone: string) => api<{ ttl: number }>('sms', { phone }),

  async login(phone: string, code: string): Promise<{ created: boolean }> {
    const r = await api<{ token: string; user: Me; created: boolean }>('login', { phone, code });
    this.setToken(r.token);
    this.me = r.user;
    await this.restore();
    return { created: r.created };
  },

  async saveProfile(name: string, look: Look): Promise<Me> {
    const r = await api<{ user: Me }>('profile', { name, look });
    this.me = r.user;
    return r.user;
  },

  async logout(): Promise<void> {
    await api('logout').catch(() => undefined);
    this.setToken(null);
    this.me = null;
    this.blocks.clear();
  },

  /** 访客的外观：只存在本机 */
  guestLook(): Look {
    try {
      const raw = JSON.parse(read(GUEST_KEY) ?? 'null');
      if (raw?.look) return cleanLook(raw.look);
    } catch {
      /* 读不到就随机一件上衣 */
    }
    const look = { ...DEFAULT_LOOK, top: Math.floor(Math.random() * TOP_COLOR.length) };
    store(GUEST_KEY, JSON.stringify({ name: '', look }));
    return look;
  },

  /** 第一次登录时，用访客时的外观和旧版存的昵称做默认值 */
  guestName(): string {
    try {
      const n = JSON.parse(read(GUEST_KEY) ?? 'null')?.name;
      return n ? cleanName(n) : '';
    } catch {
      return '';
    }
  },
};
