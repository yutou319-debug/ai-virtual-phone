# 微信入站语音转写（待发布）

腾讯官方协议：https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md

`item_list` 中 `type: 3` 的 `voice_item.text` 可以带有转写文字，但并非每条语音都有。
之前云助手只读取 `type: 1` 的文字，语音一律降级为“暂时听不了”；浏览器接入则忽略语音。

本次云端/本地助手与浏览器接入均读取该可选字段，将转写作为用户内容交给原有回复流程。
同一消息内文字和语音按原顺序拼接，不读取引用消息来假冒当前语音。
云助手保留原有消息 ID 去重和八秒合并窗口，不增加识别 API、下载音频或模型调用。
接口没有转写时仍保留原有降级行为，不保证所有语音均可听懂；独立 ASR 尚未实现。

验证：`node scripts/check-weixin-voice-transcript.cjs`、现有微信合并与提示词回归、TypeScript 检查。
测试仅使用模拟消息，不读取用户语音正文，不发送微信，不调用收费服务。

此分支仅保存代码，不合并 main，不部署 Netlify 或 Supabase。
以后发布时需发布网页并同步微信运行包；没有同步运行包时，应更新云函数内置核心以使用新版逻辑。
