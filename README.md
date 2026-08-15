# Mattermost HarmonyOS

基于 React Native OpenHarmony (RNOH) 的鸿蒙版 [Mattermost](https://mattermost.com) 客户端。

支持宽屏（平板/桌面三栏）与窄屏（手机抽屉式）两种自适应布局。

## 功能特性

- **认证**：邮箱/用户名 + 密码登录，会话持久化（重启自动登录）
- **频道**：频道列表（未读/提及分组）、搜索、创建频道、DM/GM、频道通知偏好
- **消息**：发送/编辑/删除、Markdown 渲染、代码语法高亮、Emoji 反应、@提及、消息固定、消息草稿
- **线程**：线程详情页、Threads 收件箱、关注/取消关注
- **搜索**：全文搜索（支持 `from:`/`in:`/`after:` 语法）
- **实时通信**：WebSocket 消息推送、编辑/删除同步、正在输入指示器、断线自动重连
- **缓存**：内存缓存 + 本地持久化（`mmcache:`），离线启动秒开
- **推送**：华为 Push Kit 集成（需按 `PUSH_KIT_SETUP.md` 完成 AGC 侧配置）

## 技术栈

| 组件 | 版本 |
|------|------|
| React Native | 0.84.1 |
| React | 19.2.3 |
| RNOH (@react-native-oh/react-native-harmony) | 0.84.2 |
| react-native-harmony-cli | 0.84.2 |
| DevEco Studio | 6.1.0+ |
| HarmonyOS SDK | API 23 (6.1.0) |

## 项目结构

```
├── src/                    # RN JS/TS 源码
│   ├── api/                # Mattermost API v4 + WebSocket + 缓存
│   ├── components/         # 通用 UI 组件（Markdown / Avatar / TopBar 等）
│   ├── screens/            # 页面（登录 / 频道列表 / 聊天 / 线程 / 搜索等）
│   ├── specs/              # TurboModule codegen spec
│   └── theme/              # 主题（默认 Denim 浅色）
├── entry/                  # 鸿蒙原生工程（Stage 模型）
│   └── src/main/           # ArkTS 入口、C++ 原生层、资源
├── AppScope/               # 应用级配置
├── index.js                # RN 入口
├── docs/                   # 文档
└── package.json
```

## 环境要求

- Node.js 20+
- DevEco Studio 6.1.0+（含 HarmonyOS SDK、ohpm、hvigor）
- 鸿蒙手机/平板（真机或模拟器）

## 构建与运行

```bash
# 1. 安装 JS 依赖
npm install

# 2. 生成 JS bundle（必须，输出到 entry/src/main/resources/rawfile/）
npm run bundle:harmony

# 3. 用 DevEco Studio 打开工程根目录
#    File → Sync and Build → Build Hap(s)/App(s) → Debug
#    连接设备后 Run ▶ 部署
```

命令行构建：

```bash
# 类型检查
npm run tsc

# 生成 bundle（调试模式）
npm run bundle:harmony:dev

# 构建 HAP（在 DevEco Studio 的 hvigor 环境下）
hvigorw assembleApp -p buildMode=debug
```

## 配置

### 签名

签名配置位于根目录 `build-profile.json5`，由 DevEco Studio 自动签名生成（已被 `.gitignore` 排除，不随仓库分发）。新环境请在 DevEco Studio 中重新配置签名：

`File → Project Structure → Signing Configs → Automatically generate signature`

### 华为 Push Kit（可选）

如需推送通知，按 `PUSH_KIT_SETUP.md` 完成 AGC 侧配置，并将 AppGallery Connect 应用的 Client ID 填入 `entry/src/main/module.json5` 的 `metadata.client_id`（HarmonyOS API 12+ 通常不需要）。

### 应用标识

默认 bundleName 为 `com.example.mattermostharmony`（`AppScope/app.json5`），发布前请替换为自己的包名。

## 相关文档

- `docs/SETUP.md` — 新环境搭建指南（clone 后从零编译部署）
- `PROGRESS.md` — 功能构建进展与已知问题
- `PUSH_KIT_SETUP.md` — 华为推送服务接入清单
- 服务端推送对接见独立仓库 [mattermost-push-proxy-huawei](https://github.com/你的用户名/mattermost-push-proxy-huawei)（mattermost-push-proxy 的华为 Push Kit provider）
