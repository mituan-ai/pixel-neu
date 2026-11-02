// 短信验证码的发送接口。服务商还没定：现在只有开发版（验证码打印在服务端日志里）。
// 接入服务商时在这里加一个实现，用环境变量 SMS_PROVIDER 切换，登录逻辑和界面不用改。

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

/**
 * 当前的发送器；返回 undefined 表示短信登录没开放（线上还没配服务商）。
 * SMS_PROVIDER：
 * - 不设：开发模式（--dev）用 log，线上不开放
 * - log：强制用开发版（线上临时测试用）
 */
export function smsSender(): SmsSender | undefined {
  const p = process.env.SMS_PROVIDER ?? (process.argv.includes('--dev') ? 'log' : '');
  if (p === 'log') return logSender;
  if (p) console.warn(`未知的 SMS_PROVIDER=${p}，短信登录不开放`);
  return undefined;
}
