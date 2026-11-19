# niceb_mihomo_rules

Sub-Store 部署在 Render，镜像为 `xream/sub-store:latest`，域名为 `sub.asin.fun`。

## 镜像更新

GitHub Actions 每天北京时间 09:23 检查镜像摘要，也可在 Actions → Check Sub-Store image → Run workflow 手动执行。首次运行记录基线，之后比较镜像变化，结果在运行摘要中。缓存被清理后会重新建立基线。

Render 不会跟随 latest 自动部署。要启用自动部署，先完成订阅数据持久化或启动自动恢复并验证，再设置仓库 Actions secret `RENDER_DEPLOY_HOOK`（Render Settings → Deploy Hook），以及 Actions variable `SUBSTORE_AUTO_RESTORE_READY=true`。检测到新镜像后，工作流调用 Hook 部署对应摘要。部署是否成功需在 Render 查看。公开仓库的定时任务可能因长期无活动被 GitHub 暂停。

Render 免费实例的本地数据在重新部署或重启后可能丢失。订阅完整备份含访问凭据，应保存在私有存储中。当前没有配置自动恢复，自动部署开关保持关闭。
