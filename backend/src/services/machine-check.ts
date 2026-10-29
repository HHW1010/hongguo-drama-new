/**
 * 七段式投喂机检 —— manju-laoli 交付层 C1~C30（Seedance 侧）+ 六道闸门 的 TypeScript 重写
 *
 * 权威源（单一真相）：
 *   - short-drama-director/scripts/validate_prompt.py  （C1~C30 逐镜/逐段/全文机检，跳过 H1~H12 MiniMax H3 支线）
 *   - sd-feed-engine/scripts/gate_check.py              （六道闸门：节奏/台词时长/字数/语义/图数/编号+素材形态）
 *
 * 本模块不落库、不发请求——只做纯文本机检，返回 issues（FAIL）/ warns（WARN）/ blockingWarns（高危实拍必崩，
 * 由 FATAL_WARN_PREFIXES 提升为阻断级）。供 feed agent 在 save_video_prompt 落库前自纠。
 *
 * Python→JS 口径对照（与源文件一致）：
 *   re.I → i · re.S → s · re.M → m · (?P<x>…) → (?<x>…) · \A → ^（无 m） · \Z → $（无 s 之外无 m）
 *   Python \w 匹配 CJK，JS \w 不匹配 → 源里凡需要 CJK 的 \w 一律显式写 [A-Za-z0-9_一-鿿]
 *   re.findall(pat, txt) → matches(pat, txt) · re.search → exec（非 g）· re.match → 需 index===0
 */

// ============================================================================================
// 工具
// ============================================================================================

/** 秒小数位 → 秒值（按位数换算：`5`→0.5 · `50`→0.5 · `05`→0.05，不写死 ÷100） */
function fracToSec(frac: string | null | undefined): number {
  if (!frac) return 0.0
  return parseInt(frac, 10) / 10 ** frac.length
}

/** 给正则补 g 标志（不污染原常量），返回可迭代的全局版 */
function reglobal(r: RegExp): RegExp {
  return r.flags.includes('g') ? r : new RegExp(r.source, r.flags + 'g')
}

/** re.finditer 等价：返回全部匹配 */
function matches(r: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(reglobal(r))]
}

/** re.findall 等价（取指定分组，默认第 0 组） */
function findAll(r: RegExp, text: string, group = 0): string[] {
  return matches(r, text).map(m => m[group])
}

/** re.search 等价（首处匹配） */
function search(r: RegExp, text: string): RegExpExecArray | null {
  return r.exec(text)
}

/** re.match 等价（须从串首起） */
function matchAtStart(r: RegExp, text: string): RegExpExecArray | null {
  const m = r.exec(text)
  return m && m.index === 0 ? m : null
}

/** re.escape 等价 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按行切分（容忍 \r\n） */
function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** 中文字符计数（一-龥，与源 [一-龥] 口径一致） */
function cjkCount(s: string): number {
  return (s.match(/[一-龥]/g) || []).length
}

/** sorted(set(...)) */
function uniqSorted<T>(arr: T[]): T[] {
  return [...new Set(arr)].sort()
}

/** Counter(...).most_common(1)[0] 的极简版：返回 [最频值, 次数] */
function topCount<T>(arr: T[]): [T, number] {
  const cnt = new Map<T, number>()
  for (const x of arr) cnt.set(x, (cnt.get(x) || 0) + 1)
  let best: T = arr[0]
  let bestN = 0
  for (const [k, n] of cnt) if (n > bestN) { best = k; bestN = n }
  return [best, bestN]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 剔除 Markdown 元数据行（# 标题 / > 引用 / | 表格 / ``` 围栏 / --- 分隔线） */
function stripMdMeta(text: string): string {
  const keep: string[] = []
  for (const ln of lines(text)) {
    const s = ln.trimStart()
    if (s.startsWith('#') || s.startsWith('>') || s.startsWith('|') || s.startsWith('```')) continue
    if (/^\s*[-*_]{3,}\s*$/.test(ln)) continue
    keep.push(ln)
  }
  return keep.join('\n')
}

// ============================================================================================
// 常量（源文件逐条对照）
// ============================================================================================

const LIMITS: Record<string, number> = { '2.5': 30, '2.0': 15 }
const MAX_CHARS = 4500

// 三形态时码（MM:SS(.ff) / Xs-Ys / N-N秒带守卫）
const TIME_RE = /(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\s*[-~～→]\s*(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?|(\d+(?:\.\d+)?)\s*s\s*[-~～→]\s*(\d+(?:\.\d+)?)\s*s|(?:^|(?<=[\s\[【\]】]))\s*([0-9]|[1-5]\d)(?:\.\d+)?\s*[-~～→]\s*([0-9]|[1-5]\d)(?:\.\d+)?秒/i

// 镜号标记（半角/全角/无括号）
const SHOT_TAG_RE = /[\[【]?\s*镜头\s*\d+\s*[\]】]?/

const SEVEN_SEGMENTS = ['【画幅风格】', '【场景资产】', '【核心人物】', '【站位声明】', '【时间轴分镜】', '【音效】', '【强制禁止项】']

const BAN_FRONT_TAG = /【强制禁止项[｜|·]前置】/
const BAN_BLOCK_ANY = /【强制禁止项(?:(?<pre>[｜|·]前置】)|】|(?<odd>[^\n】]{0,12})】)/

const GORE_WORDS = ['鲜血', '血喷', '血迹', '血溅', '血肉模糊', '鲜血淋漓', '喷血', '流血', '断肢', '截肢',
  '断臂', '断头', '碎尸', '四分五裂', '尸体', '死尸', '惨死', '内脏', '肠子', '脑浆',
  '开膛破肚', '割喉', '绞杀', '虐杀', '凌迟', '透体', '捅穿', '刺穿', '砍断', '撕裂',
  '伤口', '骨裂', '骨骼断裂', '切开', '劈成两段', '斩为两段', '切成两半', '劈成两半',
  '深可见骨', '可见骨', '血污', '血淋淋', '断指', '开膛', '破腹', '掏心', '剥皮',
  '裸体', '裸露', '走光', '露点', '床戏', '自杀', '自残', '割腕', '上吊', '吸毒', '嗑药', '吸毒贩毒']

const OS_PAT = /内心独白|（\s*OS\s*）|\(\s*OS\s*\)|\bOS\b|心声/
const VO_PAT = /旁白|画外音|（\s*VO\s*）|\(\s*VO\s*\)|\bVO\b/
const MOUTH_PAT = /张嘴|开口|说道|说着|喊道|喊着|呐喊|嘴里念|嘴唇张开|嘴里说着|开口道|开口说/
const VO_OS_QUOTA = 20
const VO_OS_QUOTA_SLACK = 5
const OS_MAX_SHOTS = 2
const VO_MAX_SHOTS = 1

const NARR_TRACKS = new Set(['3'])
const NARR_SPEED_MIN = 4.5
const NARR_SPEED_MAX = 6.5
const CINE_VOCAB = ['特写', '紧特写', '大特写', '极特写', '超特写', '近景', '中近景', '中景',
  '中全景', '全景', '远景', '大全景', '平视', '仰视', '俯视', '略仰', '略俯',
  '侧角', '正侧', '斜角', '顶拍', '过肩', '主观', '固定', '缓推', '慢推',
  '推', '拉', '摇', '移', '跟', '升降', '手持', '环绕', '变焦', '甩', '旋转',
  '横移', '垂直']
const CINE_VOCAB_SORTED = [...CINE_VOCAB].sort((a, b) => b.length - a.length)
const NARR_PIC_MIN = 2

const C25_BLAND_FACE = ['表情平静', '神色复杂', '神情复杂', '面露', '眼神凌厉', '面无表情',
  '神色平静', '表情复杂', '一脸平静', '神色凝重', '表情严肃', '神情平静']
const C25_SYNC_CROWD = ['众人同时', '齐声', '异口同声', '整齐划一', '所有人同时', '全场同时',
  '一同露出', '不约而同', '两人同时', '三人同时', '四人对视', '相视一笑', '同时转头']

const C26_ERA_ANCHOR = /(?:1[0-9]{3}|20[0-9]{2})\s*年|公元前|民国|清朝|明朝|宋朝|唐朝|汉朝|先秦|战国|春秋|古代|近代|中古|上古|未来|近未来|架空|赛博朋克|科幻|蒸汽时代|工业时代|现代|当代|民国风/
const C26_FUTURE_ANCHOR = /(?:19[89]\d|20[0-9]{2})\s*年|未来|近未来|赛博朋克|科幻|架空/
const C26_OLD_ELEMS = ['马车', '青砖', '煤油灯', '旗袍', '长衫', '中山装', '辫子', '发髻',
  '竹简', '文言', '亭台', '木质楼梯', '手摇电话', '蒸汽机车']
const C26_PAST_ANCHOR = /古代|近代|先秦|战国|春秋|汉朝|唐朝|宋朝|明朝|清朝|民国|中古|上古/
const C26_MODERN_ELEMS = ['玻璃幕墙', '电线杆', '运动鞋', '牛仔裤', '智能手机', 'LED屏', 'LED 屏',
  '塑料袋', '空调外机', '监控探头', '二维码']
const C26_AGE_ANCHOR = /\d{1,3}\s*[-~～至]\s*\d{1,3}\s*岁|\d{1,3}\s*岁|\d{1,2}\s*岁|[三四五六七八九十两]{1,3}岁|青年|中年|老年|少年|少女|孩童|婴儿|[老少中]年/
const C26_LOOK_ANCHOR = /外套|夹克|制服|工装|衬衫|T恤|polo|背心|风衣|大衣|连衣裙|旗袍|长袍|道袍|剑袍|劲装|广袖|束发|短须|头身|佩剑|铠甲|警服|护士服|白大褂|围裙|头盔|鸭舌帽|棒球帽|工牌|安全帽|反光背心|外卖箱|保温箱|发髻|马尾|寸头|络腮胡|眼镜|耳钉|围巾|手套|胸牌|袖口|衣领|肩章|纽扣|拉链|补丁|磨损|油渍|血迹|疤痕|纹身|[青白黑红黄灰紫橙]色(?:长|短|风)?(?:衫|褂|袍|衣|甲)|头发|胡须|面孔|眉|眼|唇|齿/
const C26_CAST_REF_ONLY = /参考图\s*\d+|@?图\s*\d+|外观严格参考图|外观以\S*参考图锁定|外观以资产图锁定|参考图锁定/

const NO_DIALOG_SHOT_MAX = 5
const PURE_AMBIENT_SEG_MAX = 10
const NO_LINE_RE = /台词：\s*无(?![一-鿿A-Za-z0-9])/
const DIALOGUE_RE = /台词：\s*(?!无(?![一-鿿A-Za-z0-9]))/

const TAIL_FREEZE_WORDS = ['定格', '定住', '静止', '顿住', '凝住', '硬切', '定镜收束']
const ANCHOR_WORDS = ['身后', '背后', '侧后', '后方', '背靠', '身后侧', '后侧']
const ANCHOR_EXEMPT = ['无背景锚点', '免锚点', '无锚点', '无背景', '空镜']
const LOWER_BODY_RE = /胸|腰|腹|臀|腿|膝|脚|鞋|下半身|下身|全身/
const LOWER_BODY_ACTION = /[拧蹬转挺沉坐送折弓弹震扭摆收蓄绷顶撑挫旋翻仰含塌拔]/
const FULL_BODY_RE = /全身|完整站位|整个人|从头顶/
const OTS_RE = /(后肩|前肩)\s*过[^，。；、]{0,10}?(左|右)(?:前)?肩/
const OTS_SIDE_MAP: Record<string, string> = { '后肩,左': '右', '后肩,右': '左', '前肩,左': '左', '前肩,右': '右' }
const OTS_FG_RE = /画面(左|右)前景/
const C25_FAKE_ACTING = ['突然瞪眼', '机械微笑', '大幅点头', '频繁摇头', '五官同时用力', '假哭',
  '眼神乱飘', '傻笑', '无意义甩头', '舞台剧式', '张嘴瞪眼', '默认爆哭', '默认吼']
const CONTAMINATION_WORDS = ['某角色', '待补充', '待定', 'TBD', 'TODO', '占位符',
  '示例角色', 'placeholder', '△0.0', 'palette 默认']
const C12_TRANSITION_RE = /J-?cut|L-?cut|Whip\s*Pan|Match\s*Cut|Sound\s*Bridge|视线匹配|抽帧/i

const CAM_FAMILIES: Record<string, string> = {
  '固定': '固定',
  '推镜': '推', '缓推': '推', '慢推': '推', '快推': '推', '急推': '推', '推近': '推', '推入': '推',
  '拉镜': '拉', '拉远': '拉', '后拉': '拉',
  '横移': '横移', '平移': '横移', '竖移': '竖移',
  '平摇': '摇', '横摇': '摇', '直摇': '摇', '摇摄': '摇', '纵摇': '俯仰', '跟摇': '跟',
  '侧移': '横移', '斜移': '横移', '前移': '推', '后移': '拉', '推移': '推', '拉升': '拉',
  '跟随': '跟', '跟移': '跟',
  '跟拍': '跟', '摇镜': '摇', '俯仰': '俯仰', '上摇': '俯仰', '下摇': '俯仰',
  '升降': '升降', '环绕': '环绕', '弧形': '环绕',
  '轨道': '轨道', '摇臂': '摇臂',
  '变焦': '变焦', '滑动变焦': '滑动变焦', 'Dolly': '滑动变焦', 'Zoom': '滑动变焦',
  '手持': '手持', '微漂': '漂移', '漂移': '漂移', '甩镜': '甩',
  'POV': 'POV', '主观视角': 'POV',
  '荷兰角': '荷兰角', '鱼眼': '鱼眼', 'Snorricam': 'Snorricam',
  '升格': '升格', '降格': '降格', 'Snap': '急推', 'Rack': '移焦',
}
const CAM_MOTIVELESS = ['无动机', '毫无动机', '没有动机', '无理由晃动', '无理由地晃动',
  '随机甩', '胡乱甩', '乱晃', '胡乱晃动', '疯狂甩动', '乱切', '随意晃动']
const CAM_MULTI_MAX = 2
const CAM_FIXED_RATIO_MAX = 0.10
const CAM_FIXED_MIN_SHOTS = 6
const CAM_FIXED_RUN_MAX = 3
const CAM_SAME_RUN_MAX = 3
const CAM_COVER_MIN = 4
const CAM_COVER_MIN_SHOTS = 6
const CAM_HEAVY_LIMITS: Array<{ name: string; pat: RegExp; limit: number; scope: 'whole' | 'seg' }> = [
  { name: '滑动变焦', pat: /滑动变焦|Dolly\s*Zoom|变焦推进|急推变焦/i, limit: 1, scope: 'whole' },
  { name: '环绕/弧形', pat: /环绕|弧形/i, limit: 3, scope: 'whole' },
  { name: 'Snorricam', pat: /Snorricam/i, limit: 1, scope: 'whole' },
  { name: '鱼眼', pat: /鱼眼/i, limit: 2, scope: 'whole' },
  { name: '荷兰角', pat: /荷兰角/i, limit: 1, scope: 'whole' },
  { name: '升降', pat: /升降/i, limit: 2, scope: 'whole' },
  { name: '摇臂', pat: /摇臂/i, limit: 2, scope: 'whole' },
  { name: 'POV主观视角', pat: /\bPOV\b|主观视角/i, limit: 3, scope: 'whole' },
  { name: '手持剧烈晃动', pat: /手持剧烈|剧烈晃动/i, limit: 3, scope: 'seg' },
]

// C16 对白语气
const TONE_STRONG = ['嘶哑', '沙哑', '低语', '气音', '嘶吼', '低吼', '颤声', '哭腔', '破音',
  '一字一顿', '压着嗓子', '哑着嗓子', '声嘶力竭', '阴阳怪气', '扯着嗓子']
const TONE_SOFT = ['冷笑', '嗤笑', '讥诮', '嘲讽']
const TONE_FACE_CTX = /挂[着上]|带[着上]|露出|浮现|勾起|扬起|抿|咧|噙|绷|抹/
const IDLE_PROP_RE = /把玩|摩挲|拨弄|把弄|翻弄|转着/
const TONE_SEVERE = ['宣判', '一字一顿', '嘶吼', '咆哮', '低吼', '质问', '冷硬',
  '森然', '咬牙', '发狠', '含恨', '恨意', '暴怒', '压着怒']
const TONE_MISS_RATIO = 0.5
const TONE_VAGUE = ['开心', '难过', '生气', '愤怒', '悲伤', '伤心', '高兴', '邪魅', '伤感', '激动']
const TONE_TAG_RE = /[^（()【】\[\]]{1,16}?\s*[（(]\s*([^）)]{1,40}?)\s*[）)]\s*[:：]/

// C17 摆位必入画
const ZW_PERSON_RE = /@(?:(?:CHR|SCN|PRP|ITM|PROP|ENV|OBJ)-)?([^\s@（）()【】，、；;：:]+)/
const C17_EXIT_WORDS = ['离画', '退场', '离场', '出画', '未入镜', '不入镜']
const ZW_LOOSE_HEAD = /^(?![@【])([^\s（(【】：:]{1,14})\s*[（(]/

// C18 首镜锚定·景别·姿态·视线
const GAZE_ANCHOR_RE = /目光|视线|不落|不离/
const LIFT_TOWARD_RE = /[举捧]向/
const CU_SHOT_RE = /特写/
const CU_RATIO_MIN = 0.25
const CU_RATIO_MAX = 0.40
const CU_PERSON_ANCHOR_RE = /@CHR-|@(?!SCN-|PRP-|ITM-|PROP-|ENV-)[一-龥A-Za-z]{1,8}/
const CU_BODY_PART_RE = /眼皮|眼睑|眼睛|眼珠|眼球|瞳孔|睫毛|眉头|眉心|眉|嘴角|唇|嘴唇|喉咙|喉结|下颌|下巴|鼻翼|鼻息|手背|手腕|手指|指尖|指节|掌心|手掌|拳头|拳|肩颈|侧颈|脖颈|脸|面部|面颊|脸颊|身体|背影/
const SPACE_EVENT_RE = /房顶|屋顶|屋子|屋里|屋内|房间|门口|窗外|院子|全景/
const PROPUP_RE = /撑起|坐起|起身|站起|弹起|坐起身/
const LIE_RE = /躺|卧|蜷|瘫/
const LIEBACK_EXEMPT = ['躺回', '倒回', '跌回', '又躺', '瘫回', '重新躺', '重新蜷', '蜷回']
const GLOW_PROP_RE = /玉佩|银镯|宝石|镜子|铜镜|珍珠|金饰|银饰|钻石|水晶/

// C19 禁令失效三改法
const BARE_NEG_RE = /不发光|不透光|不悬浮|面无笑意|面无笑容|不会发光|不会透光|无其他弟子|无其他人物|无其他人|无旁人/
const LIGHTPATH_RE = /(举向|凑向|对着|冲着|迎向)[^。；]*?(灯|光|火)|冲光/
const FLAME_MAP_RE = /(映出|倒映|映着|反射出)[^。；]*?(火苗|火焰|灯火|烛火)/
const PROP_LIGHT_RE = /光斑|受光|受[^。；]{0,8}照射|照射|照在|亮起/
const LAMP_NEAR_RE = /(举|凑|贴|送|递)[^。；]{0,6}(到|向|至)[^。；]{0,8}(油灯|灯|烛|火)/
const C19E_POS_RE = /(即[^。；]{0,24}?(画面|镜头|首帧)|保持[^。；]{0,14}?(质感|状态|位置|本色)|必须|应写出|应写明|写明|复述|画面主体|以.{1,10}为主|呈[^。；]{0,10}?(色|质|感))/
const C19E_NEG_WORDS = ['禁止', '禁', '无', '不', '防', '杜绝', '避免', '杜绝']

// C20 首镜单主体锚定 + 抽象形容
const MULTI_SUBJ_RE = /同框|同在画面|一同入画|同时入画|与[^。；，]{1,8}同(处|在|入)/
const DANGLING_DEIXIS_RE = /[这那](只|双|张|个)(手|脚|脸|眼|肩|手指|手背|身体|背影)/
const DEIXIS_OWNED_RE = /[她他其][^。；，]{0,2}$/
const ABSTRACT_SHAPE_RE = /成线|成串|成股|如注|连成一线|轻蜷|微蜷|如钟|如松|如山|如满弓|如活物|如刀|如雷|如电|如死狗|如寒竹|如寒潭|如万丈寒渊|如寒星|如蝼蚁|如修罗|如泥|宛若[^，。；]{1,6}|呈金字塔|把[^，。；]{0,8}影子钉在|压着分量|在夜色里发沉|带着跃跃的亮|烛火齐齐一晃/

// C21/C22 打戏护栏
const COMBAT_SIGNAL_RE = /出拳|挥拳|一拳|劈掌|掌风|一掌|肘击|膝顶|踢中|扫腿|扫堂|剑锋|剑气|剑罡|刀锋|刀光|枪芒|枪尖|棍影|鞭梢|拳脚|招式|出招|变招|对招|交手|缠斗|近身|贴身|格挡|架住|架开|磕开|对轰|破防|受创|反杀|蓄力|发力|扑上|冲向|疾掠|滑退|被击飞|撞飞/
const COMBAT_SIGNAL_MIN = 6
const COMBAT_MOVE_RE = /冲|扑|撞|滚|翻|跃|纵|掠|退|闪|撤|腾|踏|蹬|踹|欺身|错身|贴地|暴起|俯冲|滑退|横飞|倒飞|震飞|弹出|扭身|转身|下蹲|纵身|腾空|落地|翻身|扑击/
const COMBAT_CONTACT_RE = /击中|砸中|撞中|劈中|斩中|刺中|扫中|点中|踹中|顶中|拍中|打中|相撞|硬碰|磕上|磕开|架上|架住|格挡|格开|交击|对撞|硬接|硬扛|拳掌相交|拳脚相加|兵器相击|着肉|入肉|抓住|揪住|扼住|勒住|崩开|崩碎|劈开|斩断|捅入|抵住|撞在|砸在|劈在|撞上/
const COMBAT_CLOSE_RATIO = 0.33
const COMBAT_SAME_RUN = 3
const COMBAT_SIZE_RE = /极特写|大特写|紧特写|超特写|特写|中近景|近景|中全景|中景|大全景|全景|大远景|远景/
const COMBAT_ANGLE_RE = /平视|仰视|俯视|略仰|略俯|顶拍|正侧|斜角|侧角|过肩|主观|背面|正面|荷兰角/

const COMBAT_IAU_RE = /撩斩|斩中|劈中|劈碎|劈开|挑刺|刺中|捅入|横扫|竖劈|剪斩|扫腿|扫堂|踢中|踹中|顶中|肘击|膝顶|点中|拍中|砸中|撞中|撞碎|扑击|砸在|撞在|劈在|揪住|扼住|勒住|擒住|格挡|架住|架开|格开|磕开|硬接|硬扛|对撞|交击|兵器相击|拳掌相交/
const COMBAT_IAU_GRAB_RE = /抓住[一-龥@]{0,6}?(?:脚踝|手腕|剑刃|剑身|兵器|骨爪|衣领|后颈|喉|肩|臂)/
const COMBAT_TACTIC_RE = /剑气|剑罡|法术|法阵|符|咒|法相|剑意|刀光|掌风/
const COMBAT_TACTIC_TYPES: Record<string, RegExp> = {
  '兵器': /撩斩|斩中|劈中|劈碎|劈开|挑刺|刺中|捅入|横扫|竖劈|剪斩|扫腿|扫堂|兵器相击|刀光/,
  '拳脚': /踢中|踹中|顶中|肘击|膝顶|点中|拍中|砸中|拳掌相交/,
  '投技/擒拿': /抓住[一-龥@]{0,6}?(?:脚踝|手腕|剑刃|剑身|衣领|后颈|喉|肩|臂)|揪住|扼住|勒住|擒住/,
  '撞碎/破防': /撞中|撞碎|撞在|砸在|劈在|硬接|硬扛|对撞|交击/,
  '法术/特效': COMBAT_TACTIC_RE,
}
const COMBAT_BEAT_RE: Record<string, RegExp> = {
  '起': /沉肩|压低重心|碾碎|绷紧|屏息|蓄力|蓄势|预备|屈膝|后仰|重心下压|攒/,
  '爆': /暴起|骤然|猛地|瞬间|陡然|疾掠|扑上|冲出|甩出|弹射|暴涌/,
  '顿': /顿住|时停|顿帧|定格|凝固|压在|静止/,
  '收': /卸力|稳住|侧滑|滑退|收势|滑步|落地缓冲|后撤|站定|单膝|卸掉冲势/,
}
const COMBAT_FULL_SIZE = ['中全景', '中景', '全景', '大远景']
const COMBAT_TIGHT_SIZE = ['特写', '近景', '中近景']
const COMBAT_TIGHT_MAX_RUN = 2
const COMBAT_STRUCT_TAGS = new Set(['起手拍，慢', '爆发拍，快', '顿帧', '收势拍，慢', '转折', '起手拍', '爆发拍', '收势拍', '假动作', '战术变化'])
const COMBAT_EGRESS = '〔参考·打戏档可豁免：R1 枪战/狙击/暗杀/追车/儿童向 · R3 大场面/术法对轰 · 群战乱斗 按 combat-rhythm-and-load-guardrails.md §七 放行，非一票否决〕'

const COMBAT_RANGE_RE = /(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\s*[-~～→]\s*(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?|(\d+(?:\.\d+)?)\s*s\s*[-~～→]\s*(\d+(?:\.\d+)?)\s*s|(\d+(?:\.\d+)?)\s*[-~～→]\s*(\d+(?:\.\d+)?)\s*[秒sS]/i

// C23 画风锁
const C23_NUM_RANGE = /\[\s*\d+\s*[:：]\s*(\d+(?:\.\d+)?)\s*,\s*\d+\s*[:：]\s*(\d+(?:\.\d+)?)\s*\]/
const C23_MM_RANGE = /\[\s*(\d+)\s*mm\s*,\s*(\d+)\s*mm\s*\]/
const C23_FPS_RANGE = /\[\s*(\d+)\s*fps\s*,\s*(\d+)\s*fps\s*\]/
const C23_K_RANGE = /\[\s*(\d+)\s*K\s*,\s*(\d+)\s*K\s*\]/
const C23_PCT_RANGE = /\[\s*(\d+)%\s*,\s*(\d+)%\s*\]/
const C23_ENUM_RANGE = /\[\s*(低|中|高)\s*,\s*(低|中|高)\s*\]/
const C23_ENUM_MAP: Record<string, number> = { '低': 1, '中': 2, '高': 3 }
const C23_SHOT_LINE = /^\s*(?:(?:\d+(?:\.\d+)?(?:s|秒)?|\d{1,2}:\d{2})\s*[-~～→]\s*(?:\d+(?:\.\d+)?(?:s|秒)?|\d{1,2}:\d{2})\s*[\[【]?\s*(镜头\s*\d+)\s*[\]】]?|[\[【]?\s*(镜头\s*\d+)\s*[\]】]?\s*[,，]?\s*(?:\d+(?:\.\d+)?(?:s|秒)?|\d{1,2}:\d{2})\s*[-~～→]\s*(?:\d+(?:\.\d+)?(?:s|秒)?|\d{1,2}:\d{2}))(.*)$/m
const C23_SHOT_LIGHT = /光比约?\s*1\s*[:：]\s*(\d+(?:\.\d+)?)/
const C23_SHOT_LENS = /(\d+)\s*mm/
const C23_SHOT_FPS = /(\d+)\s*fps/
const C23_NAMES = [
  '张艺谋', '陈凯歌', '冯小刚', '周星驰', '宁浩', '乌尔善', '路阳', '毕赣',
  '徐克', '王家卫', '杜琪峰', '袁和平', '彭顺', '陈可辛', '李少红', '刘镇伟',
  '李安', '侯孝贤', '杨德昌', '蔡明亮', '王童',
  '黑泽明', '北野武', '今村昌平', '是枝裕和', '河濑直美', '岩井俊二', '押井守',
  '大友克洋', '铃木敏郎', '高畑勋', '宫崎骏',
  '奉俊昊', '朴赞郁', '李沧东', '金炯柱',
  '诺兰', '维伦纽瓦', '塔伦蒂诺', '芬奇', '韦斯·安德森', '大卫·林奇', '库布里克',
  '马利克', '昆汀', '索德伯格', '雷德利·斯科特', '卡梅隆', '温子仁', '塔可夫斯基',
  '帕索里尼', '贝松',
  '狄金斯', '霍伊特', '西格尔', '斯托拉罗', '沙赫巴巴', '荒木经惟', '莱博维茨',
  '赫尔佐格', '斯文·尼奎斯特', '迈克·摩尔',
  '吉卜力', '新海诚', 'MAPPA', '皮克斯', '迪士尼', '京阿尼', '罗小黑',
  '皮埃尔·孔切', 'Nelagraphs',
  '狄仁杰', '花样年华', '重庆森林', '阿飞正传', '东邪西毒', '卧虎藏龙', '霸王别姬',
  '英雄', '满城尽带黄金甲',
]
const C23_STUDIO_HINT = /[一-龥A-Za-z]{2,}(工作室|影业|动画公司)/i
const C23_VFX_WORDS = ['体积光', '体积雾', '丁达尔', '雾', '尘埃', '浮尘', '炫光', '光晕', '暗角',
  '色散', '焦散', '流体', '电弧', '粒子', '星芒', '光斑', 'halation', '泛光', '辉光']
const C23_PARAM_HINTS = ['光比', '颗粒', '色温', '饱和度', '镜头', '焦段', 'mm', 'fps', '抽帧',
  '影调', '色调', '主调', '景深', '光学', '成像', '材质响应', '体积雾', '光晕']
const C23_STYLE_ABILITY: Record<string, [number, number]> = {
  '国漫3D仙侠': [3, 3], '暗黑神话游戏CG': [3, 3], '国漫3D进阶水墨': [3, 3], '东方神话3D奇幻': [3, 3],
  '徐克': [3, 3], '路阳': [3, 2], '袁和平': [3, 2], '乌尔善': [3, 3], '张艺谋': [2, 2], '朴赞郁': [3, 2], '大卫·芬奇': [2, 2], '芬奇': [2, 2], '罗杰·狄金斯': [2, 2], 'MAPPA': [3, 3], '王家卫': [0, 0], '侯孝贤': [0, 0], '毕赣': [0, 0],
  '蔡明亮': [0, 0], '马利克': [0, 1], '塔可夫斯基': [0, 1], '北野武': [1, 0],
  '是枝裕和': [0, 0], '河濑直美': [0, 0], '岩井俊二': [0, 0], '李沧东': [0, 0],
  '韦斯·安德森': [0, 0], '索德伯格': [1, 0], '雷德利·斯科特': [1, 2],
  '维伦纽瓦': [2, 3], '吕贝·贝松': [1, 1], '斯文·尼奎斯特': [0, 0],
}
const C23_COMBAT_SIG = /(打斗|打戏|武打|武侠|格斗|对决|对峙|交手|过招|拆招|斗法|厮杀|混战|交战|挥剑|出剑|劈砍|格挡|刺穿|兵刃相向|剑锋|刀锋|[出直挥]拳|[一记重]脚|[挥甩抽]手|出手|打退|逼退|摔跤|搏斗|攻击动作|卸力|后仰|侧滑|闪避|突进|跃起|腾空|翻滚|一爪|一掌|一记|硬接|借力|借势|卸甲|兵器|刀光|剑光)/
const C23_NEG_COMBAT = /(无|不|没有|非|免)\s*(?:任何|本片|该片|本段|该段)?\s*(打斗|打戏|武打|格斗|动作戏|打斗戏|战斗场面)/
const C23_EXCLUDE_CTX = /(声音[:：]|音效|强制禁止项|禁止项|严禁|不得|不可|禁[止用]|避免|不要|负面示例|反例)/
const C23_PERSON_TOKEN = /(主角|对手|反派|男主|女主|角色|人物|两人|三人|二人|众人|群演|侍卫|护卫|弟子|长老|师父|敌人|双方)/
const C23_FULL_BODY = /(全身|中全景|全景|站位|铠甲|持剑|举剑|握刀|立姿|背影)/
const C23_INTRO_SEM = /(入画|出场|登场|亮相|建立|交接|对峙|并立|同框.*(站|立)|初次)/
const C23_INTERACT_SEM = /(擦过|掠过|划过|斩向|劈向|刺向|砍向|挥向|推向|撞上|撞击|迎上|扑向|冲向|逼近|后仰|侧身后仰|交手|过招|接触点|反作用力|同时被|一同被|两人|双方|互相|互搏)/
const C23_SOLO_DECL = /(单人入画|单人|不出现第二个人物|仅一人|只有一人|独自)/
const C23_ACTION_INTENT = /(劈砍|斩|刺|砍|挥剑|出剑|格挡|反击|回身|转身|拧身|错步|换位|位移|跃起|腾空|落地|翻滚|闪避|突进|后撤|撞击|崩裂|碎裂|崩开|爆开|掀起|卷起|扑面|扩散)/
const C23_B2_LIMIT = 2

// C26 entries 解析（\w → 含 CJK）
const C26_ENTRIES_RE = /@([A-Za-z一-鿿][A-Za-z0-9_一-鿿-]{0,20})\s*(?:[：:]|[（(])\s*(.*?)(?=@[A-Za-z一-鿿][A-Za-z0-9_一-鿿-]{0,20}\s*(?:[：:]|[（(])|$)/s

// C17d/C17f 站位字段
const ZW_FIELD_RE = /@([一-龥A-Za-z0-9_\-]+)\s*[（(]([^）)]*)[）)]/
const POS_ORDER = ['画面左后', '画面右后', '画面中后', '画面左前', '画面右前', '画面左', '画面右', '画面中', '画面前', '画面后']
const SCN_ANCHOR_RE = /@SCN-[^\s（(，,；;：:【】]+/

// C18o 光影信号
const LIGHT_SIG = /时段光影|主光|侧光|逆光|顶光|底光|轮廓光|眼神光|边缘光|背光|光向|光质|硬光|柔光|散射|冷暖|暖金|冷蓝|暖黄|色温|天光|霓虹|钨丝|丁达尔|光斑|光影|补色|打光|布光|月光|烛光|日光/

// C17e 人数变化
const C17E_ENTRANCE_WORDS = ['入画', '走进', '走进来', '进来', '进门', '跨门槛', '迈进', '推门',
  '自门外', '从门外', '从外', '从里屋', '从走廊', '从侧门', '走出',
  '折返', '返回', '落座前', '已被扶', '扶着', '声先入', '传来', '空镜',
  '转场', '淡入', '叠化', '已在场', '开场前', '先已']
const CORE_FIELD_RE = /【核心人物】([^【]*)/

// C27 对话戏节奏
const C27_DIALOGUE_MARK = ['对话', '对白', '文戏', '谈判', '争执', '争吵', '商议', '聊']
const C27_NO_DIALOGUE_MARK = ['空镜', '打斗', '战斗', '武戏', '动作段', '转场', '蒙太奇',
  '独白', '宣判', '静场', '留白', '氛围段', '长镜段', '情绪积累']

// C28 台词机械化
const C28_BOOKISH = ['是否', '因此', '从而', '鉴于', '予以', '加以', '可否', '何以',
  '颇为', '甚为', '以及', '然而', '由于', '进行']
const C28_PARTICLE = ['啊', '吧', '呢', '嘛', '呗', '啦', '呀', '哦', '咯', '嗯',
  '唉', '哎', '嘿', '哟', '罢了', '而已']
const C28_PAUSE = ['，', '、', '—', '…', '；', '：', '?', '？', '!', '！']

// C29 资产状态偏离
const C29_DETACH = ['摘下', '脱下', '取下', '解开', '夹在', '夹着', '拎着', '拎在',
  '捧在', '捧起', '抱在怀', '挂在', '别在', '端在']
const C29_DECL = ['偏离', '以本段为准', '覆盖角色参考图', '覆盖参考图']

// C18m 段缝景别
const C18M_LADDER = ['大远景', '远景', '全景', '中全景', '中景', '中近景', '近景', '特写', '大特写']
const C18M_SIZE_DEFS: Array<[string, RegExp]> = [
  ['大远景', /大远景|大全景/], ['远景', /远景/], ['全景', /全景/],
  ['中全景', /中全景/], ['中景', /中景/], ['中近景', /中近景/],
  ['近景', /近景/], ['特写', /特写/], ['大特写', /大特写|极特写/],
]
const C18M_MOVE_END = /(?:后拉|拉远|拉开|拉至|拉到|拉出|退至|退到|推至|推到|推近|摇至|移到|移向)\s*(?:到|至)?\s*(大远景|大全景|远景|全景|中全景|中景|中近景|近景|特写|大特写|极特写)/
const C18M_FROM = /从\s*(大远景|大全景|远景|全景|中全景|中景|中近景|近景|特写|大特写)/
const C18M_BRIDGE = /遮挡|黑场|黑屏|划变|甩镜|运动模糊|叠化|转场/

// C30 外挂指纹
const C30_XUANHUAN_SIG = /剑阵|法阵|法相|万剑|飞剑|仙侠|修仙|修真|灵力|灵气|神魔|元婴|金丹|结印|道法|天雷|阵纹|符箓|剑气化|剑罡/
const C30_SCALE_FRAME = /占画[面框]|画面[七八九六五四三]成|半幅|满屏|[1-9]\/[1-9]|八成天穹|七成天穹/
const C30_SCALE_MACRO = /[十百千万][米丈]|数公里|数百米|上百米|百丈|千丈|万丈|丈许粗|数十米/
const C30_SCALE_REF = /参照|对比|比[^，。；]{1,6}(?:高|大|粗)|牌坊|石柱|山峰|山峦|城池|古松|巨梁|山岳/
const C30_SCALE_TINY = /千分之一|两千分之一|四分之一|十分之一|五分之一|[1-5]%|如蝼蚁|如微尘|如细沙|渺小|仅及画面/
const C30_ELEM_3 = /(?:主体层|外层)[\s\S]{1,120}(?:边缘层|中层)[\s\S]{1,120}(?:表面层|内层)|三层(?:复合|剑气|剑罡|刀芒|神雷|火浪|冰晶|水墨)/
const C30_REAL_SIG = /写实格斗|现代搏击|近身搏击|警匪|暗杀|擒拿|MMA|八极|咏春|泰拳|拳击|散打|R1\s*写实/
const C30_KINETIC_11 = /蹬地|蹬步|拧胯|转胯|转腰|拧腰|送肩|沉肩|沉腰|重心|屈膝|旋身|拧身|催肘|抖腕|脊柱/
const C30_DEF_IMPACT = /格挡|卸力|闪避|偏头|潜避|架开|拍开|凹陷|弓身|滑退|闷响|震颤|后仰|踉跄|擦痕|崩裂|崩碎|溢血|血沫|音爆环|深壑/
const C30_VOICE_LOCK = /音色|声线|嗓音|男声|女声|童声|低沉|沙哑|清冷|温润|清脆|磁性|粗粝|醇厚|语速|Hz/
const C30_STATIC_HOLD_RE = /双手横架死封|对撞定格|横架姿势被压|持续相持|架刀互推|贴脸对推|脸贴脸对视/
const C30_FAKE_ATK_RE = /轻松闪过|轻易避开|毫发无损|仅划开衣|仅划破衣/
const C30_WEAK_END_RE = /烟尘缓缓落定|缓缓收刀|慢悠悠收|气焰和平消散|残影粒子缓缓熄灭/
const C30_FINISHER_4_RE = /斜插[^。；]{0,12}(?:残兵|断刀|折剑|断剑|面具)|(?:轰飞|震飞|砸嵌|撞穿)[^。；]{0,18}(?:百米|千米|远景|岩壁|绝壁|深坑)|(?:瓦解|解构|化作|溃成|爆散成|溃散)[^。；]{0,18}(?:光粒|粒子|余烬|碎光|烟屑|消失)|(?:飞出画框|冲出画框|脱离画面|劈中镜头)[^。；]{0,12}硬切/

// 高危实拍必崩：这些 WARN 前缀被提升为阻断级（源 main() FATAL_WARN_PREFIXES）
const FATAL_WARN_PREFIXES = [
  'C2d', 'C20c', 'C20f', 'C20g', 'C20h', 'C20i', 'C20j', 'C20k', 'C20l', 'C20m',
  'C25d', 'C25e', 'C26e', 'C26f', 'C26g',
  'C30a', 'C30b', 'C30e', 'C30f', 'C30g', 'C30i', 'C30j', 'C30k', 'C30l',
]

// ============================================================================================
// 辅助函数
// ============================================================================================

function zwPeopleLoose(block: string): string[] {
  const out: string[] = []
  for (const tok of block.split(/[、；;]/)) {
    const t = tok.trim().replace(/^\s*【站位声明】\s*[：:]\s*/, '')
    const m = ZW_LOOSE_HEAD.exec(t)
    if (m) {
      const name = m[1].trim()
      if (name && !out.includes(name)) out.push(name)
    }
  }
  return out
}

function combatIau(pic: string): number {
  const hits = new Set(findAll(COMBAT_IAU_RE, pic))
  let n = hits.size
  if (![...hits].some(h => h.startsWith('抓住')) && search(COMBAT_IAU_GRAB_RE, pic)) n += 1
  return n
}

function combatTacticTypes(pic: string): string[] {
  return Object.keys(COMBAT_TACTIC_TYPES).filter(k => search(COMBAT_TACTIC_TYPES[k], pic))
}

function iauLimit(durS: number): number {
  if (durS <= 2) return 2
  if (durS <= 3.5) return 2
  if (durS <= 4.5) return 3
  if (durS <= 6) return 3
  return 4
}

function combatOn(text: string, mode: string): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return findAll(COMBAT_SIGNAL_RE, text).length >= COMBAT_SIGNAL_MIN
}

function c23On(text: string, mode: string, styleSource: string | null): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return /^【STYLE/m.test(text) || /^【PERFORMANCE/m.test(text) || !!styleSource
}

function picOnly(line: string): string {
  const si = line.indexOf('声音：')
  return si >= 0 ? line.slice(0, si) : line
}

function stripStructAnnot(s: string): string {
  return s.replace(/（([^）]*)）/g, (_m, inner: string) => COMBAT_STRUCT_TAGS.has(inner.trim()) ? '' : _m)
}

/** 返回 [(start_s, end_s, line_no, 画面段)] */
function combatRanges(text: string): Array<[number, number, number, string]> {
  const out: Array<[number, number, number, string]> = []
  const seen = new Set<string>()
  let i = 0
  for (const line of lines(text)) {
    i += 1
    const probe = line.replace(/^[\s\-*>•]+/, '')
    if (!(/^\d/.test(probe) || SHOT_TAG_RE.test(line))) continue
    const rs: Array<[number, number]> = []
    for (const m of matches(COMBAT_RANGE_RE, line)) {
      let s: number, e: number
      if (m[1] != null) {
        s = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fracToSec(m[3])
        e = parseInt(m[4], 10) * 60 + parseInt(m[5], 10) + fracToSec(m[6])
      } else if (m[7] != null) {
        s = parseFloat(m[7]); e = parseFloat(m[8])
      } else {
        s = parseFloat(m[9]); e = parseFloat(m[10])
      }
      rs.push([round2(s), round2(e)])
    }
    if (!rs.length) continue
    const seg = picOnly(line)
    const key = `${Math.min(...rs.map(x => x[0]))}|${Math.max(...rs.map(x => x[1]))}|${seg.trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([Math.min(...rs.map(x => x[0])), Math.max(...rs.map(x => x[1])), i, seg])
  }
  return out
}

function unionLen(spans: Array<[number, number]>): number {
  if (!spans.length) return 0.0
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let total = 0.0
  let cs = sorted[0][0], ce = sorted[0][1]
  for (let k = 1; k < sorted.length; k++) {
    const [s, e] = sorted[k]
    if (s <= ce) ce = Math.max(ce, e)
    else { total += ce - cs; cs = s; ce = e }
  }
  return total + (ce - cs)
}

/** 返回 [(start_s, end_s, line_no)] */
function parseTimeRanges(text: string): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  let i = 0
  for (const line of lines(text)) {
    i += 1
    for (const m of matches(TIME_RE, line)) {
      let s: number, e: number
      if (m[1] != null) {
        s = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fracToSec(m[3])
        e = parseInt(m[4], 10) * 60 + parseInt(m[5], 10) + fracToSec(m[6])
      } else if (m[7] != null) {
        s = parseFloat(m[7]); e = parseFloat(m[8])
      } else {
        s = parseFloat(m[9]); e = parseFloat(m[10])
      }
      out.push([round2(s), round2(e), i])
    }
  }
  return out
}

function picContentLen(picSeg: string): number {
  let s = picSeg.replace(reglobal(TIME_RE), '')
  s = s.replace(reglobal(SHOT_TAG_RE), '')
  for (const tok of CINE_VOCAB_SORTED) s = s.split(tok).join('')
  return cjkCount(s)
}

function splitSegments(text: string): Array<[string, number, string]> {
  const ls = lines(text)
  const idxs: number[] = []
  ls.forEach((l, i) => { if (l.trimStart().startsWith('【画幅风格】')) idxs.push(i) })
  if (!idxs.length) return [['全文', 1, text]]
  const segs: Array<[string, number, string]> = []
  idxs.forEach((start, k) => {
    const end = k + 1 < idxs.length ? idxs[k + 1] : ls.length
    segs.push([`段${k + 1}`, start + 1, ls.slice(start, end).join('\n')])
  })
  return segs
}

function feedBody(text: string): [string, boolean] {
  const blocks = findAll(/```[^\n]*\n([\s\S]*?)```/g, text, 1)
  if (!blocks.length) return [text, false]
  return [blocks.join('\n'), true]
}

function camFamilies(s: string): Set<string> {
  const fams = new Set<string>()
  let masked = s
  for (const w of Object.keys(CAM_FAMILIES).sort((a, b) => b.length - a.length)) {
    if (masked.includes(w)) {
      fams.add(CAM_FAMILIES[w])
      masked = masked.split(w).join('　'.repeat(w.length))
    }
  }
  return fams
}

function shotHead(line: string): string {
  const m = SHOT_TAG_RE.exec(line)
  if (!m) return ''
  let rest = line.slice(m.index + m[0].length).replace(/^[ \t,，]+/, '')
  const tm = matchAtStart(TIME_RE, rest)
  if (tm) rest = rest.slice(tm[0].length).replace(/^[ \t,，]+/, '')
  let head = rest.split('。', 1)[0]
  if (head.includes('，') || head.includes(',')) {
    const parts = head.split(/[，,]/)
    if (parts[0].includes('·')) {
      head = parts[0]
    } else {
      const kept = [parts[0]]
      for (const pt of parts.slice(1)) {
        if (pt.includes('@') || pt.trim().length > 6 || !(search(COMBAT_SIZE_RE, pt) || search(COMBAT_ANGLE_RE, pt) || camFamilies(pt).size)) break
        kept.push(pt)
      }
      head = kept.join('，')
    }
  }
  return head
}

function segScns(linesList: string[]): Set<string> {
  return new Set(findAll(SCN_ANCHOR_RE, linesList.join('\n')))
}

function zwFields(block: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>()
  for (const m of matches(ZW_FIELD_RE, block)) {
    const nm = m[1], inner = m[2]
    const pos = POS_ORDER.find(p => inner.includes(p)) || ''
    let anc = ''
    const am = /(?:身后|背后|侧后|后方|背靠)(?:为|是|：)?\s*([^，,；;）)〕\]·]{1,20})/.exec(inner)
    if (am) anc = am[1].trim().replace(/^\*+|\*+$/g, '').trim()
    out.set(nm, [pos, anc])
  }
  return out
}

function corePeople(block: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  const m = CORE_FIELD_RE.exec(block || '')
  if (!m) return out
  for (const ln of lines(m[1])) {
    const pm = /@(?:(?:CHR|SCN|PRP|ITM|PROP|ENV|OBJ)-)?([^\s@（）()【】，、；;：:]+)/.exec(ln)
    if (pm) out.set(pm[1], ln.includes('（在场）') || ln.includes('(在场)'))
  }
  return out
}

function c23Decls(blockText: string): Record<string, Array<[number, number, string?, string?]>> {
  const decls: Record<string, Array<[number, number, string?, string?]>> = {}
  for (const m of matches(C23_NUM_RANGE, blockText)) {
    const a = parseFloat(m[1]), b = parseFloat(m[2])
    ;(decls['光比'] ||= []).push([Math.min(a, b), Math.max(a, b)])
  }
  for (const m of matches(C23_MM_RANGE, blockText)) {
    ;(decls['镜头'] ||= []).push([parseInt(m[1], 10), parseInt(m[2], 10)])
  }
  for (const m of matches(C23_FPS_RANGE, blockText)) {
    ;(decls['帧率'] ||= []).push([parseInt(m[1], 10), parseInt(m[2], 10)])
  }
  for (const m of matches(C23_K_RANGE, blockText)) {
    ;(decls['色温'] ||= []).push([parseInt(m[1], 10), parseInt(m[2], 10)])
  }
  for (const m of matches(C23_PCT_RANGE, blockText)) {
    ;(decls['百分比'] ||= []).push([parseInt(m[1], 10), parseInt(m[2], 10)])
  }
  for (const m of matches(C23_ENUM_RANGE, blockText)) {
    const lo = m[1], hi = m[2]
    ;(decls['枚举'] ||= []).push([C23_ENUM_MAP[lo], C23_ENUM_MAP[hi], lo, hi])
  }
  return decls
}

function c23HasCombat(txt: string): boolean {
  const ls = lines(txt)
  const guide = ls.map(ln => /(强制禁止项|禁止项|严禁|不得|不可|负面示例|反例|声音[:：]|音效)/.test(ln))
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i]
    if (C23_EXCLUDE_CTX.test(ln)) continue
    if (i > 0 && guide[i - 1]) continue
    for (const m of matches(C23_COMBAT_SIG, ln)) {
      const ctx = ln.slice(Math.max(0, m.index - 6), m.index + m[0].length + 2)
      if (C23_NEG_COMBAT.test(ctx)) continue
      return true
    }
  }
  return false
}

function c23Check(text: string, styleSource: string | null): { issues: string[]; warns: string[] } {
  const issues: string[] = [], warns: string[] = []

  const _m8 = /^【STYLE/m.exec(text)
  const _m9 = /^【PERFORMANCE/m.exec(text)
  const hasS8 = !!_m8
  const hasS9 = !!_m9
  if (!hasS8) issues.push('C23a 缺段8【STYLE｜视觉风格 · 全片锁死】——I 画风锁未落地（选卡/默认卡后由系统生成）')
  if (!hasS9) issues.push('C23a 缺段9【PERFORMANCE｜表演与动作 · 全片锁死】')

  function block(tag: string): string {
    const m = new RegExp('^' + escapeRegExp(tag), 'm').exec(text)
    if (!m) return ''
    const i = m.index
    const j = text.indexOf('\n【', i + 1)
    return text.slice(i, j > 0 ? j : text.length)
  }

  const styleBlock = block('【STYLE')
  const perfBlock = block('【PERFORMANCE')

  const decls = c23Decls(styleBlock + '\n' + perfBlock)
  for (const k of ['光比', '镜头']) {
    if (hasS8 && !decls[k]) issues.push(`C23a 段8 缺少可解析的「${k}」区间声明（如 光比 [1:6, 1:10] / 镜头 [21mm, 28mm]）`)
  }
  for (const bad of ['适度的光比', '较强的反差', '适中的饱和度', '合适的景深']) {
    if (styleBlock.includes(bad)) issues.push(`C23a 段8 出现不可解析的模糊表述「${bad}」——槽位必须写量化区间`)
  }

  // C23d1 三方名（只扫交付正文）
  const d1Text = stripMdMeta(text)
  for (const name of C23_NAMES) {
    if (d1Text.includes(name)) issues.push(`C23d1 交付层出现三方名「${name}」——选项层名字不进交付层，只写参数组`)
  }
  for (const m of matches(C23_STUDIO_HINT, d1Text)) {
    issues.push(`C23d1 疑似工作室名：…${d1Text.slice(Math.max(0, m.index - 8), m.index + m[0].length + 4).trim()}…`)
  }

  // 镜块切分
  const shotBlocks: Array<{ id: string; text: string }> = []
  let cur: { id: string; text: string } | null = null
  for (const ln of lines(text)) {
    const m = matchAtStart(C23_SHOT_LINE, ln)
    if (m) {
      if (cur) shotBlocks.push(cur)
      const sid = m[1] || m[2] || '镜头'
      cur = { id: sid, text: m[3] }
    } else if (cur !== null && ln.trim() && !ln.startsWith('【')) {
      cur.text += ' ' + ln.trim()
    }
  }
  if (cur) shotBlocks.push(cur)

  // C23b 区间越界 + C23c 特效超支
  for (const sb of shotBlocks) {
    const t = sb.text
    for (const m of matches(C23_SHOT_LIGHT, t)) {
      const val = parseFloat(m[1])
      for (const [lo, hi] of decls['光比'] || []) {
        if (!(lo <= val && val <= hi)) {
          issues.push(`C23b ${sb.id} 光比 1:${val} 越界，段8 区间为 [1:${lo}, 1:${hi}]——镜头取值必须落在段8 笼子内`)
        }
      }
    }
    for (const m of matches(C23_SHOT_LENS, t)) {
      const val = parseInt(m[1], 10)
      for (const [lo, hi] of decls['镜头'] || []) {
        if (!(lo <= val && val <= hi)) issues.push(`C23b ${sb.id} 镜头 ${val}mm 越界，段8 区间为 [${lo}mm, ${hi}mm]`)
      }
    }
    for (const m of matches(C23_SHOT_FPS, t)) {
      const val = parseInt(m[1], 10)
      for (const [lo, hi] of decls['帧率'] || []) {
        if (!(lo <= val && val <= hi)) issues.push(`C23b ${sb.id} 帧率 ${val}fps 越界，段9 区间为 [${lo}fps, ${hi}fps]`)
      }
    }
    const hit = uniqSorted(C23_VFX_WORDS.filter(w => t.includes(w)))
    if (hit.length > 3) {
      warns.push(`C23c ${sb.id} 并列视觉特效类 ${hit.length} 项 > 3：${hit.join('/')}——渲染负载超支，砍到 3 类以内`)
    }
  }

  // C23d② 转译丢失
  if (styleSource) {
    const dims = ['成像底层', '形体骨相', '影调区间', '色彩区间', '空气介质', '光学区间', '材质响应', '特效语言', '禁项']
    const hitDims = dims.filter(d => styleBlock.includes(d))
    const hasRange = !!(c23Decls(styleBlock)['光比'] || c23Decls(styleBlock)['镜头'])
    const n = new Set(C23_PARAM_HINTS.filter(w => styleBlock.includes(w))).size
    if (hitDims.length < 4 || !hasRange || n < 5) {
      issues.push(`C23d2 转译丢失：STYLE_BIBLE 记了来源「${styleSource}」，但段8 未落到成组参数组（参数维度 ${hitDims.length}/9 · 含数值区间=${hasRange} · 特征词 ${n}）——只写「电影感画风」不算转译，须按 director-param-library.md 落 11 槽位`)
    }
  }

  // C23e 题材越界
  if (styleSource && C23_STYLE_ABILITY[styleSource]) {
    const [fight, fx] = C23_STYLE_ABILITY[styleSource]
    if (c23HasCombat(text) && fight <= 0) {
      issues.push(`C23e 题材越界：稿含打斗信号，但来源风格「${styleSource}」打斗承载 ★${fight}——硬写拍不出来，应换 T1/T7/T8 系风格（style-fit-and-combat-matrix.md）`)
    }
    if (/(特效强度\s*[=:：]?\s*高|高密度特效|粒子密度高|满屏特效)/.test(text) && fx <= 1) {
      issues.push(`C23e 题材越界：稿声明高强度特效，但来源风格「${styleSource}」特效承载 ★${fx}——其参数组明确禁该类表现`)
    }
  }

  // C23f 单镜超载（B1/B2）
  for (const sb of shotBlocks) {
    const t = sb.text
    const persons = findAll(C23_PERSON_TOKEN, t).length
    const full = !!search(C23_FULL_BODY, t)
    const solo = !!search(C23_SOLO_DECL, t)
    const interact = !!search(C23_INTERACT_SEM, t)
    if (persons >= 2 && full && !solo && !interact && search(C23_INTRO_SEM, t)) {
      issues.push(`C23f ${sb.id} B1 违反：同一镜内建立 ${persons} 个人物（入画/交接语义 + 全身或兵器描述）——一镜一个全身人物，交接动作拆两镜（实拍病根：模型丢角色，只渲染信息量大的那个）`)
    } else if (persons >= 2 && full && !solo && !interact) {
      warns.push(`C23f ${sb.id} 疑似 B1：同镜 ${persons} 个人物 + 全身/兵器描述，但未写互动关系或单人声明（信息量超载，请显式处理）`)
    }
    const acts = uniqSorted(matches(C23_ACTION_INTENT, t).map(m => m[0]))
    if (acts.length > C23_B2_LIMIT) {
      issues.push(`C23f ${sb.id} B2 违反：单镜动作意图 ${acts.length} 项 > ${C23_B2_LIMIT}：${acts.join('/')}——一镜一击（位移/换位/崩裂一并计入），其余下沉到相邻镜`)
    }
  }

  return { issues, warns }
}

function looksLikeFeed(text: string): boolean {
  if (search(TIME_RE, text) && search(SHOT_TAG_RE, text)) return true
  if (SEVEN_SEGMENTS.filter(s => text.includes(s)).length >= 6) return true
  if (/^\s*(?:subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:/m.test(text)) return true
  return false
}

// ============================================================================================
// 主校验：validate(text, model, track, combat, c23, style_source, aspect, plugin)
// ============================================================================================

export interface MachineCheckOptions {
  model?: '2.5' | '2.0'
  track?: string
  combat?: 'on' | 'off' | 'auto'
  c23?: 'on' | 'off' | 'auto'
  styleSource?: string | null
  aspect?: string | null
  plugin?: 'auto' | 'real' | 'xuanhuan' | 'combat' | 'off'
}

export interface MachineCheckResult {
  issues: string[]
  warns: string[]
  /** 高危实拍必崩：被提升为阻断级的 WARN（FATAL_WARN_PREFIXES） */
  blockingWarns: string[]
  stats: { duration_s: number; shots: number; chars: number }
  passed: boolean
  isFeed: boolean
  combatChecked: boolean
  c23Checked: boolean
}

export function validateVideoPrompt(text: string, opts: MachineCheckOptions = {}): MachineCheckResult {
  const model = opts.model || '2.5'
  const track = opts.track || '1'
  const combat = opts.combat || 'auto'
  const c23 = opts.c23 || 'auto'
  const styleSource = opts.styleSource ?? null
  const aspect = opts.aspect ?? null
  const plugin = opts.plugin || 'auto'

  const issues: string[] = []
  const warns: string[] = []

  const _rawLen = text.length
  const _rawTextForC30 = text
  text = stripMdMeta(text)

  // ---- C1/C2/C3 时间轴（逐段）----
  const segmentsTime = splitSegments(text)
  const tr: Array<[number, number, number]> = []
  let noAxis = true
  const dlgLineRanges: Array<[number, number]> = []

  for (const [sn, sb, st] of segmentsTime) {
    const stLines = lines(st)
    const trp = parseTimeRanges(st)
    if (!trp.length) continue
    const headP = trp.slice(0, 12).map(([, , ln]) => stLines[Math.max(0, ln - 1)]).join('\n')
    let dP = (['对话', '对白', '文戏', '谈判', '争执', '争吵', '商议', '聊'].some(w => headP.includes(w))
      && !['空镜', '打斗', '战斗', '武戏', '转场', '蒙太奇', '独白', '宣判', '静场', '留白', '氛围段', '长镜段', '情绪积累'].some(w => headP.includes(w)))
    if (!dP) {
      const cntP = trp.filter(([, , ln]) => {
        if (!(0 <= ln - 1 && ln - 1 < stLines.length)) return false
        const l = stLines[ln - 1]
        const di = l.indexOf('台词：')
        if (di < 0) return false
        return !l.slice(di + 3, di + 4).startsWith('无')
      }).length
      dP = cntP >= 2
    }
    if (dP) dlgLineRanges.push([sb, sb + stLines.length])
  }

  function inDlg(ln: number): boolean {
    return dlgLineRanges.some(([a, b]) => a <= ln && ln < b)
  }

  for (const [sn, sb, st] of segmentsTime) {
    const trSeg = parseTimeRanges(st)
    for (const [s, e, ln] of trSeg) tr.push([s, e, sb + ln - 1])
    if (!trSeg.length) continue
    noAxis = false
    const d = round2(Math.max(...trSeg.map(([, e]) => e)))
    if (d > LIMITS[model] + 0.01) issues.push(`C1 [${sn}] 段时长 ${d}s 超 ${model} 上限 ${LIMITS[model]}s`)
    if (model === '2.5') {
      if (d < 12) warns.push(`C1b [${sn}] 段时长 ${d}s < 12s 下限（2.5 建议 25~30s 吃满上限，过短会显著增加段数与段缝）`)
      else if (15 < d && d < 25) warns.push(`C1b [${sn}] 段时长 ${d}s 落在碎段区（2.5 默认 25~30s；16~24s 既吃不到长镜头红利又比 15s 更碎，除非打戏快节奏/单段信息量小，否则合并到 ≥25s）`)
    }
    const n = trSeg.length
    const stLines = st.split(/\r?\n/)
    const isDlg = inDlg(sb)
    const isCmbSeg = combatOn(st, combat)
    const div = isDlg || isCmbSeg ? 2 : 3
    const cap = Math.ceil(Math.floor(d + 0.5) / div) || 1
    if (n > cap) {
      issues.push(`C2 [${sn}] 镜头数 ${n} > 段长÷${div}s 上限 ${cap}${(isDlg || isCmbSeg) ? '（对话段按 ÷2s 放宽以支持正反打 / 打戏段按 ÷2s 支持 2~3s 黄金颗粒度细切）' : ''}`)
    }
    for (const [s, e, l] of trSeg) {
      const g = sb + l - 1
      if (e <= s) issues.push(`C3 第${g}行 时间码倒挂 ${s}->${e}`)
      else if (e - s < (isDlg || isCmbSeg ? 2 : 3)) warns.push(`C2 第${g}行 单镜 ${round2(e - s)}s <${isDlg || isCmbSeg ? 2 : 3}s（碎切风险）`)
      else if (e - s > 6) warns.push(`C10 第${g}行 单镜 ${round2(e - s)}s >6s（talking head 风险：单镜预算 3~5s，长台词按 dialogue-doctor 拆 2~3 镜正反打/反应镜头）`)
    }
    for (let k = 0; k + 1 < trSeg.length; k++) {
      const [s1, e1, l1] = trSeg[k]
      const [s2, e2, l2] = trSeg[k + 1]
      if (Math.abs(e1 - s2) > 0.05) {
        const kind = s2 < e1 ? '重叠' : '断档'
        warns.push(`C3 第${sb + l1 - 1}->${sb + l2 - 1}行 ${kind}(${e1} vs ${s2})`)
      }
    }
    if (trSeg[0][0] > 0.05) warns.push(`C3 [${sn}] 全新生成建议从 0 起手`)
  }
  if (noAxis) warns.push('C1-C3 未识别到时间轴（如为纯文生视频短片可忽略）')
  const dur = round2(tr.length ? Math.max(...tr.map(([, e]) => e)) : 0)
  const [feed, hasFence] = feedBody(text)

  // ---- C4 字符预算 ----
  if (segmentsTime.length > 1) {
    for (const [sn, , st] of segmentsTime) {
      if (st.length > MAX_CHARS) {
        issues.push(`C4 [${sn}] ${st.length} 字符 > 预算 ${MAX_CHARS}（多段文件按段判；段级红线 ≤1900 字 / 2000 硬上限见 gate_check.py 闸门3。按 seedance-render-engine 压缩顺序裁删）`)
      }
    }
  } else if (text.length > MAX_CHARS) {
    issues.push(`C4 共 ${_rawLen} 字符 > 预算 ${MAX_CHARS}（篇级兜底·按整份文件 len() 计；段级字数见 gate_check.py 闸门3。按 seedance-render-engine 压缩顺序裁删）`)
  }

  // ---- C5 版本语法 ----
  if (model === '2.0') {
    if (text.toUpperCase().includes('[SFX')) issues.push('C5 Seedance 2.0 无官方声音字符标记（音效/台词以文字写入镜行、默认由模型生成）')
    for (const w of ['顿挫', '微停顿', '咬住']) {
      if (text.includes(w)) issues.push(`C5 2.0 禁顿挫词「${w}」（会渲染成真停顿）`)
    }
  } else if (!text.toUpperCase().includes('[SFX')) {
    warns.push('C5 2.5 建议用 [SFX:] 原生音效标记')
  }

  // ---- C6/C6b 画幅 ----
  if (!/aspect_ratio\s*=/.test(text) && !/【画幅风格】\s*(?:\n\s*)?[^【\n]{0,100}?(16:9|9:16|21:9|1:1)/.test(text)) {
    issues.push('C6 缺画幅回填（体内 aspect_ratio= 或【画幅风格】段内写 16:9/9:16/21:9）')
  }
  const RATIO_KEYS = ['2.35:1', '2.39:1', '21:9', '16:9', '9:16', '4:3', '1:1']
  const arField = findAll(/aspect_ratio\s*[:=]\s*([0-9]+\s*[:：]\s*[0-9]+)/g, text, 1)
    .map(a => a.replace(/\s/g, '').replace('：', ':'))
  const arRead: string[] = []
  for (const m of matches(/(?:【画幅风格】|【画幅】)[^\n]{0,80}/g, text)) {
    for (const k of RATIO_KEYS) {
      if (m[0].includes(k)) { arRead.push(k); break }
    }
  }
  const arUniq = uniqSorted(arField)
  if (arUniq.length > 1) {
    issues.push(`C6b 画幅字段自相矛盾：稿内 aspect_ratio= 出现多种取值 ${arUniq}——画幅一经锁定，全流程（每条提示词/每个时间轴/每个 API 载荷）回填同一值，禁止混用（aspect-ratio-adaptation.md §〇·4）`)
  } else if (arUniq.length && arRead.length) {
    const readUniq = uniqSorted(arRead)
    if (!readUniq.includes(arUniq[0])) {
      issues.push(`C6b 画幅不一致：【画幅风格】写明「${readUniq.join('/')}」，但 aspect_ratio=${arUniq[0]}——文字比例与 API 参数不符，模型按参数出图、观感按文字预期，必错位（§三 强约束清单）`)
    }
  }
  if (aspect) {
    const arLock = arUniq[0] || arRead[0] || ''
    if (arLock && aspect.replace('：', ':') !== arLock) {
      issues.push(`C6b 画幅与任务锁不符：--aspect ${aspect}，稿内锁定值 ${arLock}——画幅锁定后不得被模板/示例带偏（aspect-ratio-adaptation.md §〇·2）`)
    }
  }
  const arLock2 = arUniq[0] || arRead[0] || ''
  if (arLock2 === '16:9' || arLock2 === '21:9') {
    const port = ['垂直安全区', '竖向安全区', '上下叠压', '上下对峙', '纵向落差'].filter(w => text.includes(w))
    if (port.length) warns.push(`C6b 画幅口径越界：锁定 ${arLock2} 横屏，正文却出现竖屏构图词 ${port}——横屏禁「垂直安全区/上下叠压」写法，构图按横屏套版（aspect-ratio-adaptation.md §一 / §三·1）`)
  } else if (arLock2 === '9:16') {
    const land = ['三分线左右站位', '左右对峙', '横向位移', '左右推进', '水平展开'].filter(w => text.includes(w))
    if (land.length) warns.push(`C6b 画幅口径越界：锁定 9:16 竖屏，正文却出现横屏构图词 ${land}——竖屏禁横向展开写法，构图按竖屏套版（aspect-ratio-adaptation.md §一）`)
  }

  // ---- C7 七段式核心栏 ----
  const hasGlobalBan = !!search(BAN_FRONT_TAG, text)
  const missing = SEVEN_SEGMENTS.filter(seg => !text.includes(seg) && !(seg === '【强制禁止项】' && hasGlobalBan))
  if (missing.length) {
    issues.push(`C7 七段式缺栏 ${missing}（V7.3.0 主格式唯一命名 · 域命名沿革，段序见 model-adapters §5；段7 亦可用前置【强制禁止项｜前置】等价满足——禁项单点，二选一）`)
  } else if (segmentsTime.length > 1) {
    for (const [sn7, , st7] of segmentsTime) {
      const m7 = SEVEN_SEGMENTS.filter(seg => !st7.includes(seg) && !(seg === '【强制禁止项】' && (hasGlobalBan || search(BAN_FRONT_TAG, st7))))
      if (m7.length) issues.push(`C7 [${sn7}] 七段式缺栏 ${m7}（多段稿每段均须具备完整七段式核心栏，段7 可由全文前置【强制禁止项｜前置】等价满足）`)
    }
  }

  // ---- C24 禁项单点纪律 ----
  function banCount(blob: string): number {
    let n = blob.split('【强制禁止项】').length - 1
    n += findAll(BAN_FRONT_TAG, blob).length
    n += matches(BAN_BLOCK_ANY, blob).filter(m => m.groups?.odd != null).length
    return n
  }
  const banStd = text.split('【强制禁止项】').length - 1
  const banFront = findAll(BAN_FRONT_TAG, text).length
  const banOdd = matches(BAN_BLOCK_ANY, text).filter(m => m.groups?.odd != null).length
  const banTotal = banStd + banFront + banOdd
  const preBlob = text.includes('【画幅风格】') ? text.split('【画幅风格】', 1)[0] : ''
  const preN = banCount(preBlob)
  const segBan = segmentsTime.map(([n, , t]) => [n, banCount(t)] as const)
  const dups = segBan.filter(([, c]) => c > 1).map(([n, c]) => `${n}×${c}`)
  if (banTotal === 0) {
    issues.push('C24b 缺禁项块——段7【强制禁止项】或前置【强制禁止项｜前置】必须二选一（禁项单点纪律）')
  } else if (dups.length) {
    issues.push(`C24a 禁项重复（段内 ${dups.join(', ')}）——每个投喂单元（段）只保留一处禁项块：段7【强制禁止项】或前置【强制禁止项｜前置】二选一；双写=模型读到两份规则，后一份近似噪声（V7.3.6 · 规则命名沿革）`)
  } else if (preN >= 1 && segBan.some(([, c]) => c >= 1)) {
    issues.push(`C24a 禁项重复（前置禁项块 ×${preN} 与段7 并存）——禁项单点纪律：调在前面，后面就不要（V7.3.6 · 规则命名沿革）`)
  } else if (preN > 1) {
    issues.push(`C24a 禁项重复（前置禁项块出现 ${preN} 份）——全稿只保留一处（V7.3.6 · 规则命名沿革）`)
  }

  // ---- C25 表演层 ----
  let c25ln = 0
  for (const line of lines(text)) {
    c25ln += 1
    if (!search(TIME_RE, line)) continue
    const snd = line.indexOf('声音：')
    const dlg = line.indexOf('台词：')
    const cuts = [snd, dlg].filter(x => x >= 0)
    const pic = cuts.length ? line.slice(0, Math.min(...cuts)) : line
    const face = uniqSorted(C25_BLAND_FACE.filter(w => pic.includes(w)))
    if (face.length) warns.push(`C25a 第${c25ln}行 画面段出现抽象神态词 ${face}——神态须落到看得见的肌肉动作（acting-direction.md §七 + FACS 层），禁结果词`)
    const sync = uniqSorted(C25_SYNC_CROWD.filter(w => pic.includes(w)))
    if (sync.length) warns.push(`C25b 第${c25ln}行 群演反应同步词 ${sync}——群体反应须成「波」不成「排」，错开先后与强度（acting-direction.md §十一）`)
    const fake = uniqSorted(C25_FAKE_ACTING.filter(w => pic.includes(w)))
    if (fake.length) warns.push(`C25c 第${c25ln}行 AIGC 假表演词 ${fake}——出现即视为该镜行需重写；改为具体可见的肌肉动作与呼吸，不靠负面词压制（shot-economy-and-acting.md §六·补）`)
    if (CU_SHOT_RE.test(shotHead(pic) || pic.slice(0, 24))) {
      const cuOv = findAll(/挥臂|跨步|奔跑|狂奔|跳跃|转身离开|咆哮大吼|五官扭曲|疯狂大笑|手舞足蹈|大幅挥手/g, pic)
      if (cuOv.length) warns.push(`C25d 第${c25ln}行 特写动作过载（Close-up overload）：特写/大特写镜内写了大幅动作或夸张表情「${uniqSorted(cuOv).join('、')}」——违反《ACTING SYSTEM》铁律14「The tighter the shot, the less movement（镜头越紧，动得越少）」！特写内大幅肢体或五官用力会导致AI人脸五官瞬间崩塌变形，特写只准写眼神微移、呼吸与细微肌肉收紧（acting-direction.md §十二·14）`)
    }
    if (/(?:伸手进|探手进|手伸入|从怀里摸)[^。；]{0,14}(?:摸索|掏出|取出|拿出)[^。；]{0,14}(?:展开|打开|翻开|递出)/.test(pic)) {
      warns.push(`C25e 第${c25ln}行 单镜长过程链穿模高危（States, not transitions）：同一镜内连写「伸手进怀/包→摸索掏出→展开/打开」三步连续转换过程——违反《ACTING SYSTEM》铁律10「视频模型拍不好过渡过程，拍得好当下状态」！单镜内既掏又展必引发手部多指与道具凭空穿模，请改为状态直写（如「右手已捏着半展的信笺」）或拆分为两镜（acting-direction.md §十）`)
    }
    // C18f 景别与表演幅度绑定
    if (CU_SHOT_RE.test(pic)) {
      let low = search(LOWER_BODY_RE, pic)
      if (low && LOWER_BODY_ACTION.test(pic.slice(Math.max(0, low.index - 4), low.index))) low = null
      if (low) warns.push(`C18f 第${c25ln}行 特写承载胸部以下身体「${low[0]}」——特写只能写眼皮/眨眼/眼焦/唇线/喉咙/下颌/鼻息；胸部以下、完整腿脚、复杂空间关系超出景别容纳范围，模型会直接生成错误画面（short-drama-camera-system.md §一 景别与表演幅度绑定）`)
    } else if (/近景/.test(pic)) {
      const fb = search(FULL_BODY_RE, pic)
      if (fb) warns.push(`C18f 第${c25ln}行 近景/中近景承载「${fb[0]}」——近景不装完整站位与全身；需展示手脚或多人完整站位时改中景/全景或拆镜（short-drama-camera-system.md §一 景别与表演幅度绑定）`)
    }
    // C20e 过肩镜头几何
    const ots = search(OTS_RE, pic)
    if (ots) {
      const kind = ots[1], side = ots[2]
      const expect = OTS_SIDE_MAP[`${kind},${side}`]
      const fg = search(OTS_FG_RE, pic)
      if (!fg) warns.push(`C20e 第${c25ln}行 过肩未写左右前景——过肩必须同时写清摄影机在被越角色背后还是前侧、越过哪一侧肩，并落到画面左右前景（short-drama-camera-system.md §三 过肩镜头几何）`)
      else if (fg[1] !== expect) warns.push(`C20e 第${c25ln}行 过肩左右前景写反：「${kind}过${side}肩」应落画面${expect}前景，稿内写「画面${fg[1]}前景」——左右前景写反会让模型把肩膀挡在错的位置、前后景人物颠倒（short-drama-camera-system.md §三）`)
    }
  }

  // ---- C8 首尾帧 ----
  const fl = findAll(/首帧\s*[:：]|尾帧\s*[:：]|参考图绑定|Start\s*Frame|End\s*Frame/gi, text)
  if (fl.length) {
    if (model === '2.0') issues.push(`C8 Seedance 2.0 全面禁用首尾帧：出现 ${uniqSorted(fl)}（2.0 参考图仅锁定形象）`)
    else issues.push(`C8 首尾帧仅限 2.5「参考模式②」：出现 ${uniqSorted(fl)}——若走默认全能参考模式则删去；确用模式②需标注 mode=first_last_frame`)
  }

  // ---- C9 平台高危词 ----
  const hits = GORE_WORDS.filter(w => text.includes(w))
  if (hits.length) issues.push(`C9 正文出现平台高危词 ${hits}——按 platform-safety-compliance-guide 全类目替代表在成句时直接改写（2.0 提及即召唤，禁靠否定式压制）`)

  // ---- C11 接续状态残留 ----
  for (const m of matches(/【接续状态】/g, text)) {
    const ln = text.slice(0, m.index).split('\n').length
    issues.push(`C11 第${ln}行 出现已废止的【接续状态】栏（2026-10-09 废止，残留即 FAIL）——段末末 1 秒整秒定格（前置 0.5 秒收束窗）改写进末镜行内，跨段对齐走段缝画面锁`)
  }

  // ---- C12 否定式 / 工作流 / 转场术语 ----
  const negObj = '(人物|角色|路人|群演|演员|家具|道具|背景|场景|物体|动物|车辆|观众|杂物|陈设|装饰|文字|字幕|水印|logo|LOGO)'
  const negPat = new RegExp('(没有|不要出现|禁止出现)([\\u4e00-\\u9fa5]{0,4})' + negObj)
  for (const ln of lines(feed)) {
    let probe = ln.replace(/台词：.*$/, '')
    probe = probe.replace(/【强制禁止项】.*$/, '')
    probe = probe.replace(/【音效】.*$/, '')
    for (const m of matches(negPat, probe)) {
      if (!/负面|排除|禁止角色变形|无水印|无字幕/.test(probe.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))) {
        warns.push(`C12 正文疑似否定式硬删除「${m[0]}」——硬删除应整句移除，负面仅走【强制禁止项】负面词`)
      }
    }
  }
  const workflow = findAll(/末态继承|拼接节点|换机位|同机位硬接|可变数据|每段重写|每段更新/g, feed)
  if (workflow.length) warns.push(`C12 工作流规则名词混入投喂正文 ${uniqSorted(workflow)}——投喂正文只写「画面长什么样」，规则由执行者应用（末态继承/换机位等不进稿）`)
  const trans: string[] = []
  for (const m of matches(C12_TRANSITION_RE, feed)) {
    if (m[0] === '抽帧') {
      const pre = feed.slice(Math.max(0, m.index - 12), m.index)
      const suf = feed.slice(m.index + m[0].length, Math.min(feed.length, m.index + m[0].length + 2))
      if (/\d+\s*fps\s*$/i.test(pre) || suf.startsWith('感')) continue
    }
    trans.push(m[0])
  }
  const transU = uniqSorted(trans)
  if (transU.length) warns.push(`C12 转场术语裸写进投喂正文 ${transU}——术语只在分镜层标注（段缝两侧逐对标接缝式别），投喂稿转译成「画面怎么接」的可执行描述（如 J-cut 声先画后 →「下一场的声音先于画面 0.5~1s 进入，画面还停在上一场」）；规则权威 creative-transition-library.md §1.3`)

  // ---- C14 画外声 ----
  const isNarr = NARR_TRACKS.has(track)
  let osShots = 0, voShots = 0
  let voOsChars = 0
  const voLines: Array<[number, string]> = []
  let c14ln = 0
  for (const line of lines(text)) {
    c14ln += 1
    if (!search(TIME_RE, line)) continue
    const isOs = !!search(OS_PAT, line), isVo = !!search(VO_PAT, line)
    if (!(isOs || isVo)) continue
    osShots += isOs ? 1 : 0
    voShots += isVo ? 1 : 0
    const sndIdx = line.indexOf('声音：')
    const dlgIdx = line.indexOf('台词：')
    const picSeg = sndIdx >= 0 ? line.slice(0, sndIdx) : dlgIdx >= 0 ? line.slice(0, dlgIdx) : line
    const sndSeg = sndIdx >= 0 ? line.slice(sndIdx) : ''
    const dlgSeg = dlgIdx >= 0 ? line.slice(dlgIdx) : ''
    if (isNarr && isVo) voLines.push([c14ln, picSeg])
    if (isOs && search(MOUTH_PAT, picSeg)) {
      issues.push(`C14 第${c14ln}行 OS 声画分离红线：画面段出现开口词——独白发声时角色必须闭口，改闭口神态微特写承载（嘴唇紧闭/瞳孔/手指，见 vo-os-weaving.md 纪律 2）`)
    }
    if (dlgSeg && ((isOs && search(OS_PAT, dlgSeg)) || (isVo && search(VO_PAT, dlgSeg)))) {
      issues.push(`C14 第${c14ln}行 OS/VO 写进了台词字段——画外声一律走「声音：」段并标注画外身份，台词字段写"台词：无。"`)
    }
    if (sndSeg && /\{[^}]*\}/.test(sndSeg)) {
      issues.push(`C14 第${c14ln}行 OS/VO 使用 {} 台词字符——{} 是锁口型对白通道，画外声禁用；走声音段文字标注（见 vo-os-weaving.md §二）`)
    }
    const seg = sndSeg || picSeg
    voOsChars += cjkCount(seg)
  }
  if (!isNarr) {
    const c14Segs = segmentsTime.length ? segmentsTime : [['全文', 1, text]] as Array<[string, number, string]>
    for (const [sn14, , st14] of c14Segs) {
      let os14 = 0, vo14 = 0, ch14 = 0
      const tr14 = parseTimeRanges(st14)
      const dur14 = tr14.length ? round2(Math.max(...tr14.map(([, e]) => e))) : dur
      for (const l14 of lines(st14)) {
        if (!search(TIME_RE, l14)) continue
        const io = !!search(OS_PAT, l14), iv = !!search(VO_PAT, l14)
        if (!(io || iv)) continue
        os14 += io ? 1 : 0; vo14 += iv ? 1 : 0
        const si14 = l14.indexOf('声音：')
        const di14 = l14.indexOf('台词：')
        const ps14 = si14 >= 0 ? l14.slice(0, si14) : di14 >= 0 ? l14.slice(0, di14) : l14
        const ss14 = si14 >= 0 ? l14.slice(si14) : ''
        const seg14 = ss14 || ps14
        ch14 += cjkCount(seg14)
      }
      const pfx14 = c14Segs.length > 1 ? `[${sn14}] ` : ''
      if (os14 > OS_MAX_SHOTS) warns.push(`C14 ${pfx14}段内 OS 内心独白 ${os14} 镜 > 上限 ${OS_MAX_SHOTS}——独白是配额制工具，超量即广播剧化（vo-os-weaving.md 纪律 1）`)
      if (vo14 > VO_MAX_SHOTS) warns.push(`C14 ${pfx14}段内 VO 旁白 ${vo14} 镜 > 上限 ${VO_MAX_SHOTS}——旁白一点定调即可，多则听书化`)
      const bdg14 = dur14 ? VO_OS_QUOTA * Math.max(1, Math.round(dur14 / 15)) : VO_OS_QUOTA
      if (ch14 > bdg14 + VO_OS_QUOTA_SLACK) warns.push(`C14 ${pfx14}段内 VO+OS 总字数≈${ch14} 字 > 折算上限 ${bdg14} 字（60~80 字/分钟钢性卡口，容差线 +${VO_OS_QUOTA_SLACK}）——删到只剩点题句`)
    }
  } else {
    for (const [ln, pic] of voLines) {
      if (picContentLen(pic) < NARR_PIC_MIN) {
        warns.push(`C14n 第${ln}行 旁白镜无画面描述——解说类「一句旁白配 1~2 个画面」，旁白走「声音：」段、画面段必须给注释画面（不许只剩机位规格）；把旁白删掉画面信息量不得减少（sd-jieshuo-engine §八 · 声画信息差纪律）`)
      }
    }
  }

  // ---- C13 镜长雷同 ----
  if (tr.length >= 4) {
    const trNd = tr.filter(([, , ln]) => !inDlg(ln))
    const durs = trNd.map(([s, e]) => round2(e - s))
    if (durs.length >= 4) {
      const [topDur, topN] = topCount(durs)
      const ratio = topN / durs.length
      if (ratio >= 0.7) warns.push(`C13 镜长雷同：${topN}/${durs.length} 镜均为 ${topDur}s（占比 ${Math.round(ratio * 100)}%）——节奏缺乏快慢呼吸；镜长应按台词字数÷语速(3.5~6字/s，判定按最快档6)+情绪节拍倒推，禁机械等分（quality-gate-review P1「时长全篇雷同」反例）`)
    }
  }

  // ---- C15 拉伸凑时 ----
  const linesAll = lines(text)
  const hasDialogue = !!search(DIALOGUE_RE, text)
  if (tr.length) {
    for (const [s, e, ln] of tr) {
      const line = 0 < ln && ln <= linesAll.length ? linesAll[ln - 1] : ''
      const d = round2(e - s)
      const c15max = (!hasDialogue && line.length < 85) ? NO_DIALOG_SHOT_MAX : 6.0
      if (d > c15max && search(NO_LINE_RE, line) && !search(OS_PAT, line) && !search(VO_PAT, line)) {
        warns.push(`C15 第${ln}行 无台词镜 ${d}s >${NO_DIALOG_SHOT_MAX}s——镜长必须由内容倒推，禁止把氛围/过渡镜拉长凑满剧本标注的【本集时长】（一句≤40字动作行合理节拍≤6s）；总时长允许比剧本标注短至 -25%，宁短勿拉`)
      }
    }
    if (!hasDialogue && dur > PURE_AMBIENT_SEG_MAX && !combatOn(text, combat)) {
      warns.push(`C15 全段 ${dur}s 无任何台词（纯氛围段）>${PURE_AMBIENT_SEG_MAX}s——若非 D 锁③空镜过渡（1~2s）或蓄意留白的爆点镜，即为拉伸凑时；压缩节拍或与钩子台词合并同段`)
    }
  }

  // ---- C16 对白语气 ----
  const dlgList: Array<[number, string, number]> = []
  let c16ln = 0
  for (const line of lines(text)) {
    c16ln += 1
    if (!search(TIME_RE, line)) continue
    const di = line.indexOf('台词：')
    if (di < 0) continue
    if (matchAtStart(NO_LINE_RE, line.slice(di))) continue
    dlgList.push([c16ln, line, di])
  }
  if (dlgList.length) {
    const miss: number[] = []
    for (const [ln, line, di] of dlgList) {
      const si = line.indexOf('声音：')
      const pic = 0 <= si && si < di ? line.slice(0, si) : line.slice(0, di)
      const hit: string[] = TONE_STRONG.filter(w => pic.includes(w))
      for (const w of TONE_SOFT) {
        const k = pic.indexOf(w)
        if (k >= 0 && !TONE_FACE_CTX.test(pic.slice(Math.max(0, k - 8), k))) hit.push(w)
      }
      if (hit.length) warns.push(`C16a 第${ln}行 语气错位：画面段出现声音词 ${uniqSorted(hit)}——声音词会被模型当视觉信息渲染（画出一张冷笑的脸），应移入台词语气位 \`台词：【角色（语气）："…"】\`（model-adapters §5.2）`)
      const tm = search(TONE_TAG_RE, line.slice(di))
      if (!tm) miss.push(ln)
      else {
        const v = TONE_VAGUE.filter(w => tm[1].includes(w))
        if (v.length) warns.push(`C16c 第${ln}行 语气位含空泛结果词 ${v}——按四维改写（情绪色/力度/音质/节奏），如「压着怒·低语」而非「愤怒」`)
        const am = search(IDLE_PROP_RE, pic)
        const tw = TONE_SEVERE.filter(w => tm[1].includes(w))
        if (am && tw.length) warns.push(`C16d 第${ln}行 道具动作与语气冲突：「${am[0]}」×语气「${tw[0]}」——闲适把玩配不上宣判/强情绪时刻（实测出戏：正俯视宣判台词还在把玩玉佩）。换成贴合语气的动作：攥紧/捏住/垂手握着（model-adapters §5.0.3）`)
      }
    }
    if (miss.length / dlgList.length > TONE_MISS_RATIO) {
      warns.push(`C16b 语气缺失：${miss.length}/${dlgList.length} 条台词未带语气位（缺失率 ${Math.round((miss.length / dlgList.length) * 100)}% > 阈值 ${Math.round(TONE_MISS_RATIO * 100)}%）——台词应写 \`台词：【角色（语气）："…"】\`；2.0/2.5 同规格必写，缺语气会让声音与表情一并扁平（官方点名 tone_qualifiers）`)
    }
  }

  // ---- C17 摆位必入画（逐段）----
  const segZw: Array<{ name: string; base: number; ls: string[]; zwBlock: string; zwPeople: string[]; shots: Array<[number, string]>; dlgs: Array<[number, string, number]> }> = []
  for (const [segName, segBase, segText] of splitSegments(text)) {
    const ls = lines(segText)
    const zwI = ls.findIndex(l => l.trimStart().startsWith('【站位声明】'))
    let zwBlock = ''
    let zwPeople: string[] = []
    if (zwI !== -1) {
      zwBlock = ls[zwI]
      let j = zwI + 1
      while (j < ls.length && !ls[j].trimStart().startsWith('【')) { zwBlock += ls[j]; j += 1 }
      zwPeople = findAll(ZW_PERSON_RE, zwBlock, 1)
      if (!zwPeople.length) zwPeople = zwPeopleLoose(zwBlock)
    }
    const shots: Array<[number, string]> = []
    ls.forEach((l, n) => { if (search(TIME_RE, l)) shots.push([segBase + n, l]) })
    const dlgs: Array<[number, string, number]> = []
    for (const [n, l] of shots) {
      const di = l.indexOf('台词：')
      if (di >= 0 && !matchAtStart(NO_LINE_RE, l.slice(di))) dlgs.push([n, l, di])
    }
    segZw.push({ name: segName, base: segBase, ls, zwBlock, zwPeople, shots, dlgs })

    // C17 摆位必入画
    if (zwPeople.length >= 2) {
      const shotBlob = shots.map(([, l]) => l).join('')
      const ctx = zwBlock + ls.filter(l => l.includes('@CHR-') || l.trimStart().startsWith('【站位声明】')).join('')
      const gone: string[] = []
      for (const p of zwPeople) {
        if (shotBlob.includes(p)) continue
        let exempt = false
        for (const m of matches(new RegExp(escapeRegExp(p), 'g'), ctx)) {
          if (C17_EXIT_WORDS.some(w => ctx.slice(m.index + m[0].length, m.index + m[0].length + 24).includes(w))) { exempt = true; break }
        }
        if (!exempt) gone.push(p)
      }
      if (gone.length) warns.push(`C17 [${segName}] 摆位必入画：站位声明摆了位、但本段镜行一次都未带到的人物：${gone.join('、')}——人物凭空消失，跨段衔接必穿帮（model-adapters §5.0.1）。给该人物至少一个镜头（正拍/焦外身影/全景群像/反应镜头均算），或在站位行写明「离画/退场·去向」；重新入画的段要写明入画方式`)
    }
  }

  // ---- C17d 跨段站位漂移 ----
  for (let k = 0; k + 1 < segZw.length; k++) {
    const a = segZw[k], b = segZw[k + 1]
    const sc1 = segScns(a.ls), sc2 = segScns(b.ls)
    if (sc1.size && sc2.size && ![...sc1].every(x => sc2.has(x))) continue
    const f1 = zwFields(a.zwBlock), f2 = zwFields(b.zwBlock)
    const sm = /位移[:：]([^\n]*)/.exec(b.zwBlock)
    const shift = sm ? sm[1] : ''
    const drift: string[] = []
    for (const [nm, [, a2v]] of f2) {
      if (!f1.has(nm)) continue
      const [p1v, a1v] = f1.get(nm)!
      if (p1v && a2v && p1v !== a2v && !shift.includes(nm)) drift.push(`${nm} 画面位置 ${p1v}→${a2v}`)
      else if (a1v && a2v && a1v !== a2v && !shift.includes(nm)) drift.push(`${nm} 背景锚 ${a1v}→${a2v}`)
    }
    if (drift.length) warns.push(`C17d 跨段站位漂移（${a.name}→${b.name}）：${drift.join('；')}——相邻段未写移动的人物，画面位置与背景锚不得改变（法则 20·③ / segment-splicing.md §三 段缝末态继承）。确需挪人，就在该段【站位声明】的「位移：」行写明「起点→终点」`)
  }

  // ---- C17f 单一方位权威 ----
  for (const seg of segZw) {
    const declared = new Map<string, [string, string]>()
    for (const [k, v] of zwFields(seg.zwBlock)) if (v[0]) declared.set(k, v)
    if (!declared.size) continue
    const restate: string[] = []
    for (const [lnNo, ln] of seg.shots) {
      for (const [c, [cp]] of declared) {
        for (const m of matches(new RegExp(escapeRegExp(c), 'g'), ln)) {
          const win = ln.slice(m.index + m[0].length, m.index + m[0].length + 14)
          const hitP = POS_ORDER.find(p => win.includes(p)) || ''
          if (hitP) { restate.push(`镜${lnNo}「${c}」又写${hitP}（段首已锁${cp}）`); break }
        }
      }
    }
    if (restate.length) warns.push(`C17f [${seg.name}] 单一方位权威：镜行重复声明了段首已摆位角色的绝对画面左右——${restate.slice(0, 4).join('；')}${restate.length > 4 ? '…' : ''}。段首【站位声明】是本段唯一方位权威；镜行只写位移增量（向前半步）+ 依托物（背靠卷帘门），禁重复画面左右——双重发位会让人物「东一个西一个、突然出现在身后」（model-adapters §5.0）。确需越轴/大幅移动，在段首【站位声明】的「位移：」行写明「起点→终点」`)
  }

  // ---- C18o 时段光影基准 ----
  for (const seg of segZw) {
    if (!LIGHT_SIG.test(seg.ls.join('') + seg.zwBlock)) {
      warns.push(`C18o [${seg.name}] 时段光影基准缺失：整段既无【场景资产】时段光影、镜行也无任何光影词——AI 会随机打光、画面发灰（model-adapters §5.0.5）。请在【场景资产】补「时段光影：主光方向·光质·光色冷暖·天空/时段·暗部补色」，镜行只写增量/特写眼神光；反光道具不写光效、禁写光比 X:1 参数`)
    }
  }

  // ---- C17e 人数变化未交代 ----
  for (let k = 0; k + 1 < segZw.length; k++) {
    const a = segZw[k], b = segZw[k + 1]
    const sc1 = segScns(a.ls), sc2 = segScns(b.ls)
    if (sc1.size && sc2.size && ![...sc1].every(x => sc2.has(x))) continue
    const c1 = corePeople(a.ls.join('\n')), c2 = corePeople(b.ls.join('\n'))
    if (!c1.size || !c2.size) continue
    let newP = [...c2.keys()].filter(p => !c1.has(p))
    newP = newP.filter(p => !c2.get(p))
    if (!newP.length) continue
    const blob2 = b.ls.join('')
    if (C17E_ENTRANCE_WORDS.some(w => blob2.includes(w))) continue
    warns.push(`C17e 人数变化未交代（${a.name}→${b.name}）：本段新增人物 ${newP.join('、')} 在前一段不存在，且本段全文无任何进出场交代（①画内入画 / ②画外先声 / ③空镜转场 / ④末镜行句尾过渡）——观众读作「跳了一段」（法则 20·②b / segment-splicing.md §四·补二）。补法：前 1~2 秒写「自画面外走入画框 / 从里屋跨门槛进来 / 声先入」等`)
  }

  // ---- C27 对话戏节奏 ----
  function c27SegType(ls: string[]): 'dialogue' | 'none' | null {
    const head = ls.slice(0, 12).join('\n')
    if (C27_NO_DIALOGUE_MARK.some(w => head.includes(w))) return 'none'
    if (C27_DIALOGUE_MARK.some(w => head.includes(w))) return 'dialogue'
    const n = ls.filter(l => search(TIME_RE, l) && l.includes('台词：') && !l.slice(l.indexOf('台词：') + 3, l.indexOf('台词：') + 4).startsWith('无')).length
    return n >= 4 ? 'dialogue' : null
  }
  function c27ShotSpan(line: string): [number, number] | null {
    const trs = parseTimeRanges(line)
    if (!trs.length) return null
    return [trs[0][0], trs[0][1]]
  }
  let c27Seen = 0, c27Ran = 0
  for (const seg of segZw) {
    if (!seg.shots.length) continue
    c27Seen += 1
    const styp = c27SegType(seg.ls)
    if (styp !== 'dialogue') continue
    const spans = seg.shots.map(([, l]) => c27ShotSpan(l)).filter((x): x is [number, number] => !!x)
    if (!spans.length) continue
    c27Ran += 1
    const segLen = Math.max(...spans.map(s => s[1])) - Math.min(...spans.map(s => s[0]))
    if (segLen <= 0) continue
    let chars = 0, openCnt = 0
    const speakers: string[] = []
    for (const [, ln, pos] of seg.dlgs) {
      const segTxt = ln.slice(pos + '台词：'.length)
      for (const q of findAll(/["“]([^"”]*)["”]/g, segTxt, 1)) {
        if (!q.trim()) continue
        chars += q.replace(/[\s，。！？、；：…—"'（）()《》【】\[\],.!?;:]+/g, '').length
        openCnt += 1
        const spm = findAll(/@?([^\s@（(【，,、]{1,8})\s*[（(]/g, segTxt, 1)
        speakers.push(spm[0] || '?')
      }
    }
    const needChars = Math.floor(segLen * 2.0)
    if (chars < needChars) warns.push(`C27b 对话段台词密度不足（${seg.name}）：${Math.round(segLen)} 秒仅 ${chars} 字（下限 ${needChars} 字 ≈2.0 字·秒⁻¹）——台词量太少会被观众读作「技术说明书」。补法：① OS 补位（零口型成本）② 长句拆成两次短开口 ③ 加上对方回嘴追问；⛔ 禁靠拉长文采凑字（对话戏节奏律见 shot-economy-and-acting.md §五·七 · 密度下限见 dialogue-speed-check.md §一·补三）`)
    const needOpen = Math.max(3, Math.round(segLen / 15 * 6))
    if (openCnt < needOpen) warns.push(`C27c 对话段开口次数不足（${seg.name}）：${Math.round(segLen)} 秒仅 ${openCnt} 次开口（下限 ${needOpen} 次 ≈15 秒 6 次）——正反打来回不够，读起来是「一个人说完另一个人说」的站桩式对话。补法：短句化 + 换嘴切镜 + OS 补位`)
    let prevSp: string | null = null, run = 0
    const runHit: string[] = []
    for (const sp of speakers) {
      if (sp === prevSp && sp !== '?') {
        run += 1
        if (run >= 2) runHit.push(sp)
      } else {
        run = sp !== '?' ? 1 : 0
      }
      prevSp = sp
    }
    if (runHit.length) {
      const uniq = uniqSorted(runHit)
      warns.push(`C27d 站桩式对话（${seg.name}）：说话人 ${uniq.join('、')} 连续 ≥2 镜独占开口——切镜点应按「回合」切（每切一次换嘴），不是按「内容块」切。判据：一次切镜至少换 说话人/景别/角度/主体 之一；⛔「只为这句说完了而切、其余变量全不变」= 废切（shot-economy-and-acting.md §五·七·①）`)
    }
  }
  const totalDlgShots = segZw.reduce((n, seg) => n + seg.dlgs.length, 0)
  if (c27Seen >= 2 && c27Ran === 0 && totalDlgShots >= c27Seen * 4) {
    warns.push(`C27x 段落类型识别未生效（元告警）：本次 ${c27Seen} 段全部被判为非对话段，C27b/c/d 与 C28b 一条都没跑——本次「无 C27/C28 告警」不等于合规。请检查段落是否缺少类型标记（对话 / 空镜 / 打斗 / 转场）；若本稿确实全为非对话段（纯空镜/纯打斗），本告警可忽略。`)
  }

  // ---- C28 台词机械化 ----
  if (track !== '3') {
    const c28Words = new Set<string>(), c28B: Array<[string, number]> = [], c28C: Array<[string, string]> = []
    for (const seg of segZw) {
      if (!seg.dlgs.length) continue
      const styp28 = c27SegType(seg.ls)
      let sChars = 0, sPart = 0
      for (const [, ln, pos] of seg.dlgs) {
        const segTxt = ln.slice(pos + '台词：'.length)
        for (const q of findAll(/["“]([^"”]*)["”]/g, segTxt, 1)) {
          if (!q.trim()) continue
          for (const w of C28_BOOKISH) if (q.includes(w)) c28Words.add(w)
          sChars += q.replace(/[\s，。！？、；：…—"'（）()《》【】\[\],.!?;:]+/g, '').length
          sPart += C28_PARTICLE.filter(p => q.includes(p)).length
          for (const sent of q.split(/[。！？!?]+/)) {
            const s = sent.trim()
            if (s.length >= 20 && !C28_PAUSE.some(p => s.includes(p))) c28C.push([seg.name, s.slice(0, 24)])
          }
        }
      }
      if (styp28 === 'dialogue' && sChars >= 40 && sPart === 0) c28B.push([seg.name, sChars])
    }
    if (c28Words.size) warns.push(`C28a 台词出现现代书面虚词：${uniqSorted([...c28Words]).join('、')} —— 口语台词不这么说（「是否」→「是不是」、「因此」→「所以」、「以及」→「还有」、「进行+名词」→ 直接用动词）。⛔ 本码只报不改（下游铁律：台词逐字保留）；修复须回阶段⑤ 过《台词拟人化过站》（dialogue-naturalization.md §二·2 词汇表 + §三 撒碎屑四法）`)
    if (c28B.length) {
      const segS = c28B.slice(0, 3).map(([x]) => x).join('、')
      warns.push(`C28b 对话段零语气词（${segS}）：整段对话没有任何「啊/吧/呢/嘛」类句尾助词——这是机械化台词最典型的指纹。补法见 dialogue-naturalization.md §三·4（⚠️ 宣判段/静场留白段属刻意处理，须在段首显式标注段落意图）`)
    }
    if (c28C.length) {
      const [n0, s0] = c28C[0]
      warns.push(`C28c 长句无停顿（${n0}）：「${s0}…」单句 ≥20 字且句内无任何停顿标点——人说话会断气。拆法：加逗号/破折号/省略号，或按 §三·1·2 打断掉尾（dialogue-naturalization.md §二·4 句式层）`)
    }
  }

  // ---- C29 资产状态偏离 ----
  if (track !== '3') {
    const h29: string[] = []
    const c29Segs = segmentsTime.length ? segmentsTime : [['全文', 1, text]] as Array<[string, number, string]>
    const allCh29 = matches(/【核心人物】([\s\S]*?)(?=\n【|$)/g, text).map(m => m[1]).join('\n')
    for (const [, , st29] of c29Segs) {
      const mCh29 = /【核心人物】([\s\S]*?)(?=\n【|$)/.exec(st29)
      const ch29 = mCh29 ? mCh29[1] : allCh29
      const dec29 = C29_DECL.some(d => st29.includes(d))
      if (ch29 && !dec29) {
        for (const line29 of lines(st29)) {
          const l29 = line29.trim()
          if (!l29 || l29.startsWith('【')) continue
          for (const dv29 of C29_DETACH) {
            const i29 = l29.indexOf(dv29)
            if (i29 < 0) continue
            const ctx29 = l29.slice(Math.max(0, i29 - 10), i29 + dv29.length + 10)
            let best29 = ''
            for (let stI = 0; stI < ctx29.length; stI++) {
              for (const ln29 of [5, 4, 3, 2]) {
                const w29 = ctx29.slice(stI, stI + ln29)
                if (w29.length === ln29 && ch29.includes(w29) && w29.length > best29.length) best29 = w29
              }
            }
            if (best29) h29.push(dv29 + '·' + best29)
          }
        }
      }
    }
    if (h29.length) warns.push(`C29 疑似资产状态偏离未声明：${uniqSorted(h29).slice(0, 4).join('、')} —— 该物品出现在【核心人物】行（属角色锁定项），但本段要求它脱离身体、且全稿无偏离声明。⚠️ 参考图锁定的是「它长什么样」，不是「它必须在身上」；缺替换声明时模型会【叠加】而非【替换】（实测表现：头上一个 + 手里一个 的双现）。补法：①【核心人物】行尾加偏离标注（须含「以本段提示词为准，覆盖角色参考图」替换语）；② 补脱离后本体的物理后果（如「额前头发被压扁」）；③ 禁项兜底。（权威：model-adapters.md §5.0.6；跨 2 镜以上改走 CHAR_STATE 出脱离态参考图）`)
  }

  // ---- C18m 段缝景别落差 ----
  function c18mNorm(name: string): string {
    if (!name) return ''
    if (name === '大全景') return '大远景'
    if (name === '极特写') return '大特写'
    return name
  }
  function c18mHeadSize(line: string): string {
    const head = shotHead(line)
    if (!head) return ''
    const zone = head.slice(0, 32)
    let best = '', at = 1e6
    for (const [name, pat] of C18M_SIZE_DEFS) {
      const m = pat.exec(zone)
      if (m && m.index < at) { best = name; at = m.index }
    }
    return best
  }
  function c18mTailSize(line: string): string {
    const hits = findAll(C18M_MOVE_END, line, 1)
    if (hits.length) return c18mNorm(hits[hits.length - 1])
    return c18mNorm(c18mHeadSize(line))
  }
  function c18mOpenSize(line: string): string {
    const m = search(C18M_FROM, line)
    if (m) return c18mNorm(m[1])
    return c18mNorm(c18mHeadSize(line))
  }
  for (let k = 0; k + 1 < segZw.length; k++) {
    const a = segZw[k], b = segZw[k + 1]
    if (!a.shots.length || !b.shots.length) continue
    const tailLine = a.shots[a.shots.length - 1][1]
    const headLine = b.shots[0][1]
    const ta = c18mTailSize(tailLine), tb = c18mOpenSize(headLine)
    if (!C18M_LADDER.includes(ta) || !C18M_LADDER.includes(tb)) continue
    const sc1 = segScns(a.ls), sc2 = segScns(b.ls)
    if (sc1.size && sc2.size && ![...sc1].every(x => sc2.has(x))) continue
    const settled = !!search(C18M_MOVE_END, tailLine)
    if (!settled && model === '2.0') continue
    const gap = Math.abs(C18M_LADDER.indexOf(ta) - C18M_LADDER.indexOf(tb))
    const limit = settled ? 0 : 1
    if (gap <= limit) continue
    if (search(C18M_BRIDGE, tailLine) || search(C18M_BRIDGE, headLine)) continue
    const why = settled ? `末镜做了收束（尾帧落档「${ta}」），下段首镜必须同档起手` : '段缝默认同档（0 级），最多容忍 1 级相邻档'
    warns.push(`C18m 段缝景别落差 ${gap} 级（${a.name}→${b.name}：末镜终点「${ta}」→ 首镜起点「${tb}」）——尾帧截图就是下一段的首帧参考图，画面必须逐档咬合：${why}。否则参考图对不上画面，观众读作跳切——尤其「末镜拉宽收束后，首镜又反向大幅收紧」（如全景 → 中景）。改法：① 首镜改为与末镜同档（全景收束 → 全景起手）；② 确为刻意的景别跳切（爆点/转场）时，在末镜或首镜行内写出可见的过渡手段（遮挡 / 甩镜 / 运动模糊 / 叠化 / 黑场）；③ 下段段内随后怎么推进都可以——约束只在首帧那一格。（segment-splicing.md §四·补 段缝景别承接律）`)
  }

  // ---- C18 首镜锚定·视线·景别·姿态 ----
  const cuLines: Array<[number, string]> = []
  for (const seg of segZw) cuLines.push(...seg.shots)
  if (cuLines.length >= 6) {
    let cuN = 0
    for (const [, l] of cuLines) {
      const hd = shotHead(l)
      if (!(hd && /特写/.test(hd.slice(0, 32)))) continue
      if (search(CU_PERSON_ANCHOR_RE, l) || search(CU_BODY_PART_RE, l)) cuN += 1
    }
    const cuRatio = cuN / cuLines.length
    const cuMinEff = cuLines.length > 12 ? 0.20 : CU_RATIO_MIN
    const cuMaxEff = cuLines.length > 12 ? 0.45 : CU_RATIO_MAX
    if (cuRatio < cuMinEff || cuRatio > cuMaxEff) {
      const dir = cuRatio < CU_RATIO_MIN ? '低于下限——该给的特写没给，情绪落不了地' : '高于上限——特写滥用，人脸廉价化、节奏碎'
      warns.push(`C18n 人物特写占比 ${cuN}/${cuLines.length} = ${(cuRatio * 100).toFixed(1)}%（${dir}）——区间 ${Math.round(CU_RATIO_MIN * 100)}%~${Math.round(CU_RATIO_MAX * 100)}%；五类必给特写场景自查：情绪拐点 / 关键道具（物件特写不计入配额）/ 眼神记忆点 / 台词重音 / 反应镜头（short-drama-camera-system.md §一·4 特写使用铁律与场景清单）。口径：含人体局部肢体（手/拳/肩背），仅纯物件特写不计入。`)
    }
  }

  const shotLines: Array<[number, string]> = linesAll.map((l, i): [number, string] => [i + 1, l]).filter(([, l]) => search(TIME_RE, l))

  // ---- C7b 镜行解析元检查 ----
  const nTimeline = shotLines.length
  const nHeadok = shotLines.filter(([, l]) => shotHead(l).trim()).length
  if (nTimeline >= 2 && nHeadok === 0) {
    issues.push(`C7b 镜行解析失效：${nTimeline} 条时间轴行无一能解析出镜行头（应为 \`[镜头N] 景别 · 视角 · 运镜。\`）——镜级判据（C18g~l 运镜门 / C13 镜长节奏 / C11b 末镜定格 / C2 单镜时长）全部未生效，本次 PASS 不可信。请按七段式补镜行头（镜号用 \`[镜头N]\`，全角 \`【镜头N】\` 亦可）`)
  } else if (nTimeline >= 4 && nHeadok < nTimeline * 0.6) {
    warns.push(`C7b 镜行解析率偏低：${nTimeline} 条时间轴行仅 ${nHeadok} 条解析出镜行头——部分镜级判据可能未生效。核对是否每条镜行都带镜号与「景别 · 视角 · 运镜」三要素（说明性时间轴行不计）`)
  }

  // ---- C7c 站位人物账解析元检查 ----
  for (const seg of segZw) {
    if (!seg.zwBlock || !seg.zwBlock.includes('（')) continue
    if (findAll(ZW_PERSON_RE, seg.zwBlock).length) continue
    if (seg.zwPeople.length) {
      warns.push(`C7c [${seg.name}] 站位声明未按 \`@人名（…）\` 规范格式书写（本次已宽松兜底解析出：${seg.zwPeople.join('、')}）——漏 \`@\` 会让 C17d 跨段站位漂移等人物账判据的稳定性下降。请统一写成 \`@A（画面右 · 柜台后 · 朝左 · 立 · 身后是木柜）、@B（画面左 · …）\``)
    } else {
      issues.push(`C7c [${seg.name}] 站位人物账解析失效：站位声明里一个人名都解析不出（应为 \`@人名（画面位置 · …）\`）——C17 摆位必入画 / C17b 关系镜 / C17c 背景锚点 / C17d 跨段站位漂移 / C19c 首镜主体优先 全部未生效，本次 PASS 不可信。请按 \`@A（画面右 · 柜台后 · 朝左 · 立 · 身后是木柜）\` 补写`)
    }
  }

  // ---- C17b/C18a/C18b（逐段）----
  for (const seg of segZw) {
    const segBlob = seg.shots.map(([, l]) => l).join('')
    if (seg.zwPeople.length >= 2 && seg.dlgs.length >= 6 && !/电话|通话|听筒|视频通话|对讲机/.test(segBlob)) {
      const hasOts = segBlob.includes('过肩')
      const twoShot = seg.shots.some(([, l]) => seg.zwPeople.filter(p => l.includes(p)).length >= 2)
      if (!hasOts && !twoShot) warns.push(`C17b [${seg.name}] 长对白段关系镜缺失（含台词镜 ${seg.dlgs.length} 个 / 摆位 ${seg.zwPeople.length} 人）：全段既无过肩反打、也无同框关系镜——长对白全程单人正拍轮切，观众读不出『在对谁说话』，关系戏会塌成两段独白。段内至少安排 1 个过肩双人反打；双侧摆位 ≥2 人时至少 1 镜两人同框（满足其一即可）。豁免：对镜独白 / 电话·远程对话 / 一方已离场`)
    }
    if (seg.shots.length && seg.zwPeople.length) {
      const first = seg.shots[0][1]
      if (!first.includes('空镜') && !seg.zwPeople.some(p => first.includes(p))) {
        warns.push(`C18a [${seg.name}] 第${seg.shots[0][0]}行 段首镜无人物锚：首镜既未带站位人物名、也未声明「空镜」——首镜无锚，模型会渲染出空场景（实测出『只有一张床』）。首镜写明主体归属（谁的手/谁的身体局部）或改为带站位人物的中近景（model-adapters §5.0.2）`)
      }
    }
    let propup = false
    for (const [lnI, l] of seg.shots) {
      const picL = l.split('台词：')[0]
      if (propup && search(LIE_RE, picL) && !LIEBACK_EXEMPT.some(w => picL.includes(w))) {
        warns.push(`C18b [${seg.name}] 第${lnI}行 姿态回退：前镜已撑起/坐起/起身，本镜又躺/卧/蜷且无「跌回/躺回」交代——状态回退必穿帮；后续镜写「保持撑坐/已坐起」，确需倒下要写明动作过程（model-adapters §5.0.2）`)
      }
      if (search(PROPUP_RE, picL)) propup = true
    }
  }

  // ---- C18c 视线黏道具 ----
  for (const [lnI, line, di] of dlgList) {
    const si = line.indexOf('声音：')
    const pic = 0 <= si && si < di ? line.slice(0, si) : line.slice(0, di)
    if ((search(IDLE_PROP_RE, pic) || search(LIFT_TOWARD_RE, pic)) && !search(GAZE_ANCHOR_RE, pic)) {
      warns.push(`C18c 第${lnI}行 视线指派缺失：说话同时把玩/举起道具，却未写目光/视线归属——模型默认视线黏在道具上，说话不看人（实测：举玉宣判整段盯着玉）。补「目光落在XX脸上/视线不落在道具上」（model-adapters §5.0.2）`)
    }
  }

  // ---- C18d 景别冲突 ----
  for (const [lnI, l] of shotLines) {
    const si = l.indexOf('声音：')
    const pic = si >= 0 ? l.slice(0, si) : l
    if (search(CU_SHOT_RE, pic) && search(SPACE_EVENT_RE, pic)) {
      warns.push(`C18d 第${lnI}行 景别冲突：特写镜头承载空间级事件（房顶/屋子/门口/全景…）——特写装不下全屋信息，模型只能丢人物保空间（实测出空床）。空间事件改中景以上承载，或近景只保留单一局部主体（model-adapters §5.0.2）`)
    }
  }

  // ---- C18e 反光道具光效 ----
  const shotBlobAll18 = shotLines.map(([, l]) => l).join('')
  if (search(GLOW_PROP_RE, shotBlobAll18)) {
    const banM = /【强制禁止项】[\s\S]*/.exec(text)
    const negDeclared = !!(banM && banM[0].includes('发光'))
    const posDeclared = !!/哑光|实心|石质|原色|光斑/.test(shotBlobAll18)
    if (!(negDeclared || posDeclared)) {
      warns.push('C18e 反光道具光效未声明：镜行出现玉佩/银镯/镜面类反光道具，但既无正向材质描写（实心石质/哑光质感，§5.0.4 首选）也未在【强制禁止项】加光效负面声明——实测会被渲染成自发光半透明魔法道具；镜行写明材质正描写 + 主光源在关键镜行复述（model-adapters §5.0.3/§5.0.4）')
    }
  }

  // ---- C19 禁令失效三改法 ----
  for (const [lnI, l] of shotLines) {
    const si = l.indexOf('声音：')
    const pic = si >= 0 ? l.slice(0, si) : l
    const negHits = findAll(BARE_NEG_RE, pic)
    if (negHits.length) warns.push(`C19a 第${lnI}行 裸禁令词污染：镜行内出现「${negHits.join('、')}」——视频模型对否定不敏感、对词根敏感，被禁概念的词根本身会被当画面词渲染（实测三条否定式禁令全部被无视）。删掉否定式写法，在镜行内改写为正向材质/肌肉/光路描述：道具→「深青色实心哑光石质，玉面呈青玉原色」（零光效描写，禁光斑/受光/照射类从句，见 C20d），表情→「双唇抿紧、嘴角向下压、下颌绷紧」，首帧→「画面主体：<人名>…」单主体开头（禁「X 与 Y 同框」并列主体写法，见 C20a）`)
    if (search(LIGHTPATH_RE, pic) && search(GLOW_PROP_RE, pic)) warns.push(`C19b 第${lnI}行 光路触发器：反光道具被「举向/对着/冲向灯或光」——道具正对光源会诱发模型渲染透光自发光（实测玉佩被画成灯泡）。道具不与光源共现：动作上远离灯火，只写材质本色（青玉原色/哑光金属本色），不做任何光效描写（见 C20d）`)
    if (search(GLOW_PROP_RE, pic) && search(FLAME_MAP_RE, pic)) warns.push(`C19d 第${lnI}行 具象光源映射污染：反光道具镜行写「映出/倒映火苗」——模型不理解「反射」，会把「映出+光源名词」读成光源出现在道具上（玉面画出小火苗/整体泛光）。反光道具零光效描写：删掉全部光斑/受光/照射类从句，只写材质本色（如「玉面呈青玉原色」），且动作上不靠近光源（model-adapters §5.0.4 / C20d）`)
  }

  // ---- C19c 首镜主体优先 ----
  for (const seg of segZw) {
    function shotNo(l: string): number | null {
      const m = SHOT_TAG_RE.exec(l)
      if (!m) return null
      const d = /\d+/.exec(m[0])
      return d ? parseInt(d[0], 10) : null
    }
    let firstShot = seg.shots.find(([, l]) => shotNo(l) === 1)?.[1] ?? null
    if (firstShot === null && seg.shots.length) firstShot = seg.shots[0][1]
    if (firstShot) {
      const fsPic = firstShot.split('声音：')[0].split('台词：')[0]
      const fsHd = shotHead(fsPic)
      let fsAfter: string
      if (fsHd && fsPic.includes(fsHd)) fsAfter = fsPic.slice(fsPic.indexOf(fsHd) + fsHd.length).replace(/^[ 。，,·\t]+/, '')
      else fsAfter = fsPic.includes('。') ? fsPic.split('。').slice(-1)[0] : fsPic
      const firstClause = (fsAfter || fsPic).split(/[，。；]/, 1)[0]
      const bodyLocal = /的手|的脚|的脸|的手背|的肩膀|的侧脸|的眼|画面主体/.test(firstClause)
      const crowdSubject = /^[^，。；]{0,8}(?:两人|二人|双方|对阵|对峙|缠斗|交手|对打|互殴|搏斗|群演|人群|众人|士兵们|双方同时|两人同时)/.test(firstClause)
      const peopleInClause = seg.zwPeople.some(p => firstClause.includes(p)) || /她|他|其/.test(firstClause.slice(0, 4)) || !!crowdSubject
      if (!(peopleInClause || bodyLocal)) {
        warns.push(`C19c [${seg.name}] 首镜主体优先：镜1第一个分句以环境开头、人物名/身体局部出现在其后——环境前置词会诱导模型渲染空场景开场（实测两轮出空房间大全景）。改为「画面主体：<人名>…」或以人名/身体局部开头（model-adapters §5.0.4）`)
      }
    }
  }

  // ---- C19e 禁止项栏目纪律 ----
  const banBlocks: string[] = []
  for (const bm of matches(/【强制禁止项】([\s\S]*?)(?=\n【|```|$)/g, text)) banBlocks.push(bm[1])
  if (!banBlocks.length) {
    const bm2 = /【强制禁止项】([\s\S]*)/.exec(text)
    if (bm2) banBlocks.push(bm2[1])
  }
  for (const banBlob of banBlocks) {
    for (const part of banBlob.split(/[；;]/)) {
      const p = part.trim()
      if (!p || C19E_NEG_WORDS.some(n => p.includes(n))) continue
      const hit = search(C19E_POS_RE, p)
      if (hit) {
        warns.push(`C19e 禁止项栏目错位：正向执行指令「${hit[0]}」写进了【强制禁止项】——该栏被模型当规避清单读，正向要求放进去既不当禁令也不当指令（实测等同废纸）。正向指令回落镜行/【画幅风格】/【站位声明】，禁止项只写负面清单（变形/穿模/现代元素/字幕水印/音频约束；model-adapters §5.0.4 栏目纪律）`)
        break
      }
    }
    const negHits2 = uniqSorted(findAll(BARE_NEG_RE, banBlob))
    if (negHits2.length) warns.push(`C19e 禁止项裸禁令词：「${negHits2.join('、')}」——否定式禁令在禁止项里同样失效（模型对否定不敏感、对词根敏感，被禁概念的词根会被当画面词渲染，实测玉佩仍全片自发光）。删掉该声明，改在镜行写正向描写：道具→「哑光金属本色/实心石质+受光处小片光斑」，表情→「双唇抿紧、嘴角向下压」（model-adapters §5.0.4）`)
  }

  // ---- C20 首镜单主体锚定 + 抽象形容 ----
  for (const [lnI, l] of shotLines) {
    const si = l.indexOf('声音：')
    const pic = si >= 0 ? l.slice(0, si) : l
    const ms = search(MULTI_SUBJ_RE, pic)
    if (ms) warns.push(`C20a 第${lnI}行 并列主体/同框句式：「${ms[0]}」——模型把「X 与 Y 同框」读成画面里有两个主体（实测同一主体的手与脸被渲染成两个头/两张脸）。首镜锚定句只由一个具名主体统摄（「画面主体：林清月…」），身体部位一律以「她的/其+部位」从属出现；确有两个人物时由【站位声明】具名双主体承载，镜行内不写「同框」（model-adapters §5.0.2）`)
    const dm = search(DANGLING_DEIXIS_RE, pic)
    if (dm && !search(DEIXIS_OWNED_RE, pic.slice(0, dm.index))) {
      warns.push(`C20b 第${lnI}行 悬空指示代词：「${dm[0]}」无归属定语——指代词没有先行词，模型会自行补全一个主体（实拍多补出一个头/一张脸）。改写为「她的一只手」这类带归属写法（model-adapters §5.0.2）`)
    }
    const shapeHits = uniqSorted(findAll(ABSTRACT_SHAPE_RE, pic))
    if (shapeHits.length) warns.push(`C20c 第${lnI}行 抽象修辞/比喻具象化污染：「${shapeHits.join('、')}」——视频模型完全不理解文学比喻与虚词修辞，会把比喻词名词直接渲染成画面实体（实测拉片：写「端坐如钟」房梁凭空掉下一口大铜钟；写「四道影子钉在殿砖上」地面多生出5个黑影假人）！必须彻底删除比喻与修辞，只写纯物理可见动作（model-adapters §5.0.4）`)
    const allCastNames = uniqSorted(segZw.flatMap(seg => seg.zwPeople).map(p => p.replace(/^@?(?:CHR-)?/, '')).filter(n => n.length >= 2))
    let gazeOther = /(?:看向|望向|扫过|瞥向|盯住|盯着|凝视|直视|对视)[^。；]{0,18}?(?:@[A-Za-z一-鿿]|长老|师姐|师弟|师兄)/.test(pic)
    if (!gazeOther && allCastNames.length) {
      for (const cn of allCastNames) {
        if (new RegExp(`(?:看向|望向|扫过|瞥向|盯住|盯着|凝视|直视|对视)[^。；]{0,14}${escapeRegExp(cn)}`).test(pic)) { gazeOther = true; break }
      }
    }
    if (gazeOther && /特写|近景|中近景|中景/.test(shotHead(pic) || pic.slice(0, 24))) {
      warns.push(`C20f 第${lnI}行 视线点名画外他角污染：单人/局部镜头内写了「看向/扫过/对视+其他角色名」——视频模型看到角色名就会把对方强行塞进同一画框，甚至左右镜像克隆出双胞胎分身（实测拉片：写「视线依次扫过沈青梧、裴岳」导致中景里克隆出两个白衣沈青梧）！修法：单人镜头写「单人入画」，视线方向只写画框方位（如「目光平视画中前方高台 / 视线投向画右前」），绝不点名画外角色！`)
    }
    if (/依次扫过|先看[^。；]{1,10}再|看向[^，。；]{1,10}(?:一瞬|片刻)[^。；]{0,6}(?:随即|又)?转回/.test(pic)) {
      warns.push(`C20g 第${lnI}行 单镜多重视线切换过载：2~4秒短镜头内包含多次转头/扫视（「依次扫过 / 看向…随即转回」）——模型在短镜内无法完成多目标视线切换，会导致人物直勾勾看镜头或克隆分身！一镜只准有一个固定视线方向！`)
    }
    if (/(?:递出|伸出|探出|塞出|穿过)[^，。；]{0,6}(?:车窗|窗外|门缝|栏杆)/.test(pic)) {
      warns.push(`C20i 第${lnI}行 跨窗口/狭缝递物穿模高危：镜行写了「递出/伸出车窗（或窗外/门缝）」——视频模型无法计算长柄伞/道具穿过狭小车窗的碰撞体积，会直接将道具（尤其是撑开的伞）穿模焊在车门玻璃上！修法（从剧本与分镜源头改因果链）：车内人只降下车窗露脸对视，车外人原本就已撑伞站定（或推开车门下车），严禁跨车窗递长物！`)
    }
    if (/长柄伞|雨伞|油纸伞|黑伞|白伞|纸伞|把伞|撑伞|打伞/.test(pic)) {
      if (!/已撑开|撑着|打着|收拢|合拢|收起握在|捆紧/.test(pic)) {
        warns.push(`C20i 第${lnI}行 可开合道具（伞）缺形态锁：镜行出现「伞」，却未写明是「已撑开遮在头顶」还是「收拢握在手中」——雨景下模型默认把伞画成撑开态，若在车内/室内或递送中必严重穿模！必须前置锁死伞的开合状态，且不在单镜内做开合变形！`)
      }
    }
    const badCausal = findAll(/伞尖悬在|剑尖悬在|刀尖悬在|枪口悬在|一丝不乱|隔着雨看|隔着雾看|隔着玻璃看|隔着人群看/g, pic)
    if (badCausal.length) warns.push(`C20j 第${lnI}行 缺动作因果链/小说废词污染：「${uniqSorted(badCausal).join('、')}」——写「伞尖悬在雨里」缺少「手握何处→道具何种状态→如何位移」的物理动作链，模型会让伞在半空乱伸乱开；写「一丝不乱 / 隔着雨看XX」属不可执行的小说废词与画外点名！请改为完整物理持握态与画框视线方向！`)
    if (/收在[^。；]{0,12}(?:右手|左手|手背|手指|剑鞘|剑柄|刀柄)/.test(pic)) {
      if (l.includes('台词：【') && !/画外音|OS|旁白|心声/.test(l)) {
        warns.push(`C20k 第${lnI}行 局部手部/道具镜头排画内台词冲突：画面已推进收在「手部/剑鞘局部」（嘴部不在画内），却排了画内开口台词——视频模型为了给台词对口型，会强行把人脸扭曲塞进手部特写！修法：要么镜头停在人物半身/近景含脸，要么台词改标「画外音」或删台词！`)
      }
    }
    if (/撞上|轰碎|炸开|爆开/.test(pic) && /缓缓落定|缓缓熄灭|收剑归鞘/.test(pic)) {
      warns.push(`C20l 第${lnI}行 单镜快慢时间悖论：同一短镜头内既要「撞击爆开」又要「烟尘缓缓落定 / 收剑归鞘 / 缓缓熄灭」——2~3秒内无法同时演完剧烈爆炸与慢速收招落定，模型会把爆炸与收剑糊在同一帧！请拆分为两个镜头，或将本镜收束在爆炸余波与持剑站定！`)
    }
    const camFluff = findAll(/焦平面全程死锁|毫米级构图补偿|呼吸式微动|画面线条笔直构图平整|柔和色块与微光/g, pic)
    if (camFluff.length) warns.push(`C20m 第${lnI}行 镜行摄影机说明书废话污染：「${uniqSorted(camFluff).join('、')}」——视频模型听不懂摄影师理论术语，写进镜行会分散人物动作注意力甚至引发画面乱晃！镜行正文只准写人物与道具的纯物理动作！`)
    const tm2 = /^\s*(\d{2}):(\d{2})-(\d{2}):(\d{2})/.exec(l)
    if (tm2) {
      const durSec = (parseInt(tm2[3], 10) * 60 + parseInt(tm2[4], 10)) - (parseInt(tm2[1], 10) * 60 + parseInt(tm2[2], 10))
      if (durSec <= 2 && /迈出一步|上前一步|出列|直起身|起身|转身|躬身|弯腰/.test(pic)) {
        const dm = /台词：【[^】]*?[：:]["“]([^"”]+)["”]/.exec(l)
        if (dm && dm[1].length >= 5) {
          warns.push(`C2d 第${lnI}行 2秒短镜「全身位移+台词」过载：本镜仅 ${durSec} 秒，却同时包含全身位移/行礼动作与 ${dm[1].length} 字台词——2秒内模型无法完成「迈步/起身+行礼+念完句子」（实测人物直接卡在半弯腰动弹不得）！请将本镜时长扩至 ≥3 秒，或删掉位移动作只保留定姿说话！`)
        }
      }
    }
    if (search(GLOW_PROP_RE, pic)) {
      const lm = search(PROP_LIGHT_RE, pic)
      if (lm) warns.push(`C20d 第${lnI}行 道具光效描写：「${lm[0]}」与反光道具共现——道具与光/火产生描写关联就会被模型渲染成发光/点火（实测「指甲盖大暖黄光斑」出片玉佩像打火机点了一簇火）。反光道具零光效描写：删掉光斑/受光/照射类从句，只写材质本色（玉面呈青玉原色/哑光金属本色）（model-adapters §5.0.3）`)
      const nm = search(LAMP_NEAR_RE, pic)
      if (nm) warns.push(`C20d 第${lnI}行 道具贴近光源动作：「${nm[0]}」——道具靠近灯火的动作本身就是点火触发器（实测「举到油灯旁」出片玉佩上冒火苗）。动作改开：道具只把玩/随身佩戴，不与灯火同框共现`)
    }
  }

  // ---- C20h 群像站位朝向矛盾 ----
  for (const seg of segZw) {
    if (seg.zwBlock && seg.zwBlock.includes('画面中后') && (seg.zwBlock.includes('面朝左主位') || seg.zwBlock.includes('面朝右主位'))) {
      warns.push(`C20h [${seg.name}] 群像站位朝向矛盾：【站位声明】主位在「画面中后」，下属却写「面朝左主位 / 面朝右主位」——模型会按字面让左边人朝右、右边人朝左横向90度面对面互看，并触发左右镜像克隆出双份角色！修法：下属统一写「斜背对镜头面朝中后方高台」！`)
    }
    if (seg.zwBlock && seg.zwBlock.includes('画面中后')) {
      const hasLf = seg.zwBlock.includes('左前')
      const hasLb = seg.zwBlock.includes('左后')
      const hasRf = seg.zwBlock.includes('右前')
      const hasRb = seg.zwBlock.includes('右后')
      if ((hasLf && !hasLb && hasRf && hasRb) || (hasLf && hasLb && hasRf && !hasRb)) {
        warns.push(`C20h [${seg.name}] 中轴对称群像「左1右2」偏沉站位触发克隆：【站位声明】在居中主位下使用了「左前1人 + 右前/右后2人」不对称站位——在中轴对称大殿全景中，模型会自动把单人侧的角色（如左前唯一的女角沈青梧）复制出第2个分身填补空缺的左后位（实测拉片开头全景多出一个女性角色）！修法：台下3人改为「从左至右单排三槽位：画面左、画面中前、画面右」，一人一槽左右均衡，绝不留单侧空缺槽！`)
      }
    }
  }

  // ---- 运镜门 C18g~l ----
  const camHeads: Array<[number, string]> = shotLines.map(([ln, l]) => [ln, shotHead(l)])
  const camFamByShot: Array<[number, Set<string>]> = camHeads.map(([ln, h]) => [ln, camFamilies(h)])
  for (const [ln, h] of camHeads) {
    if (h && !camFamilies(h).size) {
      warns.push(`C18g 第${ln}行 镜行未标注运镜：镜行头「${h.trim()}」内无任何运镜词——§四「每个镜头必须标注运镜方式」（固定/推/拉/摇/移/跟/升降/环绕/手持…）。运镜留空即交给模型自选，出片偏静止与套路化；常态用微运镜（极缓慢推/极缓慢横移/呼吸感漂移）替代绝对静止（short-drama-camera-system.md §四）`)
    }
  }
  for (const [ln, fams] of camFamByShot) {
    if (fams.size > CAM_MULTI_MAX) {
      warns.push(`C18h 第${ln}行 一镜多主运镜：单镜并列 ${fams.size} 种运镜 ${uniqSorted([...fams])}（>上限 ${CAM_MULTI_MAX}）——模型无法在一个时间轴上同时执行多套运动，出片必乱或只留第一种。一镜一主运镜；确需复合（如缓慢推 + 轻升）限两层且写明叙事理由（§四 运镜变化铁律 / 高光时刻运镜专题）`)
    }
  }
  for (const [ln, l] of shotLines) {
    const hit = CAM_MOTIVELESS.filter(w => l.includes(w))
    if (hit.length) issues.push(`C18i 第${ln}行 无动机运镜：镜行出现 ${uniqSorted(hit)}——§四 手持三级烈度铁律「烈度必须由情绪买单，禁止无理由晃动」；无叙事动机的晃动/甩动/乱切会把画面变成廉价手持。删掉无动机运镜，改按情绪强度分档（微晃 4~6 分 / 晃动 6~8 分 / 剧烈晃动 ≥8 分，且仅限暴烈冲突·惊恐逃窜·精神失稳·灾难瞬间）`)
  }
  const nShots = camHeads.length
  const fixLns = camFamByShot.filter(([, fams]) => fams.size === 1 && fams.has('固定')).map(([ln]) => ln)
  const fixLnsNd = fixLns.filter(ln => !inDlg(ln))
  const nShotsNd = camFamByShot.filter(([ln]) => !inDlg(ln)).length
  const c18jRatioCap = combatOn(text, combat) ? CAM_FIXED_RATIO_MAX : 0.85
  const c18jRunCap = combatOn(text, combat) ? CAM_FIXED_RUN_MAX : 5
  if (nShotsNd >= CAM_FIXED_MIN_SHOTS && fixLnsNd.length) {
    const r = fixLnsNd.length / nShotsNd
    if (r > c18jRatioCap) warns.push(`C18j 固定镜头过量：${fixLnsNd.length}/${nShotsNd} 镜为纯固定（占比 ${Math.round(r * 100)}% > 上限 ${Math.round(c18jRatioCap * 100)}%）——§四 动静随剧情自然发生：对白交锋、情绪定格、道具展示可用固定；情绪推进、人物走位、空间揭示宜配缓慢推拉（10~15cm 物理限位）/横移/摇跟，避免全片沦为纯静态PPT`)
  }
  let runFixed = 0
  for (const [ln, fams] of camFamByShot) {
    if (fams.size === 1 && fams.has('固定') && !inDlg(ln)) {
      runFixed += 1
      if (runFixed >= c18jRunCap) {
        warns.push(`C18j 第${ln}行 连续 ${runFixed} 镜固定——§四 连续过多固定镜头易致画面呆板，建议在情绪递进或空间揭示镜加入缓慢推拉（10~15cm 物理限位）/横移/摇跟`)
        runFixed = 0
      }
    } else runFixed = 0
  }
  let prevKey: string | null = null, sameRun = 0
  for (const [ln, fams] of camFamByShot) {
    const key = fams.size ? uniqSorted([...fams]).join(',') : null
    if (key !== null && key !== '固定' && key === prevKey && !inDlg(ln)) {
      sameRun += 1
      if (sameRun === CAM_SAME_RUN_MAX) {
        warns.push(`C18k 第${ln}行 连续 ${sameRun} 镜同一运镜「${key}」——§四 运镜变化铁律：相邻镜头动态运镜应产生变化，避免连续 3 镜完全相同运动（唯一例外：手持剧烈晃动的爆发顶点短链）`)
        sameRun = 0
      }
    } else {
      sameRun = (key !== null && key !== '固定') ? 1 : 0
    }
    prevKey = key
  }
  const c18kCoverMin = combatOn(text, combat) ? CAM_COVER_MIN : 2
  for (const seg of segZw) {
    const fams = new Set<string>()
    for (const [, l] of seg.shots) camFamilies(shotHead(l)).forEach(f => fams.add(f))
    if (inDlg(seg.base)) continue
    if (seg.shots.length >= CAM_COVER_MIN_SHOTS && fams.size < c18kCoverMin) {
      warns.push(`C18k [${seg.name}] 段内运镜覆盖不足：${seg.shots.length} 镜只用 ${fams.size} 种运镜 ${uniqSorted([...fams])}（<${CAM_COVER_MIN} 种）——§四：同一场戏内运镜方式至少覆盖 4 种，避免单一手法贯穿全场（禁为凑多样性使用无叙事理由的运镜）`)
    }
  }
  const camBlob = camHeads.map(([, h]) => h).join('')
  for (const { name, pat, limit, scope } of CAM_HEAVY_LIMITS) {
    if (scope === 'whole') {
      const c = findAll(pat, camBlob).length
      if (c > limit) warns.push(`C18l 重技法名额超限：${name} 出现 ${c} 次 > 全片上限 ${limit}——重技法用多了廉价化，只用于重锤瞬间（§四 重技法频率上限）`)
    } else {
      const segs = segZw.filter(seg => seg.shots.some(([, l]) => search(pat, shotHead(l)))).length
      if (segs > limit) warns.push(`C18l 重技法名额超限：${name} 覆盖 ${segs} 个段 > 上限 ${limit} 段——§四 重技法频率上限（用多了廉价化，只用于重锤瞬间）`)
    }
  }

  // ---- C21/C22 打戏护栏 ----
  if (combatOn(text, combat)) {
    const ranges = combatRanges(text)
    const total = unionLen(ranges.map(([s, e]) => [s, e]))

    // C21a
    let run = 0
    let aDone = false
    for (const [s, , , pic] of ranges) {
      if (search(COMBAT_MOVE_RE, pic)) run = 0
      else {
        run += 1
        if (run >= COMBAT_SAME_RUN && !aDone) {
          warns.push(`C21a 自 ${s}s 起连续 ${run} 个时间区间无身体位移——打戏每个区间攻守双方都必须发生位移（冲刺/滑退/翻滚/腾空/被击飞）；只有「站着 + 发光」= 模型把每段理解成了一张静态画（combat-intensity-guardrails.md §二·①）${COMBAT_EGRESS}`)
          aDone = true
        }
      }
    }
    // C21b/C21c
    const spans = ranges.filter(([, , , pic]) => search(COMBAT_CONTACT_RE, pic)).map(([s, e]) => [s, e] as [number, number])
    if (ranges.length && !spans.length) {
      warns.push(`C21b 全片无任何实体接触——打戏至少要有兵器交击/拳脚着肉/抓握/撞击；全程「隔空对波」（双方站立不动、各放能量束在空中相撞）看着燃，实则零接触零位移。仅允许用在①高潮大招释放瞬间（1~2s）②短暂反制瞬间（≤0.5s 且紧接着必须贴身）（combat-intensity-guardrails.md §二·①⑥）${COMBAT_EGRESS}`)
    } else if (total > 0) {
      const close = unionLen(spans)
      if (close / total < COMBAT_CLOSE_RATIO) {
        warns.push(`C21c 贴身对招时长占比 ${Math.round((close / total) * 100)}% < 33% 下限——全片 ${round2(total)}s 中仅 ${round2(close)}s 有实体接触。15s 片贴身缠斗不得少于 5s、30s 片不得少于 10s，「隔空对波」不计入（combat-intensity-guardrails.md §二·③）${COMBAT_EGRESS}`)
      }
    }
    // C21d
    function sig(pic: string): [string, string] {
      const s = search(COMBAT_SIZE_RE, pic)
      const ang = search(COMBAT_ANGLE_RE, pic)
      return [s ? s[0] : '', ang ? ang[0] : '']
    }
    const sigs = ranges.map(([, , , pic]) => sig(pic))
    let runD = 1
    let dDone = false
    for (let i = 1; i < sigs.length; i++) {
      if (sigs[i][0] === sigs[i - 1][0] && sigs[i][1] === sigs[i - 1][1] && !(sigs[i][0] === '' && sigs[i][1] === '')) {
        runD += 1
        if (runD >= COMBAT_SAME_RUN && !dDone) {
          warns.push(`C21d 自 ${ranges[i - runD + 1][0]}s 起连续 ${runD} 个区间机位完全相同（${sigs[i][0] || '未标景别'}·${sigs[i][1] || '未标角度'}）——相邻区间的机位或双方相对位置必须变化，否则退化成「同一张画反复播」（combat-intensity-guardrails.md §二·②）${COMBAT_EGRESS}`)
          dDone = true
        }
      } else runD = 1
    }

    // C22
    if (ranges.length) {
      for (const [s, e, , pic] of ranges) {
        const d = e - s
        const lim = iauLimit(d)
        const n = combatIau(pic)
        if (n > lim) warns.push(`C22a ${s}-${e}s（${round2(d)}s）独立动作单元 ${n} 个 > 上限 ${lim}（按 combat-rhythm-and-load-guardrails.md §1.2）——视频模型在该时长内可靠渲染约 2~3 个动作，超出部分会被丢弃、只留第一个匀速播完，出片必现『贴脸乱动 + 后半段动作消失』= 像小孩打架。解法：拆镜或删动作（铁律0 第1步 一镜一主任务）${COMBAT_EGRESS}`)
      }
      for (const [s, e, , pic] of ranges) {
        const tt = combatTacticTypes(pic)
        if (tt.length >= 3) warns.push(`C22b ${s}-${e}s 一镜覆盖 ${tt.length} 类动作技术（${tt.join('/')}）≥3——违反铁律0 第1步「一镜一主任务，不贪多」。一镜只能证规模/证力量/证速度/证招式/证招式轨迹/证情绪 之一；多任务并存时模型会平均分配权重，结果每一类都渲染不清（combat-rhythm-and-load-guardrails.md §1.3）${COMBAT_EGRESS}`)
      }
      const miss4: Record<string, string[]> = {}
      for (const [s, , , pic] of ranges) {
        const clean = stripStructAnnot(pic)
        for (const [beat, rx] of Object.entries(COMBAT_BEAT_RE)) {
          if (!search(rx, clean)) (miss4[beat] ||= []).push(`${s}s`)
        }
      }
      if (Object.keys(miss4).length) {
        const d = Object.entries(miss4).map(([b, v]) => `缺「${b}」于镜起 ${v.join(',')}`).join('；')
        warns.push(`C22c 镜内速度四拍不完整——${d}。每一镜内部都须具备『起(慢)→爆(快)→顿(停)→收(慢)』；其中『顿』最关键：命中瞬间画面定住 2~3 帧，是『打到了』的唯一视觉证据，缺顿拍则再多动作也读作『在乱动』（combat-rhythm-and-load-guardrails.md §2.1）${COMBAT_EGRESS}`)
      }
      const sizes = ranges.map(([, , , pic]) => { const m = search(COMBAT_SIZE_RE, pic); return m ? m[0] : '' })
      const full = sizes.filter(z => COMBAT_FULL_SIZE.includes(z)).length
      if (full * 2 < sizes.length) {
        warns.push(`C22d 全身入画景别仅 ${full}/${sizes.length} 镜（不足半数）——全身档（中全景/中景/全景/大远景）是唯一能同时看见身体重心与双脚位置的景别；缺全身档时观众看不到『谁把谁推到哪里』，位移只剩『撞来撞去』的读感（combat-rhythm-and-load-guardrails.md §三）${COMBAT_EGRESS}`)
      }
      let trun = 1, tstart: number | null = null
      let d2Done = false
      for (let i = 1; i <= sizes.length; i++) {
        const tight = i < sizes.length && COMBAT_TIGHT_SIZE.includes(sizes[i])
        if (tight) {
          if (tstart === null) tstart = ranges[i][0]
          trun += (i > 0 && COMBAT_TIGHT_SIZE.includes(sizes[i - 1])) ? 1 : 1
          if (trun > COMBAT_TIGHT_MAX_RUN && !d2Done) {
            warns.push(`C22d 自 ${tstart}s 起连续 ${trun} 镜为贴脸档（${COMBAT_TIGHT_SIZE.join('/')}）> 上限 ${COMBAT_TIGHT_MAX_RUN} 镜——第三镜必须切回全身档，否则观众丢失空间参照，动作读作『原地乱动』（combat-rhythm-and-load-guardrails.md §三·1）${COMBAT_EGRESS}`)
            d2Done = true
          }
        } else {
          trun = 1; tstart = null
        }
      }
    }
  }

  // ---- C26 锚点继承门 ----
  const c26MetaS = matches(/【画幅风格】(.*?)(?=【场景资产】|\n【|$)/gs, text).map(m => m[1]).join('\n')
  const c26ScnS = matches(/【场景资产】(.*?)(?=【核心人物】|【站位声明】|【时间轴分镜】|\n【|$)/gs, text).map(m => m[1]).join('\n')
  const c26CastS = matches(/【核心人物】(.*?)(?=【站位声明】|【时间轴分镜】|\n【|$)/gs, text).map(m => m[1]).join('\n')
  const c26Body = text
  if (!(search(C26_ERA_ANCHOR, c26MetaS) || search(C26_ERA_ANCHOR, c26ScnS))) {
    warns.push('C26a 全稿无世界锚（年代/朝代/技术时代）——剧本层的世界观设定没有落进【画幅风格】或【场景资产】，模型会回落到自己的默认年代（实测：设定 2035 年出片成 80 年代街景）。修法：在【画幅风格】或【场景资产】写明年代锚（年份/朝代 + 技术时代），权威见 sd-script-engine《世界锚卡》与 asset-spatial-ledger.md §四·E 年代锚')
  }
  if (search(C26_FUTURE_ANCHOR, c26MetaS + c26ScnS)) {
    const hitOld = uniqSorted(C26_OLD_ELEMS.filter(w => c26Body.includes(w)))
    if (hitOld.length) warns.push(`C26b 稿面声明未来/现代年代，但正文出现旧时代元素 ${hitOld.slice(0, 6)}——年代锚与画面物证自相矛盾，属「锚点没传下去」的典型病征；按声明年代重写物证，或改回实际年代锚（权威见 asset-spatial-ledger.md §四·E）`)
  }
  if (search(C26_PAST_ANCHOR, c26MetaS + c26ScnS)) {
    const hitMod = uniqSorted(C26_MODERN_ELEMS.filter(w => c26Body.includes(w)))
    if (hitMod.length) warns.push(`C26b 稿面声明古代/近代年代，但正文出现现代元素 ${hitMod.slice(0, 6)}——年代锚与画面物证自相矛盾（AI 幻觉现代元素的高发点），按声明年代改写或改锚`)
  }
  let c26Entries: Array<[string, string]> = matches(C26_ENTRIES_RE, c26CastS).map(m => [m[1], m[2]])
  if (!c26Entries.length && c26CastS.trim()) c26Entries = [['（未具名人物）', c26CastS.trim()]]
  const c26NoAge: string[] = [], c26NoLook: string[] = []
  for (const [name, ppRaw] of c26Entries) {
    const pp = ppRaw.trim()
    if (!pp) continue
    if (!search(C26_CAST_REF_ONLY, pp)) {
      if (!search(C26_AGE_ANCHOR, pp) && !c26NoAge.includes(name)) c26NoAge.push(name)
      if (!search(C26_LOOK_ANCHOR, pp) && !c26NoLook.includes(name)) c26NoLook.push(name)
    } else {
      const ppClean = pp.replace(/声线锁[：:][^；;）)]*/g, '')
      if (!ppClean.includes('偏离') && !ppClean.includes('覆盖') && !ppClean.includes('同段')) {
        if (search(C26_AGE_ANCHOR, ppClean) && search(C26_LOOK_ANCHOR, ppClean)) {
          warns.push(`C26e 全能参考冗余二次介绍告警：【核心人物】@${name} 已绑定参考图，却在后面二次介绍年龄与服装外貌——全能参考直接吃参考图，二次文字介绍反而会干扰图片权重！请精简为「@CHR-角色（参考图N，声线锁：…）」`)
        }
      }
    }
  }
  if (c26NoAge.length) warns.push(`C26c 核心人物缺年龄锚 ${c26NoAge}——【核心人物】须带年龄段（如「28~32岁男性」），否则模型自填年龄、跨镜漂移（实测：用户卡不到人物年龄）。权威见 asset-spatial-ledger.md §角色锚点 + model-adapters.md §5.0.3 外观锚`)
  if (c26NoLook.length) warns.push(`C26d 核心人物缺身份可渲染外观 ${c26NoLook}——只有姓名/身份词没有可画的外观要素，模型会给泛化人像（实测：外卖员出成协警）。按《身份外观三件套》补：职业标识物 + 制服/服装形制 + 气质体态；权威见 sd-asset-engine 角色资产板`)
  for (const m of matches(/@(SCN|PRP)-([\w\-一-鿿]+)\s*[（(]([^）)]*参考图\s*\d+[^）)]*)[）)]/g, c26ScnS)) {
    const kind = m[1], aname = m[2], abody = m[3]
    const abodyClean = abody.replace(/参考图\s*\d+|[：:，,；;\s]|外观以\S*锁定|关键道具|同源建筑|状态[：:][^；;）)]*/g, '')
    if (abodyClean.length > 18) {
      warns.push(`C26e 全能参考冗余二次介绍告警：【场景资产】@${kind}-${aname} 已绑定参考图，却在后面二次介绍陈设/材质细节（「${abodyClean.slice(0, 18)}…」）——全能参考直接吃图，请直接精简为「@SCN-场景名（参考图N）；@PRP-道具名（参考图M）」`)
    }
  }
  for (const m of matches(/@(?:PRP-|道具-)?([A-Za-z0-9_一-鿿]+(?:与|和|及)[A-Za-z0-9_一-鿿]+)/g, c26ScnS)) {
    if (!m[1].includes('场景')) {
      warns.push(`C26g 复合双道具拼图告警：「${m[0]}」将两件独立道具绑在同一张设定图/同一个 @ 标签下——全能参考按整图提取特征，两件分开使用的道具拼一张图会导致端酒杯时冒出发钗、拿发钗时粘着酒杯！必须遵循「一图一独立道具」拆分为两个独立图号！`)
      break
    }
  }
  const allPrpNames = uniqSorted(findAll(/@PRP-([A-Za-z0-9_一-鿿]+)/g, c26ScnS, 1))
  if (allPrpNames.length && segmentsTime.length > 1) {
    for (const pname of allPrpNames) {
      const pRoot = pname.replace(/(?:古剑|宝剑|长剑|佩剑|飞剑|神剑|法宝)$/, '') || pname
      for (const [sn, , st] of segmentsTime) {
        const segScnM = /【场景资产】(.*?)(?=【核心人物】|【站位声明】|【时间轴分镜】|$)/s.exec(st)
        const segScnTxt = segScnM ? segScnM[1] : ''
        if (!segScnTxt.includes(`@PRP-${pname}`) && (st.includes(pname) || (pRoot.length >= 2 && st.includes(pRoot)))) {
          warns.push(`C26f 随身/跨段关键道具漏 @ 告警：${sn} 正文出现了道具「${pname}」，但未在本段【场景资产】挂接「@PRP-${pname}（参考图M）」——随身核心道具在主角出场或使用的所有段落均须全程 @ 跟随！`)
        }
      }
    }
  }

  // ---- 融合规则补载体组：C11b / C17c / C12b ----
  const c11bMiss: string[] = []
  for (const seg of segZw) {
    if (!seg.shots.length) continue
    const last = seg.shots[seg.shots.length - 1][1]
    if (TAIL_FREEZE_WORDS.length && !TAIL_FREEZE_WORDS.some(w => last.includes(w)) && !last.includes('空镜')) c11bMiss.push(seg.name)
  }
  if (!segZw.length) {
    const tlines = lines(text).filter(l => search(TIME_RE, l))
    if (tlines.length && !TAIL_FREEZE_WORDS.some(w => tlines[tlines.length - 1].includes(w)) && !tlines[tlines.length - 1].includes('空镜')) c11bMiss.push('全文')
  }
  if (c11bMiss.length) warns.push(`C11b 段缝末镜缺定格：${c11bMiss} 的末镜未写定格——段末镜须在行内写「末 1 秒全体人物保持姿态与站位、动作完全静止、画面定格」（其前 0.5 秒为收束窗：镜头趋缓、人物停止大幅动作），产出可截帧的定格尾帧供下一段作画面依据；空镜结尾豁免（segment-splicing.md §二 末帧可截性）`)

  const c17cMiss: Array<[string, string[]]> = []
  for (const seg of segZw) {
    const decl = (seg.zwBlock || '').replace(/^\s*【站位声明】[：:]?\s*/, '')
    if (!decl.trim() || ANCHOR_EXEMPT.some(x => decl.includes(x))) continue
    const pairs = matches(/@([^\s@（）()【】，、；;：:]+)\s*[（(]([^）)]*)[）)]/g, decl).map(m => [m[1], m[2]] as [string, string])
    const noanchor = pairs.filter(([, body]) => !ANCHOR_WORDS.some(w => body.includes(w))).map(([nm]) => nm)
    if (noanchor.length) c17cMiss.push([seg.name, noanchor])
  }
  if (c17cMiss.length) {
    const parts = c17cMiss.map(([n, ns]) => `[${n}] ${ns.map(x => '@' + x).join('、')}`)
    warns.push(`C17c 站位声明缺背景锚点：${parts.join('；')} 未绑定身后/侧后背景物——每名主要人物须绑定身后最可辨识的背景物（墙/门/窗/树/柱/家具），跨段不得变位/消失/增生/改比例（segment-splicing.md §二 背景锚点锁）`)
  }
  const cont = uniqSorted(CONTAMINATION_WORDS.filter(w => feed.includes(w)))
  if (cont.length) warns.push(`C12b 跨项目污染：出现 ${cont}——占位语/样例残留/调色板默认词不是「画面长什么样」，不得进投喂正文（quality-gate-review.md §一·补 跨项目污染专检）`)

  // ---- C23 画风锁 ----
  const c23Checked = c23On(text, c23, styleSource)
  if (c23Checked) {
    const { issues: ci, warns: cw } = c23Check(text, styleSource)
    issues.push(...ci); warns.push(...cw)
  }

  // ---- C30 外挂指纹 ----
  if (plugin !== 'off') {
    const shotBlobAll = shotLines.map(([, l]) => l).join('\n')
    const isCombatPlugin = plugin === 'combat'
    const isXuanhuan = plugin === 'xuanhuan' || (['auto', 'combat'].includes(plugin) && combatOn(text, combat) && !!search(C30_XUANHUAN_SIG, text))
    const isReal = plugin === 'real' || (['auto', 'combat'].includes(plugin) && combatOn(text, combat) && !!search(C30_REAL_SIG, text))
    if (isXuanhuan && shotLines.length) {
      const sMiss: string[] = []
      if (!search(C30_SCALE_FRAME, shotBlobAll)) sMiss.push('①画框分数占比（如占画面八成/半幅）')
      if (!search(C30_SCALE_MACRO, shotBlobAll)) sMiss.push('②宏观尺寸量级（如百米/数十丈/丈许粗）')
      if (!search(C30_SCALE_REF, shotBlobAll)) sMiss.push('③五级参照物（如以十丈牌坊/石柱/山峰为参照）')
      if (!search(C30_SCALE_TINY, shotBlobAll)) sMiss.push('④人物渺小占比（如人物仅占画面四分之一/千分之一）')
      const hasElem = !!search(C30_ELEM_3, shotBlobAll)
      if ((plugin === 'xuanhuan' && (sMiss.length || !hasElem)) || (plugin !== 'xuanhuan' && sMiss.length >= 3 && !hasElem)) {
        const detailMiss: string[] = []
        if (sMiss.length) detailMiss.push('尺度四件套缺：' + sMiss.join('、'))
        if (!hasElem) detailMiss.push('缺三层复合元素（主体层/边缘层/表面层 或 外层/中层/内层）')
        warns.push(`C30a R3 玄幻外挂（xuanhuan-combat-director V2.6.0）未完整落字：${detailMiss.join('；')}——尺度四件套缺一即废句重写，特效必须写清三层复合材质（grand-scale-domains.md + xuanhuan-elements-vfx.md）`)
      }
      const shHits = findAll(C30_STATIC_HOLD_RE, shotBlobAll)
      if (shHits.length) warns.push(`C30e 玄幻打戏长时相持状态词违规：「${uniqSorted(shHits).join('、')}」——模型会将此类状态词解析为双手架刀发呆互推3秒！必须改为瞬态爆发动词（劈中即分/震退即变招/借反弹力暴退）（core-combat-laws.md §五·3）`)
      const fkHits = findAll(C30_FAKE_ATK_RE, shotBlobAll)
      if (fkHits.length) warns.push(`C30f 玄幻打戏「假攻击」违规：「${uniqSorted(fkHits).join('、')}」——对手出招严禁写轻松闪过/毫发无损，必须产生明确受力回执（护罩崩裂/滑退数米/骨骼震颤/护甲碎裂）（core-combat-laws.md §二·2）`)
      const wkHits = findAll(C30_WEAK_END_RE, shotBlobAll)
      if (wkHits.length) {
        warns.push(`C30g 玄幻打戏平缓收尾违规：「${uniqSorted(wkHits).join('、')}」——严禁慢悠悠收刀、烟尘缓缓落定或气焰和平消散！终局必须采用协议A（天坑斜插残兵）/协议B（抛飞百米嵌远景岩壁）/协议C（肉身化漫天光粒消散）/协议D（背向飞出画框或刀光冲镜硬切）（core-combat-laws.md §一·5 & §三）`)
      } else if (plugin === 'xuanhuan' && !search(C30_FINISHER_4_RE, shotBlobAll)) {
        warns.push('C30g 玄幻打戏终结收束未匹配四大协议（A 遗物定场 / B 抛飞百米嵌远景岩壁 / C 肉身瓦解化光粒消散 / D 反向错车出画或刀光冲镜硬切）——未按四协议收束极易触发模型在爆心前景凭空刷新跪地败者！（core-combat-laws.md §三 & §六）')
      }
      for (const [lnI, l] of shotLines) {
        const hd = shotHead(l) || l.slice(0, 28)
        if (/中景|全景|远景/.test(hd) && /90°|90度|正侧/.test(hd)) {
          warns.push(`C30i 第${lnI}行 打戏空间感铁律违规：中景/全景使用了「90°侧面/正侧拍」——会产生横版格斗游戏的廉价平面感！中景及以上必须使用 30°~60° 斜侧或低仰/斜俯拍摄（camera-specs-15modes.md §一 铁律1）`)
        }
      }
    }
    if ((isReal || isCombatPlugin || (isXuanhuan && plugin === 'xuanhuan')) && shotLines.length) {
      const hasKin = !!search(C30_KINETIC_11, shotBlobAll)
      const hasDef = !!search(C30_DEF_IMPACT, shotBlobAll)
      if (!(hasKin && hasDef)) {
        const miss30b: string[] = []
        if (!hasKin) miss30b.push('11环动力链身体发力词（蹬地/拧胯/转腰/脊柱/送肩/沉腰…）')
        if (!hasDef) miss30b.push('防守三态与受击物理回执（格挡/卸力/崩裂/凹陷/滑退/音爆环/深壑…）')
        warns.push(`C30b 打戏「法武合一·11环动力链与受击回执」缺失：缺少 ${miss30b.join('、')} ——严禁站桩放光波或笼统套话，必须先写身体11环发力链再长出实体特效并给出受力回执（权威：arsenal-moves-library.md §零 + core-combat-laws.md §四 + kinetic-chain-11.md）`)
      }
    }
    if ((isReal || isCombatPlugin) && !isXuanhuan && shotLines.length) {
      const shHits2 = findAll(C30_STATIC_HOLD_RE, shotBlobAll)
      if (shHits2.length) warns.push(`C30e 打戏长时相持状态词违规：「${uniqSorted(shHits2).join('、')}」——模型会将此类状态词解析为双手架刀/架拳发呆互推3秒！必须改为瞬态爆发动词（combat-iron-laws.md 铁律47③）`)
      const fkHits2 = findAll(C30_FAKE_ATK_RE, shotBlobAll)
      if (fkHits2.length) warns.push(`C30f 打戏「假攻击」违规：「${uniqSorted(fkHits2).join('、')}」——对手出招严禁写轻松闪过/毫发无损，必须产生明确受力或环境破坏回执（defense-evasion-rules.md）`)
      for (const [lnI, l] of shotLines) {
        const hd = shotHead(l) || l.slice(0, 28)
        if (/中景|全景|远景/.test(hd) && /90°|90度|正侧/.test(hd)) {
          warns.push(`C30i 第${lnI}行 打戏空间感铁律违规：中景/全景使用了「90°侧面/正侧拍」——会产生横版格斗游戏的廉价平面感！中景及以上必须使用 30°~60° 斜侧或低仰/斜俯拍摄（camera-action-specs.md §二）`)
        }
      }
    }
    if (isReal && !isXuanhuan && shotLines.length) {
      const r1VfxBad = findAll(/剑气|剑罡|法阵|法相|万剑|飞剑|灵力|真元|神雷|光波对轰|双色粒子对冲|化作流光|法宝/g, shotBlobAll)
      if (r1VfxBad.length) warns.push(`C30j R1 真人写实打斗特效越界污染：「${uniqSorted(r1VfxBad).join('、')}」——R1 写实克制档严禁出现仙侠剑气/法阵/光波对轰等超自然特效词，必须全部改为真实物理受力与环境破坏（sd-real-engine/SKILL.md §一 + r1-combat-core.md §一）`)
      const r1FlyBad = findAll(/空中不落地|凌空悬浮|悬停半空|浮空而立|御空|旋转720|连转数圈|多周旋转/g, shotBlobAll)
      if (r1FlyBad.length) warns.push(`C30k R1 真人写实打斗腾空/旋转超限：「${uniqSorted(r1FlyBad).join('、')}」——违反 r1-combat-core.md §八 腾空口径（跳踢离地≤1.2m、单次≤0.6s落地即卸力，严禁空中不落地/悬停帧，单次旋身≤360°）`)
    }
    if ((combatOn(text, combat) || isReal || isXuanhuan || isCombatPlugin) && shotLines.length) {
      const waitHits = findAll(/原地等待|站立旁观|在旁观看|原地举刀看|在一旁等待|站着不动|旁观等待/g, shotBlobAll)
      if (waitHits.length) warns.push(`C30l 多人打戏「站等（P0阻断）」违规：「${uniqSorted(waitHits).join('、')}」——违反 multi-opponent-rules.md §四 三拍轮转制！未与主角接触的其余敌人必须处于「压上/被击退/绕位」三种可见动态之一，严禁原地站等旁观！`)
      for (const [lnI, l] of shotLines) {
        const si = l.indexOf('声音：')
        const picL = si >= 0 ? l.slice(0, si) : l
        const hd = shotHead(picL) || picL.slice(0, 24)
        if (CU_SHOT_RE.test(hd)) {
          const chrMentions = new Set(findAll(/@(?:CHR-)?([A-Za-z一-鿿]{1,10})/g, picL, 1))
          if (chrMentions.size >= 3) {
            warns.push(`C30l 第${lnI}行 多人打戏特写人数超限：特写/大特写镜内同时点名了 ${chrMentions.size} 名角色（${uniqSorted([...chrMentions])}）——违反 multi-opponent-rules.md §一 & §六「特写禁 ≥3 人（必触发脸崩与分身）」！特写焦平面最多 1~2 人！`)
          }
        }
      }
    }
    if (['real', 'xuanhuan', 'combat'].includes(plugin) || isXuanhuan || isReal) {
      if (!(_rawTextForC30.includes('激活外挂') && _rawTextForC30.includes('已读子库') && _rawTextForC30.includes('外挂指纹'))) {
        warns.push('C30d 外挂激活回执头缺失：未在文档顶部检出完整的三行【外挂激活回执头】（`> 激活外挂：…` / `> 已读子库：…` / `> 本段调用外挂指纹：…`）——请按总控 SKILL.md ★强制读取清单自检规范补齐，证明子技能规则库已实际读取（本项在 `--plugin auto` 下判出 R1/R3 打戏档时同样核验）')
      }
      if (c27Ran > 0 && c26CastS.trim() && !search(C30_VOICE_LOCK, c26CastS)) {
        warns.push('C30c 角色表演档案声线锁未交接：对话段【核心人物】未检出 Voice 声线/音色描述（如「低沉沙哑男声·语速偏慢」）——P3《角色表演档案》的声线锁须贴入 P4【核心人物】行尾（权威：references/acting-direction.md §十 Voice 声线锁）')
      }
    }
  }

  // ---- 高危实拍必崩提升为阻断 ----
  const blockingWarns = warns.filter(w => FATAL_WARN_PREFIXES.some(p => w.startsWith(p)))
  const passed = issues.length === 0 && blockingWarns.length === 0

  return {
    issues,
    warns,
    blockingWarns,
    stats: { duration_s: dur, shots: tr.length, chars: text.length },
    passed,
    isFeed: looksLikeFeed(_rawTextForC30),
    combatChecked: combatOn(text, combat),
    c23Checked,
  }
}

// ============================================================================================
// 六道闸门 gate_check.py 的 TS 重写
// ============================================================================================

const SPEED_BANDS: Array<[RegExp, number, number, string]> = [
  [/耳语|气声|一字一顿|一字一停|一字一句|拖长|断续|哽咽|抽气/, 2.5, 3.5, '慢速重音（节奏维慢）'],
  [/低语|低声|压抑|嘶哑|沉声|沉冷|宣判|喃喃|放缓/, 3.5, 4.5, '偏慢'],
  [/争吵|吼|喊|嚷|咆哮|抢话|慌乱|急促|连珠|语速快/, 5.0, 6.0, '快速/争吵/抢话'],
]
const SPEED_DEFAULT: [number, number, string] = [3.5, 6.0, '标准~高速（判定按 6 字/秒）']
const PAUSE: Array<[string, number]> = [['，', 0.2], ['、', 0.2], ['。', 0.4], ['？', 0.4], ['！', 0.4], ['…', 0.8], ['——', 0.6]]

const GC_TIME_RE = /(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\s*[-~～→]\s*(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?|(\d+(?:\.\d+)?)\s*s\s*[-~～→]\s*(\d+(?:\.\d+)?)\s*s|(?:\A|(?<=[\s\[【\]】]))\s*([0-9]|[1-5]\d)(?:\.\d+)?\s*[-~～→]\s*([0-9]|[1-5]\d)(?:\.\d+)?秒/i
const GC_SHOT_NO_RE = /[\[【]?\s*镜头\s*(\d+)\s*[\]】]?/
const MODE_DECL = /素材形态[：:]\s*[（(]?\s*(M[012])/
const WIRING_HEAD = /^##\s*素材接线单[^\n]*\n/m
const FAKE_VERIFY = /(?<![未不])已核验|(?<![未不])核对一致|(?<![未不])核验通过|已与《?资产图册》?一致/
const NEG_CTX = /未|不|禁止|不得|没有|无核验|仅适用|非/

function parseUnits(text: string): Array<[string, string]> {
  const unitHdrRe = /^(?:##\s*【投喂单元[^\n]*|###+\s*(?:第\s*\d+\s*段|段\s*\d+)[^\n]*)/m
  const ms = matches(unitHdrRe, text)
  const units: Array<[string, string]> = []
  if (ms.length) {
    ms.forEach((m, i) => {
      const title = m[0].replace(/^#+/, '').trim()
      const start = m.index + m[0].length
      const end = i + 1 < ms.length ? ms[i + 1].index : text.length
      const chunk = text.slice(start, end)
      const fm = /```(?:text|prompt)?\s*\n(.*?)```/s.exec(chunk)
      if (fm && fm[1].includes('【画幅风格】')) units.push([title, fm[1]])
      else if (chunk.includes('【画幅风格】') && chunk.includes('【时间轴分镜】')) units.push([title, chunk.trim()])
    })
  }
  if (!units.length) {
    let idx = 1
    for (const fm of matches(/```(?:text|prompt)?\s*\n(.*?)```/gs, text)) {
      if (fm[1].includes('【画幅风格】') && fm[1].includes('【时间轴分镜】')) units.push([`段${idx}`, fm[1]])
      idx += 1
    }
  }
  return units
}

function gcParseShots(body: string): Array<[number, number, number, string]> {
  const shots: Array<[number, number, number, string]> = []
  let autoNo = 0
  for (const line of lines(body)) {
    const tm = search(GC_TIME_RE, line)
    if (!tm) continue
    let s: number, e: number
    if (tm[1] != null) {
      s = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10) + fracToSec(tm[3])
      e = parseInt(tm[4], 10) * 60 + parseInt(tm[5], 10) + fracToSec(tm[6])
    } else if (tm[7] != null) {
      s = parseFloat(tm[7]); e = parseFloat(tm[8])
    } else {
      s = parseFloat(tm[9]); e = parseFloat(tm[10])
    }
    const sm = search(GC_SHOT_NO_RE, line)
    autoNo += 1
    const no = sm ? parseInt(sm[1], 10) : autoNo
    shots.push([no, s, e, line])
  }
  return shots
}

function gcParseLines(body: string): Array<[string, string, string, string]> {
  const out: Array<[string, string, string, string]> = []
  for (const m of matches(/台词：【([^（(]*)（([^）)]*)）：?"(.*?)"】/g, body)) {
    out.push([m[1].trim(), m[2].trim(), m[3], m[0]])
  }
  for (const m of matches(/台词：【([^（(]*)："(.*?)"】/g, body)) {
    out.push([m[1].trim(), '', m[2], m[0]])
  }
  return out
}

function splitWiring(text: string): [string, string] {
  const m = WIRING_HEAD.exec(text)
  if (!m) return [text, '']
  const rest = text.slice(m.index + m[0].length)
  const nxt = /^##\s/m.exec(rest)
  const end = nxt ? m.index + m[0].length + nxt.index : text.length
  return [text.slice(0, m.index) + text.slice(end), text.slice(m.index, end)]
}

function checkAssetMode(text: string, modeArg: string | null | undefined, fails: string[], warns: string[]): string {
  const decl = MODE_DECL.exec(text)
  let mode: string
  if (modeArg === null || modeArg === undefined || modeArg === '' || modeArg === 'auto') {
    if (decl) mode = decl[1]
    else { mode = 'M1'; warns.push('闸门6B 未声明素材形态（首行应写「素材形态：M0/M1/M2」）——形态未定，本次按默认 M1 判定；未声明不得交付') }
  } else {
    mode = modeArg.toUpperCase()
    if (!decl) warns.push(`闸门6B 未声明素材形态，本次按命令行 --mode ${mode} 判定——交付稿首行仍须补声明`)
    else if (decl[1] !== mode) { warns.push(`闸门6B 声明形态 ${decl[1]} 与 --mode ${mode} 不一致，按声明 ${decl[1]} 判定——请核对`); mode = decl[1] }
  }

  const [promptText, wiringText] = splitWiring(text)
  const figsPrompt = uniqSorted(findAll(/图(\d+)/g, promptText, 1).map(Number))
  const figsWiring = uniqSorted(findAll(/图(\d+)/g, wiringText, 1).map(Number))

  if (mode === 'M0' && figsPrompt.length) fails.push(`闸门6B 形态违约：声明 M0（纯提示词）却出现图号 ${figsPrompt}——图号槽位与 M0 互斥，须删净或改声明 M1`)
  if (mode === 'M1' && figsPrompt.length) {
    if (!wiringText) warns.push(`闸门6B 形态违约：M1 稿件引用图号 ${figsPrompt} 但未附《素材接线单》——接线单是 M1 交付必备件（§ 素材接线单）`)
    else {
      const oob = figsPrompt.filter(f => !figsWiring.includes(f))
      if (oob.length) fails.push(`闸门6B 稿内图号 ${oob} 不在《素材接线单》内——用户会去挂一张不存在的图`)
      if (!wiringText.includes('不控制')) warns.push('闸门6B 接线单缺少「不控制什么」列/说明——一张图被当多张用是主要污染源')
    }
  }
  if (mode === 'M0' || mode === 'M1') {
    let ln = 1
    for (const line of lines(text)) {
      if (FAKE_VERIFY.test(line) && !NEG_CTX.test(line)) {
        fails.push(`闸门6B 虚假核验断言（第 ${ln} 行，形态 ${mode}）——本包看不到图，不得声称已核验/与资产图册一致`)
        break
      }
      ln += 1
    }
  }
  return mode
}

function speechSeconds(line: string, tone: string): { needFast: number; needSlow: number; n: number; lo: number; hi: number } {
  let lo = SPEED_DEFAULT[0], hi = SPEED_DEFAULT[1]
  for (const [pat, a, b] of SPEED_BANDS) {
    if (pat.test(tone)) { lo = a; hi = b; break }
  }
  const n = (line.match(/[一-鿿A-Za-z0-9_]/g) || []).length
  let pause = 0
  for (const [c, p] of PAUSE) pause += (line.split(c).length - 1) * p
  return { needFast: n / hi + pause, needSlow: n / lo + pause, n, lo, hi }
}

export interface GateCheckOptions {
  model?: '2.5' | '2.0'
  assets?: number
  mode?: 'auto' | 'M0' | 'M1' | 'M2'
  tol?: number
}

export interface GateCheckResult {
  fails: string[]
  warns: string[]
  infos: string[]
  units: number
  mode: string
  passed: boolean
}

export function gateCheck(text: string, opts: GateCheckOptions = {}): GateCheckResult {
  const model = opts.model || '2.5'
  const assets = opts.assets ?? 9
  const modeArg = opts.mode || 'auto'
  const tol = opts.tol ?? 0.8

  const warns: string[] = [], fails: string[] = [], infos: string[] = []
  const mode = checkAssetMode(text, modeArg, fails, warns)
  const units = parseUnits(text)

  // 闸门 0 结构完整性
  for (const [ui, body] of units.map((u, i) => [i + 1, u[1]] as const)) {
    for (const m of matches(/【[^】\n]*$/gm, body)) fails.push(`闸门0 段${ui}：【 未闭合（行尾缺 】）→ ${m[0].slice(0, 40)}`)
    if ((body.match(/【/g) || []).length !== (body.match(/】/g) || []).length) fails.push(`闸门0 段${ui}：【/】数量不等（${(body.match(/【/g) || []).length} vs ${(body.match(/】/g) || []).length}）`)
    for (const m of matches(/台词：【[^】\n]*\n/g, body)) fails.push(`闸门0 段${ui}：台词行未见 】 收尾 → ${m[0].slice(0, 40)}`)
    const nums = findAll(GC_SHOT_NO_RE, body, 1).map(Number)
    if (nums.length && nums.join(',') !== Array.from({ length: nums.length }, (_, i) => i + 1).join(',')) fails.push(`闸门0 段${ui}：镜号不连续 ${nums}`)
    for (const f of ['【画幅风格】', '【场景资产】', '【核心人物】', '【站位声明】', '【时间轴分镜】']) {
      if (!body.includes(f)) fails.push(`闸门0 段${ui}：缺字段 ${f}`)
    }
    if (body.includes('【接续状态】')) fails.push(`闸门0 段${ui}：出现已废止的【接续状态】栏（2026-10-09 废止，机检 C11 反转为残留拦截）`)
  }

  for (const [ui, body] of units.map((u, i) => [i + 1, u[1]] as const)) {
    const shots = gcParseShots(body)
    const lines2 = gcParseLines(body)
    const dur = shots.length ? shots[shots.length - 1][2] - shots[0][1] : 0
    const chars = body.length
    const figs = uniqSorted(findAll(/图(\d+)/g, body, 1).map(Number))

    // 闸门1 节奏档位
    if (dur >= 10 && shots.length <= 2) warns.push(`闸门1 段${ui}：${dur}s 只有 ${shots.length} 镜，需慢节奏白名单或补标点镜`)
    if (shots.length) {
      const lens = shots.map(([, s, e]) => e - s)
      if (lens.length >= 4) {
        const [top, topN] = topCount(lens)
        if (topN / lens.length >= 0.7) warns.push(`闸门1 段${ui}：镜长雷同（${top}s × ${topN}/${lens.length}）`)
      }
    }

    // 闸门2 台词时长
    const lastEnd = shots.length ? shots[shots.length - 1][2] : null
    for (const [role, tone, line] of lines2) {
      if (!tone) { fails.push(`闸门2 段${ui}：台词缺语气位「${role}」（C16b）`); continue }
      const { needFast, needSlow, n, hi } = speechSeconds(line, tone)
      const mid = (needFast + needSlow) / 2
      let hit: number | null = null
      let isLast = false
      for (const [, s, e, ln] of shots) {
        if (ln.includes(line)) { hit = e - s; isLast = e === lastEnd; break }
      }
      if (hit === null) continue
      const budget = isLast ? hit - 1 : hit
      const tailNote = isLast ? `（末镜已让出末 1 秒定格期，可说话 ${budget}s）` : ''
      if (needFast > budget + tol) {
        warns.push(`闸门2 段${ui}：台词「${line.slice(0, 12)}…」${n}字/${tone} 连最快 ${hi} 字/秒都需 ${needFast.toFixed(1)}s，可用仅 ${budget}s${tailNote} → 真念不完${isLast ? '（★末镜：定格期被台词占用 → 画面定格而人在说话，须前移台词 / 加长末镜 / 末镜改无台词）' : ''}`)
      } else if (mid > budget + tol) {
        infos.push(`闸门2 段${ui}：台词「${line.slice(0, 12)}…」${n}字 标准档需 ${mid.toFixed(1)}s / 最快 ${needFast.toFixed(1)}s，可用 ${budget}s${tailNote} → 需快念（非缺陷，不触发精简）`)
      }
    }

    // 闸门3 字数
    const [wSoft, wHard] = model === '2.5' ? [2600, 3000] : [1900, 2000]
    if (chars > wHard) fails.push(`闸门3 段${ui}：字数 ${chars} > ${wHard}（model=${model} 硬上限），必须压缩`)
    else if (chars > wSoft) warns.push(`闸门3 段${ui}：字数 ${chars} 落在 ${wSoft + 1}~${wHard}（model=${model}），建议压一轮`)

    // 闸门4 可投喂语义
    for (const bad of ['接下一大分镜', '接下一段', '接分镜', '承接上一段', '接上段']) {
      if (body.includes(bad)) fails.push(`闸门4 段${ui}：含交接话术「${bad}」`)
    }
    for (const bad of ['aspect_ratio', '分辨率']) {
      if (body.includes(bad)) warns.push(`闸门4 段${ui}：参数「${bad}」疑似留在代码框内`)
    }

    // 闸门5 单组图片数
    if (figs.length > 9) fails.push(`闸门5 段${ui}：单段引用 ${figs.length} 个图号 > 9`)

    // 闸门6A 编号一致性
    const oob = figs.filter(f => f > assets)
    if (oob.length) fails.push(`闸门6A 段${ui}：引用图号 ${oob} 超出资产库（共 ${assets} 图）`)
  }

  return { fails, warns, infos, units: units.length, mode, passed: fails.length === 0 }
}
