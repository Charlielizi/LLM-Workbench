# Provider website capability audit — 2026-06-25

Evidence was collected read-only from the live public websites through the
user's Chrome profile. No prompt was sent and no file was uploaded.

| Provider | Authentication | Composer | Attachments | Modes/tools | Model control |
|---|---|---|---|---|---|
| ChatGPT | Authenticated | `#prompt-textarea` | `#composer-plus-btn`; persistent inputs include `#upload-files`, `#upload-photos`, and `#upload-camera` | `深度研究` and `创建图片` are nested under `添加文件等`; `查找资料` can also appear as a composer tool | `[data-testid='model-switcher-dropdown-button']`; the observed free account exposed `ChatGPT` |
| Claude | Not authenticated | Login page only | Not verified | Not verified | Not verified |
| 豆包 | Authenticated | `#input-engine-container textarea[placeholder='发消息...']` | Persistent multiple file input; observed support includes office documents, text/code files, and images | `快速`/`专家` is a menu; `PPT 生成`, `图像生成`, `编程`, and `深入研究` are toolbar or `更多` items | No independent model selector observed in the composer |
| Kimi | Authenticated | `.chat-input-editor[data-lexical-editor='true']` | `.toolkit-trigger-btn` opens the attachment/tool surface; input is created dynamically | Agent is a separate composer switch; research, PPT, documents, websites, sheets, and code also have dedicated routes | `.current-model`; observed options: `K2.6 快速`, `K2.6 思考`, `K2.6 Agent`, and `K2.6 Agent 集群`; options use `.model-item-content` |
| DeepSeek | Authenticated | `textarea[placeholder*='DeepSeek']` | Persistent multiple `input[type=file]` | `深度思考` and `智能搜索` are direct `aria-pressed` toggle controls | No independent selector observed |
| 腾讯元宝 | Not authenticated in Chrome | `.ql-editor` | Login required for full verification; `工具` is the visible tool surface | `深度思考` is a direct control | `[aria-label='模型选择']` |
| 千问 | Public logged-out surface | `[contenteditable='true'][role='textbox']` | `button[aria-label='添加附件']`; public surface exposed `上传图片` | Direct `aria-pressed` controls: `思考`, `研究`, `任务助理`, `PPT创作`, `AI生图`, and `代码` | `div[type='button'][aria-haspopup='dialog'][data-state]`; observed options include `Qwen3.7-千问`, `Qwen3.7-Max`, `Qwen3.5-Flash`, `Qwen3-Max`, `Qwen3-Max-Thinking`, and `Qwen3-Coder` |

## Adapter policy

- Prefer provider-owned stable IDs, `data-testid`, ARIA labels, and state
  attributes.
- Treat thinking models as models when the website models them that way
  (notably Kimi), rather than inventing a separate mode toggle.
- Support nested controls by opening the verified parent menu before resolving
  the requested child item.
- Keep unverified capabilities hidden instead of advertising a fallback that
  may not exist for the current account or website revision.
- Re-run this audit when a provider capability disappears or a selector trips
  the circuit breaker.

## Follow-up live audit (same browser profile)

- Time: 2026-06-25 afternoon local time.
- Browser: the user's logged-in desktop Edge profile over CDP.
- Scope: read-only inspection plus menu opens; no prompt was sent and no file was uploaded.

### Confirmed live findings

- Hunyuan is now authenticated on `https://yuanbao.tencent.com/chat/...`.
- Hunyuan exposes:
  `composer`: `.ql-editor`
  `tool button`: `button[aria-label='工具']`
  `reasoning`: visible `深度思考`
  `model control`: `[aria-label='模型选择']`
- Kimi dynamic controls were confirmed:
  `attachment input`: created after opening `.toolkit-trigger-btn`
  `model options`: `K2.6 快速`, `K2.6 思考`, `K2.6 Agent`, `K2.6 Agent 集群`
- Qianwen model options were confirmed live:
  `Qwen3.7-千问`, `Qwen3.7-Max`, `Qwen3.5-Flash`, `Qwen3-Max`,
  `Qwen3-Max-Thinking`, `Qwen3-Coder`
- Qianwen composer toolbar currently shows `更多`, and the overflow-visible tool
  set includes `AI生图` and `代码`, so adapter support should tolerate both
  direct and `更多`-mediated access.
- Qianwen attachments are a two-step flow on the inspected surface:
  `添加附件` opens a menu with `上传文档` and `上传图片`.
- Hunyuan `工具` is not an attachment picker on the inspected surface; it opened
  a tool menu containing `联网搜索`, `写作`, `编程`, and `解题`.

### Remaining gaps

- Claude is still on the login surface in this browser profile; message, mode,
  model, and attachment controls remain unverified.
- Hunyuan attachment upload is currently unverified and should stay hidden until
  a real file-upload entry is observed.
- Qianwen public surface showed `添加附件`, but this pass did not surface a stable
  file input after opening the control, so attachment upload remains partially verified.
