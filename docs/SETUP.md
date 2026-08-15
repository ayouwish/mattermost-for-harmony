# Mattermost HarmonyOS — 环境搭建指南

面向**首次 clone 本仓库**的新用户。按本指南可在全新环境下完成编译、签名、部署。

> 项目结构说明见 [README](../README.md)；华为推送配置见 [PUSH_KIT_SETUP.md](../PUSH_KIT_SETUP.md)。

---

## 1. 环境要求

| 组件 | 版本要求 |
|------|----------|
| Node.js | 20+ |
| DevEco Studio | 6.1.0+（含 HarmonyOS SDK、ohpm、hvigor） |
| HarmonyOS SDK | API 23 (6.1.0) |
| 华为开发者账号 | 用于自动签名 |
| 鸿蒙设备 / 模拟器 | 真机（开启开发者模式 + USB 调试）或模拟器 |

## 2. 获取代码

```bash
git clone <仓库地址>
cd <项目目录>
```

## 3. 安装依赖

```bash
# JS 依赖
npm install

# 鸿蒙原生依赖（@rnoh/react-native-openharmony 等）
# 在 DevEco Studio 中打开项目会自动安装；命令行方式：
ohpm install
```

## 4. 配置签名（必须）

> 仓库**不包含**签名配置（`build-profile.json5` 含本机路径和密钥密码，已由 `.gitignore` 排除，也不会提交）。每个环境需自行生成。

1. 用 DevEco Studio 打开**项目根目录**
2. `File → Project Structure → Signing Configs`
3. 勾选 `Automatically generate signature`
4. 登录华为开发者账号 → `Apply`
5. 签名配置会自动写入根目录 `build-profile.json5`（仅本机，不影响仓库）

## 5. 生成 JS Bundle（必须）

> `bundle.harmony.js` 是构建产物，已被 `.gitignore` 排除。**每次改动 JS 源码后、构建 HAP 前**都要重新生成：

```bash
npm run bundle:harmony          # 生产模式（部署用）
npm run bundle:harmony:dev      # 调试模式（开发用）
```

## 6. 构建与部署

### 方式一：DevEco Studio（推荐）

1. 打开项目 → `File → Sync and Refresh Project` 等待同步完成
2. `Build → Build Hap(s)/App(s) → Debug`
3. 连接设备 → `Run ▶`

### 方式二：命令行

```bash
# 类型检查
npm run tsc

# 构建 HAP（hvigor 位于 DevEco Studio tools 目录，需加入 PATH 或全路径调用）
hvigorw assembleApp -p buildMode=debug
```

构建产物：`entry/build/default/outputs/default/entry-default-signed.hap`

## 7. 连接 Mattermost 服务器

启动 app → 输入你的 Mattermost 服务器地址 → 登录。功能即可使用（频道、消息、线程、搜索、实时推送等）。

## 8. 可选：华为 Push Kit 推送

如需息屏/后台推送通知，需完成 AGC（AppGallery Connect）侧配置，详见 [PUSH_KIT_SETUP.md](../PUSH_KIT_SETUP.md)。核心步骤：

1. 在 [AppGallery Connect](https://appgalleryconnect.huawei.com) 创建应用（包名须与 `AppScope/app.json5` 的 `bundleName` 一致）
2. 开通推送服务，重新生成签名并配置 Profile / 公钥指纹
3. 如需 Client ID：填入 `entry/src/main/module.json5` 的 `metadata.client_id`
   > HarmonyOS API 12+ 通常**不需要** Client ID；占位符 `YOUR_AGC_CLIENT_ID` 可直接用于本地构建。

## 9. 常见问题

| 现象 | 原因 / 解决 |
|------|------------|
| 启动白屏 | 未生成 bundle。执行 `npm run bundle:harmony` 后重新构建 |
| `Cannot find module @rnoh/react-native-openharmony` | `ohpm install` 未执行或失败，检查 `oh_modules/` 是否存在 |
| 编译/签名报错 | 未配置签名，按第 4 步重新自动签名 |
| 无法联网 | 确认 `entry/src/main/module.json5` 已声明 `ohos.permission.INTERNET`（仓库已默认包含） |
| 推送 token 报 `Illegal application identity` | AGC 应用/签名/Client ID 未正确配置，见第 8 步 |
| 需要更换包名 | 修改 `AppScope/app.json5` 的 `bundleName`，并同步 AGC 应用包名 |

## 10. 目录速览

```
├── src/                    # RN JS/TS 源码（页面、API、组件、主题）
├── entry/                  # 鸿蒙原生工程（ArkTS 入口、C++ 原生层、资源）
├── AppScope/               # 应用级配置（bundleName、图标）
├── docs/                   # 文档
├── index.js                # RN 入口
└── package.json
```

## 11. 开发日常

```bash
# 改完 JS 后
npm run tsc                 # 类型检查
npm run bundle:harmony      # 重新生成 bundle
# DevEco Studio 中重新 Run，或命令行 hvigorw assembleApp
```
