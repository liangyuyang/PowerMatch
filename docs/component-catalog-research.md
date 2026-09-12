# PowerMatch 元器件库起始研究与收录规则

核查日2026-09-12。此清单是设计阶段的选型与资料索引，不是已建成的生产数据库。区分“官方文件已下载”“官方网页/索引可读”“候选待补充”；型号上架、供货、价格、实际适用性需另行校验。原文的本地下载状态和哈希见spec-download-manifest.json。

## 1. 首批电池矩阵

| 分类 | 厂家/型号起点 | 关键参数/差异 | 资料 |
| --- | --- | --- | --- |
| LR41 | Maxell LR41 | 1.5V，25mAh；目录条件20°C、70µA、截止1.2V | B1 |
| LR41 | GP192 | 1.5V，24mAh；按GP目录条件，不与Maxell简单混用 | B2 |
| LR41 | Varta V3GA | GP对照表列出的相当型号；独立厂家Spec待核对 | B2，候选 |
| LR44 | Maxell LR44 | 1.5V，110mAh；目录条件20°C、100µA、截止1.2V | B1 |
| LR44 | GP A76 | 1.5V，110mAh；保留厂家命名 | B2 |
| LR44 | Energizer A76 | 独立放电曲线与条件；不能把所有LR44设同容量 | B3 |
| LR44 | Varta V13GA | GP对照表线索，独立Spec待核对 | B2，候选 |
| CR2032 | Panasonic CR2032 | 默认候选；3V/225mAh，20×3.2mm | B4/B5 |
| CR2032 | Murata CR2032 | 3V/220mAh，标准放电0.2mA，截止2.0V | B6 |
| CR2032高温 | Murata CR2032W | 与标准型独立建模，不只改温度标签 | B7 |
| CR2450 | Panasonic CR2450 | 3V/620mAh，最大24.5×5.0mm | B4/B8 |
| CR2477 | Panasonic CR2477 | 3V/1000mAh，最大24.5×7.7mm | B4/B9 |
| CR2450/CR2477高温 | Murata CR2450W/CR2477W | 候选扩展，单型号Spec与焊脚版本分开 | B7 |
| AA/5号 | Energizer E91 / IEC LR6 | 1.5V碱性，容量由电流和截止条件决定 | B10 |
| AAA/7号 | Energizer E92 / IEC LR03 | 1.5V碱性，放电曲线独立 | B11 |
| AA/AAA扩展 | GP碱性圆柱系列 | 从目录选择具体工业型号；不直接设统一mAh | B2 |
| 可充电纽扣 | Panasonic VL系列 | 单独类别，充电条件独立，不能把CR改成可充电 | B4 |
| NiMH AA/AAA | Panasonic镍氢系列 | 1.2V类别；具体料号/容量/自放电待型号审核 | B4 |
| 小型二次电池 | Nichicon SLB03070LR35 | 可充电小型电池，不归为LIC | B12 |

Panasonic目录可扩展CR1025、CR1216、CR1220、CR1616、CR1620、CR1632、CR2012、CR2016、CR2025、CR2330、CR2354、CR2412、CR3032等尺寸，逐型号抽取，不把系列表当作同一颗电池。常用尺寸优先建立至少两个厂家独立条目；只有相当型号对照表时不冒充已拿到第二厂家的Spec。

LR与SR不是同一化学体系；SR41/SR44不能作为LR41/LR44的完全等同别名。LIR与CR不可仅因尺寸相同而替换。AA/AAA是外形分类，碱性、NiMH和锂化学体系要分开；10440/14500锂离子不能作为普通AAA/AA的无条件替代。实际电压及充电方式由具体型号控制。

电池字段：化学体系、标称/满电/截止电压、Ah/Wh及测试条件、连续/脉冲电流、脉冲时长、内阻/电量/温度曲线、自放电、日历寿命、可充电性、充电条件、尺寸、质量、接点/焊脚、保护和运输/储存信息。串并联组保存每支路与保护配置。

## 2. LIC与超级电容

| 器件 | 分类/容量 | 需要特别保留 | 资料 |
| --- | --- | --- | --- |
| 自定义LIC 1F | 用户要求的默认设计值 | 未匹配真实型号；不继承10F的ESR/漏电；不显示工程通过 | 明示假设 |
| CAP-XX LY13R808014M106R-L | LIC 10F | 2.5–3.8V；DC ESR800mΩ；漏电≤3µA@120h | C1 |
| CAP-XX LY13R808020M256R-L | LIC 25F | 2.5–3.8V，独立ESR/漏电/尺寸 | C1 |
| CAP-XX LY13R808025M306R-L | LIC 30F | 同上；与不同封装30F不是同一条目 | C1 |
| CAP-XX LY13R810016M306R-L | LIC 30F | 不同直径/高度与DC ESR | C1 |
| CAP-XX LY13R810020M506R-L | LIC 50F | 充电时间、体积、自耗与续航联合比较 | C1 |
| CAP-XX LY13R810025M706R-L | LIC 70F | 独立Spec行 | C1 |
| CAP-XX LY13R808014M106R-H | LIC 10F高温变体 | 高温需降额；L/H不能合并 | C1 |
| CAP-XX LY13R86C012M805R-E | LIC 8F | 小型高能量变体；不是1F | C1 |
| CAP-XX GY12R76C012M105R | EDLC 1F | 2.7V，不归LIC | C2 |
| CAP-XX GY12R708012V105R | EDLC 1F | 2.7V；DC ESR250mΩ；漏电≤2µA@72h | C2 |
| CAP-XX GY12R708014V205R | EDLC 2F | 型号独立 | C2 |
| CAP-XX GY12R708025V505R | EDLC 5F | 漏电增大可能抵消容量优势 | C2 |
| CAP-XX GY25R56E14S474RN | 双单体EDLC模块0.47F | 模块额定电压与均衡状态 | C2 |
| CAP-XX GY25R58E16V105RN | EDLC模块1F | 5.5V；无均衡版本，不归LIC | C2 |
| CAP-XX GA230F | 薄型EDLC | 厚度与峰值供电场景 | C3 |
| Eaton KVW-5R0C105-R | 1F后备EDLC | 官方页列30Ω、漏电10µA；不等于低ESR脉冲型 | C4 |

优先保留原厂定义的DC与AC ESR、测量频率、漏电等待时间、最大/典型标记。1F器件漏电若接近整机电流，不可忽略。额定电压/浪涌电压/推荐长期浮充电压分开。LIC最低允许电压不由负载能否亮屏决定。

## 3. 光伏、PMIC与LDO

| 类型 | 厂家/系列 | 当前收录状态与边界 |
| --- | --- | --- |
| 非晶硅室内PV | PowerFilm Indoor Light Series | 官方PDF已下载；按具体模块提取，保留灯光条件 |
| OPV | Epishine LEH3 | 官方索引可读；本机PDF下载403，暂记录来源与待补文件 |
| 钙钛矿 | Saule PPV.IOT系列 | 官方产品目录索引可读；原链接本机404，文件待补，不作为已入库原文 |
| DSSC | Exeger Powerfoyle Indoor/Hybrid | 官方下载入口；独立于OPV/钙钛矿，定制模块需具体尺寸与曲线 |
| DSSC扩展 | GCell | 官方下载入口，具体模块选择后建立记录 |
| 单晶硅 | IXYS/Littelfuse IXOLAR候选 | 待取得所选具体型号原厂Spec；不采用户外STC功率作室内默认 |
| 采能PMIC | e-peas AEM10941 | 官方Spec已下载；MPPT/储能/输出/备用电池约束依原厂建立 |
| 采能PMIC | TI BQ25570 | 官方Spec已下载；不能把各输入功率下效率视为常数 |
| 采能/管理 | Makesense MKS3061/MKS3062/MKS3162 | 官方目录确认三型号；详情动态加载未取得完整Spec，能力与脚号待核验 |
| LDO | TI TPS7A02 1.5V输出版本 | 官方Spec已下载；25nA为典型Iq，需确定订购料号与配套电容 |

PV需记录有效/外形面积、串联单元数、Voc/Isc/Vmpp/Impp、光谱与lux曲线、温度、入射角、封装、遮挡与寿命。Saule目录中的孔径面积与含边框面积应分开；其目录不是所有薄膜PV的统一模型。

PMIC字段含输入/启动范围、冷启动功率与时间、MPPT类型与配置、静态电流、效率图、储能电压窗口、负载输出、备用电池、反向电流、脚号/封装和参考电路。LDO标MPPT无；真正支持MPPT的器件仍需标“本方案是否启用”。

## 4. 配套阻容感与供电附件

初期提供有明确“通用自定义”标识的参数化R/C/L，不伪造厂家料号；进入可导出BOM阶段要求选具体厂商MPN、封装与Spec。

| 类别 | 必须输入的关键参数 |
| --- | --- |
| 分压/采样电阻 | 阻值、容差、温漂、功耗、分压静态损失 |
| MLCC/去耦 | 标称与有效电容、直流偏压、温度、ESR、耐压、封装 |
| 钽/铝电解/薄膜 | 容量、ESR、漏电、纹波、极性、温度与寿命 |
| 功率电感 | 电感值、DCR、饱和/有效电流、频率损失、封装 |
| 二极管/理想二极管 | 正向压降、反漏、额定电压、电流及控制器自耗 |
| 负载开关/电源选择 | 导通阻抗、静态/关断电流、反向阻断、切换行为 |
| UVLO/监控/均衡 | 门限、迟滞、精度、延时、分流/均衡电流 |
| 电池座/连接器 | 接触电阻、极性、防误插、机械尺寸 |
| 显示/MCU/BLE/传感器 | 电压、状态电流、事件时长、启动与接口约束 |

优先从已选PMIC/LDO的参考电路带入配套元件建议，再核验低电流工况；不预置一套阻容值给所有芯片使用。

## 5. 资料索引与图片策略

- B1 [Maxell SR/LR原厂目录](https://biz.maxell.com/en/primary_batteries/SRLR_22e.pdf)
- B2 [GP一次电池目录](https://ind.gpbatteries.com/pub/media/wysiwyg/Primary_Batteries/041023_Primary%2BCatalogue_Final.pdf)
- B3 [Energizer A76](https://data.energizer.com/pdfs/a76.pdf)
- B4 [Panasonic工业电池目录](https://energy.panasonic.com/dam/master/pdf/en/catalog/Catalog_EN.pdf)
- B5 [Panasonic CR2032](https://energy.panasonic.com/dam/master/pdf/en/datasheet/lithium/CR2032_Datasheet_EN.pdf)
- B6 [Murata CR2032](https://www.murata.com/-/media/webrenewal/products/batteries/micro/cr/standard/ds-cr2032-003-je_202307.ashx?cvid=20231214062707000000&la=en-us)
- B7 [Murata高温CR系列](https://www.murata.com/en-eu/products/batteries/micro/overview/lineup/cr/heat-resistant)
- B8 [Panasonic CR2450](https://energy.panasonic.com/dam/master/pdf/en/datasheet/lithium/CR2450_Datasheet_EN.pdf)
- B9 [Panasonic CR2477](https://energy.panasonic.com/na/business/products/lithium/coin-cr-standard/models/CR2477)
- B10 [Energizer E91](https://data.energizer.com/pdfs/e91.pdf)
- B11 [Energizer E92](https://data.energizer.com/pdfs/e92.pdf)
- B12 [Nichicon SLB03070LR35](https://www.nichicon.co.jp/english/_assets/pdf/products/slb/datasheet0307_2505_e.pdf)
- C1 [CAP-XX LIC v1.7](https://cap-xx-assets.s3.eu-west-2.amazonaws.com/CAP_XX_LY_13_R8_LIC_Datasheet_V1_7_b24dfbf553.pdf)
- C2 [CAP-XX GY v4.5](https://cap-xx-assets.s3.eu-west-2.amazonaws.com/CAP_XX_GY_series_Datasheet_V4_5_776c24ea2c.pdf)
- C3 [CAP-XX GA230F](https://cap-xx.com/products/ga230f-cap-xx-dual-cell-supercapacitor)
- C4 [Eaton KVW-5R0C105-R](https://www.eaton.com/us/en-us/skuPage.KVW-5R0C105-R.html)
- P1 [PowerFilm室内光伏](https://www.powerfilmsolar.com/hubfs/documents/spec%20sheets/electronic%20component%20solar%20panels/electronic%20component%20solar%20panels%20spec%20sheet_indoor%20light%20series.pdf)
- P2 [Epishine LEH3](https://kb.epishine.com/wp-content/uploads/2021/08/LEH3-Data-Sheet.pdf)
- P3 [Saule钙钛矿目录](https://sauletech.com/wp-content/uploads/2025/01/Product-Catalog-Saule.pdf)
- P4 [Exeger下载](https://www.exeger.com/powerfoyle/downloads/)
- P5 [GCell下载](https://gcell.com/downloads.html)
- I1 [e-peas AEM10941](https://e-peas.com/documents/AEM10941/DS-AEM10941.pdf)
- I2 [TI BQ25570](https://www.ti.com/lit/ds/symlink/bq25570.pdf)
- I3 [TI TPS7A02](https://www.ti.com/lit/ds/symlink/tps7a02.pdf)
- I4 [Makesense目录](https://www.makesensic.com/ProductInfoCategory?categoryId=1060443&PageInfoId=1879234)

GP/Panasonic目录及厂商产品页提供实物图片/封装图线索；保存独立的图片来源、用途权限和是否为代表性图片。当前已完成两款ZenMeasure产品本体白底素材；未批量下载和授权全部厂商产品图片，资料索引不能声称图库已完成。

CAP-XX旧WordPress下载链接已404，已沿官网当前产品页找到新的S3链接并下载v1.7/v4.5。保留旧链接失败记录与替代关系，正好作为Spec更新审核的真实例子。Epishine403、Saule404及Makesense缺Spec明确进入待补列表。
