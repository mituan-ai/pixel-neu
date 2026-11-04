# 部署：服务端环境变量与上线步骤

线上机器和目录见 README「部署」。这一版起服务端多了账号库、短信登录和天气，需要在 systemd 服务单元里加环境变量（密钥类的值写在服务器上，不进仓库，也不要发到聊天里）。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `MAP_FILE` | 是 | 地图，已有 |
| `PORT`、`HOST` | 是 | 已有（线上 8790、127.0.0.1） |
| `PHONE_SALT` | 是 | 手机号哈希的盐，32 字节以上的随机串，例如 `openssl rand -hex 32`。**定下来就不能改**：改了以后同一个号码会被当成新账号。没配时服务照常运行，但短信登录关闭，所有人都是访客 |
| `DB_FILE` | 是 | SQLite 库的路径，例如 `/srv/pixel-neu/data/pixel-neu.db`。目录要对服务用户 `pixelneu` 可写 |
| `SMS_PROVIDER` | 否 | 短信服务商。不设就不开放登录（界面提示「短信登录暂未开放」）；`aliyun` 是阿里云号码认证服务；`log` 表示把验证码打印到日志（只用于临时测试，日志里有完整号码） |
| `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET` | aliyun 时 | 阿里云 AccessKey。用 RAM 子账号，只授权 `dypns:SendSmsVerifyCode` |
| `ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE` | aliyun 时 | 号码认证控制台的赠送签名和赠送模板（登录/注册模板是 `100001`），两者必须配套 |
| `BADWORDS_FILE` | 否 | 敏感词表，每行一个词，`#` 开头是注释。默认 `data/badwords.txt` |
| `WEATHER` | 否 | 设成 `off` 不取天气（离线开发用） |

Node 要 22.5 以上（`node:sqlite`）。启动时会打印一行 SQLite 实验特性的警告，可以忽略。

## 短信：阿里云号码认证服务

`server/sms.ts` 调号码认证服务的 `SendSmsVerifyCode`（`dypnsapi.aliyuncs.com`，RPC 签名 v1，不依赖 SDK）。验证码由服务端生成、存哈希、自己校验，模板参数直接传 `{"code":"123456","min":"5"}`，不用阿里云的 `CheckSmsVerifyCode`。赠送模板的变量名如果不是 `code`、`min`，要改 `sms.ts`。

服务器要能直连 `https://dypnsapi.aliyuncs.com`（Node 的 `fetch` 不走 `HTTPS_PROXY`）。发送失败时日志里有阿里云的错误码，用户看到「短信发送失败，请稍后再试」。

换服务商：在 `sms.ts` 加一个实现 `SmsSender` 的对象，在 `smsSender()` 里按 `SMS_PROVIDER` 返回它，登录逻辑和界面不用改。

限频规则在 `server/auth.ts` 的 `SMS_RULES`：同一号码 60 秒一次、一天 10 次，同一 IP 10 分钟 5 次、一天 30 次；验证码 5 分钟有效，最多试 5 次。

## 上线步骤

线上已按下面配好（2026-11-03），以后更新只需第 1 步加重启服务。

1. `npm run build`，`dist/` 打包上传到网页目录，`dist-server/` 到 `/srv/pixel-neu/server/`，旧版本改名 `.old` 留着回滚；地图变了再复制 `map.json` 到 `/srv/pixel-neu/assets/`。服务器没有 rsync，用 `tar czf - -C dist . | ssh … 'tar xzf - -C <目录>.new'` 再换目录。
2. 密钥和库：`/etc/pixel-neu.env`（root 600）里放 `PHONE_SALT`、`DB_FILE=/srv/pixel-neu/data/pixel-neu.db`、`SMS_PROVIDER=aliyun` 和四个 `ALIYUN_*`；服务单元用 `EnvironmentFile=` 读它。服务单元有 `ProtectSystem=strict`，所以要加 `ReadWritePaths=/srv/pixel-neu/data`，库目录属主 `pixelneu`、权限 700。
3. 敏感词表在 `/srv/pixel-neu/data/badwords.txt`（打包后的服务端默认读 `../data/badwords.txt`），改完重启服务。
4. 真实 IP：网站在 Cloudflare 后面，nginx 用 `snippets/cloudflare-realip.conf`（`set_real_ip_from` Cloudflare 网段 + `real_ip_header CF-Connecting-IP`）还原客户端 IP，`/colyseus/` 里 `proxy_set_header X-Real-IP $remote_addr;` 覆盖客户端自带的头。只设 `X-Real-IP` 不还原的话，同一个 Cloudflare 节点后面的人会共用短信限额。Cloudflare 网段变了要更新这个文件（https://www.cloudflare.com/ips/）。
5. 网页目录开 gzip，类型至少包括 `application/json`、`application/javascript`、`text/css`：map.json 原样 1.6 MB，压缩后约 190 KB，首屏总传输约 2 MB。
6. 备份：`/etc/cron.d/pixel-neu-backup` 每天 4:17 用 `sqlite3 .backup` 存到 `/srv/pixel-neu/backup/`，保留 30 天。
7. 验证：`curl -X POST http://127.0.0.1:8790/api/status` 返回 `{"sms":true}`（接口只收 POST）。

## 管理

在服务器上：`DB_FILE=/srv/pixel-neu/data/pixel-neu.db node tools/admin.ts reports`。打包后的服务端不含 `tools/`，可以把 `tools/admin.ts`、`server/db.ts`、`shared/social.ts` 一起拷过去跑，或者把库拷回本机处理再放回去（要先停服务）。

## 本地开发

`npm run server` 带 `--dev`：没配盐时用固定的开发盐，验证码打印在服务端日志里，库在 `data/pixel-neu.db`（不进仓库）。开发机要走代理才能访问外网时，Node 的 `fetch` 不读 `HTTPS_PROXY`，天气会取不到，界面按「晴」显示；可以设 `WEATHER=off` 免得日志里一直报错。
