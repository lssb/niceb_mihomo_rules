// 全局后置脚本：去 Apple/Microsoft/Adobe 规则、保留流量面板、定制分流、抢票特化、Gemini 地区组智选及静态资源修复
function main(config) {
if (!config.rules) config.rules = [];
if (!config["proxy-groups"]) config["proxy-groups"] = [];
// 1. 连接优化：关闭统一延迟测速、开启 TCP 并行，保留 IPv6
config.ipv6 = true;
config["unified-delay"] = false;
config["tcp-concurrent"] = true;
if (!config.dns) config.dns = {};
config.dns.ipv6 = true;
// 2. ✨ 新增：暴力剔除机场自带的 Apple, Microsoft, Adobe 相关规则
config.rules = config.rules.filter(rule => !/(apple|microsoft|adobe)/i.test(rule));
// 注意：已删除原有的"净化节点 (去流量面板)"模块，现在流量面板节点会全部保留
// 3. 安全清理 & 降敏
const validProxyNames = new Set(config.proxies ? config.proxies.map(p => p.name) : []);
const validGroupNames = new Set(config["proxy-groups"].map(g => g.name));
const allowedNames = new Set([...validProxyNames, ...validGroupNames, "DIRECT", "REJECT", "PASS", "🎯 全球直连", "选择代理", "手动选择"]);
config["proxy-groups"].forEach(group => {
if (group.proxies && Array.isArray(group.proxies)) {
group.proxies = group.proxies.filter(name => allowedNames.has(name));
if (group.proxies.length === 0) group.proxies = ["DIRECT"];
}
// 全局默认 url-test 间隔
if (group.type === "url-test") {
group.interval = 14400;
group.tolerance = 150;
}
});
// 4. 构建定制分组
const safeProxies = names => names.filter(name => allowedNames.has(name)).length > 0 ? names.filter(name => allowedNames.has(name)) : ["DIRECT"];
const targetCustomGoogleGroup = "🤖 谷歌 & Gemini";
// Gemini 只引用地区 url-test 组（排除港/新），每周期约 4 次 gemini.google.com 测速
const geminiRegionPreferred = ["🇺🇸 美国节点", "🇺🇲 美国节点", "🇯🇵 日本节点", "🇨🇳 台湾节点", "🇰🇷 韩国节点", "美国节点", "日本节点", "台湾节点", "韩国节点"];
const geminiRegionGroups = geminiRegionPreferred.filter(name => validGroupNames.has(name));
if (geminiRegionGroups.length === 0) {
geminiRegionGroups.push(...config["proxy-groups"]
.filter(g => g.type === "url-test")
.filter(g => /(美|States|\bUS\b|日|Japan|\bJP\b|台|Tai|\bTW\b|韩|Korea|\bKR\b)/i.test(g.name))
.filter(g => !/(港|HK|Hong|新加坡|SG|Singapore|流媒体|奈飞|Netflix|自动选择|低倍率|Gemini|谷歌|Google|OpenAi|openai)/i.test(g.name))
.map(g => g.name));
}
config["proxy-groups"].unshift(
{
name: targetCustomGoogleGroup,
type: "url-test",
url: "https://gemini.google.com/",
interval: 3600,
tolerance: 150,
proxies: safeProxies(geminiRegionGroups.length > 0 ? geminiRegionGroups : ["DIRECT"])
},
{ name: "🏎️ F1 TV", type: "select", proxies: safeProxies(["低倍率节点", "美国节点", "选择代理", "DIRECT"]) }
);
// 剔除已停用的 🎲 随机漫游 分组及其引用
config["proxy-groups"].forEach(g => {
if (g.proxies && Array.isArray(g.proxies)) g.proxies = g.proxies.filter(p => p !== "🎲 随机漫游");
});
config["proxy-groups"] = config["proxy-groups"].filter(g => g.name !== "🎲 随机漫游");
// 5. 谷歌规则接管
const oldGoogleGroup = config["proxy-groups"].find(g => /google|谷歌/i.test(g.name) && g.name !== targetCustomGoogleGroup);
if (oldGoogleGroup) {
config.rules = config.rules.map(r => {
const p = r.split(',');
if (p.length >= 3 && p[2].trim() === oldGoogleGroup.name) { p[2] = targetCustomGoogleGroup; return p.join(','); }
return r;
});
config["proxy-groups"].forEach(g => {
if (g.proxies && Array.isArray(g.proxies)) g.proxies = g.proxies.map(p => p === oldGoogleGroup.name ? targetCustomGoogleGroup : p);
});
config["proxy-groups"] = config["proxy-groups"].filter(g => g.name !== oldGoogleGroup.name);
}
// 5.5 ✨ 彻底剔除前置脚本生成的 Apple/Microsoft/Adobe 相关分组
const groupsToRemove = config["proxy-groups"].filter(g =>
/^(苹果服务|Apple|微软服务|Microsoft|Adobe)/i.test(g.name)
);
groupsToRemove.forEach(g => {
// 清除规则中对该分组的引用
config.rules = config.rules.map(r => {
const p = r.split(',');
if (p.length >= 3 && p[2].trim() === g.name) { p[2] = "DIRECT"; return p.join(','); }
return r;
});
// 清除其他分组中对该分组的引用
config["proxy-groups"].forEach(other => {
if (other.proxies && Array.isArray(other.proxies)) {
other.proxies = other.proxies.map(p => p === g.name ? "DIRECT" : p);
}
});
});
config["proxy-groups"] = config["proxy-groups"].filter(g => !groupsToRemove.some(r => r.name === g.name));
// 6. ✨ 重建 AI服务 分组：剔除流媒体节点（前置脚本该分组用全量节点池，需要过滤）
const aiServiceGroup = config["proxy-groups"].find(g => g.name === "AI服务");
if (aiServiceGroup && aiServiceGroup.proxies && Array.isArray(aiServiceGroup.proxies)) {
    const noStreamProxies = aiServiceGroup.proxies.filter(name =>
        allowedNames.has(name) && !/流媒体/i.test(name)
    );
    aiServiceGroup.proxies = noStreamProxies.length > 0 ? noStreamProxies : ["DIRECT"];
}
// 7. 专属定制规则并置顶
const customRules = [
// ======== 常见内网/局域网 IP 直连防劫持 ========
"IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", // 本机回环
"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", // A类私有地址
"IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", // B类私有地址
"IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", // C类私有地址
"IP-CIDR,169.254.0.0/16,DIRECT,no-resolve", // 链路本地地址
"IP-CIDR,224.0.0.0/4,DIRECT,no-resolve", // 组播地址
// EasyTier 虚拟组网（10.0.0.0/8 已覆盖虚拟网段，下面为显式标注 + VPS 公网锚点）
"IP-CIDR,10.144.144.0/24,DIRECT,no-resolve",
"IP-CIDR,8.134.112.127/32,DIRECT,no-resolve",
// ZeroTier  overlay（与 EasyTier 局域网 peer 配合）
"IP-CIDR,192.168.193.0/24,DIRECT,no-resolve",
"PROCESS-NAME,easytier-core,DIRECT",
"PROCESS-NAME,easytier-cli,DIRECT",
// ====================================================
// Tailscale / CGNAT 直连
"IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
"DOMAIN-SUFFIX,ts.net,DIRECT",
"DOMAIN-SUFFIX,tailscale.com,DIRECT",
"DOMAIN-SUFFIX,tailscale.io,DIRECT",
"PROCESS-NAME,tailscaled,DIRECT",
"PROCESS-NAME,Tailscale,DIRECT",
// .local 域名直连（局域网设备 discovery、服务注册）
"DOMAIN-SUFFIX,.local,DIRECT",
// 校园网/南方医科大学直连
"DOMAIN-SUFFIX,smu.edu.cn,DIRECT",
// F1 TV 分流
"DOMAIN-SUFFIX,f1tv.formula1.com,🏎️ F1 TV",
"DOMAIN-SUFFIX,formula1.com,🏎️ F1 TV",
"DOMAIN-KEYWORD,f1tv,🏎️ F1 TV",
"DOMAIN-KEYWORD,formula1,🏎️ F1 TV",
// ======== ✨ Gemini & Google 核心/静态资源防分裂 ========
"DOMAIN-SUFFIX,gemini.google.com," + targetCustomGoogleGroup,
"DOMAIN-SUFFIX,bard.google.com," + targetCustomGoogleGroup,
"DOMAIN-SUFFIX,generativeai.google," + targetCustomGoogleGroup,
"DOMAIN-SUFFIX,aistudio.google.com," + targetCustomGoogleGroup,
"DOMAIN-KEYWORD,gemini," + targetCustomGoogleGroup,
"DOMAIN-SUFFIX,googleusercontent.com," + targetCustomGoogleGroup, // 包含 lh3 头像及媒体托管
"DOMAIN-SUFFIX,gstatic.com," + targetCustomGoogleGroup, // Google 基础静态资源
"DOMAIN-SUFFIX,googleapis.com," + targetCustomGoogleGroup // Google 核心 API 调用
];
config.rules = [...customRules, ...config.rules];
// TUN 旁路：局域网 + EasyTier / VPS / ZeroTier，避免 TUN 劫持导致局域网代理 SYN_RCVD
if (config.tun) {
const exKey = config.tun["route-exclude-address"] ? "route-exclude-address" : (config.tun.routeExcludeAddress ? "routeExcludeAddress" : "route-exclude-address");
if (!Array.isArray(config.tun[exKey])) config.tun[exKey] = [];
[
"192.168.0.0/16",
"10.0.0.0/8",
"172.16.0.0/12",
"127.0.0.0/8",
"10.144.144.0/24",
"8.134.112.127/32",
"192.168.193.0/24"
].forEach(cidr => {
if (!config.tun[exKey].includes(cidr)) config.tun[exKey].push(cidr);
});
}
// DNS fake-ip：私有网段不走 fake-ip，避免 NAS 等局域网 IP 被映射进 TUN
if (config.dns) {
const filterKey = config.dns["fake-ip-filter"] ? "fake-ip-filter" : (config.dns.fakeIpFilter ? "fakeIpFilter" : "fake-ip-filter");
if (!Array.isArray(config.dns[filterKey])) config.dns[filterKey] = [];
["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"].forEach(cidr => {
if (!config.dns[filterKey].includes(cidr)) config.dns[filterKey].push(cidr);
});
}
return config;
}
