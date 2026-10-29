# 角色参考图板式（红果图面 · 四视图人设图 / 正视图立绘 / 脸部放大三视图）

> 归属技能：asset（资产锁定）。本文件是角色参考图最终提示词的**逐字固定骨架**权威细则。
> 图面纪律：
> - 默认（所有角色）→ **正视图立绘**（竖版 9:16 单格全身正面，不做多视图）——**按 `fourview-sheet/` 同套 3D CG 规范生成**：纯白色背景、无灯光 + 底部「FRONT」标签与顶部标题（见 §四）。
> - 勾选「四视图」（`sheet_mode=four-view`）→ **四视图人设图**（竖版 9:16 2×2 不等大：左上正脸特写 / 右上侧脸特写 / 左下脖子以下正面无脸 / 右下背面含后脑勺）——**按 `fourview-sheet/` 3D CG 规范生成**：纯白色背景、无灯光 + 允许四格面板标签与顶部标题 + 英文正文（见 §三）。
> - 勾选「脸部放大-三视图」开关（`sheet_mode=face-three-view`，不限功能位）→ **脸部放大三视图**（横版 16:9，左 1/3 面部特写 + 右 2/3 三视图 Front/Profile/Back）
> - **正视图立绘 / 四视图人设图** 由工具自动拼装同套 3D CG 母版（无需手写）；**脸部放大三视图** 手写正文：纯白色背景、无灯光、**画面内不出现任何文字、标签、标题、水印、签名**。
> - 音色（`voice_description`）**不进图**，以纯文本字段交付（见 §七）。

## 一、总则：角色参考板是形象锚点

生成的是一张角色设定参考图（character reference sheet），**板式按 `sheet_mode` 区分（默认正视图）**，它是后续所有角色图片、视频参考的**形象锚点**：

- **默认（所有角色）→ 正视图立绘**（单张全身正面，不做多视图，竖版 9:16）。
- **勾选「四视图」**（`sheet_mode === 'four-view'`）→ **四视图人设图**（竖版 9:16 2×2 不等大）。
- **勾选「脸部放大-三视图」开关**（`sheet_mode === 'face-three-view'`，不限功能位）→ **脸部放大三视图**（横版 16:9）。

**核心原则：一致性 > 美观，视图数量不是角色身份的一部分。** 视图按「最少但足够比较」选——默认一张正视图即可；需要锁多角度身份时勾选四视图；勾选脸部放大三视图则一律用脸部放大三视图。图必须中性、清晰、可复用——不追求单张图的艺术感。

**背景与灯光**：**正视图立绘 / 四视图人设图 / 脸部放大三视图**一律为**纯白色背景、无灯光（不打光）**；正视图/四视图允许底部「FRONT」标签/四格面板标签与顶部标题（3D CG 参考板，见 §三/§四），脸部放大三视图画面内不出现任何文字、标签、标题、水印、签名。

## 二、识别锚点落地（硬约束）

角色的 `appearance`（样貌）与 `styling`（妆造）里最有辨识度的特征（疤、痣、眼型、缺指、发色、体态等）必须逐条落进正文：

- **逐条落进正文**（它正是「最有辨识度的特征」）：窄长眼、左眉尾旧疤、肩背略绷这类具体事实**不得漏、不得改写**；
- **不得新增字段里没有的外形**（不改瞳色、不改体型、不发明配饰）；性格只以神态/气质体现；
- 项目视觉风格（`drama.visual_style`）不得覆盖角色真实年龄、体态、肤质、服装与永久特征——**身份优先、模板让位**。

## 三、四视图人设图（`sheet_mode=four-view`）——按 `fourview-sheet/` 3D CG 规范

**四视图人设图不再用本文件旧骨架**，改按 `references/asset/fourview-sheet/` 的英文母版逐槽生成（3D CG 人设参考板，可投 3D CG 生图模型）。

**关键差异（正视图/四视图 vs 脸部三视图的红果图面纪律）**：

| 维度 | 正视图立绘 / 四视图人设图（fourview-sheet） | 脸部放大三视图（红果） |
|---|---|---|
| 画幅 | 竖版 9:16 | 横版 16:9 |
| 背景 | 纯白色 | 纯白色 |
| 灯光 | 无（不打光） | 无（不打光） |
| 文字 | 允许底部「FRONT」/四格面板标签 + 顶部标题 | 画面内零文字 |
| 风格 | 项目视觉风格（3D CG 动画，正文自带） | 项目视觉风格（默认 3DCG） |
| 正文语言 | 英文（中文只允许作品名/专有名词白名单） | 会话语言 |

**必读文件（写四视图前先读全，缺一不可）**：

1. `references/asset/fourview-sheet/SKILL.md` —— 十条铁律 + 五步工作流
2. `references/asset/fourview-sheet/assets/template.txt` —— 英文母版（逐槽 `{{SLOT}}` 替换，骨架一字不改）
3. `references/asset/fourview-sheet/references/prompt-template.md` —— 槽位速查 + 六条不可变铁律
4. `references/asset/fourview-sheet/references/field-spec.md` —— 每个槽位写什么/不写什么 + 五组负向词库 + 跨题材换批次
5. `references/asset/fourview-sheet/references/consistency-matrix.md` —— 同批差异化矩阵（出组图时必读）
6. `references/asset/fourview-sheet/assets/card.modern.example.json` + `shared.modern.example.json` —— 现代题材填槽范例（**本项目为现代都市题材，参考这一套**）；古装/奇幻/沙漠题材才参考 `card.example.json` + `shared.example.json`

**槽位来源映射（从 `read_characters` 字段落槽，不得新造疤痕/异色瞳/纹身/年龄）**：

- `appearance` → `HAIR_DESC` / `BEARD_DESC` / `SCARS_DESC` / `AGE_RANGE` / `AGE_DESC` / `BUILD_DESC` / `ETHNICITY_BLOCK`（骨相与永久特征）
- `styling` → `HEADWEAR_DESC` / `UPPER_BODY_DESC` / `LOWER_BODY_DESC` / `FOOTWEAR_DESC` / `SIG1_DESC` / `SIG2_DESC` / `COLOR_PALETTE`
- `role` → `ROLE_SENTENCE`（角色定位一句话）
- `description` 里的**音色/口音/语域/说话方式不进图**；只取可外化的神态/气质 → `TEMPERAMENT` / `GAZE_DESC`
- `asset_code`（图N）**只写进文档标题与《素材接线单》，正文不出现「图N」**（正文混「图N」会诱导模型渲染编号文字）

**现代都市题材三条特别纪律**（详见 field-spec.md §六.2）：

1. 武器槽写「无武器」：`PRIMARY_WEAPON` 写「不是武器，是磨损的手机/工具」，`SIDEARM_WEAPON` 写「None. No blade, no firearm, no weapon of any kind」。
2. 「精明世故/痞气」等气质落到生理细节 + 非对称表情锚（`warm on the surface and calculating underneath`），禁「反派阴沉脸 / 憨厚笑面」。
3. 阶层识别靠磨损不靠品牌：写 `NOT luxury-brand, NOT business suit, NOT new, NOT fashion-editorial`。

**保存**：调用 `save_character_final_prompt` 时 `skip_style_prefix` 传 `true`（四视图正文自带 3D CG 风格段，工具不拼接项目 3DCG 风格）；`prompt` 参数放**纯英文母版正文**。

## 四、逐字固定骨架 —— 正视图立绘（默认，硬约束）

默认角色**不写四视图骨架**，改用下面的单视图骨架（与四视图同套规范：纯白色背景、无灯光 + 底部「FRONT」标签与顶部标题）；同样**逐字按骨架组织，仅替换 `〈…〉` 槽位**，不得改回四视图、不得加侧面/背面分格。正文由工具自动拼装（`save_character_final_prompt` 忽略手写正文）。

```text
一张角色设计参考图（单视图立绘）。竖版 9:16 比例。最高分辨率输出。纯白色背景，无灯光、不打光。

【构图】单人全身正视图：〈角色名〉正对相机，从头到脚全身入镜，A-pose 站姿，双脚与肩同宽、重心稳定；面部完全可见、双眼完好。

【主体】角色核心：〈年龄区间〉，〈体型与比例，含负向边界〉。面部与永久特征：〈面部结构、眉眼鼻唇相对特征、痣/疤/旧伤等永久锚点〉。发型与发色：〈发型、发色、长度、整理方式〉。上半身：〈上装单品与穿法、领口/袖口、材质与主次色〉。下半身与鞋：〈下装、鞋，材质与主次色〉。配饰与装备：〈如有，注明佩戴位置、相对尺度；不把剧情手持道具写成身份锚点〉。

【色彩调色板】〈主次色与材质清洁/风化程度；现代题材默认干净〉。

【姿势】A-pose 站姿，双脚与肩同宽、重心稳定；〈角色常态气质，不含攻击性、诱惑、可爱/卖俏姿势〉。

【风格】〈项目视觉风格：取 `drama.visual_style` 的中文名与描述；未提供时用「精致国漫美型 3DCG 角色设计渲染」，细节同四视图骨架【风格】段〉。

【质量】最高分辨率输出，干净锐利边缘，每个结构、发束与材质细节清晰定义；无噪声、无颗粒、无杂乱元素。

【面板标签】人物下方小号黑色等宽无衬线字体「FRONT」；画布顶部居中标题（小号黑色无衬线字体）「〈角色名大写〉 — CHARACTER DESIGN SHEET」。

【约束】不是四视图/多视图（仅单一正视图）、不是侧面/背面/无脸分格、不是 1:1 方形（必须竖版 9:16）、不是彩色/渐变背景（仅纯白色）、无任何灯光/打光、除「FRONT」标签与顶部标题外无任何文字。
```

## 五、逐字固定骨架 —— 脸部放大三视图（开关开启，硬约束）

`sheet_mode === 'face-three-view'` 时**无论角色功能位**都用本骨架（替代四视图 / 正视图骨架）。同样**逐字按骨架组织，仅替换 `〈…〉` 槽位**。

```text
一张角色设计参考图（脸部放大三视图）。横版 16:9 比例。最高分辨率输出。纯白色背景，无灯光、不打光。

【布局】左侧 1/3 区域为超大高清面部特写，正对镜头，完整头部与发型入镜、面部完全可见不被遮挡；右侧 2/3 区域整齐排布角色三张全身三视图——正面(Front)、侧面(Profile)、背面(Back)三个维度的全身站姿视图。背景为纯白色背景。视觉对齐：所有角度的比例必须严格一致，确保角色身高、五官位置、服装褶皱在不同视角下完美契合。

【主体——面部特写与三张三视图为同一角色】〈角色定位一句话〉。角色核心：〈年龄区间〉，〈体型与比例，含负向边界〉。面部与永久特征：〈面部结构、眉眼鼻唇相对特征、痣/疤/旧伤等永久锚点〉。发型与发色：〈发型、发色、长度、整理方式，及后侧/侧视可辨要点〉。头部装备/头饰：〈如有；现代题材通常写"无"〉。上半身：〈上装单品与穿法、领口/袖口、材质与主次色〉。下半身与鞋：〈下装、鞋，材质与主次色〉。配饰与装备：〈佩饰、徽章、包袋等，注明佩戴位置、相对尺度；不把剧情手持道具写成身份锚点〉。

【色彩调色板】〈主次色与材质清洁/风化程度；现代题材默认干净，不写"战损覆尘"〉。

【姿势——三张全身三视图一致】A-pose 站姿，双脚与肩同宽、重心稳定、双手自然垂落；〈角色常态气质，不含攻击性、诱惑、可爱/卖俏姿势〉。

【关键一致性】左侧面部特写与右侧三张三视图为同一角色——相同面部结构、相同发型发色、相同服装、相同配饰与数量、相同材质配色；所有视图共用纯白色背景。

【风格】〈项目视觉风格：取 `drama.visual_style` 的中文名与描述；未提供时用「精致国漫美型 3DCG 角色设计渲染」，细节同四视图骨架【风格】段〉。

【质量】最高分辨率输出，干净锐利边缘，每个结构、配饰、发束与材质细节清晰定义；无噪声、无颗粒、无杂乱元素。

【负面提示词】--no photograph, live-action, real human, cosplay, internet celebrity face, revealing outfit, erotic pose, heavy coarse fabric, studio lighting

【约束】不是 2x2 四宫格、不是等大分格（左侧 1/3 面部特写 + 右侧 2/3 三视图）、三张全身三视图必须完整含 Front/Profile/Back、面部特写正对镜头且面部不被遮挡、不是彩色背景（仅纯白色）、无任何灯光/打光、画面内不出现任何文字、标签、标题、水印、签名。
```

## 六、槽位填充规则（从 `appearance` / `styling` 落地）

按此顺序把 `appearance`（样貌）与 `styling`（妆造）的每个关键元素填进骨架槽位，不遗漏：

1. **辨识特征**（疤、痣、眼型、缺指…）→ 写进【主体】的「面部与永久特征」，并在面部特写/正视分格以可见方式带出
2. **身份锚点**（年龄感、性别感、体态）→ 「角色核心」+「面部与永久特征」
3. **五官**（脸型、眼睛、显著特征）→ 「面部与永久特征」
4. **发型**（颜色、长度、样式 + 后侧/侧视要点）→ 「发型与发色」+ 各分格
5. **服装**（款式、颜色、材质、状态）→ 「上半身」「下半身与鞋」「配饰与装备」
6. **配饰** → 只写有辨识度的，注明佩戴位置与相对尺度，不堆砌

性格特点转化为外在气质与神态（如「憔悴」→「眼神疲惫、肩膀微垮」），不直接出现性格词汇。

## 七、音色（voice_description）——不进图，纯文本交付

声音提示词**不进入角色参考图**（红果图面零文字）。每个角色的音色以 `voice_description` 字段**独立交付**，遵循 manju-laoli-skill 的口径（https://github.com/lixiaoxiao9888-create/manju-laoli-skill）：**根据剧本生成每个角色的音色**。

- 用**英文 2-4 句**撰写，覆盖：音色特质（pitch/timbre）、语速与语调变化、情绪层次、适用场景（short drama dubbing）。
- **逐角色推导、不得照抄示例**——示例只是「音色该怎么写」的**样式范本**，不是要硬编码的值。

样式范本（urban-antihero / 都市反英雄，仅示范写法，勿照抄）：

> A male voice, low-mid register with a persistent husky roughness, as if from years of smoking and sleep deprivation. Speech is slow with sentence endings that drop downward, giving a withdrawn quality. Emotional intensity shows as pitch compression rather than volume, so the angrier he gets the quieter he sounds. The single exception is a brief sharp shout before he regains control. Ideal for short drama urban-antihero dubbing.

- `voice_description` 由 `save_dedup_characters`（提取阶段）与 `save_character_final_prompt`（可再回填）落库；**不写进 `save_character_final_prompt` 的 `prompt` 正文**。

## 八、禁止事项

- 动态姿势、夸张表情、手持道具、与他人同框；含攻击性/诱惑/可爱的卖俏姿势
- 裁切身体（全身视图必须 full body；四视图左下格按规定把人脸裁出画面上缘，但躯干到脚完整入镜）
- 文字、标签、水印、签名——**正视图立绘 / 脸部放大三视图** 不得出现；**四视图人设图例外**（仅允许四格面板标签 FRONT FACE / SIDE FACE / BODY FRONT (NO FACE) / BACK + 顶部标题，除此之外无任何文字）
- 重阴影、彩色背景光、背景道具——**正视图立绘 / 四视图人设图 / 脸部放大三视图** 一律纯白色背景、无灯光（不打光）
- 正文里出现 `IMG-`/`REF-`/`LOCK-`/`VOICE-` 等元数据（那些只写在回复的 `IMG-…` 条目里，不写进可复制正文）

## 九、保存

调用 `save_character_final_prompt`：`prompt` 参数放**干净的可复制正文**。**正视图立绘 / 脸部放大三视图** 不含任何文字标签/标题，项目视觉风格由工具自动注入到最前方。**四视图人设图** 放纯英文母版正文，且 `skip_style_prefix` 传 `true`（正文自带 3D CG 风格段，工具不拼接项目 3DCG 风格）。正文不含 `IMG-`/`REF-`/`LOCK-` 元数据行。回复中同步给出该角色板的 `IMG-…` 条目（用途：身份，并含 `本集造型`）。
