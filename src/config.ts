// 运营配置：社群入口、站点地址。群号和二维码还没定，先用占位；拿到真实信息后只改这里。
// 二维码图片放 assets/community/，这里写文件名；留空就显示「即将开放」。

export const COMMUNITY = {
  qq: {
    /** QQ 群号，例如 '123456789' */
    number: '',
    /** 手机 QQ 一键加群的链接（QQ 群设置里「分享群」生成），留空就只显示群号 */
    link: '',
    qr: '',
  },
  wechat: {
    /** 微信群二维码 7 天过期，所以放管理员个人微信或公众号的二维码，由管理员拉人进群 */
    label: '管理员微信',
    id: '',
    qr: '',
  },
} as const;

/** 分享时用的地址：线上域名确定后填写，留空就用当前页面地址 */
export const SITE_URL = '';

export const shareUrl = () => SITE_URL || location.origin + location.pathname;
