// 短信验证码的发送接口。用环境变量 SMS_PROVIDER 切换，登录逻辑和界面不用改。
import { createHmac, randomUUID } from 'node:crypto';
import { SMS_RULES } from './auth.ts';

export interface SmsSender {
  /** 给 phone 发验证码 code；失败抛错 */
  send(phone: string, code: string): Promise<void>;
}

/** 开发版：不真发，打印出来。日志里会有完整号码，只用于本地开发 */
const logSender: SmsSender = {
  async send(phone, code) {
    console.log(`[短信·开发] ${phone} 的验证码：${code}`);
  },
};

/** 阿里云 RPC 接口要的百分号编码（RFC 3986） */
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** 按阿里云 RPC 签名 v1（HMAC-SHA1）签好的表单参数 */
export function aliyunSign(params: Record<string, string>, secret: string, method = 'POST'): Record<string, string> {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join('&');
  const toSign = `${method}&${pct('/')}&${pct(query)}`;
  return { ...params, Signature: createHmac('sha1', secret + '&').update(toSign).digest('base64') };
}

/**
 * 阿里云号码认证服务（PNVS）的短信认证 SendSmsVerifyCode。
 * 验证码由我们生成、自己校验（TemplateParam 直接传数字），不用阿里云的 CheckSmsVerifyCode。
 * 赠送签名必须配赠送模板；模板变量名按控制台「赠送模板配置」里的写。
 */
function aliyunSender(env: NodeJS.ProcessEnv): SmsSender | undefined {
  const id = env.ALIYUN_ACCESS_KEY_ID, secret = env.ALIYUN_ACCESS_KEY_SECRET;
  const sign = env.ALIYUN_SMS_SIGN_NAME, template = env.ALIYUN_SMS_TEMPLATE_CODE;
  if (!id || !secret || !sign || !template) {
    console.warn('SMS_PROVIDER=aliyun 但 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE 没配全，短信登录不开放');
    return undefined;
  }
  const endpoint = env.ALIYUN_SMS_ENDPOINT ?? 'https://dypnsapi.aliyuncs.com/';
  return {
    async send(phone, code) {
      const body = aliyunSign(
        {
          AccessKeyId: id,
          Action: 'SendSmsVerifyCode',
          Format: 'JSON',
          SignatureMethod: 'HMAC-SHA1',
          SignatureNonce: randomUUID(),
          SignatureVersion: '1.0',
          Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          Version: '2017-05-25',
          PhoneNumber: phone,
          SignName: sign,
          TemplateCode: template,
          TemplateParam: JSON.stringify({ code, min: String(SMS_RULES.ttl / 60_000) }),
        },
        secret,
      );
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => ({}))) as { Code?: string; Message?: string; RequestId?: string };
      if (j.Code !== 'OK') throw new Error(`阿里云短信 ${res.status} ${j.Code}: ${j.Message} (${j.RequestId})`);
    },
  };
}

/**
 * 当前的发送器；返回 undefined 表示短信登录没开放。
 * SMS_PROVIDER：
 * - 不设：开发模式（--dev）用 log，线上不开放
 * - log：强制用开发版（线上临时测试用）
 * - aliyun：阿里云号码认证服务，密钥见 docs/deploy.md
 */
export function smsSender(env = process.env): SmsSender | undefined {
  const p = env.SMS_PROVIDER ?? (process.argv.includes('--dev') ? 'log' : '');
  if (p === 'log') return logSender;
  if (p === 'aliyun') return aliyunSender(env);
  if (p) console.warn(`未知的 SMS_PROVIDER=${p}，短信登录不开放`);
  return undefined;
}
