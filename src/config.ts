// 运营配置：社群入口、站点地址。二维码图片放 assets/community/，这里写文件名。

export const COMMUNITY = {
  qq: {
    number: '1049028914',
    /** 手机 QQ 一键加群的链接（QQ 群设置里「分享群」生成，也是二维码里的地址） */
    link: 'https://qm.qq.com/q/9PCFStZCsU',
    qr: 'qq.png',
  },
} as const;

/** 分享时用的地址：线上域名确定后填写，留空就用当前页面地址 */
export const SITE_URL = '';

export const shareUrl = () => SITE_URL || location.origin + location.pathname;
