# Push Kit 接入 — 你需要完成的配置清单

> 本文件记录**必须由你在 AGC 平台/开发者账号侧完成**的操作。
> 客户端代码已由开发侧完成（`@kit.PushKit` 集成在 EntryAbility + PushTurboModule 中）。
> 完成以下步骤前，`pushService.getToken()` 会返回 `Illegal application identity` 错误。

---

## ⚠️ 前置确认（3 分钟）

- [ ] 有华为开发者账号（无则先注册：https://developer.huawei.com → AppGallery Connect）
- [ ] 项目使用 DevEco Studio 6.1+ / HarmonyOS SDK API 23（当前 `targetSdkVersion 6.1.0(23)`，✅ 满足）

---

## 1. AGC 创建应用（10 分钟）

- [ ] 登录 AppGallery Connect（https://appgalleryconnect.huawei.com）
- [ ] 我的项目 → 新建项目（或选已有项目）
- [ ] 在项目下**添加应用**：
  - 平台：**HarmonyOS**
  - 应用包名：**`com.example.mattermostharmony`**（必须与工程一致）
  - 应用名称：Mattermost HarmonyOS

---

## 2. 开通推送服务（5 分钟）

- [ ] 在应用页面左侧导航选择 **增长 > 推送服务**
- [ ] 点击「立即开通」→ 确认
- [ ] （可选）设置**数据处理位置**：必须与应用服务器所在地一致，否则推送无法下发
- [ ] **项目设置 > API 管理**：确认「推送服务」开放能力已开启

---

## 3. 重新生成签名并配置 Profile（关键，15 分钟）

> ⚠️ 官方文档明确：**在申请 Profile 之前必须已开通推送服务**，否则需重新申请调试 Profile。
> 当前工程使用的是自动签名（`debugKey`），很可能需要在开通推送后**重新生成签名**。

- [ ] 用 DevEco Studio 重新生成签名：
  - File → Project Structure → Signing Configs → **勾选 Automatically generate signature**（或重新手动生成）
  - 确保签名使用新的 Profile（开通推送后生成的）
- [ ] **公钥指纹**：在 AGC 应用的「常规」页，添加签名证书的公钥指纹（HarmonyOS 5 Beta2 起可跳过，但建议加上保险）
- [ ] 若用手动签名：将新的 `.cer` / `.p7b` / `.p12` 路径填入工程 `build-profile.json5` 的 `signingConfigs.material`

---

## 4. 获取 Client ID（按需）

> HarmonyOS 5 Developer Beta2 起（API 12+ 新版 SDK）**无需配置 Client ID**。若你的 SDK 需要，则执行：

- [ ] AGC 应用页面 → 应用信息 → 复制 **Client ID**
- [ ] Client ID 填入工程 `entry/src/main/module.json5` 的 `metadata`

---

## 5. 通知权限（App 侧已处理）

- [ ] 首次启动 App 时允许「发送通知」弹窗（`requestEnableNotification` 已实现）
- [ ] 若之前拒绝过：系统设置 → 应用 → Mattermost → 通知 → 开启

---

## 6. 服务端对接（超出客户端范围，但需要知晓）

- [ ] Mattermost 服务器需支持华为推送渠道。标准 Mattermost 推送走 FCM/APNs，华为通道需：
  - 方式 A：Mattermost push proxy 增加华为 Push Kit 通道适配
  - 方式 B：自建桥接服务，将 Mattermost 通知转发到华为 Push Kit
- [ ] 客户端获取到 Push Token 后会通过 `PushTurboModule.getToken()` 暴露给 JS，JS 侧可上报到服务端（当前为预览，正式对接需服务端配合）

---

## 验证清单（全部完成后）

- [ ] `hilog` 能看到 `pushService.getToken` 成功日志（不再报 `Illegal application identity`）
- [ ] 杀掉 App 进程，从另一个端向频道发消息，**息屏/后台**也能收到通知
- [ ] 通知点击后能拉起 App

---

## 常见错误速查

| 错误 | 原因 |
|------|------|
| `1000900010 Illegal application identity` | AGC 应用/签名/公钥指纹/Client ID 未正确配置 |
| 推送收不到 | 数据处理位置与服务端不一致；通知权限未开；token 未上报服务端 |
| `Push token is not valid` | token 失效，重新启动 App 获取 |

---

**当你完成以上步骤后**，把新的签名配置同步到工程（或告诉我），我会重新构建部署验证推送链路。
