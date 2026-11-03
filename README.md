# AgentDeck · 智牌

Compose your own team of AI agents.

AgentDeck is a desktop agent workspace developed and maintained by
[ming-own](https://github.com/ming-own), based on
[Eigent](https://github.com/eigent-ai/eigent). Its direction is to make it easy to
combine agents, models, tools, and skills into teams that suit your work.

[简体中文](README_CN.md) · [Issues](https://github.com/ming-own/agent-deck/issues) ·
[Releases](https://github.com/ming-own/agent-deck/releases)

## Project status

This is the initial AgentDeck branding and repository setup. It retains the
existing application capabilities; the new agent composition experience is a
future development direction, not a feature delivered by this rename.

## Develop locally

Use Node.js 20 or 22 and npm. The local backend also needs Docker and Python;
see the [local deployment guide](server/README_EN.md).

```bash
git clone https://github.com/ming-own/agent-deck.git
cd agent-deck
npm install
```

For a local backend, configure `.env.development.local` in the project root:

```dotenv
VITE_BASE_URL=/api
SERVER_URL=http://localhost:3001
VITE_PROXY_URL=http://localhost:3001
VITE_USE_LOCAL_PROXY=true
```

Start the backend as described in the deployment guide, then run `npm run dev`.
The inherited `.env.development` points to Eigent cloud services. Those services
are operated by the upstream project, not by AgentDeck. Cloud authentication,
remote control, and model-service integration need separate configuration.

## Development and releases

- Repository, issues, pull requests, and releases: `ming-own/agent-deck` only.
- Desktop product name: `AgentDeck`; application ID: `com.mingown.agentdeck`.
- Auto-updates and package publishing target this repository's GitHub Releases.
- A release must be built and published before updates are available.
- See [maintenance notes](docs/agentdeck-maintenance.md) for compatibility and
  inherited deployment requirements.

## Attribution and license

AgentDeck is derived from Eigent and preserves its Git history and original
copyright notices. The original project and its contributors remain credited.
See [LICENSE](LICENSE) for the Apache License, Version 2.0. Third-party components
retain their respective licenses.
