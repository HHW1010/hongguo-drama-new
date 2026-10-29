---
name: character-fourview-sheet
description: "人物四视图人设图生图提示词生成器（GPT-Image-2 / 高端人设参考板）。用于把角色设定转成可直接投喂生图模型的英文四视图提示词：9:16 竖版 + 2x2 不等大四格（正脸特写 / 侧脸特写 / 脖子以下正面全身（裁头）/ 背面全身含后脑）+ 单一侧逆光无补光 + 四个面板标签与顶部标题 + 族群锚定 + 五组负向约束 + 同批角色差异化矩阵。触发词：四视图、人设图、角色设定图、人物参考板、character sheet、turnaround sheet、四宫格人设、正脸侧脸背面、9:16 人设图、角色生图提示词、角色设定板、人物四格。"
agent_created: true
version: "1.0.0"
---

# character-fourview-sheet · 人物四视图人设图提示词引擎

把「一份角色设定」翻译成「一张可直接投喂生图模型的人物四视图人设参考板提示词」。

**本技能只产出提示词文本，不调用生图工具。** 出图由用户在外部平台自行执行。

---

## 一、何时用 / 何时不用

| 场景 | 用本技能 |
|---|---|
| 需要一张「正脸 + 侧脸 + 全身 + 背面」的**电影级 3D CG 人设参考板** | ✅ |
| 同一部落/小队要出**一组**角色且必须互相区分 | ✅（走族内差异矩阵） |
| 需要左下格**裁掉头**以便后期替换脸 | ✅（本技能的招牌能力） |
| 需要"无脸保头"的**资产板**（图面零文字、唯一面部锚点） | ❌ 走 `sd-asset-engine` 的 `character-portrait-templates.md` §七 |
| 需要**道具四视图** | ❌ 走 `sd-asset-engine` 的 `prop-template.md` |
| 需要九宫格场景 | ❌ 走 `sd-asset-engine` 的 `scene-grid-template.md` |

> ⚠️ **两套四视图纪律互不通用**（易混点，务必先判别）：
> - **本技能**：四格**可以**带标签文字与标题；左下格**真裁头**；3D CG 动画质感；单侧逆光。
> - **资产板纪律**：图面**零文字**（除音色标签）；三格全身**保头去五官**（不裁头）；3D/2D/写实三风格分支。

---

## 二、核心规范（十条铁律 · 写任何一份之前先过一遍）

1. **画幅**：Vertical **9:16** 竖版，Maximum resolution output。
2. **版式**：2x2 grid with **unequal panel heights** —— 上排两格各约 1/3 画布高（脸特写），下排两格各约 2/3（全身），四格之间细浅灰分隔线。
3. **四格分工**（固定）：
   - 左上 **FRONT FACE** — 领口线以上正脸特写，双眼完整，视线朝镜头。
   - 右上 **SIDE FACE** — 纯侧脸（朝画面右），轮廓光勾出后脑与发型。
   - 左下 **BODY FRONT (NO FACE)** — 领口线以下到脚，**头在画面顶边被裁掉**，零面部信息，专供后期换脸。
   - 右下 **BACK** — 头到脚背面全身，**含后脑勺**（发型/辫子/头饰必须可见）。
4. **光照**：Single-sided side-rim backlighting from **camera-right at 45 degrees behind**，**NO fill light / NO front light / NO ambient / NO other light sources**。四格共享同一背景与同一光位。
5. **背景**：Pure solid neutral **light-warm-grey** studio backdrop（不得有颜色、渐变、场景元素）。
6. **风格**：high-quality 3D CG animation still —— 现代游戏引擎级电影渲染（Unreal Engine / Pixar 级）、半写实角色、PBR 材质、体积电影光，正文风格段见 `assets/template.txt`【Style】逐字照抄；**NOT photographic, NOT live-action photo, NOT hyperrealistic photo, NOT illustration, NOT 2D anime**；**不得叠 Kodak Vision3 35mm 颗粒 / film grain**。
7. **头饰静置态**：人设图的头饰必须**让开脸**（围脖拉下 / 护目镜推上额头），句尾固定补 `Face fully visible.`。
8. **文字纪律**：图上**只允许**四行面板标签（FRONT FACE / SIDE FACE / BODY FRONT (NO FACE) / BACK）+ 顶部一行标题，**除此之外无任何文字**。
9. **同一人四格**：脸型、发型、服装、签名装备、战利品逐项一致（Critical consistency 段必须写全清单）。
10. **签名装备可见性**：每件签名装备至少有一个"可截图锚点"——正面可见的写进左下格，背面可见的写进右下格。

---

## 三、标准工作流

### Step 1 · 判定类型与批次
确认：单角色 / 同批多角色？目标族裔锚点？
→ 同批多角色时，**先做差异矩阵**（见 `references/consistency-matrix.md` §二），再逐个填卡。

### Step 2 · 填槽位（两种方式）

**方式 A · 用脚本（推荐）**
```bash
# 1) 复制示例卡片
cp assets/card.example.json  cards/角色C.json
# 2) 填卡（槽位表见 references/field-spec.md）
# 3) 生成（批次共享段放 shared.json）
python scripts/build_prompt.py --card cards/角色C.json \
       --shared assets/shared.example.json --out out/角色C.md
```
脚本会在槽位缺失时**一次性列出全部缺失项并以非零码退出**，杜绝半成品提示词流入生图环节。

**方式 B · 手写**
按 `references/prompt-template.md` 的母版逐槽替换 `{{SLOT}}`，规则见 `references/field-spec.md`。

### Step 3 · 自检（交付前必跑）
```bash
python scripts/check_prompt.py out/角色C.md
```
检查 13 项：9:16 / 不等大四格 / 左下裁头 / 四标签 / 标题 / 单侧逆光禁补光 / Critical consistency / Constraints 五组 / 3D CG 风格 / 头饰静置态 / 正文无中文散文 / 正文无图N编号。**任一 FAIL 即不得交付。**

### Step 4 · 补【实操注意】
把本次角色的 6~8 条出图后验收点写进 `QA_NOTES`（族群准确 / 版式 / 左下不露脸 / 体型 / 签名装备可见 / 与兄弟角色的区分 / 反向禁项）。这一段是**给人看的**，不进生图提示词。

### Step 5 · 交付
交付物 = 一份 markdown 文档，四段式：【格式继承】+【角色定位】+【prompt】+【实操注意】。

---

## 四、文档级外壳（固定四段）

```
【格式继承】  声明本角色与同批共用哪套骨架
【角色定位】  战术功能 + 在小队里的位置 → 决定装备与气质取舍
【prompt】     唯一进生图模型的英文正文（代码块包裹）
【实操注意】   出图后的验收清单（逐条勾）
```

---

## 五、跨题材复用（同一骨架服务不同题材）

L1 骨架（画幅/版式/四格分工/光位/标签/标题/Constraints 结构）**完全通用**，换题材只换 L2 族群段、色板、风格参考、L3 差异轴。

**已内置两套批次共享段**：
- `assets/shared.example.json` — 沙漠批次（中亚杂胡 · 铜锈沙褐）
- `assets/shared.modern.example.json` — 现代批次（中国人 · 炭灰靛蓝）

换题材时**必须成套换**的槽位见 `references/field-spec.md` §六.1（族群段/色板/族群负向/审美负向/参考作品/武器三行/随身小物）。
现代都市角色另有三条特别纪律（武器槽写"无武器"、"精明世世"要落到生理细节、阶层识别靠磨损不靠品牌），见 §六.2。

---

## 六、同批角色的差异化纪律（出组图时必读）

**铁律：差异矩阵每一行不得出现两个相同值。**

必查的 13 个维度：性别 / 年龄区间 / 体型词根 / 发式 / 胡须 / 上装形制 / 签名装备1 / 签名装备2 / 主武器 / 副武器 / 战利品数量级 / 气质关键词 / 头饰静置态。

三条关键手法：
1. **体型跟年龄绑**：体型是族内第一差异轴，同批绝不共用体型词根。
2. **发式 + 胡须双错开**：标准三档 = 短寸+短胡茬 / 高马尾+无胡 / 长辫+长须。
3. **点名否定兄弟装备**：`NOT same equipment as raider A (no lasso winch, no back-mounted hook launcher...)` —— 比抽象写"别和别人一样"有效一个数量级。

**跨图一致性的真正来源**：同批角色的**族群段 / 光照段 / 风格段 / 色板段逐字复制**（放 `shared.json`），只有 Equipment differentiation 随角色变化。

---

## 七、资源索引

| 文件 | 内容 |
|---|---|
| `references/prompt-template.md` | **提示词母版**（槽位化全文）+ 槽位速查表 + 六条铁律 |
| `references/field-spec.md` | 每个槽位写什么/不写什么/写错后果 + 三层结构 + 族内差异轴 + 通用负向词库 |
| `references/consistency-matrix.md` | A/B/C 三实例基准表 + 新批次工作表 + 跨图一致性锚 + 点名否定句范式 |
| `assets/template.txt` | 母版纯文本（脚本读取） |
| `assets/card.example.json` | 角色卡片示例（沙漠 · 弓箭手 C） |
| `assets/shared.example.json` | 批次共享段示例（沙漠 · 中亚杂胡） |
| `assets/card.modern.example.json` | 角色卡片示例（现代 · LOCK-MAGE 中年男子） |
| `assets/shared.modern.example.json` | 批次共享段示例（现代 · 中国人） |
| `scripts/build_prompt.py` | 卡片 → 完整提示词（缺失槽位拦截） |
| `scripts/check_prompt.py` | 13 项交付前自检 |

---

## 八、常见跑偏与处方

| 跑偏现象 | 处方 |
|---|---|
| 出成欧美白人脸 | 加固族群正向锁定（骨相 5 项 + 历史锚点）+ 扩 `NEG_ETHNICITY` 至 8 条 |
| 出成纯汉人脸 | 强化"杂胡 mixed-tribe"措辞 + 明确排除 Han Chinese face |
| 左下格露脸 | 补 `The face/head is intentionally cropped out of frame at the top of this panel` + `Zero face involvement` |
| 四格等大 | 强调 unequal panel heights + 上 1/3 / 下 2/3 |
| 出成均匀柔光 | 加 `NO fill light. NO front light. NO ambient.` + Constraints 末条重申 |
| 体型跑成肌肉猛男 | 体型段加 4 个 NOT（bulky/chunky/slender frail/teenage gangly） |
| 弓手跑成奇幻精灵弓 | `NEG_AESTHETIC` 加 `NOT fantasy elf-archer aesthetic` + 加 `NOT Japanese kyudo archer` |
| 换脸接口失效 | 左下格必须完全无面部信息，连耳朵轮廓也要避开 |
| 文字乱码 | 正文只留四个标签 + 标题，且全英文等宽字体 |
| 现代角色长出中亚脸 | 换用 `shared.modern.example.json`，并把 `NEG_ETHNICITY` 里的"排除中亚"改成"排除中亚/欧美/韩日" |
| 现代角色被塞了刀 | `SIDEARM_WEAPON` 明写 "None. No blade, no firearm, no weapon of any kind" |
| 表情跑成反派阴沉脸 | 表情锚改成非对称写法：`warm on the surface and calculating underneath` |
| 包工头跑成商务精英 | `NEG_EQUIPMENT` 加 `NOT luxury-brand accessories`、`NOT business suit`，色板加"NOT new NOT fashion-editorial" |
| 帽檐/头发遮住脸 | 头饰静置态写"推后到头顶/戴在颈后"，并补 `Face fully visible.` |
