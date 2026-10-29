# 四视图提示词母版（GPT-Image-2 · 9:16 竖版）

> 本文件是「人物四视图人设图」提示词的**唯一母版**。所有角色实例都由它派生，只填槽位、不改骨架。
> 槽位标记格式：`[[SLOT_NAME]]`。生成成稿时由 `scripts/build_prompt.py` 自动替换为实参。

---

## 一、文档级外壳（三份实例共有）

每份提示词文档 = **四段式**，缺一不可：

```
【格式继承】   ← 声明本角色与同批角色共用哪套骨架（照抄母版哪几条）
【角色定位】   ← 战术功能 + 在小队里的位置（决定装备与气质的取舍）
【prompt】    ← 唯一的生图提示词正文（英文，代码块包裹）
【实操注意】   ← 出图后的验收清单（逐条勾）
```

- 【格式继承】通常写「完全同〔参照角色〕格式：9:16竖版 + 4格不等大 + 正脸特写/侧脸特写/脖子以下/背面 + single-side rim backlight」。
- 【实操注意】= 跑图后要盯的 6~8 条本角色专属验收点（族群准确 / 版式 / 左下不露脸 / 体型 / 签名装备可见 / 与同批的区分 / 反向禁项）。

---

## 二、提示词正文母版（英文 · 槽位化）

以下为完整正文。`[[...]]` 为待填槽位，`{}` 为固定文本，一字不改。

```
A character design reference sheet. **Vertical 9:16 aspect ratio. Maximum resolution output.** Pure solid neutral light-warm-grey studio backdrop. Single-sided side-rim backlighting from camera-right at 45 degrees behind the subject, no fill light, no front light, no other light sources—dramatic cinematic lighting.

【Layout】

**2x2 grid with unequal panel heights**:
- Top row: two smaller panels (each approximately 1/3 of total canvas height) — head/face close-ups
- Bottom row: two larger panels (each approximately 2/3 of total canvas height) — full body shots
- Thin neutral light-grey dividing lines between all four panels
- All four panels share the same solid backdrop and same lighting setup

【4 Panels】

**Top-left panel — FRONT FACE CLOSE-UP**:
Tight close-up of the [[GENDER]]'s face, framed from approximately collarbone-line up to top of head. Subject facing camera directly. Side-rim backlight catches the right edge of the face/hair (camera's left side of frame), leaving the left side of the face in deeper shadow with subtle ambient bounce. Both eyes intact, [[GAZE_DESC]]. **[[HEADWEAR_REST_STATE]] Face fully visible.**

**Top-right panel — SIDE FACE CLOSE-UP (PROFILE)**:
Tight close-up of [[HIS_HER]] face in pure side profile, framed from collarbone-line up to top of head. Subject facing camera-right. Side-rim backlight catches the back of the head and silhouettes the profile against the backdrop. **[[HAIR_PROFILE_SIGNATURE]]** visible falling along the spine. **[[BEARD_PROFILE_SIGNATURE]]** catches the rim light. Face fully visible.

**Bottom-left panel — FULL BODY FROM NECK DOWN, FRONT VIEW (NO FACE)**:
Full body shot from collarbone-line down to feet, facing camera directly. **The face/head is intentionally cropped out of frame at the top of this panel—only the neck, shoulders, torso, arms, hips, legs, and feet are visible.** Zero face involvement so this panel survives any future face replacement edit. Side-rim backlight catches the right shoulder and right side of body, defining [[BUILD_SILHOUETTE]] silhouette. **[[SIG_EQUIP_FRONT_VISIBLE]]** prominently visible.

**Bottom-right panel — FULL BODY BACK VIEW (INCLUDING BACK OF HEAD)**:
Full body shot from head to feet, facing directly away from camera (back of subject toward camera). **Includes back of head[[BACK_HEAD_FEATURE]] visible falling down to [[BRAID_LEN]] length**, [[HEADWEAR_BACK_STATE]]. **[[SIG_EQUIP_BACK_VISIBLE]]** (signature equipment), [[QUIVER_BACK]]. Sparse trophy decorations on back of belt visible. Side-rim backlight catches right shoulder silhouette.

【Subject — same character across all 4 panels】

[[ROLE_SENTENCE]].

**Character Core**:
Approximately [[AGE_RANGE]] years old, [[AGE_DESC]]. **[[BUILD_DESC]]** Built like [[BUILD_ANALOGY]].

**ETHNICITY — CRITICAL**: [[ETHNICITY_BLOCK]]

**Hair**: [[HAIR_DESC]]

**Beard**: [[BEARD_DESC]]

**Battle marks**: [[SCARS_DESC]]

**Headwear (CRITICAL)**: [[HEADWEAR_DESC]]

**Upper body**: [[UPPER_BODY_DESC]]

**SIG EQUIPMENT 1 (CRITICAL signature equipment)**: [[SIG1_DESC]]

**SIG EQUIPMENT 2 (CRITICAL signature detail)**: [[SIG2_DESC]]

**Lower body**: [[LOWER_BODY_DESC]]

**Trophy decorations**: [[TROPHY_DESC]]

**Footwear**: [[FOOTWEAR_DESC]]

【Weapons】
- **Primary**: [[PRIMARY_WEAPON]]
- **Secondary**: [[SECONDARY_WEAPON]]
- **Sidearm**: [[SIDEARM_WEAPON]]

【Color Palette】
[[COLOR_PALETTE]]

【Pose - same across all 4 panels】
Default standing pose with feet shoulder-width apart, weight [[WEIGHT_DISTRIBUTION]]. [[POSE_ARM_NOTE]]. Subtle [[TEMPERAMENT]] energy—NOT aggressive action pose, NOT relaxed civilian, NOT showy. [[POSE_ANALOGY]]

【Critical consistency】
SAME individual character in all 4 panels—[[CONSISTENCY_LIST]]. Same studio backdrop, same single-sided side-rim backlighting setup across all 4 panels.

【Lighting - critical】
**Single-sided side-rim backlighting from camera-right at 45-degrees behind subject. NO fill light. NO front light. NO ambient. NO other light sources.** Strong dramatic edge-light catches the right side of subject silhouette in every panel, leaving the left side of subject in deep falloff shadow with subtle ambient bounce.

【Style】
high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, volumetric cinematic lighting with soft rim light, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, 8K resolution, 85mm prime lens, f/2.0 aperture, clean cinematic composition, soft key light from camera-left with gentle ambient bounce fill, bright clean exposure, high dynamic range, soft filmic highlight rolloff, volumetric light shafts with visible dust motes, physically-based surface response, sharp micro-normal detail, individual hair strands with natural falloff, soft cloth simulation with physically accurate folds, expressive readable face, crisp pinpoint catchlights in the eyes, fine iris texture, unified color palette and lighting direction across the sequence, avoid flat lighting, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art, avoid flat color blocks, avoid harsh uniform ambient fill, avoid oily shiny skin, avoid over-smoothed skin, avoid influencer face, avoid uncanny valley, avoid cheap game-cinematic glow, avoid excessive bloom, avoid oversaturated colors, avoid underexposure, avoid film grain, avoid chromatic aberration, avoid deformed hands, avoid extra fingers, avoid extra limbs, avoid garbled text, avoid subtitles, avoid watermark, avoid logo

**Reference aesthetics for [[ETHNICITY_ANCHOR_NAME]] ethnic accuracy**:
- **[[REF_FILM_1]]** — [[REF_FILM_1_ROLE]]
- **[[REF_FILM_2]]** — [[REF_FILM_2_ROLE]]
- **[[REF_GAME_3]]** — [[REF_GAME_3_ROLE]]

【Quality】
Maximum resolution output. 8k ultra clean rendering. Sharp clean edges. Every [[DETAIL_ENUM]] clearly defined.

【Panel Labels】
Small clean monospace sans-serif black text below each panel:
- Top-left: "FRONT FACE"
- Top-right: "SIDE FACE"
- Bottom-left: "BODY FRONT (NO FACE)"
- Bottom-right: "BACK"

Title at top center of canvas (small clean black sans-serif): "[[TITLE_TEXT]]"

【Constraints】

**Ethnic accuracy (CRITICAL)**: [[NEG_ETHNICITY]]

**Body, age & framing**: [[NEG_BODY]]

**Equipment differentiation**: [[NEG_EQUIPMENT]]

**Aesthetic**: [[NEG_AESTHETIC]]

**Layout & lighting**: [[NEG_LAYOUT]]
```

---

## 三、槽位字典（速查）

> 完整填写规范与反例见 `field-spec.md`；此处为一眼可查表。

| 槽位 | 填什么 | 沙漠三实例（A / B / C） | 现代实例（LOCK-MAGE 中年男子） |
|---|---|---|---|
| `GENDER` | male / female | male / female / male | male |
| `GAZE_DESC` | 眼神气质 + 视线方向 | sharp focused / alert focused / calm focused veteran | steady shrewd appraising gaze — sizing up a customer |
| `HEADWEAR_REST_STATE` | 头饰在「静置态」的位置 + 一句说明脸全露 | headwrap pulled down / goggles pushed up / headwrap loose | reflective work cap pushed back off the forehead |
| `HAIR_PROFILE_SIGNATURE` | 侧脸格最显眼的发型特征 | short cropped / high ponytail / long braid | short black hair, receding temples |
| `BEARD_PROFILE_SIGNATURE` | 侧脸格胡须特征 + 是否被轮廓光扫到 | short stubble / clean-shaven jaw / long groomed beard | two-day patchy stubble |
| `BUILD_SILHOUETTE` | 轮廓光定义出的体型词 | stocky muscular / lean athletic / lean tall | average slightly stocky |
| `SIG_EQUIP_FRONT_VISIBLE` | 正面身体格必须可见的签名装备 | lasso-winch / pendant+bandolier / vambrace+claw-caps | belt with van keys + badge, crossbody strap, work boots |
| `BACK_HEAD_FEATURE` | 背面格后脑可见特征 | 短寸 / 高马尾 / long black braid | short black hair, receding temples |
| `BRAID_LEN` | 辫子/马尾长度 | — / upper-back / mid-back | nape |
| `HEADWEAR_BACK_STATE` | 背面格头饰状态 | headwrap loose / goggles on top / headwrap on shoulders | cap pushed back on crown, strap visible |
| `SIG_EQUIP_BACK_VISIBLE` | 背面格必须可见的签名装备 | hook launcher / javelin / long recurve bow | canvas crossbody bag, strap across shoulders |
| `BACK_GEAR` | 背面格副挂/背负物 | rope cable / — / arrow quiver | sun jacket tied round waist |
| `ROLE_SENTENCE` | 一句角色定位（族群+性别+职级+专精+资历） | desert raider…lasso / …sand-skiff / …archery | Chinese man in his late thirties, self-made small-time contractor and van owner |
| `AGE_RANGE` | 年龄区间（数字） | 28-32 / 23-26 / 33-37 | 35-40 |
| `BUILD_DESC` | 体型段（含 4 个 NOT） | stocky chunky / lean wiry / lean tall | average slightly stocky, soft middle, light paunch |
| `ETHNICITY_BLOCK` | 族群正向锁定 + 3~5 项排除 | Central Asian/Turkic/Sogdian（三人共用） | 现代中国人（现代批次共用） |
| `HEADWEAR_DESC` | 头饰材质 + 形态 + 可拉上遮脸 | tan-and-rust desert cloth / bronze goggles | faded olive reflective-brim work cap |
| `SIG1_DESC` / `SIG2_DESC` | 两件签名装备细节 + 色号 | lasso-winch / hook launcher；goggles+pendant；vambrace / claw-caps | belt with yellow-fob van keys / cracked-case phone |
| `PERSONAL_ITEMS` | 随身小物/身份锚（数量级 + 挑选逻辑） | 2-3 utilitarian / 3-4 slightly more / sparse but refined | sparse and domestic：wristwatch, lucky charm, child's photo |
| `COLOR_PALETTE` | 主色 + 材质状态 | sand tan, burnt umber leather, Mecha Crimson Bronze #7A6845 + Aged Gold #846035. ALL weathered, NOT clean. | charcoal grey, faded indigo denim, dusty olive, tan leather. Lived-in but maintained, NOT new NOT luxury-brand. |
| `TEMPERAMENT` | 气质关键词 | laborer-warrior / alert pilot / calm patient veteran | shrewd, sociable, unhurried |
| `TITLE_TEXT` | 图上标题 | SAND HUNTER COMMON RAIDER C · ARCHER — DEFAULT FORM CHARACTER SHEET | LOCK-MAGE · MIDDLE-AGED MAN — DEFAULT FORM CHARACTER SHEET |
| `NEG_*` | 五组负向约束 | 见 field-spec.md §四 + 角色专属追加 | 同左，族群/审美两组按批次换 |

---

## 四、不可变的六条铁律（写 prompt 时不得违反）

1. **9:16 竖版**，顶行两格各 1/3 画布高（脸特写），底行两格各 2/3（全身），**四格不等大**。
2. **左下格真裁头**（cropped out of frame），不是"无脸保头"——此格设计目的就是给后期换脸留接口。
3. **单一侧逆光**（camera-right 45° 背后），无补光、无正面光、无环境光；四格共享同一背景与光位。
4. **同一人四格**：脸型、发型、服装、签名装备、战利品逐项一致。
5. **头饰静置态**：画人设图时头饰必须让开脸（围脖/推上额头），否则五官被遮、失去参考价值。
6. **签名装备必须落在指定格**：正面可见的写进左下格，背面可见的写进右下格——每件签名装备至少有一个"可截图锚点"。

> ⚠️ **跨题材槽位纪律**：`BACK_GEAR` / `PERSONAL_ITEMS` / `REF_WORK_3` / `PRIMARY_WEAPON` 等槽位**不得硬编码题材词**（箭袋、战利品、弓、游戏名）。换题材时先把这些槽位中性化（见 field-spec.md §六），否则沙漠元素会漏进现代角色。
