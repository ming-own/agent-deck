# AgentDeck · 智牌

自由搭配 Agent，组建适合你的智能协作团队。

AgentDeck 由 [ming-own](https://github.com/ming-own) 开发与维护，基于
[Eigent](https://github.com/eigent-ai/eigent) 进行二次开发。后续方向是让 Agent、
模型、工具与技能能够灵活组合，按自己的工作方式协作。

[English](README.md) · [问题反馈](https://github.com/ming-own/agent-deck/issues) ·
[版本发布](https://github.com/ming-own/agent-deck/releases)

## 当前状态

本次完成项目命名与仓库初始化，沿用现有应用能力。“自由搭配 Agent”的新体验
是后续开发方向，并非本次改名已经实现的功能。

## 本地开发

使用 Node.js 20 或 22 和 npm。本地后端还需要 Docker、Python，具体操作见
[本地部署说明](server/README_CN.md)。

```bash
git clone https://github.com/ming-own/agent-deck.git
cd agent-deck
npm install
```

使用本地后端时，在项目根目录创建 `.env.development.local`：

```dotenv
VITE_BASE_URL=/api
SERVER_URL=http://localhost:3001
VITE_PROXY_URL=http://localhost:3001
VITE_USE_LOCAL_PROXY=true
```

按部署说明启动后端后，执行 `npm run dev`。

继承的 `.env.development` 默认连接 Eigent 云服务。这些服务由原项目运营，
并不属于 AgentDeck。云端登录、远程控制、模型服务等需要单独配置。

## 开发与发布

- 代码、Issue、Pull Request 和版本发布只使用 `ming-own/agent-deck`。
- 桌面应用名称为 `AgentDeck`，应用标识为 `com.mingown.agentdeck`。
- 安装包发布与自动更新均指向本仓库的 GitHub Releases。
- 需要先构建并发布 AgentDeck 版本，自动更新才能提供可下载的安装包。
- 兼容性边界及继承的部署要求见[维护说明](docs/agentdeck-maintenance.md)。

## 来源与许可

AgentDeck 基于 Eigent，保留完整 Git 历史、原作者版权声明与贡献来源。
[LICENSE](LICENSE) 为 Apache License 2.0；第三方组件沿用各自许可证。
