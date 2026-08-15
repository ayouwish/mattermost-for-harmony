# Mattermost 客户端核心功能 — 完整技术文档

> **目标**：从零构建一个功能完整的 Mattermost 客户端（Web/Desktop/Mobile），覆盖所有核心功能模块。
> **基于**：Mattermost API v4 + WebSocket（Server v11.x）

---

## 一、总体架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     Mattermost 客户端                        │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  UI 层   │  状态管理  │  数据层   │  实时通信  │   平台集成层     │
│ React/   │ Redux /  │ REST API │ WebSocket│ 通知/文件/剪切板  │
│ RN组件   │ WatermelonDB│ Client4 │  Events  │  桌面/移动原生   │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│              Mattermost Server (Go) :8065                    │
│         REST API /api/v4  +  WebSocket /api/v4/websocket     │
└─────────────────────────────────────────────────────────────┘
```

### 技术选型参考（Mattermost 官方方案）

| 层级 | Web/Desktop | 移动端 (RN) |
|------|-------------|-------------|
| UI框架 | React + TypeScript | React Native + TypeScript |
| 状态管理 | Redux (mattermost-redux) | WatermelonDB + RxJS |
| 网络层 | fetch + WebSocket API | fetch + WebSocket |
| 桌面壳 | Electron | — |
| 国际化 | i18n (react-intl) | 同左 |

---

## 二、核心功能模块拆解

### 模块 1：认证与会话管理

**功能清单：**
- 用户登录（邮箱/用户名/AD-LDAP ID + 密码）
- 多因素认证（MFA/OTP）
- 个人访问令牌（Personal Access Token）登录
- OAuth 2.0 / SAML / LDAP 单点登录
- Session Token 管理（存储、自动刷新、过期处理）
- 登出 / 会话撤销
- 注册 / 邮箱验证 / 密码重置

**涉及 API：**
```
POST   /api/v4/users/login              → 登录，返回 Token header
POST   /api/v4/users/logout             → 登出
GET    /api/v4/users/me                 → 获取当前用户信息
POST   /api/v4/users/mfa/verify         → MFA验证
GET    /api/v4/users/sessions            → 获取会话列表
DELETE /api/v4/users/sessions/{session_id} → 撤销会话
POST   /api/v4/users/password/reset     → 密码重置
```

**认证方式：**
- `Authorization: Bearer <token>` 请求头
- `MMAUTHTOKEN=<token>` Cookie

**关键设计点：**
- Token 安全存储（Web: httpOnly Cookie / Desktop: Keychain / Mobile: SecureStorage）
- WebSocket 连接需要独立认证（`authentication_challenge` 动作）
- 401 响应时自动刷新或跳转登录页

---

### 模块 2：团队与频道管理

**功能清单：**
- 团队列表 / 切换 / 加入 / 离开
- 频道侧边栏渲染（公开/私有/直接消息/分组消息）
- 创建 / 编辑 / 删除频道
- 加入 / 离开频道
- 频道成员管理（添加/移除/角色）
- 频道通知偏好设置
- 频道置顶 / 收藏
- 频道头部信息（Header / Purpose / 成员数）
- 分类与频道排序（拖拽）

**涉及 API：**
```
# 团队
GET    /api/v4/users/me/teams                      → 我的团队列表
GET    /api/v4/teams/{team_id}/channels            → 团队频道列表
POST   /api/v4/teams                               → 创建团队

# 频道
POST   /api/v4/channels                            → 创建频道
GET    /api/v4/channels/{channel_id}               → 频道详情
PUT    /api/v4/channels/{channel_id}               → 更新频道
DELETE /api/v4/channels/{channel_id}               → 删除/归档
POST   /api/v4/channels/{channel_id}/members        → 添加成员
DELETE /api/v4/channels/{channel_id}/members/{user_id} → 移除成员
PUT    /api/v4/channels/{channel_id}/members/{user_id}/schemeRoles → 设置角色

# 频道通知
PUT    /api/v4/users/me/preferences                → 更新通知偏好

# 频道分类（Sidebar Categories）
GET    /api/v4/users/me/teams/{team_id}/channels/categories
PUT    /api/v4/users/me/teams/{team_id}/channels/categories/{category_id}
```

**频道类型：**
| 类型 | 标识 | 说明 |
|------|------|------|
| 公开频道 | `O` (Open) | 任何人可加入 |
| 私有频道 | `P` (Private) | 需邀请加入 |
| 直接消息 | `D` (Direct) | 1对1 |
| 分组消息 | `G` (Group) | 多人DM |

---

### 模块 3：消息发送与展示

**功能清单：**
- 富文本编辑器（Markdown 支持：粗体、斜体、代码块、链接、列表、引用、标题）
- 消息发送（含草稿保存、Ctrl+Enter / Enter 发送偏好）
- 消息编辑 / 删除（含编辑历史）
- 消息回复（线程 Thread）
- @提及（用户 / 频道 / @here / @all / 自定义分组）
- 消息固定（Pin）
- 消息标记（已读/未读管理）
- 消息格式化渲染（Markdown → HTML、时间戳、@mention链接）
- 代码语法高亮
- 表情符号选择与自定义 Emoji
- 消息反应（Emoji Reactions）
- 消息引用 / 转发
- 消息附件（交互式按钮、下拉菜单 — Interactive Action Buttons）
- 系统消息渲染（加入频道、显示名称变更等）
- 虚拟列表渲染（性能优化，万级消息流畅滚动）

**涉及 API：**
```
# 消息 CRUD
POST   /api/v4/posts                                → 发送消息
GET    /api/v4/channels/{channel_id}/posts          → 获取频道消息
PUT    /api/v4/posts/{post_id}                      → 编辑消息
DELETE /api/v4/posts/{post_id}                      → 删除消息

# 线程
GET    /api/v4/posts/{post_id}/thread              → 获取线程
POST   /api/v4/users/me/posts/{post_id}/set_unread → 标记线程未读
PUT    /api/v4/users/me/threads/{thread_id}/read    → 标记线程已读

# 反应
POST   /api/v4/users/me/posts/{post_id}/reactions/{emoji_name} → 添加反应
DELETE /api/v4/users/me/posts/{post_id}/reactions/{emoji_name} → 移除反应

# 固定
POST   /api/v4/posts/{post_id}/pin                 → 固定消息
DELETE /api/v4/posts/{post_id}/pin                 → 取消固定

# 文件附件（见模块5）
# 交互动作
POST   /api/v4/posts/{post_id}/actions/{action_id} → 触发交互按钮
```

**消息数据结构（核心字段）：**
```json
{
  "id": "post_id",
  "create_at": 1700000000000,
  "update_at": 1700000000000,
  "edit_at": 0,
  "delete_at": 0,
  "message": "消息正文（Markdown）",
  "channel_id": "频道ID",
  "user_id": "发送者ID",
  "root_id": "线程根消息ID（空则非线程）",
  "parent_id": "直接父消息ID",
  "file_ids": ["file_id_1"],
  "props": {
    "attachments": [...],
    "override_username": "bot名称"
  },
  "metadata": {
    "reactions": [{"user_id":"...","emoji_name":"thumbsup"}],
    "files": [...],
    "embeds": [...]
  }
}
```

---

### 模块 4：线程（Threaded Discussions）

**功能清单：**
- 线程侧边栏面板（Thread Viewer）
- 线程收件箱（Threads Inbox — 统一查看所有关注的线程）
- 自动关注（参与/被提及的线程自动关注）
- 手动关注 / 取消关注线程
- 线程未读计数
- 线程内回复 / 跳转到频道

**涉及 API：**
```
GET    /api/v4/users/me/threads                     → 线程列表（收件箱）
GET    /api/v4/users/me/threads/unread
PUT    /api/v4/users/me/threads/{thread_id}/read     → 标记已读
PUT    /api/v4/users/me/threads/{thread_id}/set_unread
PUT    /api/v4/users/me/threads/{thread_id}/following → 关注/取消
```

**WebSocket 事件：**
```
thread_updated          → 线程有新回复
thread_follow_changed   → 关注状态变更
thread_read_changed     → 已读状态变更
```

---

### 模块 5：文件上传与附件

**功能清单：**
- 文件上传（拖拽 / 粘贴 / 选择）
- 图片预览（内联缩略图 + 全屏查看器）
- 视频内联播放（MP4/WebM）
- 音频内联播放（MP3/M4A — 注意：OGG在iOS端支持差）
- 文件下载
- 文件类型限制与大小校验
- 图片裁剪（上传前编辑）
- 代码片段附件展示
- 多文件批量上传

**涉及 API：**
```
POST   /api/v4/files                                 → 上传文件（multipart/form-data）
GET    /api/v4/files/{file_id}                       → 下载文件
GET    /api/v4/files/{file_id}/thumbnail             → 缩略图
GET    /api/v4/files/{file_id}/preview               → 预览图
GET    /api/v4/files/{file_id}/link                  → 获取临时公开链接
POST   /api/v4/posts                                → 发送时携带 file_ids

# 分步上传（大文件）
POST   /api/v4/uploads                               → 创建上传会话
       → 分片上传数据
       → POST /api/v4/posts 完成上传
```

**支持格式参考：**
| 类型 | 格式 |
|------|------|
| 图片 | JPEG, PNG, GIF, BMP, WebP, SVG |
| 视频 | MP4, WebM, MOV |
| 音频 | MP3, M4A, WAV, OGG (桌面) |
| 文档 | PDF, Word, Excel, PPT, TXT, 代码文件 |

---

### 模块 6：实时通信（WebSocket）

**这是客户端的心脏 — 所有实时更新都依赖 WebSocket。**

**功能清单：**
- WebSocket 连接建立与认证
- 心跳保活（keepalive / reconnect）
- 断线自动重连（指数退避）
- 多标签页/多设备同步
- 网络状态指示器（在线/正在连接/离线）

**连接流程：**
```
1. 连接 wss://server/api/v4/websocket
2. 发送认证挑战：
   {"seq": 1, "action": "authentication_challenge", "data": {"token": "..."}}
3. 收到 {"status": "OK", "seq_reply": 1}
4. 收到 {"event": "hello", "data": {"server_version": "..."}}
5. 持续监听事件...
```

**必须处理的 WebSocket 事件（40+种）：**

| 分类 | 事件 | 用途 |
|------|------|------|
| **消息** | `posted` | 新消息到达 |
| | `post_edited` | 消息被编辑 |
| | `post_deleted` | 消息被删除 |
| | `ephemeral_message` | 临时消息（仅当前用户可见） |
| **频道** | `channel_created` | 新频道创建 |
| | `channel_updated` | 频道信息更新 |
| | `channel_deleted` | 频道被删除 |
| | `channel_viewed` | 频道被查看（标记已读） |
| | `channel_member_updated` | 频道成员变更 |
| | `channel_converted` | 频道类型转换 |
| **线程** | `thread_updated` | 线程更新 |
| | `thread_read_changed` | 线程已读 |
| | `thread_follow_changed` | 关注状态变更 |
| **用户** | `status_change` | 用户在线状态变更 |
| | `user_updated` | 用户资料更新 |
| | `user_added` / `user_removed` | 团队成员变更 |
| | `typing` | 用户正在输入 |
| | `direct_added` | 被添加到DM |
| **反应** | `reaction_added` | 添加反应 |
| | `reaction_removed` | 移除反应 |
| **团队** | `added_to_team` | 被加入团队 |
| | `leave_team` | 离开团队 |
| | `update_team` / `delete_team` | 团队信息变更 |
| **偏好** | `preference_changed` | 单项偏好变更 |
| | `preferences_changed` | 批量偏好变更 |
| | `preferences_deleted` | 偏好删除 |
| **系统** | `hello` | 连接成功 |
| | `config_changed` | 服务器配置变更 |
| | `license_changed` | 许可证变更 |
| | `plugin_enabled` / `plugin_disabled` | 插件状态变更 |
| | `role_updated` | 角色权限变更 |
| | `emoji_added` | 新增自定义表情 |

**WebSocket API 动作（客户端→服务端）：**
```json
// 用户正在输入
{"action": "user_typing", "seq": 2, "data": {"channel_id": "...", "parent_id": ""}}

// 获取用户状态
{"action": "get_statuses", "seq": 3}
{"action": "get_statuses_by_ids", "seq": 4, "data": {"known_users": ["user_id1", "user_id2"]}}
```

---

### 模块 7：搜索

**功能清单：**
- 消息全文搜索（关键词、短语、排除词）
- 文件搜索（按文件名、类型）
- 搜索范围控制（当前团队 / 所有团队 / 指定频道）
- 搜索语法（from:、in:、on:、before:、after:、— 排除）
- 搜索结果高亮与上下文展示
- 搜索历史

**涉及 API：**
```
GET    /api/v4/teams/{team_id}/posts/search          → 搜索消息
GET    /api/v4/teams/{team_id}/files/search          → 搜索文件
```

**搜索语法示例：**
```
"deploy plan"              → 精确短语
from:@username             → 指定用户
in:channel-name            → 指定频道
on:2024-01-15              → 指定日期
before:2024-06-01          → 某日期之前
after:2024-01-01           → 某日期之后
-deploy                    → 排除关键词
```

---

### 模块 8：用户与个人资料

**功能清单：**
- 用户列表 / 成员目录
- 个人资料查看（头像、昵称、职位、部门）
- 编辑个人资料（头像上传、显示名称、职位）
- 用户在线状态（在线/离开/勿扰/离线）
- 自定义状态（文字 + Emoji + 过期时间）
- 用户时区显示
- 用户角色标识（Admin / Channel Admin / Guest）
- 用户分组（Custom Groups）

**涉及 API：**
```
GET    /api/v4/users                                → 用户列表
GET    /api/v4/users/{user_id}                      → 用户详情
GET    /api/v4/users/{user_id}/status               → 用户状态
PUT    /api/v4/users/me/status                      → 更新自己的状态
GET    /api/v4/users/me                             → 当前用户
PATCH  /api/v4/patch/me                             → 更新资料
POST   /api/v4/users/{user_id}/status/custom        → 设置自定义状态
GET    /api/v4/users/{user_id}/profile_image        → 头像
POST   /api/v4/users/me/image                       → 上传头像

# 用户分组
GET    /api/v4/groups                               → 分组列表
POST   /api/v4/groups                               → 创建分组
```

---

### 模块 9：通知系统

**功能清单：**
- 桌面通知（Web Notification API / Desktop 原生通知）
- 移动推送通知（APNs / FCM）
- 通知声音
- 通知偏好设置（桌面/邮件/移动）
  - 全部消息
  - 仅 @提及
  - 关闭
- @提及高亮
- 未读消息计数（频道级别 + 全局）
- 未读徽章（桌面图标 / 标签页标题）
- 邮件通知摘要
- 免打扰模式（Do Not Disturb）

**WebSocket 事件驱动：**
```
posted            → 检查是否需要通知（@mention? 频道通知设置?）
status_change     → 更新在线状态指示器
```

**涉及 API：**
```
PUT    /api/v4/users/me/preferences                 → 通知偏好
POST   /api/v4/notifications/ack                    → 确认通知
GET    /api/v4/users/me/teams/unread                → 未读统计
```

---

### 模块 10：Slash 命令与集成

**功能清单：**
- 内置 Slash 命令解析与执行
- 自定义 Slash 命令（HTTP webhook 集成）
- 传入 Webhook（Incoming Webhook）展示
- 传出 Webhook（Outgoing Webhook）触发
- Bot 账户交互
- 交互式消息按钮（Interactive Actions）
- 对话框（Dialog — 弹出表单）
- 命令自动补全与提示

**内置命令：**
```
/away, /offline, /online, /dnd      → 设置状态
/code                                → 代码块消息
/header                              → 设置频道Header
/purpose                             → 设置频道Purpose
/rename                              → 重命名频道
/echo                                 → 测试消息
/me                                   → 动作消息
/kick, /remove                        → 移除成员
/leave                               → 离开频道
/join                                → 加入频道
/open, /hide, /mute                  → 频道操作
/msg                                  → 发起DM
/groupmsg                            → 发起群组消息
/search                              → 搜索
/shortcuts                           → 快捷键列表
/help                                → 帮助
```

**涉及 API：**
```
POST   /api/v4/commands                             → 创建自定义命令
GET    /api/v4/commands/list                        → 命令列表
POST   /api/v4/commands/execute                     → 执行命令
POST   /api/v4/actions/dialogs/open                 → 打开对话框
POST   /api/v4/actions/dialogs/submit               → 提交对话框
POST   /api/v4/posts/{post_id}/actions/{action_id}  → 交互按钮回调
```

---

### 模块 11：表情 Emoji

**功能清单：**
- 系统 Emoji 渲染
- 自定义 Emoji（上传/删除/展示）
- Emoji 选择器面板
- Emoji 搜索
- 消息中的 Emoji 解析（`:emoji_name:` → 图片）
- Emoji 反应面板

**涉及 API：**
```
GET    /api/v4/emoji                                 → 自定义Emoji列表
POST   /api/v4/emoji                                 → 上传自定义Emoji
GET    /api/v4/emoji/{emoji_id}/image               → 获取Emoji图片
DELETE /api/v4/emoji/{emoji_id}                     → 删除Emoji
```

---

### 模块 12：全局搜索与数据浏览

**功能清单：**
- 频道内文件列表（Channel Files）
- 团队成员目录（Member Directory）
- 固定消息查看（Pinned Messages）
- 频道信息面板（成员/通知/设置）
- 最近提及（Recent Mentions）
- 未读消息收件箱（Saved/Flagged Posts）

---

### 模块 13：用户设置与偏好

**功能清单：**
- 显示设置（主题色、消息显示格式 Compact/Clean）
- 时区设置（自动检测 / 手动选择）
- 时钟格式（12/24小时）
- 语言切换（i18n — 支持16+种语言）
- 通知详细设置（桌面/移动/邮件）
- 隐私设置（已读回执、输入状态）
- 高级设置（预发布特性、性能优化标志）
- 快捷键配置
- 数据导出（个人数据 GDPR）

**涉及 API：**
```
GET    /api/v4/preferences                           → 获取偏好
PUT    /api/v4/preferences                           → 更新偏好
GET    /api/v4/config/client                         → 客户端配置
GET    /api/v4/users/me/preferences                  → 用户偏好详情
```

---

### 模块 14：Markdown 渲染引擎

**客户端必须内置的 Markdown 解析与渲染：**

| 语法 | 渲染效果 |
|------|---------|
| `**粗体**` | **粗体** |
| `*斜体*` | *斜体* |
| `~~删除线~~` | ~~删除线~~ |
| `` `行内代码` `` | `行内代码` |
| ` ```代码块``` ` | 语法高亮代码块 |
| `[链接](url)` | 可点击链接 |
| `> 引用` | 引用块 |
| `- 列表` / `1. 有序` | 列表 |
| `# 标题` | H1-H6 |
| `---` | 水平分割线 |
| `![alt](url)` | 内联图片 |
| `@username` | 用户提及链接 |
| `~channelname` | 频道链接 |
| `:emoji:` | Emoji 图片 |

**特殊渲染：**
- 时间戳自动识别与格式化
- OpenGraph 链接预览
- GitHub Gist / YouTube / Twitter 嵌入
- LaTeX 数学公式（可选）

---

### 模块 15：桌面端/移动端平台特化

#### Desktop (Electron)
- 多服务器实例管理（Tab 切换）
- 系统托盘（Tray）+ 最小化到托盘
- 原生通知（带操作按钮）
- 全局快捷键唤起
- 深色/浅色系统主题跟随
- 自动更新（Auto Update）
- 拼写检查
- 屏幕共享（Desktop capturer）

#### Mobile (React Native)
- 离线消息缓存（WatermelonDB 本地存储）
- 推送通知（APNs / FCM）
- 后台 WebSocket 保活策略
- 下拉刷新 / 无限滚动加载
- 图片/视频选择器（原生）
- 生物识别解锁（Face ID / Touch ID）
- 摇一摇反馈
- 深链接（Deep Linking）

---

## 三、API 交互层总结

### REST API 端点分类（38个域）

| 序号 | 域 | 核心功能 |
|------|-----|---------|
| 1 | Users | 用户 CRUD、登录、状态 |
| 2 | Bots | Bot 账户管理 |
| 3 | Teams | 团队管理 |
| 4 | Channels | 频道管理 |
| 5 | Posts | 消息管理 |
| 6 | Files | 文件上传下载 |
| 7 | Uploads | 分步上传 |
| 8 | Bookmarks | 频道书签 |
| 9 | Views | 频道视图 |
| 10 | Preferences | 用户偏好 |
| 11 | Status | 在线状态 |
| 12 | Emoji | 自定义表情 |
| 13 | Reactions | 消息反应 |
| 14 | Webhooks | Webhook 管理 |
| 15 | Commands | Slash 命令 |
| 16 | System | 系统配置 |
| 17 | Brand | 品牌定制 |
| 18 | OAuth | OAuth 2.0 |
| 19 | SAML | SAML SSO |
| 20 | LDAP | LDAP 集成 |
| 21 | Groups | 用户分组 |
| 22 | Compliance | 合规报告 |
| 23 | Cluster | 高可用集群 |
| 24 | Elasticsearch | ES 搜索 |
| 25 | Data Retention | 数据保留策略 |
| 26 | Jobs | 后台任务 |
| 27 | Plugins | 插件管理 |
| 28 | Roles | 角色管理 |
| 29 | Schemes | 权限方案 |
| 30 | Integration Actions | 集成交互动作 |
| 31 | Shared Channels | 跨实例频道共享 |
| 32 | Terms of Service | 服务条款 |
| 33 | Imports | 数据导入 |
| 34 | Exports | 数据导出 |
| 35 | Metrics | 性能监控 |
| 36 | Audit Logs | 审计日志 |
| 37 | Recaps | AI 摘要回顾 |
| 38 | Agents | AI Agent 交互 |

### 关键 API 约定
- **基础路径**：`/api/v4`
- **格式**：JSON（`application/json`）
- **分页**：`per_page` 最大 200，默认 60
- **用户ID**：可用 `me` 代替当前用户ID
- **速率限制**：返回 `X-Ratelimit-*` 头，超限返回 429
- **错误格式**：`{"id": "error.id", "message": "...", "status_code": 400}`

---

## 四、状态管理架构

### Redux Store 结构（mattermost-redux）

```
Store
├── entities
│   ├── users          { currentUserId, profiles: {id: User} }
│   ├── teams          { currentTeamId, teams: {id: Team} }
│   ├── channels       { currentChannelId, channels: {id: Channel} }
│   ├── posts          { posts: {id: Post}, postsInChannel: {channelId: [postIds]} }
│   ├── threads        { threads: {id: Thread} }
│   ├── files          { files: {id: File} }
│   ├── preferences    { MyPreferences: [Preference] }
│   ├── emoji          { customEmoji: {name: Emoji} }
│   ├── roles          { roles: {name: Role} }
│   └── general        { config, license, serverVersion }
├── views
│   ├── channels       { myMembers: {channelId: membership} }
│   ├── posts          { messages: {channelId: postId[]} }
│   ├── threads        { counts: {threadId: {unread, mentions}} }
│   └── typing         { typing: {channelId: {userId: timestamp}} }
└── errors             { error logs }
```

### 关键设计原则
1. **单一数据源**：所有实体只存一份，通过 ID 引用
2. **Normalized State**：避免嵌套，扁平化存储
3. **乐观更新**：先更新 UI，API 失败再回滚
4. **Selector 记忆化**：使用 reselect 避免 unnecessary re-render
5. **离线优先（移动端）**：WatermelonDB 本地优先，后台同步

---

## 五、开发优先级建议

### Phase 1 — MVP（最小可用）
| 序号 | 功能 | 依赖 |
|------|------|------|
| 1 | 登录/认证 | REST API |
| 2 | 频道列表 | REST + WebSocket |
| 3 | 消息收发 | REST + WebSocket |
| 4 | WebSocket 实时更新 | WebSocket |
| 5 | 基础 Markdown 渲染 | — |
| 6 | 文件上传 | REST API |

### Phase 2 — 核心体验
| 序号 | 功能 |
|------|------|
| 7 | 线程回复 |
| 8 | @提及 + 通知 |
| 9 | 消息搜索 |
| 10 | 用户在线状态 |
| 11 | Emoji + Reactions |
| 12 | 消息编辑/删除 |
| 13 | 频道管理（创建/设置） |
| 14 | 直接消息（DM/GM） |

### Phase 3 — 完整功能
| 序号 | 功能 |
|------|------|
| 15 | Slash 命令 |
| 16 | 交互式消息 |
| 17 | 自定义 Emoji |
| 18 | 用户设置面板 |
| 19 | 频道分类与排序 |
| 20 | 线程收件箱 |
| 21 | 深色主题 |
| 18 | 国际化 i18n |
| 19 | 桌面通知 |
| 20 | 离线缓存（移动端） |
| 21 | 推送通知 |
| 22 | 插件支持 |

---

## 六、性能优化要点

| 场景 | 方案 |
|------|------|
| 万级消息列表 | 虚拟列表（react-window / Flashlist） |
| 频道切换卡顿 | 预加载 + 懒加载 + 数据缓存 |
| WebSocket 消息洪流 | 事件批量处理（batching） |
| 图片加载 | 懒加载 + 渐进式缩略图 + CDN |
| 状态更新频繁 | Selector 记忆化（reselect） |
| 大型团队（1000+人） | 分页加载 + 搜索优先 |
| 搜索性能 | 防抖（debounce）+ 取消旧请求 |

---

## 七、安全要点

| 项目 | 要求 |
|------|------|
| Token 存储 | httpOnly Cookie（Web）/ Keychain（Desktop）/ SecureStorage（Mobile） |
| XSS 防护 | Markdown 渲染前 sanitize HTML |
| CSRF | 使用 Bearer Token 而非仅依赖 Cookie |
| 文件上传 | 客户端文件类型校验 + 大小限制 |
| 速率限制 | 处理 429 响应，显示友好提示 |
| WebSocket 安全 | WSS（TLS）+ Token 认证 |
| 敏感数据 | 本地缓存加密（移动端 SQLCipher） |

---

> **文档版本**：v1.0 | **基于 Mattermost Server v11.x + API v4**
> **参考来源**：Mattermost 官方 API 文档 (api.mattermost.com)、GitHub 仓库 (mattermost/mattermost)、mattermost-redux、官方开发者文档
