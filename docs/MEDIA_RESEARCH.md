# 多媒体展示调研报告（视频 / 网页 / 链接预览）

> 状态：调研完成，未实施
> 日期：2026-08-18
> 环境：HarmonyOS + RNOH `@rnoh/react-native-openharmony` 0.84.2，RN 0.84.1，`@react-native-oh/react-native-harmony` 0.84.2

## 1. 背景与现状

- 图片附件展示**已修复**：RNOH 的 `<Image>` 下载管线不发送 `source.headers`（原生层忽略），且 Mattermost 拒绝 session token 查询参数鉴权。现状为**带鉴权的 fetch 下载字节 → base64 data URI → `<Image>` 渲染**，工具在 `src/utils/imageDataUri.ts`，图片渲染在 `src/components/FileAttachments.tsx`。
- 除此之外的多媒体**尚未渲染**：
  - `PostMetadata.embeds`（opengraph / permalink / message_attachment）——目前只存在于类型定义 `src/api/types.ts:98`，无渲染。
  - 视频（mp4 / avi / mov / webm）和音频（mp3 / wav / m4a）附件——仅作为普通文件卡片展示。
  - 消息正文中的裸图片/网页链接——只显示为文本。
  - 网页打开——无 WebView / 系统浏览器跳转。

## 2. 各路实现方案的调研结论

### 2.1 网页链接预览（opengraph / permalink embeds）

- **数据来源**：`post.metadata.embeds[]`，Mattermost 服务端在发帖时抓取并附加。典型结构：
  ```json
  {
    "type": "opengraph",
    "url": "https://example.com/article",
    "data": {
      "type": "website",
      "title": "…",
      "description": "…",
      "site_name": "…",
      "url": "…",
      "image_url": "https://…/thumb.jpg"
    }
  }
  ```
  `permalink` 类型用于频道/帖子内部链接（强提示：优先渲染，用 server 路由拼接内部跳转）；`message_attachment` 携带 SlashCommand/自定义 attachment。
- **实现方式**：纯 JS 卡片组件（标题 / 描述 / 站点名 / 缩略图 / 跳转链接），**零原生依赖**。
- **缩略图鉴权**：`image_url` 通常是公网可访问的 OG 图，RNOH `<Image source={{uri}}>` 直接加载即可；遇到需要鉴权的域名时可复用 `fetchImageAsDataUri` 兜底。
- 风险：低。改动仅 bundle 层。

### 2.2 消息正文内联图片链接

- 桌面端/官方客户端行为：正则匹配正文里以图片扩展名结尾的裸 URL，内联渲染图片。
- 实现：`/(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp)(?:\?\S*)?)/i` 提取 → 复用 `fetchImageAsDataUri` → 行内 `<Image>`。
- 风险：低（纯 JS）。注意与 opengraph embed 去重（Mattermost 对同时有 embed 的链接不再内联渲染，避免重复）。

### 2.3 视频附件（mp4 等）

两条路线：

| 路线 | 说明 | 依赖 | 风险 |
|---|---|---|---|
| **A. 视频卡片 + 系统播放器** | 渲染缩略图（AV 缩略图缺失时用文件图标）+ 播放按钮 + 文件名；点击后调系统应用播放 | 无（`openLink`） | 低 |
| **B. 内嵌播放器** | FlatList 内直接播放 | `@react-native-ohos/react-native-video` | 中 |

- 原生包调研结果：
  - 原 GitHub 仓库 `react-native-oh-library/react-native-video` 已于 2025-12 归档。
  - 官方迁移到 **GitCode `openharmony-sig/rntpc_react-native-video`**，npm 包名 **`@react-native-ohos/react-native-video`**，当前 **latest = 6.15.0**（`peerDependencies: react:* / react-native:*`，内嵌 Harmony 原生实现，基于 ArkUI Video + AVPlayer）。
  - 本项目具备接入条件：已配置 `@react-native-oh/react-native-harmony-cli`（autolinking）与 `entry/src/main/cpp/CMakeLists.txt` + `RNPackagesFactory.ets`。
- **难点**：视频需要鉴权（`Authorization` header / 临时 URL）。需要确认该包是否支持 requests HTTP 头；否则视频流也走 data URI 不现实（文件大），需服务端支持或改用临时下载文件后本地播放。
- 同类问题参考：RNOH 图片管线不能带 header（本次 bug 根因），`react-native-video` 的 OH 实现若同样走 `@ohos.request`/AVPlayer 原生下载管线，大概率同样**无法携带自定义 header**——**这是接入前必须验证的点**（建议先在示例工程/poc 里确认 `source.headers` 是否生效）。

### 2.4 音频附件

- 与视频同理。纯 JS 方案：渲染音频卡片（图标 + 时长 + 文件名），点击 openLink 系统播放器；或与视频共用原生播放器包。

### 2.5 网页内嵌浏览 / 系统浏览器

| 路线 | 说明 | 依赖 | 风险 |
|---|---|---|---|
| **A. openLink 系统浏览器** | `import { openLink } from '@kit.BasicServicesKit'`（即 `@ohos.ability.openLink`），点击跳转系统浏览器/对应应用 | 无 | 低 |
| **B. 内嵌 WebView** | `@react-native-ohos/react-native-webview`，npm **latest = 13.10.6**（`peerDependencies: react:* / react-native:*`） | 原生组件 | 中 |

- 聊天场景推荐 A：零依赖、交互简单（点击预览卡/链接 → 系统浏览器）。
- WebView 适合"登录态网页/沙箱内嵌"等强集成场景，本项目暂不需要。

### 2.6 非媒体文件下载

- 现有文件卡片（图标 + 名称 + 大小）已在。增强：加载 progress + 下载目录（`@ohos.request.downloadFile` 或 `@kit.BasicServicesKit`），原生 TurboModule 一个，风险中。
- 文件内容同样存在鉴权问题：`downloadFile` 原生下载管线是否支持 header 需验证（可能同样不支持），届时可退化为「fetch 字节 → 写 `@ohos.file.fs` 缓存目录 → 系统打开」。

## 3. 推荐实施计划（分阶段）

### Phase 1 —— 纯 JS，零原生依赖（风险最低，建议先做）
1. `LinkPreviewCard` 组件：渲染 `metadata.embeds`（opengraph / permalink），点击 openLink。
2. 正文内联图片链接检测与渲染（复用 `imageDataUri`）。
3. 视频/音频附件卡片：图标 + 元信息 + 播放按钮，点击 openLink。
4. 在 `ChatScreen`/`ThreadScreen` 的 post 渲染层接入。
- 验证：`npm run bundle:harmony:dev` + `build_project` + 真机（无 CMake/原生改动）。

### Phase 2 —— 原生增强（视需求再评估）
1. **接入前先做 PoC**：npm 安装 `@react-native-ohos/react-native-video` + `@react-native-ohos/react-native-webview`，autolink，验证两点：
   - 组件能否在 RNOH 0.84 正确编译运行；
   - 视频/WebView 请求是否携带 `Authorization`（极可能不支持 → 需要下载到本地再播放/打开）。
2. 若 header 不可用：实现「fetch 字节 → 临时文件 → 本地文件 URI 播放」链路，或用服务端特性（临时公开链接）规避。
3. WebView 登录态内嵌（可在 `JSBridge`/Cookie 层面做注入）。

## 4. 相关代码位置

| 位置 | 说明 |
|---|---|
| `src/utils/imageDataUri.ts` | 已可复用的鉴权 fetch → data URI 工具 |
| `src/components/FileAttachments.tsx` | 附件渲染（单图/网格/文件卡片），多媒体入口 |
| `src/screens/ChatScreen.tsx` / `ThreadScreen.tsx` | `renderPost`/`renderReply` 插入点 |
| `src/api/types.ts:98` | `embeds?: any[]` 待细化类型 |
| `src/api/client.ts` | `getFileImageDataUri` / `getImageRequestHeaders` / `getFileUrl` |
| `oh-package.json5` / `package.json` | 原生/JS 依赖声明位 |
| `entry/src/main/ets/RNPackagesFactory.ets` | 原生组件/TurboModule 注册位 |