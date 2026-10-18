# 云端重复提交与定时确认（待发布）

2026-10-18 14:25–14:38（北京时间）的只读诊断：jobs 接口两次 HTTP 500，数据库两次 `(user_id, trigger_key)` 唯一冲突；同期也存在成功生成并消费的回复。不能将这次问题归因于图片大小。未重跑任何真实生成任务。

## 单次回复

`push_jobs` 主键为 `id`，另有唯一索引 `(user_id, trigger_key)`。PostgREST 的 `resolution=ignore-duplicates` 默认只处理主键冲突；每次新 UUID 对应相同触发键时，原实现仍报 23505。现在显式设置 `on_conflict=user_id,trigger_key`，随后读取同一任务。已完成、运行中、失败的任务均不替换，不追加模型调用。

回归测试先模拟 PostgREST 的默认主键行为复现失败，再验证 20 个并发提交共享同一个任务和一次付费执行。此前的 mock 错把所有触发键冲突当作已正确忽略，已修正。

## 定时联系

本地 `executeTimedWakeTool` 原先保存本机排期后直接返回成功，异步提交云端且吞掉错误。现在等待一次云端确认，明确区分“云端已确认”和“仅本机定时”。注册失败或应答丢失不自动重试，保留本机定时并说明离线送达不能保证。确认预约仅代表成功入队，不代表模型生成和通知投递必然成功。

仍未解决：普通聊天在 `generateChatCompletionCore` 的单次云端执行入口提前交接，未经过后面的本地工具执行循环；outbox 导入也只解析消息，不能把模型自然语言承诺视作成功执行定时工具。要支持在该路径用聊天创建真实云端定时任务，需要为云端增加受限、可确认、可去重的定时工具执行协议。此次不通过导入历史文本补执行工具，不自动重跑旧任务，不声称该功能已完全修复。

生产环境未发布。网关修复需更新个人 Supabase 的 ai-phone-push；仅发布 Netlify 无法修复正在运行的云端代码。定时提示修复需网页更新。

验证：`node scripts/check-single-reply-executor.cjs`、`node scripts/check-timed-wake-confirmation.cjs`、TypeScript 类型检查。不产生真实模型费用。

参考：https://docs.postgrest.org/en/stable/references/api/tables_views.html#on-conflict
