// 登录面板（手机号 + 短信验证码，新号码自动注册）和资料面板（昵称、形象）。
import { PHONE_RE, cleanName } from '../../shared/social.ts';
import { account, ApiError } from '../account.ts';
import { button, el, Sheet, toast } from './dom.ts';
import { lookEditor } from './look.ts';

export interface LoginDeps {
  /** 登录成功（新号码 created 为 true），调用方负责重连房间 */
  done(created: boolean): Promise<void>;
  /** 打开协议页 */
  legal(which: 'terms' | 'privacy'): void;
}

export function loginSheet(deps: LoginDeps): Sheet {
  const sheet = new Sheet('登录 / 注册');
  const form = el('div', 'login-form');
  form.append(el('p', '', '登录后别人才能看到你，也可以聊天。新号码第一次登录会自动注册。'));

  const phone = el('input', 'field');
  phone.type = 'tel';
  phone.inputMode = 'numeric';
  phone.autocomplete = 'tel-national';
  phone.maxLength = 11;
  phone.placeholder = '手机号';
  phone.setAttribute('aria-label', '手机号');
  const send = button('获取验证码', 'small');
  const l1 = el('div', 'line');
  l1.append(phone, send);

  const code = el('input', 'field');
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.maxLength = 6;
  code.placeholder = '6 位验证码';
  code.setAttribute('aria-label', '验证码');

  const agree = el('label', 'fine');
  const box = el('input');
  box.type = 'checkbox';
  const terms = el('button', 'link', '《用户协议》');
  const privacy = el('button', 'link', '《隐私政策》');
  terms.addEventListener('click', (e) => (e.preventDefault(), deps.legal('terms')));
  privacy.addEventListener('click', (e) => (e.preventDefault(), deps.legal('privacy')));
  agree.append(box, document.createTextNode(' 我已阅读并同意'), terms, document.createTextNode('和'), privacy);

  const err = el('p', 'error');
  const go = button('登录', 'primary', undefined, 'login');
  form.append(l1, code, agree, go, err, el('p', 'fine', '手机号只用来认出你是同一个人，服务器上只存加密后的摘要，不存号码本身。'));
  sheet.body.append(form);

  // 服务端没配短信服务商时直接告诉用户
  void account
    .status()
    .then((s) => {
      if (!s.sms) {
        err.textContent = '短信登录暂未开放，先以访客身份逛逛吧。';
        send.disabled = go.disabled = true;
      }
    })
    .catch(() => undefined);

  let timer = 0;
  const countdown = (s: number) => {
    send.disabled = true;
    clearInterval(timer);
    const tick = () => {
      send.textContent = `${s}s 后重发`;
      if (s-- <= 0) {
        clearInterval(timer);
        send.disabled = false;
        send.textContent = '获取验证码';
      }
    };
    tick();
    timer = window.setInterval(tick, 1000);
  };

  send.addEventListener('click', async () => {
    err.textContent = '';
    if (!PHONE_RE.test(phone.value)) return void (err.textContent = '请输入 11 位手机号');
    send.disabled = true;
    try {
      await account.sendCode(phone.value);
      countdown(60);
      code.focus();
      toast('验证码已发送');
    } catch (e) {
      send.disabled = false;
      err.textContent = (e as Error).message;
    }
  });

  const submit = async () => {
    err.textContent = '';
    if (!PHONE_RE.test(phone.value)) return void (err.textContent = '请输入 11 位手机号');
    if (!/^\d{6}$/.test(code.value)) return void (err.textContent = '请输入 6 位验证码');
    if (!box.checked) return void (err.textContent = '请先阅读并同意用户协议和隐私政策');
    go.disabled = true;
    try {
      const r = await account.login(phone.value, code.value);
      clearInterval(timer);
      sheet.close();
      await deps.done(r.created);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : '登录失败，请稍后再试';
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', submit);
  for (const i of [phone, code]) i.addEventListener('keydown', (e) => (e.stopPropagation(), e.key === 'Enter' && submit()));
  return sheet;
}

/** 资料面板：改昵称和形象，保存后 done 回调 */
export function profileSheet(first: boolean, done: () => void): Sheet {
  const me = account.me!;
  const sheet = new Sheet(first ? '欢迎！先选个昵称和形象' : '我的资料', { tall: true });
  const editor = lookEditor(first ? account.guestName() || '' : me.name, first ? account.guestLook() : me.look);
  const err = el('p', 'error');
  const save = button(first ? '就这样，进校园' : '保存', 'primary');
  save.addEventListener('click', async () => {
    const v = editor.value();
    save.disabled = true;
    err.textContent = '';
    try {
      await account.saveProfile(cleanName(v.name), v.look);
      sheet.close();
      done();
    } catch (e) {
      err.textContent = (e as Error).message;
    } finally {
      save.disabled = false;
    }
  });
  editor.el.addEventListener('keydown', (e) => e.stopPropagation());
  const foot = el('div', 'row');
  foot.style.marginTop = '12px';
  foot.append(save, err);
  sheet.body.append(editor.el, foot);
  return sheet;
}
