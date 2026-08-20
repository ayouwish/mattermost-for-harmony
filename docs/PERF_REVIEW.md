# 性能 Review（2026-08-21）

## 已识别问题（按影响排序）与已实施修复

### ✅ P0-1 消息行子组件未 memo —— 已修复
**问题**：`Markdown`/`Avatar`/`FileAttachments`/`LinkPreview` 都是普通函数组件。ChatScreen 任何 state 变化（**每个输入字符**、typing 指示、滚动相关 state）都触发全部可见行重渲染：每行重新跑 Markdown tokenizer（正则密集）、Avatar 重新走 effect、FileAttachments 重建。平板上 ~20 行可见时，每敲一个字 = 20 次 Markdown 全量重解析。
**修复**：全部包 `React.memo`（`Markdown`/`Avatar`/`FileAttachments`/`LinkPreview`/`InlineImagePreviews`/`InlineImage`），props 不变即跳过整棵子树。

### ✅ P0-2 内联回调破坏 memo —— 已修复
**问题**：行内 `onOpen={(url) => openInBrowser(url)}` 每次渲染都是新函数身份 → memo 全部失效。
**修复**：模块级稳定回调 `openInBrowserUrl`（ChatScreen + ThreadScreen）。

### ✅ P0-3 FlatList 无虚拟化调优 —— 已修复
**问题**：默认 `windowSize=21`（渲染 ~3 屏内容）、无批渲染限制，长列表滚动掉帧、内存高。
**修复**：ChatScreen/ThreadScreen FlatList 加 `initialNumToRender={12} maxToRenderPerBatch={8} windowSize={9} removeClippedSubviews`。

### ✅ P1-4 base64 编码 O(n²) —— 已修复
**问题**：`encodeBase64` 用 `result += ...` 字符串拼接，500KB 图片 ≈ 17 万次拼接，Hermes 下接近 O(n²)。
**修复**：改为数组填充 + 一次 `join('')`。

### P1-5 data URI 图片走 JS 堆（未修，需权衡）
每张图片的 base64 字符串（1.33x 原始大小）驻留 JS 堆 + 每个 Image 组件解析 data URI。
**建议方案**（后续）：ArkTS 侧把缓存写成**二进制文件**，Image 用 `file://` URI —— JS 不再持有 base64，内存和解码都下移到原生。需要 ImageCacheTurboModule 增加二进制写 + buffer 解码，改动中等。

### P1-6 频道切换阻塞（部分缓解）
`loadPosts` 在每次进频道时 network fetch（有缓存首屏，非首次基本秒开）。已由缓存层缓解；如仍慢可加 per-channel 请求去重。

### P2-7 renderItem 身份（已由子组件 memo 缓解）
`renderPost` 每次渲染重建，但行内重活已被 memo 子组件挡住；完整方案是把行提取成 `React.memo` 组件（文件大，风险高，后续做）。

## 验证
- 打字时消息列表应不再逐字卡顿（子树跳过重渲染）
- 滚动长频道应更顺滑（windowSize 收紧 + removeClippedSubviews）
- 图片首次加载更快（base64 编码线性化）