# PowerMatch 设计交接

更新时间：2026-09-12（北京时间）。实际设备：Home PC / HomePC。

## 项目与边界

- 项目：PowerMatch；工作目录：D:\Data\GitHub\PowerMatch。
- 用户明确本轮先讨论、系统设计和UI设计，不编写应用或部署。
- 本地尚无Git工作副本。公开远端：https://github.com/liangyuyang/PowerMatch；本轮只读核查main只有README，提交8eaf609ab02ffc6576602f423c62f35abae02172。无本轮提交或推送。
- 计划域名powermatch.zenmeasure.space；前后端使用Cloudflare。未创建DNS、Worker、D1、R2、认证配置或邮件服务，未发生生产部署。

## 已完成

- docs/system-ui-design.md为当前完整设计；system-ui-design-v2.md为同内容版本副本；首轮文档存档在docs/archive/。
- docs/component-catalog-research.md整理常用电池、LIC、EDLC、PV、PMIC、LDO及配套器件的候选、关键参数、来源和缺项。
- docs/spec-download-manifest.json记录15份元器件原厂PDF的下载、页数和SHA-256，另有1份Otii竞品手册；已下载不等于逐字段工程审核。
- 原厂PDF本地目录：C:\Users\liang\.codex\visualizations\2026\09\12\01a09428-474e-7002-8186-776bdd9e9e29\research。文件未发布到公开仓库。
- docs/assets/brand/保留原版三Logo；specs/保留两份原始整机彩页；products/完成Tiny去线本体和MHO-C404正确黑色外观的白底图。
- docs/ui-concepts/v2-workbench.png、v2-comparison.png、v2-admin.png为新版静态视觉稿；README解释示意参数和状态边界。
- output/pdf/PowerMatch-system-ui-design.pdf：25页带ZenMeasure原版Logo的完整设计PDF，含正文、元器件研究与三张大幅UI附页；支持可搜索文字、目录和来源链接。

## 已确认决策

- 同时保留首轮界面1和3：主演算台＋方案对比，共享项目、方案、修订和计算数据；不再要求二选一。
- 首版简中、英、日、韩、西、法、德；首次按浏览器/设备偏好自动选择，支持手动切换与记忆，提供跟随浏览器选项。手动偏好优先，登录后可账户同步；切语言不改电气参数/单位/时区。
- 大厅示例“穿山甲Tiny”，产品型号ZenMeasure MOT-U125。用户所说11+µA是团队经验感觉，时序按9s/3µA加1.2s/90µA计算得到13.2353µA，两者分开保存。
- “老米3”替换为“秒秒测微光能温湿度计”，型号MHO-C404；正式外观使用新彩页黑色产品，不使用早前白色照片冒充。
- MOT-U125彩页v2.1/2026-06-16：LR41×2、可更换、最长8个月、LCD。彩页没有说明两颗电池连接关系。
- MHO-C404彩页v1.1/2026-09-07：薄膜光伏＋电容储能＋电子墨水屏，广播间隔随余电变化，整机DC3V。不能从中推断PV具体材料、LIC容量或裸屏驱动电压。
- 三层持久空间、公司域名、Magic Link、员工官方Spec维护、外部贡献但不能覆盖官方、唯一Admin patrick@miaomiaoce.com、论坛与版本讨论均保留。
- 作者公开名取邮箱@前内容，首字符可大写则大写；不公开完整邮箱。点击留言触发应用邮件通知，保护双方地址。
- CR2032为通用电池默认；LIC容量默认1F，真实型号待匹配。办公室复合照明、260lux、5天×10小时、法线夹角0°。
- 导出PDF带Logo，最终规划引脚级原理图和BOM；当前视觉连接图仅为系统框图。

## 研究结论与设计建议

- 2026-09-12官方价格：Cloudflare任意收件人发信需Workers Paid，最低$5/月含3000封，超出$0.35/千封；Resend Free每月3000且每日100，Pro $20/月含50000，超出$0.90/千封。Free/Pro域名数当前3/10；CF Email Sending仍Beta。
- 全Cloudflare生产优先评估Cloudflare邮件；严格零月费初期可Resend。供应商切换层和内部App用量归因属于设计建议；本账户开通和真实送达均未验证。
- 默认日程具体化为周一至周五09:00–19:00是可编辑建议，对应50小时光/118小时暗/最长62小时无光，不是储能续航。
- 1F若假设3.8–2.5V，Tiny时序负载在1.5V下，理想转换约57.3小时，理想LDO约27.3小时；未计漏电等，不能承诺跨62小时周末。
- 真实CAP-XX LIC已查10F及以上/8F型号与原厂Spec；不能把EDLC标为LIC或把10F漏电/ESR线性缩为1F。
- 图片经生成式编辑，白色背景非透明；作为显示素材，不作尺寸或光学仿真证据。AI画面品牌在正式实现中应替换为原版Logo。

## 检查与限制

- 两份整机彩页已读取、收录；新图使用正确产品来源，Tiny外露线已去除。
- 已检查15份元器件PDF可解析，记录哈希及下载失败状态；Otii官方手册第106页对比截图已查看。
- 设计PDF已渲染检查25页，矢量字体最小10pt、无文字越界、无空白正文页；µ、平方及减号使用补充字体。104个链接中54个目录定位、50个来源URL，目标有效。
- 新版三张UI已视觉审阅。没有真实网页交互、登录、发信、仿真、论坛、EDA/ERC或设备续航验收。
- Makesense官方目录已确认MKS3061、MKS3062、MKS3162；完整Spec未取得，不再写“厂商官网未确认”。Epishine PDF下载403，Saule原链接404，均保留待补。
- Tiny仍缺内部芯片电气Spec、LR41连接关系、150lux的PV/面积/光谱/角度测试条件。
- MHO-C404仍缺实际PV、储能、裸屏、PMIC和工作/广播策略资料；两份整机彩页已收到，不再重复索要彩页。
- 1F LIC仍缺可核验的具体原厂型号。厂商图片未批量收齐；当前是起始目录研究，不是完整生产元器件数据库。
- Obsidian开始时有其他项目未提交改动，缓存ahead23/behind11。本轮仅更新PowerMatch交接，不合并、重置、暂存或推送其他内容；跨设备同步未完成。

## 下一步

继续围绕已选双界面讨论交互和参数完整性；优先补足Tiny供电约束及一套真实PV/储能数据，确定可复算验收基准。只有用户进入实施阶段后，才安全接入远端工作副本并建立PowerMatch上下文检查，再实现计算、权限及UI。

本次无新增独立于本项目的跨项目长期规则，不改Z0_长久记忆。此页与项目根HANDOFF.md、Obsidian PowerMatch交接页保持本次内容一致。
