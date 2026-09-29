# zhanghaoran.github.io
ForgeOS project

首次访问默认显示英文。导航栏的 `CN / ENG` 按钮显示当前语言，点击后切换；浏览器会记住选择。语言和主题分别保存，原有动画与特效保持不变。

静态内容的英文译文放在 `index.html` 的 `data-i18n-en` 等属性中；动态提示、打字机和终端文案由 `assets/js/i18n.js` 管理。

本机安装 Chrome 和 Node.js 22 或更新版本后，可运行 `node tests/language.cjs` 检查语言切换、窄屏布局、主题兼容、动画和存储降级。Chrome 安装在其他位置时，用 `CHROME_PATH` 指定可执行文件。

内容默认可见，入场效果只在进入视口时播放；脚本加载失败后会自动退出启动遮罩。测试还覆盖锚点跳转、快速滚动、缺少 IntersectionObserver、禁用 JavaScript 和点击区域尺寸。

分享图源文件为 `assets/images/social-card.svg`，发布使用同目录下的 PNG。执行 `node tests/language.cjs --render-social` 可重新生成 1200×630 分享图并运行检查。

独立页面的后续安排见 [页面规划](docs/SITE_PLAN.md)。当前 `sitemap.xml` 仅收录已存在的首页；修改域名时请同步更新 CNAME、canonical、分享地址、结构化数据、robots.txt 和 sitemap.xml。
