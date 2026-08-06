// ============================================
// product-catalog.js — Fanz 官方产品清单(2026)
//
// 来源:Fanz 提供的 "Fanz Product List 2026.xlsx"(两个工作表 FANZ / VIOZ),
// 2026-08-04 由 Edwin 转来。**本文件由脚本从 Excel 直接生成,不是手抄**,
// 避免转录错误(47 型号 / 144 SKU 靠手敲必然出错)。
//
// 这份清单是**规格的唯一真源**。在它之前我们只有从图片和发票倒推的零碎信息,
// 所以文案层一度出现"同一型号画出不同叶数""不知道 FS48 是几叶"这类问题。
//
// ⚠️ 清单本身有已知数据问题,见 DATA_ISSUES。**标了 do_not_use 的型号
// 不许进选品池、不许在文案里引用规格** —— 宁可少讲,也不要把 Fanz 表格里
// 写反的数字当成事实发出去。等 Fanz 书面确认后再放开。
//
// 品牌差异(经全表核对,不是听说):
//   · WiFi:FANZ 123/123 全有,VIOZ 21/21 全无 —— 这是真实的品牌差异化点
//   · 马达保修:FANZ 10 年,VIOZ 5 年(客服 bot 的 MODEL_BRAND_MAP 据此生成)
// ============================================

/** 型号 → 规格。同一型号内各颜色规格完全一致(已全表校验),所以规格挂在型号上。 */
const CATALOG = {
  "GRANDE453L": {
    brand: "FANZ",
    size_inch: 45,
    blades: 3,
    led: "3 TONE",
    led_watt: "22W",
    dimmable: true,
    wifi: true,
    cfm: 10210,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GRANDE453LMB" }, { colour: "MATTE WHITE", code: "GRANDE453LMW" }, { colour: "OAKWOOD", code: "GRANDE453LOAK" }, { colour: "PINEWOOD", code: "GRANDE453LPW" }, { colour: "GREYWOOD", code: "GRANDE453LGW" }],
  },
  "GRANDE453N V2": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 10210,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GRANDE453NV2MB" }, { colour: "MATTE WHITE", code: "GRANDE453NV2MW" }, { colour: "OAKWOOD", code: "GRANDE453NV2OAK" }, { colour: "PINEWOOD", code: "GRANDE453NV2PW" }, { colour: "GREYWOOD", code: "GRANDE523NVWGW" }],
  },
  "GRANDE523L": {
    brand: "FANZ",
    size_inch: 45,
    blades: 3,
    led: "3 TONE",
    led_watt: "22W",
    dimmable: true,
    wifi: true,
    cfm: 8810,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GRANDE523LMB" }, { colour: "MATTE WHITE", code: "GRANDE523LMW" }, { colour: "OAKWOOD", code: "GRANDE523LOAK" }, { colour: "PINEWOOD", code: "GRANDE523LPW" }, { colour: "GREYWOOD", code: "GRANDE523LGW" }],
  },
  "GRANDE523N V2": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 8810,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GRANDE523NV2MB" }, { colour: "MATTE WHITE", code: "GRANDE523NV2MW" }, { colour: "OAKWOOD", code: "GRANDE523NV2OAK" }, { colour: "PINEWOOD", code: "GRANDE523NV2PW" }, { colour: "GREYWOOD", code: "GRANDE523NV2GW" }],
  },
  "FS423L": {
    brand: "FANZ",
    size_inch: 42,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 8634,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS423LMB" }, { colour: "MATTE WHITE", code: "FS423LMW" }, { colour: "OAKWOOD", code: "FS423LOAK" }, { colour: "PINEWOOD", code: "FS423LPW" }],
  },
  "FS423N": {
    brand: "FANZ",
    size_inch: 42,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 8634,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS423NMB" }, { colour: "MATTE WHITE", code: "FS423NMW" }, { colour: "OAKWOOD", code: "FS423NOAK" }, { colour: "PINEWOOD", code: "FS423NPW" }],
  },
  "FS563L": {
    brand: "FANZ",
    size_inch: 56,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS563LMB" }, { colour: "MATTE WHITE", code: "FS563LMW" }, { colour: "OAKWOOD", code: "FS563LOAK" }, { colour: "PINEWOOD", code: "FS563LPW" }],
  },
  "FS563N": {
    brand: "FANZ",
    size_inch: 56,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS563NMB" }, { colour: "MATTE WHITE", code: "FS563NMW" }, { colour: "OAKWOOD", code: "FS563NOAK" }, { colour: "PINEWOOD", code: "FS563NPW" }],
  },
  "GAZE40L": {
    brand: "FANZ",
    size_inch: 40,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE40LMB" }, { colour: "MATTE WHITE", code: "GAZE40LMW" }, { colour: "OAKWOOD", code: "GAZE40LOAK" }, { colour: "PINEWOOD", code: "GAZE40LPW" }],
  },
  "GAZE40N": {
    brand: "FANZ",
    size_inch: 40,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE40NMB" }, { colour: "MATTE WHITE", code: "GAZE40NMW" }, { colour: "OAKWOOD", code: "GAZE40NOAK" }, { colour: "PINEWOOD", code: "GAZE40NPW" }],
  },
  "GAZE52L": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE52LMB" }, { colour: "MATTE WHITE", code: "GAZE52LMW" }, { colour: "OAKWOOD", code: "GAZE52LOAK" }, { colour: "PINEWOOD", code: "GAZE52LPW" }],
  },
  "GAZE52N": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE52NMB" }, { colour: "MATTE WHITE", code: "GAZE52NMW" }, { colour: "OAKWOOD", code: "GAZE52NOAK" }, { colour: "PINEWOOD", code: "GAZE52NPW" }],
  },
  "GAZE66L": {
    brand: "FANZ",
    size_inch: 66,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE66LMB" }, { colour: "MATTE WHITE", code: "GAZE66LMW" }, { colour: "OAKWOOD", code: "GAZE66LOAK" }, { colour: "PINEWOOD", code: "GAZE66LPW" }],
  },
  "GAZE66N": {
    brand: "FANZ",
    size_inch: 66,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 7539,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "GAZE66NMB" }, { colour: "MATTE WHITE", code: "GAZE66NMW" }, { colour: "OAKWOOD", code: "GAZE66NOAK" }, { colour: "PINEWOOD", code: "GAZE66NPW" }],
  },
  "FS48L": {
    brand: "FANZ",
    size_inch: 48,
    blades: 5,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 8563,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS48LMB" }, { colour: "MATTE WHITE", code: "FS48LMW" }, { colour: "OAKWOOD", code: "FS48LOAK" }, { colour: "PINEWOOD", code: "FS48LPW" }],
  },
  "FS48N": {
    brand: "FANZ",
    size_inch: 48,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 8563,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS48NMB" }, { colour: "MATTE WHITE", code: "FS48NMW" }, { colour: "OAKWOOD", code: "FS48NOAK" }, { colour: "PINEWOOD", code: "FS48NPW" }],
  },
  "FS62L": {
    brand: "FANZ",
    size_inch: 62,
    blades: 5,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: true,
    cfm: 8563,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS62LMB" }, { colour: "MATTE WHITE", code: "FS62LMW" }, { colour: "OAKWOOD", code: "FS62LOAK" }, { colour: "PINEWOOD", code: "FS62LPW" }],
  },
  "FS62N": {
    brand: "FANZ",
    size_inch: 62,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 8563,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FS62NMB" }, { colour: "MATTE WHITE", code: "FS62NMW" }, { colour: "OAKWOOD", code: "FS62NOAK" }, { colour: "PINEWOOD", code: "FS62NPW" }],
  },
  "DELTA56": {
    brand: "FANZ",
    size_inch: 56,
    blades: 6,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: true,
    wifi: true,
    cfm: 9750,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: "DELTA56OAK" }, { colour: "PINEWOOD", code: "DELTA56PW" }, { colour: "GREYWOOD", code: "DELTA56GW" }],
  },
  "DELTA66": {
    brand: "FANZ",
    size_inch: 66,
    blades: 6,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 9750,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: "DELTA66OAK" }, { colour: "PINEWOOD", code: "DELTA66PW" }, { colour: "GREYWOOD", code: "DELTA66GW" }],
  },
  "INNO435L": {
    brand: "FANZ",
    size_inch: 43,
    blades: 5,
    led: "3 TONE",
    led_watt: "22W",
    dimmable: true,
    wifi: true,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "INNO435LMB" }, { colour: "MATTE WHITE", code: "INNO435LMW" }, { colour: "PINEWOOD", code: "INNO435LPW" }],
  },
  "INNO525L": {
    brand: "FANZ",
    size_inch: 52,
    blades: 5,
    led: "3 TONE",
    led_watt: "22W",
    dimmable: true,
    wifi: true,
    cfm: 10000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "INNO525LMB" }, { colour: "MATTE WHITE", code: "INNO525LMW" }, { colour: "PINEWOOD", code: "INNO525LPW" }],
  },
  "AURA36": {
    brand: "FANZ",
    size_inch: 36,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: true,
    wifi: true,
    cfm: 6689,
    rpm: 330,
    motor: "DC",
    watt: "32W",
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "AURA36MB" }, { colour: "MATTE WHITE", code: "AURA36MW" }, { colour: "OAKWOOD", code: "AURA36OAK" }, { colour: "PINEWOOD", code: "AURA36PW" }],
  },
  "AURA48": {
    brand: "FANZ",
    size_inch: 48,
    blades: 3,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: true,
    wifi: true,
    cfm: 6983,
    rpm: 245,
    motor: "DC",
    watt: "42W",
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "AURA48MB" }, { colour: "MATTE WHITE", code: "AURA48MW" }, { colour: "OAKWOOD", code: "AURA48OAK" }, { colour: "PINEWOOD", code: "AURA48PW" }],
  },
  "ALPINE52": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: "ALPINEOAK" }, { colour: "PINEWOOD", code: "ALPINEPW" }],
  },
  "V605": {
    brand: "FANZ",
    size_inch: 60,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: "37W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "V605MB" }],
  },
  "HEPTA72": {
    brand: "FANZ",
    size_inch: 72,
    blades: 7,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: 15000,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ALUMINIUM",
    skus: [{ colour: "MATTE BLACK", code: "HEPTAMB" }, { colour: "SILVER", code: "HEPTASV" }],
  },
  "FERRO56L": {
    brand: "FANZ",
    size_inch: 56,
    blades: 3,
    led: "3 TONE",
    led_watt: null,
    dimmable: true,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FERRO52LMB" }, { colour: "MATTE WHITE", code: "FERRO52LMW" }, { colour: "OAKWOOD", code: "FERRO52LOAK" }],
  },
  "FERRO56N": {
    brand: "FANZ",
    size_inch: 56,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FERRO52NMB" }, { colour: "MATTE WHITE", code: "FERRO52NMW" }, { colour: "OAKWOOD", code: "FERRO52NOAK" }],
  },
  "MOVA36": {
    brand: "FANZ",
    size_inch: 36,
    blades: 5,
    led: "3 TONE",
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "HERA42L": {
    brand: "FANZ",
    size_inch: 42,
    blades: 3,
    led: null,
    led_watt: null,
    dimmable: null,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "HERA42N": {
    brand: "FANZ",
    size_inch: 42,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "HERA52L": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: null,
    led_watt: null,
    dimmable: null,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "HERA52N": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "ALDO52": {
    brand: "FANZ",
    size_inch: 52,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "9+9",
    material: "ABS",
    skus: [{ colour: "OAKWOOD", code: null }, { colour: "PINEWOOD", code: null }],
  },
  "SPINOR": {
    brand: "FANZ",
    size_inch: 16,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: true,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "SPINORMB" }, { colour: "MATTE WHITE", code: "SPINORMW" }, { colour: "OAKWOOD", code: "SPINOROAK" }, { colour: "BRONZE", code: "SPINORBRON" }],
  },
  "WINDY MKII42L": {
    brand: "VIOZ",
    size_inch: 42,
    blades: 5,
    led: true,
    led_watt: null,
    dimmable: null,
    wifi: false,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "WINDYMKII42LMB" }],
  },
  "WINDY MKII56L": {
    brand: "VIOZ",
    size_inch: 56,
    blades: 5,
    led: true,
    led_watt: null,
    dimmable: null,
    wifi: false,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "WINDYMKII56LMB" }],
  },
  "WINDY MKII42": {
    brand: "VIOZ",
    size_inch: 42,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "WINDYMKII42MB" }, { colour: "MATTE WHITE", code: "WINDYMKII42MW" }],
  },
  "WINDY MKII56": {
    brand: "VIOZ",
    size_inch: 56,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "WINDYMKII56MB" }, { colour: "MATTE WHITE", code: "WINDYMKII56MW" }],
  },
  "FF425": {
    brand: "VIOZ",
    size_inch: 42,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: 5000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FF425MB" }],
  },
  "FF565": {
    brand: "VIOZ",
    size_inch: 56,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: 8000,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "7+7",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK", code: "FF565MB" }],
  },
  "VETTA42L": {
    brand: "VIOZ",
    size_inch: 42,
    blades: 5,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: false,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "BLACK", code: "VETTA42LMB" }, { colour: "WHITE", code: "VETTA42LMW" }, { colour: "OAKWOOD", code: "VETTA42LOAK" }],
  },
  "VETTA42N": {
    brand: "VIOZ",
    size_inch: 42,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "BLACK", code: "VETTA42NMB" }, { colour: "WHITE", code: "VETTA42NMW" }, { colour: "OAKWOOD", code: "VETTA42NOAK" }],
  },
  "VETTA56L": {
    brand: "VIOZ",
    size_inch: 56,
    blades: 5,
    led: "3 TONE",
    led_watt: "24W",
    dimmable: false,
    wifi: false,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "BLACK", code: "VETTA56LMB" }, { colour: "WHITE", code: "VETTA56LMW" }, { colour: "OAKWOOD", code: "VETTA56LOAK" }],
  },
  "VETTA56N": {
    brand: "VIOZ",
    size_inch: 56,
    blades: 5,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: null,
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "BLACK", code: "VETTA56NMB" }, { colour: "WHITE", code: "VETTA56NMW" }, { colour: "OAKWOOD", code: "VETTA56NOAK" }],
  },
  "AXEL16": {
    brand: "VIOZ",
    size_inch: 16,
    blades: 3,
    led: false,
    led_watt: null,
    dimmable: false,
    wifi: false,
    cfm: null,
    rpm: null,
    motor: "DC",
    watt: "31W",
    speed: "6+6",
    material: "ABS",
    skus: [{ colour: "MATTE BLACK/PINEWOOD", code: "AXELPW" }],
  },};

// ============================================
// 已知数据问题 —— Edwin 已去向 Fanz 求证,确认前不许用
// ============================================
//
// action 说明:
//   'do_not_use' —— 该型号整条不许进选品池、不许被文案引用
//   'verify'     —— 可以用,但标注的那个字段不许引用
const DATA_ISSUES = [
  {
    models: ['GRANDE453N V2', 'GRANDE523L'],
    field: 'size_inch',
    action: 'do_not_use',
    issue: '尺寸疑似写反:型号名 GRANDE453N V2 但 SIZE 栏写 52",型号名 GRANDE523L 但 SIZE 栏写 45"。',
    // 我们自己的图库独立佐证了这个方向:Fanz 给的产品照文件夹里有
    // GRANDE/GRANDE LED/GRANDE_52_MB.png —— 即"52 吋带 LED"实物存在,
    // 而清单里两个 L(带灯)款都写成 45"。所以写反的很可能是 SIZE 栏。
    evidence: '素材库 GRANDE 52L(4 色)源文件为 GRANDE/GRANDE LED/GRANDE_52_*.png,实物为 52" 带 LED',
  },
  {
    models: ['GRANDE453N V2'],
    field: 'code',
    action: 'do_not_use',
    issue: '型号名 GRANDE453N V2,但 GREYWOOD 那行的产品代码是 GRANDE523NVWGW —— 名字与代码不一致。',
  },
  {
    models: ['HERA42L', 'HERA52L'],
    field: 'led',
    action: 'do_not_use',
    issue: 'LED 栏空白。型号名带 L 通常表示带灯,但表里没写,不能靠猜。',
  },
  {
    models: ['FERRO56L', 'FERRO56N'],
    field: 'code',
    action: 'verify',
    issue: '型号名和 SIZE 栏都是 56",但 6 个产品代码全部写 FERRO52*(如 FERRO52LMB)。',
    // 这条是导入时新发现的,不在 Edwin 最初列的四条里。
    evidence: '素材库 FERRO 56L/56N 的源文件为 FERRO/Angle Photo/FERRO_56_*.jpeg,支持 56"',
  },
  {
    models: ['MOVA36', 'HERA42L', 'HERA42N', 'HERA52L', 'HERA52N', 'ALDO52'],
    field: 'code',
    action: 'verify',
    issue: '这 12 个 SKU 完全没有产品代码(PRODUCT CODE 栏空白),无法按代码对账。',
  },
  {
    models: ['WINDY MKII42L', 'WINDY MKII56L'],
    field: 'led',
    action: 'verify',
    issue: 'LED 栏写 ✅ 而不是像 VETTA 那样写 "3 TONE",且 LED WATT 空白 —— 有灯但灯的规格未知。',
  },
];

/**
 * 缺 CFM 或马达功率的型号(不是错误,是缺数据 —— 这些字段不许在文案里引用)。
 *
 * 刻意**不统计 RPM**:那一列 45/47 都是空的,整列就没填,算进去会让
 * "45 个型号缺规格" 这种数字看着像灾难,其实只是一列没给。RPM 单独记在
 * MISSING_COLUMNS 里。
 */
const MISSING_SPECS = {};
for (const [model, spec] of Object.entries(CATALOG)) {
  const miss = [];
  if (spec.cfm == null) miss.push('cfm');
  if (spec.watt == null) miss.push('watt');
  if (miss.length) MISSING_SPECS[model] = miss;
}

/** 整列缺失的字段(不是个别型号的问题) */
const MISSING_COLUMNS = {
  rpm: 'FANZ 表有 RPM 列但基本全空;VIOZ 表连这一列都没有 —— 全系不许引用转速',
};

const BLOCKED = new Set(
  DATA_ISSUES.filter((d) => d.action === 'do_not_use').flatMap((d) => d.models)
);

/** 这个型号能不能用(进选品池 / 被文案引用)。有 do_not_use 级数据问题的一律 false。 */
// ============================================
// 产品定位(家用 / 商用)
// ============================================
//
// ⚠️ **清单里没有"分类"这一列** —— Fanz 没有给官方定位,现在的"适合空间"
// 也是我们按尺寸推的,不是 Fanz 的口径。所以这里只标一个型号,其余一律 unknown。
// Edwin 2026-08-04:「不要瞎猜」。
//
// 唯一敢标 commercial 的是 HEPTA72,因为规格上它明显是另一个物种:
//   · 72" / 7 叶,全系**唯一**用铝合金扇叶的(其余 46 个型号全是 ABS)
//   · CFM 15000,比第二名 DELTA66 的 9750 高 54%
// 这不是"大一号的家用扇",是另一条产品线。
//
// 其余型号(含 DELTA66 / GAZE66 / V605 这些大尺寸)一律 unknown ——
// 它们规格上和家用款是连续的(ABS 扇叶、CFM 7539-9750、31-37W),没有依据说是商用。
//
// unknown **不排除出内容池**:那是"还没确认",不是"是商用"。
const PRODUCT_CLASS = {
  HEPTA72: 'commercial',
};
const PRODUCT_CLASS_EVIDENCE = {
  HEPTA72: '全系唯一铝合金扇叶;CFM 15000 比第二名(DELTA66 9750)高 54%;72" 7 叶',
};

/** 型号定位:'commercial' | 'unknown'。清单没有分类列,所以只有明显的才标。 */
function productClass(model) {
  return PRODUCT_CLASS[model] || 'unknown';
}

/**
 * 能不能进「家用调性」的月度内容池。
 *
 * 商用型号暂时排除:我们现在 13 篇的调性全是家用(卧室、家庭、温馨),
 * 商用型号进去会写成"让你卧室凉爽" —— 餐厅老板看不到,屋主既买不起也装不下。
 * 等 Fanz 确认商用型号有哪些,再单独设计商用的角度和调性。
 */
function allowedInResidentialPool(model) {
  return isUsable(model) && productClass(model) !== 'commercial';
}

function isUsable(model) {
  return Boolean(CATALOG[model]) && !BLOCKED.has(model);
}

/** 取型号规格;型号不存在或被封禁返回 null —— 调用方拿不到就不许讲。 */
function specsFor(model) {
  if (!isUsable(model)) return null;
  return CATALOG[model];
}

/**
 * 某个字段能不能引用。
 * 缺数据(null)或该型号该字段被标了问题 → false。
 * 这是文案层的最后一道闸:拿不到值就不许写数字。
 */
function canCite(model, field) {
  const spec = specsFor(model);
  if (!spec || spec[field] == null) return false;
  return !DATA_ISSUES.some(
    (d) => d.models.includes(model) && d.field === field
  );
}

/**
 * 同尺寸、不同叶数的风量横向对比 —— 全部由清单真值算出来，不手抄。
 *
 * 2026-08-06:这解决了搁置已久的「3 叶还是 5 叶」。以前只能引用行业通说
 * (来源存疑，正是我们刚被烧过的那类)，现在用 Fanz 自己四个尺寸段的数据说话:
 * 同样直径下叶多的风量确实更高，四段同方向。
 *
 * ⚠️ 红线:这里算出来的百分比**只能用来横向比自家两台同尺寸的扇**。
 * 绝不许拿去推「够几平方」「省多少电」—— 那正是我们 8/5 停用掉的那类推导，
 * 而且带上 CFM 之后它会长得特别像"有依据"。
 *
 * ⚠️ 第二条红线(2026-08-06 写这个函数时发现的):**「5 叶比 3 叶多几 %」不是一个数**。
 * 52 吋有三台 3 叶扇，风量 7539 和 8810 都有 —— 拿哪台当基准，答案就从 14% 变成 33%。
 * 所以这里不产出"每个尺寸一个百分比"(那等于让调用方在几个真数字里挑最好看的那个)，
 * 而是**枚举所有真实配对**;每个百分比都对应一对具体型号，可以逐个核。
 * 提示词里只给每个尺寸**差距最小**的那对 —— 宁可少说，不给最好看的。
 *
 * @returns {Array<{size, fewer, more, pct}>} 全部真实配对，按尺寸、再按 pct 升序
 */
function airflowComparisons() {
  const bySize = new Map();
  for (const [model, spec] of Object.entries(CATALOG)) {
    if (!isUsable(model)) continue;
    if (!canCite(model, 'cfm') || !canCite(model, 'blades')) continue;
    if (!bySize.has(spec.size_inch)) bySize.set(spec.size_inch, []);
    bySize.get(spec.size_inch).push({ model, blades: spec.blades, cfm: spec.cfm });
  }
  const out = [];
  for (const [size, list] of bySize) {
    for (const fewer of list) {
      for (const more of list) {
        // 叶更多**且**风量更高才算一对;反例(叶多风量反而低)不硬凑成结论
        if (more.blades <= fewer.blades || more.cfm <= fewer.cfm) continue;
        out.push({
          size, fewer, more,
          pct: Math.round(((more.cfm - fewer.cfm) / fewer.cfm) * 100),
        });
      }
    }
  }
  return out.sort((a, b) => a.size - b.size || a.pct - b.pct);
}

/** 每个尺寸只留差距最小的那对 —— 给提示词用，避免模型总挑最好看的数字 */
function conservativeAirflowComparisons() {
  const best = new Map();
  for (const c of airflowComparisons()) if (!best.has(c.size)) best.set(c.size, c);
  return [...best.values()];
}

/** 品牌 → 该品牌所有型号 */
function modelsByBrand(brand) {
  const b = String(brand || '').toUpperCase();
  return Object.keys(CATALOG).filter((m) => CATALOG[m].brand === b);
}

/** 全部 SKU 展开(型号 × 颜色) */
function allSkus() {
  const out = [];
  for (const [model, spec] of Object.entries(CATALOG)) {
    for (const s of spec.skus) out.push({ model, ...spec, ...s, skus: undefined });
  }
  return out;
}

module.exports = {
  CATALOG,
  DATA_ISSUES,
  MISSING_SPECS,
  PRODUCT_CLASS,
  PRODUCT_CLASS_EVIDENCE,
  productClass,
  allowedInResidentialPool,
  MISSING_COLUMNS,
  BLOCKED,
  isUsable,
  specsFor,
  canCite,
  modelsByBrand,
  airflowComparisons,
  conservativeAirflowComparisons,
  allSkus,
};
