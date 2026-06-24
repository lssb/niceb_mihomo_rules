# NiceB Task Hub 设计文档

> 状态：需求确认后的初版设计稿  
> 目标：把现有 `tasks.json + 早晚提醒` 升级为可被多 Agent 安全访问、认领、回报和可视化管理的局域网任务中枢。  
> 重要边界：任务拆分交给 Hermes 执行；Task Hub 只负责发起拆分请求、展示预览、确认后写入子任务。

## 1. 产品定位

NiceB Task Hub 是一个面向个人多 Agent 工作流的任务管理系统。

它不是单纯待办列表，而是：

- 人类可视化管理任务的 WebUI。
- Agent 可通过 REST API 轮询、认领、更新和提交报告的任务总线。
- 支持 API Key 权限与任务可见性控制的协作中枢。
- 记录每次任务变更来源的审计系统。
- 调用 Hermes 进行任务拆分，并把拆分结果转为可分配子任务的调度入口。

## 2. 已确认配置

| 项目 | 值 |
| --- | --- |
| 系统名称 | NiceB Task Hub |
| 默认端口 | `8787` |
| 监听地址 | `0.0.0.0:8787` |
| WebUI 默认账号 | `niceb` |
| WebUI 默认密码 | `1231` |
| Agent 认领超时 | `6h` |
| 部署范围 | 局域网访问 |
| 报告格式 | Markdown 文本 |
| 存储方案 | SQLite MVP，预留 PostgreSQL 迁移空间 |

## 3. 核心原则

1. **Task Hub 管任务，Hermes 管智能拆分。**
   Task Hub 不自己维护 provider、prompt、skills 调用逻辑，避免重复造半个 Hermes。

2. **一个子任务同一时间只能一个 Agent 认领。**
   Agent 是否再调用自己的子代理，由 Agent 自己决定，Task Hub 不管理 Agent 内部执行拓扑。

3. **涉及 Agent 的任务必须双重完成。**
   Agent 只能提交执行报告并进入待确认状态，最终 `done` 需要 WebUI 人工确认。

4. **所有重要变更必须可审计。**
   创建、更新、认领、释放、超时、报告、确认完成、取消、拆分应用都写入事件日志。

5. **API Key 是 Agent 身份。**
   每个 Agent 有独立 API Key；任务可见性和可操作权限都基于这个身份判断。

6. **提醒脚本也走 REST API。**
   原早晚提醒迁移为特殊只读 Agent，不再直接读取 JSON 账本。

## 4. 用户与身份模型

### 4.1 WebUI 用户

MVP 只有一个 WebUI 用户：

- username: `niceb`
- password: `1231`
- role: `admin`

WebUI 使用登录 session/cookie。后续如需多人访问，可扩展 `users` 表。

### 4.2 Agent

Agent 由用户在 WebUI 中新增、更新、禁用、删除。

Agent 字段建议：

```json
{
  "id": "agent_xxx",
  "name": "Claude Code",
  "slug": "claude-code",
  "description": "负责编码任务",
  "capabilities": ["coding", "review", "test"],
  "permissions": ["read_tasks", "claim_tasks", "update_tasks", "submit_reports"],
  "visibility_rules": {
    "tags": ["coding"],
    "projects": [],
    "public_pool": false
  },
  "enabled": true,
  "created_at": "...",
  "updated_at": "..."
}
```

新增 Agent 时自动生成 API Key。API Key 可在局域网管理界面查看、重置、禁用。

### 4.3 特殊 Agent

系统内置或初始化时创建：

- `niceb-admin`：WebUI 管理者对应的审计 actor。
- `butler-reminder`：早晚提醒专用只读 Agent。
- `hermes-decomposer`：任务拆分请求对应的系统 actor，可选。

`butler-reminder` 权限：

- `read_tasks`
- `read_reminders`

禁止：

- 创建任务
- 修改任务
- 认领任务
- 提交报告
- 管理 Agent

## 5. 权限模型

### 5.1 能力权限

建议定义以下权限：

- `read_tasks`
- `create_tasks`
- `update_tasks`
- `delete_tasks`
- `claim_tasks`
- `release_claims`
- `submit_reports`
- `decompose_tasks`
- `read_events`
- `manage_agents`
- `manage_api_keys`
- `admin`
- `read_reminders`

### 5.2 可见性规则

任务可见性支持多种方式并存：

1. **直接指定 Agent 可见**
   任务维护 `visible_agent_ids`。

2. **直接分配 Agent**
   任务维护 `assigned_agent_ids`，优先显示给这些 Agent。

3. **项目规则**
   Agent 可按 project 读取任务。

4. **标签规则**
   Agent 可按 tags 读取任务。

5. **公开任务池**
   任务设置 `visibility = public_pool` 后，对有 `read_tasks` 且允许公共池的 Agent 可见。

最终可见性判断：

```text
admin
OR agent explicitly assigned
OR agent explicitly visible
OR task project matches agent visibility rule
OR task tags intersect agent visibility rule
OR task is public_pool and agent can read public pool
```

能力权限决定“能不能做”，可见性决定“看不看得到”。

## 6. 任务模型

### 6.1 任务字段

```json
{
  "id": "task_xxx",
  "parent_id": null,
  "title": "PFE文稿投稿修改",
  "description": "这周需要改好",
  "status": "ready",
  "agent_status": "not_started",
  "human_status": "pending",
  "priority": "high",
  "project": "PFE论文",
  "tags": ["科研", "PFE", "论文"],
  "due_at": "2026-06-28T23:59:59+08:00",
  "created_by": "user:niceb",
  "updated_by": "user:niceb",
  "assigned_agent_ids": ["agent_hermes"],
  "visible_agent_ids": ["agent_hermes", "agent_claude_code"],
  "visibility": "restricted",
  "claimed_by": null,
  "claimed_at": null,
  "claim_expires_at": null,
  "previous_status": null,
  "metadata": {},
  "created_at": "...",
  "updated_at": "..."
}
```

### 6.2 状态枚举

主状态 `status`：

- `open`：新建但尚未准备执行。
- `ready`：信息足够，Agent 可认领。
- `claimed`：已被 Agent 认领但未开始或未写进度。
- `in_progress`：Agent 执行中。
- `blocked`：阻塞，需要用户或外部条件处理。
- `review`：Agent 已提交报告，等待人工确认。
- `done`：人工确认完成。
- `cancelled`：取消。

Agent 状态 `agent_status`：

- `not_started`
- `claimed`
- `in_progress`
- `submitted_report`
- `blocked`
- `failed`

人工确认状态 `human_status`：

- `pending`
- `approved`
- `rejected`
- `not_required`

涉及 Agent 的任务默认 `human_status = pending`，必须人工确认后才进入 `done`。

## 7. 认领与超时

### 7.1 认领流程

Agent 调用：

```http
POST /api/tasks/{task_id}/claim
Authorization: Bearer <agent_api_key>
```

服务端必须原子检查：

- Agent 有 `claim_tasks` 权限。
- 任务对 Agent 可见。
- 任务状态允许认领。
- 任务当前没有有效 `claimed_by`。

成功后写入：

```json
{
  "claimed_by": "agent_xxx",
  "claimed_at": "...",
  "claim_expires_at": "claimed_at + 6h",
  "previous_status": "ready",
  "status": "claimed",
  "agent_status": "claimed"
}
```

### 7.2 超时恢复

认领超时后恢复到认领前状态：

- `status = previous_status`
- `claimed_by = null`
- `claimed_at = null`
- `claim_expires_at = null`
- `previous_status = null`
- `agent_status = not_started`

写审计事件：`claim_expired`。

实现方式：

- MVP 可采用“惰性释放”：读取任务列表、读取单任务、认领任务前先清理过期 claim。
- 后续可加后台 scheduler 定期清理。

## 8. 报告与双重完成

Agent 执行后提交 Markdown 文本报告：

```http
POST /api/tasks/{task_id}/reports
Authorization: Bearer <agent_api_key>
Content-Type: application/json

{
  "content": "## 执行报告\n- 做了什么...\n- 结果...\n- 问题...",
  "result": "completed"
}
```

提交成功后：

- 新增 report。
- 任务进入 `review`。
- `agent_status = submitted_report`。
- `human_status = pending`。
- 写审计事件：`report_submitted`。

WebUI 人工确认：

```http
POST /api/tasks/{task_id}/approve
```

确认后：

- `status = done`
- `human_status = approved`
- 清空认领字段
- 写审计事件：`human_approved_done`

如果报告不合格，可驳回：

```http
POST /api/tasks/{task_id}/reject
```

驳回后可回到 `ready` 或 `in_progress`，由 UI 提供选择。

## 9. 任务拆分：交给 Hermes

### 9.1 架构边界

最终确认：任务拆分交给 Hermes 执行。

Task Hub 不做：

- 不维护 provider API 调用细节。
- 不自行拼接 skills 上下文。
- 不自行维护复杂拆分专家 prompt。
- 不直接承担模型调用与推理演化。

Task Hub 做：

- 在任务详情页提供“分解任务”按钮。
- 收集任务上下文与用户选择的拆分方向。
- 调用 Hermes 拆分入口。
- 接收结构化子任务草案。
- 展示预览。
- 用户确认后写入子任务。
- 记录拆分审计日志。

Hermes 做：

- 选择 provider/model。
- 加载相关 skills。
- 使用合适的拆分方法与提示词。
- 返回结构化子任务 JSON。
- 随着技能、provider、提示词体系持续进化。

### 9.2 分解请求

WebUI 请求：

```http
POST /api/tasks/{task_id}/decompose/preview
```

请求体：

```json
{
  "mode": "coding|bioinformatics|devops|writing|general",
  "instructions": "按适合 Agent 执行的粒度拆分",
  "suggested_skills": ["software-development-workflows", "debugging"],
  "max_subtasks": 8
}
```

Task Hub 后端构造给 Hermes 的任务：

```text
请将以下 Task Hub 任务拆分为适合 Agent 执行的子任务。
要求：
1. 返回 JSON。
2. 每个子任务只能建议一个主执行 Agent 类型。
3. 每个子任务包含 title、description、priority、tags、suggested_agent、acceptance_criteria。
4. 不要直接执行任务，只做拆分。
5. 如信息不足，生成 blocked 子任务或提出需要补充的信息。
```

### 9.3 Hermes 调用方式

MVP 先使用本机 Hermes CLI 的一次性调用：

```bash
hermes chat -q '<decompose prompt>' --toolsets skills
```

后续可升级为：

- Hermes webhook。
- Hermes API Server。
- 专用 `task_decompose` skill。
- 独立 Hermes profile。

调用输出必须解析为结构化 JSON。解析失败时：

- 保存原始输出。
- WebUI 显示错误和原文。
- 不写入子任务。

### 9.4 分解预览与应用

预览响应：

```json
{
  "task_id": "task_xxx",
  "decomposer": "hermes",
  "raw_request_id": "decomp_xxx",
  "subtasks": [
    {
      "title": "整理 PFE 文稿待修改点",
      "description": "...",
      "priority": "high",
      "tags": ["PFE", "writing"],
      "suggested_agent": "hermes",
      "acceptance_criteria": ["列出所有待修改点"]
    }
  ]
}
```

用户确认后调用：

```http
POST /api/tasks/{task_id}/decompose/apply
```

应用后：

- 创建子任务，`parent_id = task_id`。
- 子任务默认为 `open` 或 `ready`。
- 可在预览页给每个子任务指定 Agent。
- 写事件：`task_decomposed`。

## 10. REST API 设计

### 10.1 WebUI/Auth

```http
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

### 10.2 Agent 管理

```http
GET    /api/agents
POST   /api/agents
GET    /api/agents/{agent_id}
PATCH  /api/agents/{agent_id}
DELETE /api/agents/{agent_id}
POST   /api/agents/{agent_id}/api-keys
POST   /api/agents/{agent_id}/api-keys/{key_id}/disable
POST   /api/agents/{agent_id}/api-keys/{key_id}/rotate
```

### 10.3 任务管理

```http
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/{task_id}
PATCH  /api/tasks/{task_id}
DELETE /api/tasks/{task_id}
GET    /api/tasks/{task_id}/children
GET    /api/tasks/{task_id}/events
```

### 10.4 Agent 执行接口

```http
GET  /api/agent/me
GET  /api/agent/tasks?status=ready
POST /api/tasks/{task_id}/claim
POST /api/tasks/{task_id}/heartbeat
POST /api/tasks/{task_id}/release
POST /api/tasks/{task_id}/reports
```

`heartbeat` 用于延长或刷新执行状态，防止长任务误超时。

### 10.5 人工确认接口

```http
POST /api/tasks/{task_id}/approve
POST /api/tasks/{task_id}/reject
POST /api/tasks/{task_id}/cancel
```

### 10.6 拆分接口

```http
POST /api/tasks/{task_id}/decompose/preview
POST /api/tasks/{task_id}/decompose/apply
```

### 10.7 提醒接口

```http
GET /api/reminders/pending
```

只允许 `butler-reminder` 或 admin 访问。

## 11. 数据库表设计

### 11.1 `agents`

- `id`
- `name`
- `slug`
- `description`
- `capabilities_json`
- `permissions_json`
- `visibility_rules_json`
- `enabled`
- `created_at`
- `updated_at`

### 11.2 `api_keys`

- `id`
- `agent_id`
- `name`
- `key_hash`
- `key_preview`
- `enabled`
- `last_used_at`
- `created_at`
- `updated_at`

MVP 可显示明文生成结果；数据库仍建议只存 hash，避免未来迁移时踩坑。若需要“可查看”，可加本机加密存储，但 MVP 不强制。

### 11.3 `tasks`

- `id`
- `parent_id`
- `title`
- `description`
- `status`
- `agent_status`
- `human_status`
- `priority`
- `project`
- `tags_json`
- `visibility`
- `due_at`
- `created_by`
- `updated_by`
- `claimed_by_agent_id`
- `claimed_at`
- `claim_expires_at`
- `previous_status`
- `metadata_json`
- `created_at`
- `updated_at`

### 11.4 `task_agent_assignments`

- `task_id`
- `agent_id`
- `assignment_type`: `assigned|visible`
- `created_at`

### 11.5 `task_reports`

- `id`
- `task_id`
- `agent_id`
- `content_markdown`
- `result`
- `created_at`

### 11.6 `task_events`

- `id`
- `task_id`
- `actor_type`: `user|agent|system|hermes`
- `actor_id`
- `action`
- `before_json`
- `after_json`
- `message`
- `created_at`

### 11.7 `decomposition_runs`

- `id`
- `task_id`
- `requested_by`
- `mode`
- `instructions`
- `hermes_command_json`
- `raw_output`
- `parsed_output_json`
- `status`: `preview|applied|failed|cancelled`
- `created_at`
- `applied_at`

## 12. WebUI 页面

### 12.1 登录页

- 用户名
- 密码
- 登录按钮

### 12.2 任务列表视图

支持：

- 搜索
- 状态筛选
- 项目筛选
- 标签筛选
- Agent 筛选
- 截止日期筛选
- 优先级筛选
- 列表/看板切换

列表列：

- 标题
- 状态
- 优先级
- 截止日期
- 指定 Agent
- 认领 Agent
- 最近更新者
- 最近更新时间
- 操作按钮

### 12.3 看板视图

按状态分列：

- open
- ready
- claimed
- in_progress
- blocked
- review
- done

卡片显示：

- 标题
- 优先级
- Agent
- 截止日期
- 是否有报告
- 是否待确认

### 12.4 任务详情页

包含：

- 基本信息编辑
- 描述 Markdown
- 子任务树
- 指定 Agent / 可见 Agent
- 标签与项目
- 认领状态
- 报告列表
- 审计日志
- 分解任务按钮
- 确认完成 / 驳回 / 取消按钮

### 12.5 Agent 管理页

包含：

- Agent 列表
- 新增 Agent
- 编辑 Agent
- 启用/禁用
- API Key 查看/重置/禁用
- 权限配置
- 可见性规则配置

### 12.6 拆分预览页/弹窗

包含：

- 拆分模式
- 额外指令
- 建议 skills
- Hermes 返回的子任务列表
- 每个子任务的编辑区
- 为每个子任务指定 Agent
- 应用按钮

## 13. 现有数据迁移

来源：

- `/Users/niceb/.hermes/butler/tasks.json`

迁移规则：

- `title` 原样迁移。
- `status = done` 的任务迁移为 `done`。
- 其他状态迁移为 `open`。
- `progress` 迁移到 `description` 或 `metadata.progress`。
- `due` 迁移为 `due_at`。
- `created_at`、`updated_at` 尽量保留。
- 默认创建者：`user:niceb`。
- 默认 project 可设为 `管家待办`。
- 默认 tags 可设为 `legacy-butler`。

迁移后创建 `butler-reminder` Agent，并把提醒脚本改为 REST API 读取。

## 14. 早晚提醒改造

旧脚本：

- `/Users/niceb/.hermes/scripts/butler_pending_tasks.py`

新逻辑：

1. 读取环境变量或配置文件中的 Task Hub URL 和 reminder API Key。
2. 调用：

```http
GET http://127.0.0.1:8787/api/reminders/pending
Authorization: Bearer ***
```

3. 格式化未完成任务。
4. 无未完成任务时输出空内容，保持 no-agent cron 静默。

提醒范围：

- `open`
- `ready`
- `claimed`
- `in_progress`
- `blocked`
- `review`

排除：

- `done`
- `cancelled`

## 15. 技术栈建议

### 15.1 后端

- Python 3.11+
- FastAPI
- Uvicorn
- SQLAlchemy 2.x 或 SQLModel
- SQLite
- Pydantic
- Passlib 或 hashlib/scrypt 用于密码/API Key hash

### 15.2 前端

- React
- Vite
- TypeScript
- 简单 CSS 或 Tailwind

### 15.3 部署

MVP 本机直接运行：

```bash
uvicorn niceb_task_hub.main:app --host 0.0.0.0 --port 8787
```

后续可补：

- launchd plist
- Dockerfile
- 反向代理
- HTTPS

## 16. 目录结构建议

```text
niceb-task-hub/
  backend/
    niceb_task_hub/
      main.py
      config.py
      db.py
      models.py
      schemas.py
      auth.py
      permissions.py
      audit.py
      routers/
        auth.py
        agents.py
        tasks.py
        agent_api.py
        reminders.py
        decompose.py
      services/
        task_service.py
        agent_service.py
        reminder_service.py
        hermes_decompose_service.py
        migration_service.py
    tests/
  frontend/
    src/
      api/
      components/
      pages/
      App.tsx
      main.tsx
  scripts/
    migrate_butler_tasks.py
    run_dev.sh
  README.md
```

## 17. 开发阶段划分

### Phase 0：设计与骨架

- 确认本设计文档。
- 创建项目结构。
- 初始化 FastAPI、SQLite、React/Vite。
- 添加基础配置。

### Phase 1：后端核心

- 数据模型。
- WebUI 登录。
- Agent CRUD。
- API Key 鉴权。
- Task CRUD。
- 权限与可见性判断。
- 审计日志。

### Phase 2：Agent 工作流

- Agent 轮询任务。
- 原子认领。
- heartbeat。
- 认领超时恢复。
- Markdown 报告提交。
- 人工确认完成。

### Phase 3：WebUI

- 登录页。
- 任务列表视图。
- 看板视图。
- 任务详情页。
- Agent 管理页。
- 报告与审计日志展示。

### Phase 4：Hermes 拆分

- 后端封装 Hermes 调用。
- 结构化 JSON 解析。
- 拆分预览。
- 拆分应用为子任务。
- 错误展示与审计记录。

### Phase 5：迁移与提醒

- 迁移 `tasks.json`。
- 创建 `butler-reminder` Agent。
- 改造 `butler_pending_tasks.py` 走 REST API。
- 保持现有 cron 时间不变。

### Phase 6：部署与验证

- 局域网访问验证。
- API Key 访问验证。
- 多 Agent 权限隔离验证。
- 认领并发验证。
- 提醒脚本验证。
- WebUI 手工验收。

## 18. 验收标准

### 18.1 管理端

- 能用 `niceb / 1231` 登录 WebUI。
- 能创建、编辑、禁用 Agent。
- 创建 Agent 时能生成 API Key。
- 能创建任务并指定 Agent。
- 能在列表和看板视图之间切换。
- 任务详情能看到报告和审计日志。

### 18.2 Agent API

- 不带 API Key 不能访问任务。
- Agent 只能看到自己有权限看到的任务。
- Agent 能认领可见任务。
- 两个 Agent 不能同时认领同一任务。
- 认领超时后任务恢复到认领前状态。
- Agent 能提交 Markdown 报告。
- Agent 提交报告后任务进入待确认，而不是直接完成。

### 18.3 人工确认

- WebUI 能确认 Agent 报告并完成任务。
- WebUI 能驳回报告。
- 所有操作记录更新者和审计事件。

### 18.4 Hermes 拆分

- 点击分解任务能调用 Hermes。
- Hermes 返回子任务预览。
- 解析失败时不落库，并展示原始输出。
- 确认应用后创建子任务。
- 子任务能指定 Agent。

### 18.5 提醒迁移

- 旧 `tasks.json` 数据能迁移。
- 早晚提醒脚本通过 REST API 获取未完成任务。
- 无未完成任务时脚本静默。
- 已完成和取消任务不出现在提醒中。

## 19. 风险与注意事项

1. **Hermes CLI 输出结构化 JSON 不稳定。**
   需要强约束 prompt，并在后端做 JSON 提取和错误回显。

2. **API Key 明文展示与安全性取舍。**
   用户确认局域网使用且不要求只显示一次；但数据库仍建议存 hash。

3. **局域网访问需要登录保护。**
   WebUI 必须有密码，不能裸露管理界面。

4. **SQLite 并发限制。**
   MVP 足够；认领操作必须用事务。未来高并发可迁移 PostgreSQL。

5. **提醒系统不能中断。**
   迁移提醒脚本前要保留原 JSON 备份，并验证 cron 输出。

6. **不要把 Agent 内部执行复杂化。**
   Task Hub 只管理任务归属、状态、报告，不管理 Agent 是否调用子代理。

## 20. 待确认的小问题

1. 项目代码放在当前工作区新目录 `niceb-task-hub/`，还是放在 `~/.hermes/` 或其他路径？
2. WebUI 密码 `1231` 是否需要首次启动写入 `.env`，避免硬编码？
3. Hermes 拆分调用是先用 `hermes chat -q`，还是优先找 Hermes API Server/Webhook？
4. Agent API Key 是否需要支持过期时间？MVP 可不做。
5. 是否需要任务评论功能？MVP 可用报告和审计日志先替代。
