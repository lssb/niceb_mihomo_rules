# niceb_mihomo_rules

Sub-Store 部署在 Render，镜像为 xream/sub-store:latest，域名为 sub.asin.fun。

Render 镜像服务不会随 latest 自动更新。可通过 Settings 中的 Deploy Hook 触发部署，也可用 GitHub Actions 定时检查镜像变化后调用该 Hook。重新部署前需确保订阅数据可自动恢复。
