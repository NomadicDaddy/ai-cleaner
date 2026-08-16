- \[ ] --older-than 30d
- \[ ] target specific agent(s)
- \[ ] support cleaning: {HOME}\\.agent-browser

## Buzz preset

- [ ] Add an aggressive Buzz cleanup preset that runs only while Buzz is closed.
      [Buzz repository](https://github.com/block/buzz)
    - Target managed-agent logs in `%APPDATA%\xyz.block.buzz.app\agents\logs` and the managed npm
      cache in `%APPDATA%\Buzz\node-tools\cache`.
    - Target WebView caches under `%LOCALAPPDATA%\xyz.block.buzz.app\EBWebView`, including `Cache`,
      `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `GrShaderCache`, and
      `ShaderCache`.
    - Target crash reports in `%LOCALAPPDATA%\xyz.block.buzz.app\EBWebView\Crashpad\reports`.
    - Preserve managed-agent definitions such as `managed-agents.json`,
      `global-agent-config.json`, and `teams.json`; retention databases; archive history; models;
      skills; credentials; WebView local storage, network data, sessions, and login data; and every
      user work product under `~/.buzz`.

## Clairvoyance AI preset

- [ ] Add fixture-gated Clairvoyance cleanup only after inspecting a real installation.
      [Clairvoyance documentation](https://www.clairvoyanceai.com/docs)
    - Preserve every workspace `.clairvoyance` directory.
    - Target only confirmed application logs, caches, and crash reports. Do not infer disposable
      paths from product names or remove skills, MCP configuration, credentials, Staff settings, or
      workspace metadata.
