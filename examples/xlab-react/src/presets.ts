/**
 * 示例页的模式与内置预设，素材、顺序与提示词对齐 macOS XmaxCamera。
 */

export interface StylePreset {
  /** 预设的稳定标识，不依赖可能重名的展示名称。 */
  id: string;

  /** 预设名称。 */
  name: string;

  /** 列表缩略图 URL；纯提示词预设不包含图片。 */
  thumbnail?: string;

  /** 提交生成的原始参考图 URL；纯提示词预设不传参考图。 */
  reference?: string;

  /** 预设专用的生成提示词。 */
  prompt: string;
}

export type ExampleModeKey = "charx" | "clothx" | "vibex" | "dimx" | "free";

/** 换装保留原始人脸，其余模式关闭回贴。 */
export function faceRestorationForMode(mode: ExampleModeKey): boolean {
  return mode === "clothx";
}

export interface ExampleMode {
  /** 模式标识。 */
  key: ExampleModeKey;

  /** 页签显示名称。 */
  label: string;

  /** 上传自定义参考图时使用的默认文本条件。 */
  prompt: string;

  /** 内置图片和纯提示词预设；自由输入模式为空。 */
  presets: readonly StylePreset[];
}

const MODE_PROMPTS = {
  charx: "视频中角色替换成参考图中角色",
  clothx: "视频中人物衣服替换成参考图中衣服",
  vibex: "参考图角色重现视频动作，角色全部外观细节保留，保留并使用参考图的背景",
  dimx: "召唤新增任务：保留原视频中已有的主体，额外加入参考图中的主体，不替换任何原有主体。把参考图角色召唤到视频人物的肩膀上或者手上",
};

const STYLE_IMAGE_PROMPT = `${MODE_PROMPTS.vibex}。`;
const SUMMON_IMAGE_PROMPT = "召唤新增任务：保留原视频中已有的主体，额外加入参考图中的主体，不替换任何原有主体。把参考图的小动物召唤到视频人物的肩膀上";

/** 缩略图与生成使用同一张图片，列表加载中心裁剪的 WebP，生成保留原图。 */
function makePreset(
  group: Exclude<ExampleModeKey, "free">,
  name: string,
  referenceFile: string,
  prompt = MODE_PROMPTS[group],
): StylePreset {
  const reference = `https://cdn.22duck.cn/images/playground/${group}/${referenceFile}?v=32&presetVersion=20261030`;
  return {
    id: reference,
    name,
    thumbnail: `${reference}&imageMogr2/crop/256x256/gravity/center/format/webp/quality/90`,
    reference,
    prompt,
  };
}

/** 角色替换预设。 */
const CHARX_PRESETS: readonly StylePreset[] = [
  makePreset("charx", "硅谷马哥", "charx_image1.jpeg"),
  makePreset("charx", "糖果少女", "charx_image21.png"),
  makePreset("charx", "大眼萌妹", "charx_image2.jpeg"),
  makePreset("charx", "西装青年", "charx_image22.png"),
  makePreset("charx", "短发酷姐", "charx_image23.jpeg"),
  makePreset("charx", "唯美少女", "charx_image24.png"),
  makePreset("charx", "动漫少女", "charx_image25.jpeg"),
  makePreset("charx", "潮流少年", "charx_image26.png"),
  makePreset("charx", "科技鸭", "charx_image27.png"),
  makePreset("charx", "外星小猫", "charx_image9.jpeg"),
  makePreset("charx", "3D牛来", "charx_image10.png"),
  makePreset("charx", "商务奶蛙", "charx_image11.png"),
  makePreset("charx", "3D奶蛙", "charx_real_image12.png"),
  makePreset("charx", "天选牛马", "charx_image13.jpeg"),
  makePreset("charx", "机甲少女", "charx_image14.png"),
  makePreset("charx", "机甲战士", "charx_real_image15.jpeg"),
  makePreset("charx", "人形机器", "charx_image16.png"),
  makePreset("charx", "特战士兵", "charx_real_image17.jpeg"),
  makePreset("charx", "呆萌仓鼠", "charx_image18.png"),
];

/** 虚拟试衣预设。 */
const CLOTHX_PRESETS: readonly StylePreset[] = [
  makePreset("clothx", "粉色学院装", "clothx_image1.png"),
  makePreset("clothx", "黑领学院装", "clothx_image2.png"),
  makePreset("clothx", "黑白先锋装", "clothx_real_image3.png"),
  makePreset("clothx", "棕色文艺装", "clothx_real_image4.png"),
  makePreset("clothx", "银白仙侠袍", "clothx_image5.png"),
  makePreset("clothx", "换上衣", "clothx_image6.png", "将参考图的上衣穿到视频人物身上，其他保持不变"),
  makePreset("clothx", "换上衣", "clothx_image7.png", "将参考图的上衣穿到视频人物身上，其他保持不变"),
  makePreset("clothx", "换下装", "clothx_image8.png", "将参考图的下装穿到视频人物身上，其他保持不变"),
  makePreset("clothx", "换下装", "clothx_real_image9.png", "将参考图的下装穿到视频人物身上，其他保持不变"),
  makePreset("clothx", "藏青水手装", "clothx_real_image10.png"),
  makePreset("clothx", "棒球帽", "clothx_image11.jpeg", "将参考图棒球帽应用到视频角色身上"),
  makePreset("clothx", "墨镜", "clothx_image12.jpeg", "将参考图眼镜应用到视频角色身上"),
];

/** 风格迁移预设。 */
const VIBEX_PRESETS: readonly StylePreset[] = [
  makePreset("vibex", "草地小牛", "vibex_real_image1.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "写实人象", "vibex_real_image2.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "地狱梗图", "vibex_real_image3.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "战队特摄", "vibex_real_image4.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "写实动物", "vibex_real_image5.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "3D卡通", "vibex_real_image6.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "潮玩人偶", "vibex_real_image7.png", STYLE_IMAGE_PROMPT),
  makePreset("vibex", "超现实风", "vibex_real_image8.png", STYLE_IMAGE_PROMPT),
];

/** 虚拟召唤预设。 */
const DIMX_PRESETS: readonly StylePreset[] = [
  {
    id: "preset:dimx-little-dog",
    name: "小狗在肩",
    prompt: "召唤一只小狗到人的肩膀上",
  },
  {
    id: "preset:dimx-little-mouse",
    name: "小鼠在肩",
    prompt: "召唤一只小老鼠到人物肩膀上",
  },
  makePreset("dimx", "企鹅玩偶", "dimx_image3.png", SUMMON_IMAGE_PROMPT),
  makePreset("dimx", "小兔在肩", "dimx_image4.png", SUMMON_IMAGE_PROMPT),
  makePreset("dimx", "奶白小兔", "dimx_image5.png", SUMMON_IMAGE_PROMPT),
  makePreset("dimx", "奶兔", "dimx_image6.png", SUMMON_IMAGE_PROMPT),
  makePreset("dimx", "奶牛玩偶", "dimx_image7.png", SUMMON_IMAGE_PROMPT),
  makePreset("dimx", "hello Kitty", "dimx_image8.png", SUMMON_IMAGE_PROMPT),
];

/** 四个预设模式在前，自由输入在后。 */
export const EXAMPLE_MODES: readonly ExampleMode[] = [
  {
    key: "charx",
    label: "角色替换",
    prompt: MODE_PROMPTS.charx,
    presets: CHARX_PRESETS,
  },
  {
    key: "clothx",
    label: "虚拟试衣",
    prompt: MODE_PROMPTS.clothx,
    presets: CLOTHX_PRESETS,
  },
  {
    key: "vibex",
    label: "风格迁移",
    prompt: MODE_PROMPTS.vibex,
    presets: VIBEX_PRESETS,
  },
  {
    key: "dimx",
    label: "虚拟召唤",
    prompt: MODE_PROMPTS.dimx,
    presets: DIMX_PRESETS,
  },
  {
    key: "free",
    label: "自由输入",
    prompt: "",
    presets: [],
  },
];
