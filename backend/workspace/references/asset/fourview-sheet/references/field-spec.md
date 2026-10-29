# 槽位填写规范（field spec）

> 母版见 `prompt-template.md`。本文件规定每个槽位**写什么 / 不写什么 / 写错的典型后果**。

---

## 一、三层结构：任何四视图提示词 = 不变骨架 + 角色槽位 + 族内差异轴

| 层 | 内容 | 变更频率 |
|---|---|---|
| **L1 不变骨架** | 画幅、版式、四格分工、光位、标签、标题格式、Critical consistency 段、Constraints 段结构 | 永不变（除非用户裁定） |
| **L2 角色槽位** | 族群、年龄、体型、发型、胡须、疤痕、头饰、服装、签名装备、武器、战利品、气质、标题 | 每个角色一套 |
| **L3 族内差异轴** | 同批角色（同一部落/同一小队）之间必须错开的维度 | 每批角色之间 |

**提示词正文只写 L1 + L2 + L3 的展开；L3 的"与同批区分"部分在正文里体现为 Constraints 段的 Equipment differentiation 负向条款。**

---

## 二、L2 槽位逐项规范

### 2.1 族群（ETHNICITY — CRITICAL）

**必须写满三层**，缺一层就跑偏：

1. **正向锁定**：`Central Asian / Turkic / Sogdian Silk Road ethnic features` + 4~6 项具体骨相（颧骨、眼型、瞳色、鼻型、眉形、肤色质感）。
2. **历史锚点**：`the historically accurate "杂胡" mixed-tribe peoples of the Sui-Tang frontier desert` 一类说明——让模型知道是「混血部落」而非单一现代民族。
3. **排除清单**：见 §四 `NEG_ETHNICITY`，至少 5 条，且必须包含「非纯汉人脸」「非欧美白人脸」两条。

> ⚠️ 本段**整批共用同一段文字**（A/B/C 三人完全相同），不要为每个人重写——族内差异靠体型/发型/装备，不靠换族群。

### 2.2 年龄与体型

- 年龄写**区间数字**（`28-32` / `33-37`），不写「中年」。
- 体型段必须**同时写正向 + 4 个 NOT**：
  - 正向要落到**职业类比**（`the build of an experienced archer who values reach and precision over raw strength`），不是抽象形容词。
  - NOT 至少覆盖：bulky muscular / chunky / slender frail / teenage gangly（按角色实际体型调整其中 3~4 个）。
- 体型是**族内第一差异轴**：同批角色绝不共用同一体型词根。

### 2.3 发型与胡须（第二差异轴）

| 差异维度 | 可选值族 |
|---|---|
| 发长/发式 | short cropped / 高马尾 / 长辫至 mid-back / 散发 / 光头+发髻 |
| 胡须 | 无 / short stubble / 长groomed beard / 编须 / 山羊须 |
| 颜色 | black / dark brown / 灰白（老兵） |

> 铁律：**同批角色至少在「发式」和「胡须」两项上各错开一档**。A（短寸+短胡茬）/ B（高马尾+无胡）/ C（长辫+长须）就是标准三档。

### 2.4 头饰（静置态原则）

人设图的头饰**只做静置态**，绝不做使用态：

- 用途型头饰（头巾）→ `pulled down loose around the neck/shoulders (face fully uncovered)`，并注明"作战时可拉起遮口鼻"。
- 器械型头饰（护目镜）→ `pushed up onto forehead/hairline, NOT covering eyes (off-duty stance)`。
- 写法固定为 `**[[HEADWEAR_REST_STATE]] Face fully visible.**`（句末必须补 Face fully visible）。

### 2.5 签名装备（signature equipment）

**定义**：角色在战术分工中不可替代的那件装备。判定标准——**拿掉它这个角色就不是这个角色了**。

每件签名装备必须写满四项：

1. **位置**（哪条手臂/身体哪侧/背或腰）
2. **形制**（齿轮、镜片、弓弦、扣件、销钉…）
3. **材质与色号**（`Mecha Crimson Bronze #7A6845, Aged Gold #846035 accent`，带 verdigris 铜锈）
4. **可见格**（正面格可见 / 背面格可见 / 两格都可见）

**装备等级纪律**：
- 普通喽啰 = **wearable 局部机改**（叠加式），**禁止义肢替换**——必须写 `NOT a prosthetic limb replacement — the underlying arm is intact, this is wearable equipment armor with mechanism`。
- 头领级才允许完整义肢。
- 首领级才允许 brutalist 战利品堆量。

### 2.6 武器

固定三行结构：**Primary / Secondary / Sidearm**。普通喽啰的 primary 必须等于其战术职能（钩索手=钩索+绞盘、沙艇手=飞镖+短矛、弓箭手=长复合弓）。

### 2.7 战利品（第三差异轴 · 数量级阶梯）

同一批角色用**数量级阶梯**拉开：

| 层级 | 数量 | 挑选逻辑 | 用于 |
|---|---|---|---|
| utilitarian | 2-3 | 纯实用，战场随手捡的 | 新人/低阶 |
| slightly more | 3-4 | 多一两件，混个小珠子 | 中阶 |
| sparse but refined | 3-4 件但更小更精 | 逐件挑选，有审美 | 老练/专业 |
| brutalist mass | 大堆 | 战利展示 | 首领（禁止用于喽啰） |
| refined woven | 编织珠饰成组 | 精致体系 | 副手/头领 |

### 2.8 气质

三段式：`能量词 + NOT 动作姿态 + NOT 放松平民 + 职业类比收尾`。
禁止 aggressive action pose（人设图是「猎人休息态」，不是战斗定格）。

---

## 三、L3 族内差异矩阵（出同批角色前必先填）

出图前先填这张表，**任一列不得重复**（"—" 除外）：

| 维度 | 角色A | 角色B | 角色C |
|---|---|---|---|
| 性别 | | | |
| 年龄区间 | | | |
| 体型词根 | | | |
| 发式 | | | |
| 胡须 | | | |
| 上装形制 | | | |
| 签名装备1 | | | |
| 签名装备2 | | | |
| 主武器 | | | |
| 副武器 | | | |
| 战利品数量级 | | | |
| 气质关键词 | | | |

**填法**：先定「角色A」再依次定 B、C，每定一个，回头扫全表找重复项，改到不重复为止。

> 现成三例可直接参考 `consistency-matrix.md`。

---

## 四、通用负向词库（Constraints 段）

### 4.1 `NEG_ETHNICITY`（族群）
```
NOT pure Caucasian European face, NOT blonde or red or light brown hair,
NOT blue or green or grey or hazel eyes, NOT pale fair Northern European skin,
NOT thin pointed delicate Western nose, NOT round Western double-fold eyes,
NOT pure Han Chinese face, NOT modern K-pop or Chinese drama actor aesthetic.
MUST be Central Asian Turkic/Sogdian Silk Road mixed ethnicity.
```
> 负面情绪表演片需追加：`NOT ugly, NOT caricatured, NOT a real historical portrait`。

### 4.2 `NEG_BODY`（体型/年龄/取景）
```
NOT bulky muscular, NOT chunky, NOT slender frail, NOT teenage gangly,
NOT young appearance (must be [[AGE_RANGE]] weathered veteran with deep sun lines),
NOT clean-shaven or stubble (long groomed beard mandatory).   ← 仅长须角色
```
> 女性角色追加：`NOT voluptuous sensualized body, NOT teen-aged delicate, NOT seductive pose or framing`。

### 4.3 `NEG_EQUIPMENT`（装备区分）
```
NOT a prosthetic limb replacement (no mechanical limbs, only wearable [[EQUIP_TYPE]]),
NOT same equipment as [[SIBLING_A]] ([[SIBLING_A_NO]]),
NOT same equipment as [[SIBLING_B]] ([[SIBLING_B_NO]]),
NOT chieftain-level brutalist trophy mass, NOT lieutenant-level refined woven beads.
```
> **SIBLING_NO 写法**：把兄弟角色的签名装备逐件点名否定（`no lasso winch, no back-mounted hook launcher, no large mechanical chest device`）。这是同批区分最有效的一句。

### 4.4 `NEG_AESTHETIC`（审美）
```
NOT precision cybernetic, NOT modern, NOT clean (war-torn salvage bronze only),
NOT medieval European, NOT Ming-Qing imperial, NOT samurai, NOT cyberpunk neon,
NOT steampunk Victorian, NOT photographic, NOT live-action photo, NOT 2D flat cel shading, NOT anime line art,
NOT fantasy elf-archer aesthetic, NOT colorful saturated palette.
```
> 弓手追加 `NOT fantasy elf archer / NOT Japanese kyudo archer`——这类模型默认往奇幻跑，必须显式堵。

### 4.5 `NEG_LAYOUT`（版式与光）
```
NOT 1:1 square aspect (must be vertical 9:16),
NOT equal-sized 4 panels (top row smaller, bottom row larger),
NOT face visible in bottom-left panel (face strictly cropped out at top of panel),
NOT face covered by [[HEADWEAR_BLOCKER]] in face close-up panels,
NOT colorful background (solid neutral light-warm-grey only),
NOT soft even neutral lighting (must be single-side rim backlight only),
NOT front light, NOT fill light,
NOT any text other than the four panel labels and the title.
```

---

## 五、写作纪律（写在正文里的中文注释不进 prompt）

1. **正文纯英文**：中文只出现在【格式继承】【角色定位】【实操注意】三段外壳里。
2. **不要在正文里出现"图N"编号**：编号只写在文档标题。
3. **表格符号不进 prompt**：已知会被文本模型乱排版，四格描述写成自然语言行。
4. **同一部落角色共用同一段族群文字、同一段光位文字、同一段 Style 文字**——复制即可，不要每份重新措辞（措辞漂移=跨图不一致）。


---

## 六、跨题材换批次（沙漠 → 现代都市）

同一骨架可以服务不同题材。**L1 骨架完全复用，只换 L2 的族群/色板/风格段和 L3 差异轴。**

### 6.1 必须换掉的槽位（换题材时逐项检查）

| 槽位 | 沙漠版 | 现代版 | 不换的后果 |
|---|---|---|---|
| `ETHNICITY_BLOCK` | Central Asian/Turkic/Sogdian | 现代中国人（汉族·内地当代城市平民） | 现代角色长成中亚脸 |
| `COLOR_PALETTE` | 沙褐/焦褐皮革/铜锈 | 炭灰/靛蓝牛仔/土黄帆布 | 现代角色带沙漠铜锈 |
| `NEG_ETHNICITY` | 排除中亚之外的一切 | 排除欧美/中亚/韩日/东南亚 | 跑成欧美白人脸 |
| `NEG_AESTHETIC` | 排除奇幻/科幻/武士 | 排除古装/科幻/精英商务 | 跑成古装或商务精英 |
| `REF_FILM_1/2` `REF_WORK_3` | 长安十二时辰 / Mongol / 怪猎 | 钢的琴 / 树先生 / 我的前半生 | 参考锚错位 |
| `PRIMARY/SECONDARY_WEAPON` | 弓 / 飞镖 | 无武器（手机/图纸卷） | 现代角色持冷兵器 |
| `PERSONAL_ITEMS` | 战利品骨饰 | 廉价手表/幸运结/孩子照片 | 现代角色挂骨饰 |
| `TROPHY` 类措辞 | sparse but refined | sparse and domestic | 数量级逻辑错位 |
| `NEG_EQUIPMENT` | 排除义肢/铜机械 | 排除武器/装甲/部落器物 | 负面项误导模型 |

### 6.2 现代都市角色的三条特别纪律

1. **武器槽位要写"无武器"**：现代角色的 `PRIMARY_WEAPON` 写"不是武器，是被磨损的手机"，`SIDEARM_WEAPON` 写"无任何武器，他的权威完全来自社交与金钱"。否则模型会自作主张给把刀。
2. **"精明世故"必须落到生理细节**：不要只写 `shrewd`。写"表面温和、眼底在算账"式的具体描述，并配一个**非对称表情锚**（如 `warm on the surface and calculating underneath`），否则容易跑成反派阴沉脸或憨厚笑面。
3. **阶层识别靠磨损不靠品牌**：包工头/小老板的辨识点是"旧、糙、但整齐"——反光工帽、腰间钥匙串、起球的polo衫、磨白的工装靴。写 `NOT luxury-brand NOT business-suit` 是必须的。

### 6.3 批次共享段要成套换

现代批次 = `shared.modern.example.json`（族群+色板+风格参考+族群/审美负向词）。
**沙漠批次和现代批次不能共用一个 shared.json**，否则交叉污染。
