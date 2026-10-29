# 同批角色一致性矩阵（consistency matrix）

> 用途：出**一组**同部落/同小队角色时，先用本文件定轴，再逐个填 `card.json` 出图。
> 铁律：**每一行不得出现两个相同值**（"—" 除外）。

---

## 一、三实例基准（A/B/C 三喽啰）

来自「万物生 第1集 · 沙猎部落」已验证的三份提示词，作为族内差异的**标尺样本**。

| 维度 | A · 钩索手 Lasso | B · 沙艇驾驶手 Skimmer | C · 弓箭手 Archer |
|---|---|---|---|
| 性别 | 男 | 女 | 男 |
| 年龄 | 28-32 | 23-26 | 33-37 |
| 体型词根 | stocky chunky working laborer | lean athletic pilot | lean tall veteran archer |
| 发式 | short cropped | 高马尾 ponytail | 长辫至 mid-back |
| 胡须 | short stubble | 无 | 长 groomed beard |
| 上装形制 | sleeveless vest | cropped vest | long-sleeved tunic |
| 签名装备 1 | 右前臂 lasso winch（叠加式） | 额上 sand goggles | 左前臂 vambrace 瞄准器 |
| 签名装备 2 | 背挂 hook launcher | 通讯哨 + throwing darts bandolier | 右手指尖 metal claw-caps |
| 主武器 | lasso / grappling hook | throwing darts + javelin | long composite recurve bow |
| 副武器 | 单短刀 | 短矛 + 短刀 | 短刀 |
| 战利品数量级 | 2-3 sparse utilitarian | 3-4 sparse + small bead | sparse but refined chosen |
| 气质关键词 | working laborer | alert pilot | calm patient veteran |
| 头饰静置态 | 围脖拉下 | 护目镜推上额头 | 围脖拉下 |

**读法**：三人构成「年轻精瘦 / 中年壮实 / 老练高瘦」三条**互不重叠**的体型谱+年龄谱。

---

## 二、新批次工作表（复制即用）

```
批次名：〔            〕    部落/阵营：〔            〕    人数：〔  〕

| 维度            | 角色1 | 角色2 | 角色3 | 角色4 |
|-----------------|-------|-------|-------|-------|
| 性别            |       |       |       |       |
| 年龄区间        |       |       |       |       |
| 体型词根        |       |       |       |       |
| 发式            |       |       |       |       |
| 胡须            |       |       |       |       |
| 上装形制        |       |       |       |       |
| 签名装备1       |       |       |       |       |
| 签名装备2       |       |       |       |       |
| 主武器          |       |       |       |       |
| 副武器          |       |       |       |       |
| 战利品数量级    |       |       |       |       |
| 气质关键词      |       |       |       |       |
| 头饰静置态      |       |       |       |       |
```

**定轴顺序建议**：性别 → 年龄 → 体型（体型跟年龄绑，别撞）→ 发式 → 胡须 → 上装形制 → 签名装备 → 主武器 → 战利品 → 气质。
撞了轴就**改后一个角色**（不要改已出图的角色，否则跨图不一致）。

---

## 三、同批共享段（整批逐字复制，禁止逐份重写）

以下三段在同批所有角色的 prompt 里**必须逐字一致**——这是跨图一致性的来源：

1. **ETHNICITY 段**（族群正向锁定 + 历史锚点）
2. **Lighting 段**（单侧侧逆光全文）
3. **Style 段**（3D CG 动画风格 + 三部参考作品）
4. **Color Palette 段**（部落色板 + 铜锈色号 + 材质统一状态）

> 只有 Equipment differentiation 的负向条款**随角色变化**——它引用兄弟角色的签名装备。

---

## 四、跨图一致性锚（比"提示词写得好"更管用）

| 锚 | 作用 | 落点 |
|---|---|---|
| **背景色** | 纯中性浅暖灰 | 全批同一 RGB |
| **光位** | camera-right 45° 背后侧逆光 | 全批同一侧，四格不变 |
| **色板 + 铜锈色号** | 材质识别 | `Mecha Crimson Bronze #7A6845` / `Aged Gold #846035` |
| **服装主色** | 部落识别 | 深焦褐皮革 + 沙褐 |
| **战利品数量级** | 身份等级识别 | 逐级递减 |
| **头部静置态** | 脸不被遮 | 全批统一"让开脸" |

---

## 五、兄弟角色点名否定句（Equipment differentiation 必写）

在角色 C 的 prompt 里，长这样：

```
**Equipment differentiation**: NOT a prosthetic limb replacement (no mechanical limbs,
only wearable vambrace and finger caps),
NOT same equipment as raider A (no lasso winch, no back-mounted hook launcher, no large mechanical chest device),
NOT same equipment as raider B (no goggles, no throwing-dart bandolier, no high ponytail),
NOT chieftain-level brutalist trophy mass, NOT lieutenant-level refined woven decoration.
```

**要点**：把兄弟角色的签名装备**逐件点名否定**，比抽象写"不要和别的角色一样"有效一个数量级。
