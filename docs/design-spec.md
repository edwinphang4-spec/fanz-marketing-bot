# Fanz 设计规范(完整版,从 14 张真实 reference 提炼,2026-07-13,待 Edwin 确认)

> 用途:驱动合成管线的确定性排版(logo/文字/icon/badge 位置)+ 背景生成的风格约束。
> 每张 reference 上传 brand_assets 时必须打 tag(见 §5),出图时按帖子类型选对应模板。

## 1. Logo 系统(三个版本 × 三种位置 × 明暗规则)
| 版本 | 长相 | 用在 |
|---|---|---|
| 纯字标(白) | 小写 "fanz" 白色 | 深色/图形背景(product_intro、promo、festival_illustration、feature_explainer) |
| 纯字标(蓝) | 小写 "fanz" 品牌蓝 | 浅色实景(lifestyle、festival_lifestyle、brand_trust) |
| 完整 lockup | 黑色花朵 icon + fanz + "THE AIR MOVER" | 浅色实景的右上角(高端 lifestyle、mood_minimal) |

位置:默认**左上角**;lockup 惯用**右上角**;festival_illustration **顶部居中**(白);
feature_explainer **底部居中**(白);educational 底部深蓝波浪内居中。
高度约画布 5-6%。

## 2. 色彩系统
- **品牌蓝** #3B5999(标题/logo/icon 图形/色块)
- **深蓝渐变** 深海军蓝系(product_intro 背景、educational 页脚波浪)
- **亮蓝** 更饱和的 royal blue(promotion 背景、CNY 背景)
- **白** 深底上的文字/图标底
- **深绿**(仅 educational 标题和叶饰)
- **金/黄**:promo 的 badge 和金币;festival 的标题(CNY 金黄)
- 节庆配色跟节日走(CNY 红金、中秋红橙灯笼),不锁品牌蓝

## 3. 字体系统
| 字体声音 | 样式 | 用在 |
|---|---|---|
| 主力粗黑体 | 几何无衬线 ExtraBold,全大写,最多两行 | 各类主标题 |
| 优雅衬线 | 大写、字距宽(BREEZE IN STYLE) | 高端 lifestyle 的情绪标题 |
| 手写体 | 蓝色 script(Happy Mother's Day) | festival_lifestyle 的温度点缀 |
| 中文书法 | 白色毛笔字,可带线框 | festival_illustration 中文主标 |
| 休闲 display | 圆润/趣味(CNY 黄字) | 插画节庆的英文标题 |
- 标题颜色铁律:**深底=白,浅底=品牌蓝**(educational 例外用深绿)。

## 4. 通用组件库(合成管线的确定性元素)
- **规格行**:颜色圆点(白/黑/木色)+ 长破折号 + 尺寸("56 inch"),标题旁
- **型号 callout**:虚线或细实线 + 型号名(如 "FS 423 L"),从产品引出
- **AVAILABLE OPTIONS 卡**:白底圆角条,3 个颜色缩略图 + 标签
- **icon 方块**:白色圆角方块 + 品牌蓝线条图形 + 底部短标签;已收录:Energy Saving / ABS Blade / Sleep Mode / Forward & Reverse / 7 Speed / Stylish Design / Whisper Quiet Level / 120° Oscillon / Dual Mounting
- **促销 badge**:金色圆形("Buy 2 Get RM50 Off")左下
- **保修盾牌**:蓝渐变盾 + "10 YEARS WARRANTY"
- **日期胶囊**:白/蓝分段圆角条("FROM | 10 - 13 OCT")
- **Quick Guide 行条**:icon 色块 + 名称 + 数值,叠层圆角条
- **毛玻璃面板**:半透白圆角大板,承载 icon+标题+正文(feature_explainer)
- **手机 mockup**:右侧,展示 app UI(smart 系列)

## 5. 九个模板 tag
### product_intro(产品介绍·图形底)
深蓝渐变 + 抽象波浪/蓝光弧;产品大图吊顶垂下;白色大写标题左下;规格行;底部 3-5 个 icon 方块。logo 白,左上。
### lifestyle(生活实景)
明亮真实室内(马来现代/北欧,自然光),风扇合成天花板;标题品牌蓝(粗黑体)或白色衬线(高端向);可带型号 callout、AVAILABLE OPTIONS 卡。logo 蓝左上,或黑 lockup 右上。
### promotion(促销)
亮蓝渐变 + 放射线 + 金币彩带;居中大标题(白+蓝描边数字);日期胶囊;产品 1-2 台斜角;金色 badge 左下;规格行右侧。logo 白左上。
### festival_illustration(节庆·插画)
全幅节日插画(不放产品);logo 白顶部居中;中文书法或休闲 display 标题居中;英文副标 + 一句祝语;配色跟节日。
### festival_lifestyle(节庆·实景带货)
明亮人物/家庭实景;蓝色粗体标题 + **手写体节日名**;产品合成顶部 + 型号 callout。logo 蓝左上。
### educational(科普信息图)
米色底;深绿大写主标 + 叶饰;双场景对比图 + 圆角角标;Quick Guide 表格条;底部深蓝波浪 + 居中 logo。信息密度最高的一类。
### feature_explainer(功能讲解·smart 系列)
虚化实景底 + 毛玻璃大板;白线条 icon + 白粗体标题 + 小字说明居左;手机 UI mockup 居右;logo 白底部居中。
### brand_trust(品牌信任)
浅灰净底;真实产品特写(非渲染);保修盾牌 badge;渐变蓝粗体标题底部。logo 蓝左上。
### mood_minimal(纯氛围)
整幅生活实景,零标题零文案;仅黑 lockup 右上(可加一枚小星标)。克制即高级。

## 6. Tag ↔ 帖子类型映射(Mark 选模板用)
| pillar | 默认 tag | 备选 |
|---|---|---|
| product | product_intro | lifestyle(第二次介绍同款时换) |
| case | lifestyle | mood_minimal |
| educational | educational | feature_explainer(讲 app 功能时) |
| story | festival_illustration / festival_lifestyle(节庆) | brand_trust(品牌故事) |
| promo | promotion | — |

## 7. 落地说明
- **确定性合成**(compose):logo 版本+位置、标题字体/颜色/位置、规格行、callout、icon 方块、badge——全按本 spec 写死成模板参数,不交给 AI。
- **AI 只画背景**:按 tag 给背景 prompt 加约束(product_intro=深蓝抽象波浪;lifestyle=明亮马来现代室内;promotion=亮蓝放射;educational=米色净底…),再叠加同 tag reference 的视觉摘要。
- **产品图**:必须真透明抠图;没有就不上产品层(已实现,杀白卡)。
- 待确认:正式字体文件(现用系统安全字体降级)、花朵 lockup 的透明 PNG、icon 库源文件。
