import { computed, onBeforeUnmount, ref } from 'vue'
import { activityApi } from '../api/activityApi'
import { MINI_PROGRAM_COUPON_PAGE, goMiniProgramCouponPage } from '../utils/miniProgramBridge'

const MAX_DAILY_SHARE_REWARDS = 3
const DEFAULT_DRAW_CHANCE = 1
const TIP_VISIBLE_MS = 3000
const CLAIMED_BENEFIT_REWARD_REDIRECT_MS = 2000
const CLAIMED_BENEFIT_REWARD_REDIRECT_MESSAGE = '即将跳转到我的考运进度'
const PAGE_ROUTES = {
  home: '/activity/home',
  p2: '/activity/result',
  p4: '/activity/explain',
  p6: '/activity/rewards',
  rules: '/activity/rules',
  p8: '/activity/grand-prize',
}
const PREVIEW_PAGE_ALIASES = {
  p1: 'home',
  p7: 'rules',
  '/': 'home',
  '/activity/home': 'home',
  '/activity/result': 'p2',
  '/activity/explain': 'p4',
  '/activity/rewards': 'p6',
  '/activity/rules': 'rules',
  '/activity/grand-prize': 'p8',
}
const PREVIEW_PAGES = new Set(['home', 'p2', 'p4', 'p6', 'p8', 'rules'])
const NO_CHANCE_TIP = '今日机会已用完，分享可再得机会'
const CLAIM_SUCCESS_COUPON_FALLBACK_MESSAGE = '领取成功，请前往小程序我的优惠券查看'
const SESSION_USER_KEY_STORAGE = 'gaokao_h5_user_key'
const P4_THINKING_STEP_MS = 620
const P4_THINKING_MIN_VISIBLE_MS = 1700
const P4_THINKING_LINES = [
  '正在读取签面灵感',
  '匹配牛气补给能量',
  '整理专属好运签文',
]
const RESULT_PRODUCT_ROTATION_STORAGE = 'gaokao_h5_result_product_index'
const RESULT_PRODUCTS = [
  {
    productId: 'flat-iron-beef-card',
    productImage: 'product_flat_iron_steak.png',
    action: { type: 'mini_program_product_detail', target: '/pages/product/detail?id=sku_001' },
  },
  {
    productId: 'ribeye-beef-card',
    productImage: 'product_ribeye_steak.png',
    action: { type: 'mini_program_product_detail', target: '/pages/product/detail?id=sku_002' },
  },
  {
    productId: 'sirloin-beef-card',
    productImage: 'product_sirloin_steak.png',
    action: { type: 'mini_program_product_detail', target: '/pages/product/detail?id=sku_003' },
  },
  {
    productId: 'tenderloin-beef-card',
    productImage: 'product_tenderloin_steak.png',
    action: { type: 'mini_program_product_detail', target: '/pages/product/detail?id=sku_004' },
  },
]
const DEFAULT_P2_RESULT = {
  signType: '过儿签',
  signLevel: '上上签',
  fortuneHeadline: '过儿签',
  fortuneHint: '考试期间，\n别叫我真名，\n叫我过儿，\n最好叫我全过儿。',
  mainTextColumns: ['考试期间，', '别叫我真名，', '叫我过儿，', '最好叫我全过儿。'],
  goodFor: '',
  avoid: '',
  explainText: '此签属“礼貌玄学派”。名字可以临时改，准考证名字不能乱写。建议考前默念三遍：我会的全对，不会的也别太离谱。',
}
const DEFAULT_P4_DETAIL = {
  title: 'AI解签结果',
  explainLines: [
    '锦绣前程，步步生花',
    '实力如锦，终成佳绩',
    '心之所向，金榜题名',
  ],
  themeText: '高考好运 × 牛气补给',
  thinkingProcess: P4_THINKING_LINES,
  ai: {
    provider: 'fallback',
    model: '',
    thinkingEnabled: false,
    promptVersion: '',
  },
  product: {
    productId: 'default-beef-card',
    productName: '和牛 · 锦绣前程板腱',
    productImage: 'product_flat_iron_steak.png',
  },
  benefit: {
    benefitId: 'default-benefit',
    claimStatus: 'unclaimed',
    claimButtonText: '领取专属福利',
  },
}
const DEFAULT_P5_RESULT = {
  pageTitle: '领取成功',
  claimStatus: 'input',
  reward: {
    rewardType: 'coupon',
    couponId: 'default-coupon',
    couponLabel: '优惠券',
    thresholdText: '无门槛',
    amountText: '20',
    unitText: '元券',
    couponName: '无门槛20元券',
    couponStatus: 'unused',
    validTimeText: '',
  },
  action: {
    buttonText: '去领取',
    type: 'placeholder',
    target: '',
  },
}
const DEFAULT_P6_CENTER = {
  activity_id: 'gaokao_lucky_sign_2026',
  page_title: '我的奖励',
  progress: {
    shared_count: 0,
    share_target: 5,
    lit_days: 0,
    light_target: 7,
    completed_days: [],
    gift_qualified: false,
    gift_status: 'not_qualified',
    progress_desc: '分享5个好友，或累计点亮7天，赢取985和牛礼盒抽奖资格！',
  },
  claimed_rewards: [
    {
      reward_id: 'coupon_10',
      reward_type: 'coupon',
      title: '10',
      unit_text: '元',
      desc: '无门槛券',
      status: 'unused',
      button_text: '去领取',
      action: {
        type: 'mini_program_coupon_package',
        target: MINI_PROGRAM_COUPON_PAGE,
      },
    },
    {
      reward_id: 'coupon_20',
      reward_type: 'coupon',
      title: '20',
      unit_text: '元',
      desc: '无门槛券',
      status: 'unused',
      button_text: '去领取',
      action: {
        type: 'mini_program_coupon_package',
        target: MINI_PROGRAM_COUPON_PAGE,
      },
    },
    {
      reward_id: 'coupon_30',
      reward_type: 'coupon',
      title: '30',
      unit_text: '元',
      desc: '无门槛券',
      status: 'unused',
      button_text: '去领取',
      action: {
        type: 'mini_program_coupon_package',
        target: MINI_PROGRAM_COUPON_PAGE,
      },
    },
    {
      reward_id: 'discount_9',
      reward_type: 'discount_coupon',
      title: '9折',
      unit_text: '',
      desc: '全场可用',
      status: 'unused',
      button_text: '去领取',
      action: {
        type: 'mini_program_coupon_package',
        target: MINI_PROGRAM_COUPON_PAGE,
      },
    },
    {
      reward_id: 'discount_75',
      reward_type: 'discount_coupon',
      title: '7.5折',
      unit_text: '',
      desc: '西冷牛排专属',
      status: 'unused',
      button_text: '去领取',
      action: {
        type: 'mini_program_coupon_package',
        target: MINI_PROGRAM_COUPON_PAGE,
      },
    },
  ],
  gift_reward: {
    reward_id: 'gift_985',
    reward_type: 'gift_lottery_qualification',
    title: '985和牛礼盒',
    desc: '抽奖资格',
    status: 'not_qualified',
    button_text: '未达标',
    action: {
      type: 'gift_qualification_detail',
      target: '/activity/grand-prize',
    },
  },
  product_recommend: {
    product_id: 'sku_001',
    title: '高考成功牛排',
    subtitle: '板腱牛排肉质细嫩，适合考前牛气补给',
    button_text: '去看看',
    image_url: 'product_flat_iron_steak.png',
    action: {
      type: 'mini_program_product_detail',
      target: '/pages/product/detail?id=sku_001',
    },
  },
  draw_again_action: {
    button_text: '再抽一次',
    action: {
      type: 'p1_home',
      target: '/activity/home',
    },
  },
  rules_action: {
    button_text: '活动规则',
    action: {
      type: 'activity_rules',
      target: '/activity/rules',
    },
  },
}
const DEFAULT_P7_RULES = {
  activity_id: 'gaokao_lucky_sign_2026',
  page_title: '活动规则',
  subtitle: '一举高中 · 六月牛气加油签',
  rules: [
    {
      rule_no: 1,
      content: '用户每日默认获得 1 次抽签机会。',
    },
    {
      rule_no: 2,
      content: '完成抽签后，可根据结果领取对应优惠券福利。',
    },
    {
      rule_no: 3,
      content: '分享活动并带来好友完成抽签，可获得额外抽签机会。',
    },
    {
      rule_no: 4,
      content: '每日分享奖励最多 3 次，超出后不再增加抽签机会。',
    },
    {
      rule_no: 5,
      content: '分享 5 个好友或累计点亮 7 天，可解锁 985 和牛礼盒抽奖资格。',
    },
    {
      rule_no: 6,
      content: '优惠券发放以手机号绑定和后台发券结果为准。',
    },
    {
      rule_no: 7,
      content: '活动最终解释权在法律允许范围内归活动主办方所有。',
    },
  ],
  wechat_group: {
    qrcode_url: 'qrcode_wechat_group.png',
    title: '扫码添加企微',
    desc: '进群可获取活动提醒、专属优惠及福利通知',
  },
}
const DEFAULT_P8_PRIZE = {
  activity_id: 'gaokao_lucky_sign_2026',
  hero: {
    title: '连续打卡7天\n大奖资格已解锁',
    subtitle: '牛气大奖资格已确认',
  },
  qualification: {
    qualified: true,
    qualify_type: 'checkin_7_days',
    qualify_desc: '恭喜你已完成7天打卡',
    prize_title: '985和牛礼盒抽奖资格',
    lottery_no: 'KY202406-0038',
  },
  benefits: [
    {
      id: 'coupon_50',
      title: '50元券',
      desc: '企微领取',
    },
    {
      id: 'gift_qualification',
      title: '礼盒资格',
      desc: '已解锁',
    },
    {
      id: 'draw_notice',
      title: '开奖提醒',
      desc: '企微通知',
    },
  ],
  lottery_status: {
    status: 'pending',
    status_text: '待开奖',
    draw_time_desc: '2026-06-18 10:00',
    notice: '中奖编号将在本页面与企微社群同步公示',
    publicity_title: '中奖公示',
    publicity_desc: '开奖后将在此更新',
  },
  wechat_group: {
    qrcode_url: 'qrcode_grand_prize_wechat.png',
    qrcode_id: 'grand_prize_wechat_default',
    title: '扫码添加企微领取',
    benefits: ['领取50元券', '接收礼盒开奖通知', '查看中奖结果'],
  },
}


Object.assign(DEFAULT_P7_RULES, {
  page_title: '活动规则',
  subtitle: '一举高中 · 六月牛气加油签',
  rules: [
    { rule_no: 1, content: '用户每日默认获得 1 次抽签机会。' },
    { rule_no: 2, content: '完成抽签后，可根据结果领取对应优惠券福利。' },
    { rule_no: 3, content: '分享活动并带来好友完成抽签，可获得额外抽签机会。' },
    { rule_no: 4, content: '每日分享奖励最多 3 次，超出后不再增加抽签机会。' },
    { rule_no: 5, content: '分享 5 个好友或累计点亮 7 天，可解锁 985 和牛礼盒抽奖资格。' },
    { rule_no: 6, content: '优惠券发放以手机号绑定和后台发券结果为准。' },
    { rule_no: 7, content: '活动最终解释权在法律允许范围内归活动主办方所有。' },
  ],
  wechat_group: {
    qrcode_url: 'qrcode_wechat_group.png',
    title: '扫码添加企微',
    desc: '进群可获取活动提醒、专属优惠及福利通知',
  },
})

Object.assign(DEFAULT_P8_PRIZE, {
  hero: {
    title: '连续打卡7天\n大奖资格已解锁',
    subtitle: '牛气大奖资格已确认',
  },
  qualification: {
    qualified: true,
    qualify_type: 'checkin_7_days',
    qualify_desc: '恭喜你已完成7天打卡',
    prize_title: '985和牛礼盒抽奖资格',
    lottery_no: 'KY202406-0038',
  },
  benefits: [
    { id: 'coupon_50', title: '50元券', desc: '企微领取' },
    { id: 'gift_qualification', title: '礼盒资格', desc: '已解锁' },
    { id: 'draw_notice', title: '开奖提醒', desc: '企微通知' },
  ],
  lottery_status: {
    status: 'pending',
    status_text: '待开奖',
    draw_time_desc: '2026-06-18 10:00',
    notice: '中奖编号将在本页面与企微社群同步公示',
    publicity_title: '中奖公示',
    publicity_desc: '开奖后将在此更新',
  },
  wechat_group: {
    qrcode_url: 'qrcode_grand_prize_wechat.png',
    qrcode_id: 'grand_prize_wechat_default',
    title: '扫码添加企微领取',
    benefits: ['领取50元券', '接收礼盒开奖通知', '查看中奖结果'],
  },
})

const normalizeP2Result = (result = {}) => ({
  ...DEFAULT_P2_RESULT,
  ...result,
  mainTextColumns: result.mainTextColumns?.length
    ? result.mainTextColumns
    : DEFAULT_P2_RESULT.mainTextColumns,
})

const normalizeP4Detail = (detail = {}) => ({
  ...DEFAULT_P4_DETAIL,
  ...detail,
  explainLines: detail.explainLines?.length
    ? detail.explainLines
    : DEFAULT_P4_DETAIL.explainLines,
  thinkingProcess: detail.thinkingProcess?.length
    ? detail.thinkingProcess
    : DEFAULT_P4_DETAIL.thinkingProcess,
  ai: {
    ...DEFAULT_P4_DETAIL.ai,
    ...(detail.ai ?? {}),
  },
  product: {
    ...DEFAULT_P4_DETAIL.product,
    ...(detail.product ?? {}),
  },
  benefit: {
    ...DEFAULT_P4_DETAIL.benefit,
    ...(detail.benefit ?? {}),
  },
})

const getStoredResultProductIndex = () => {
  if (typeof window === 'undefined') {
    return -1
  }

  const stored = window.sessionStorage.getItem(RESULT_PRODUCT_ROTATION_STORAGE)
  if (stored === null) {
    return -1
  }

  const parsed = Number(stored)
  return Number.isInteger(parsed) ? parsed : -1
}

const claimNextResultProduct = () => {
  if (typeof window === 'undefined') {
    return RESULT_PRODUCTS[0]
  }

  const nextIndex = (getStoredResultProductIndex() + 1) % RESULT_PRODUCTS.length
  window.sessionStorage.setItem(RESULT_PRODUCT_ROTATION_STORAGE, String(nextIndex))
  return RESULT_PRODUCTS[nextIndex]
}

const withResultProduct = (detail, product) => ({
  ...detail,
  product: {
    ...detail.product,
    productId: product.productId,
    productImage: product.productImage,
    action: product.action,
  },
})

const normalizeP5Result = (result = {}) => ({
  ...DEFAULT_P5_RESULT,
  ...result,
  reward: {
    ...DEFAULT_P5_RESULT.reward,
    ...(result.reward ?? {}),
  },
  action: {
    ...DEFAULT_P5_RESULT.action,
    ...(result.action ?? {}),
  },
})
const normalizeP5RewardPreview = (benefit = {}, currentReward = {}) => {
  const benefitReward = benefit.reward ?? {}
  const rewardCode = benefitReward.reward_code ?? benefitReward.rewardCode ?? benefitReward.couponId ?? benefit.rewardCode

  return {
    ...currentReward,
    ...benefitReward,
    reward_code: benefitReward.reward_code ?? rewardCode ?? currentReward.reward_code,
    couponId: benefitReward.couponId ?? rewardCode ?? currentReward.couponId,
  }
}

const buildP5InputResultFromBenefit = (benefit = {}) =>
  normalizeP5Result({
    pageTitle: '领取优惠券',
    claimStatus: 'input',
    reward: normalizeP5RewardPreview(benefit, {}),
  })

const P6_FIXED_REWARD_CODES = ['coupon_10', 'coupon_20', 'coupon_30', 'discount_9', 'discount_75']
const P6_FIXED_REWARD_CODE_SET = new Set(P6_FIXED_REWARD_CODES)
const P6_REWARD_CLAIM_TEXT = '\u53bb\u9886\u53d6'
const P6_REWARD_USE_TEXT = '\u53bb\u4f7f\u7528'
const P6_GIFT_USE_TEXT = '\u53bb\u67e5\u770b'
const CLAIM_ISSUE_FALLBACK_STATUS = 502
const CLAIM_MOBILE_REGISTRATION_REQUIRED_STATUS = 409
const CLAIM_ISSUE_FALLBACK_STATUSES = new Set([
  CLAIM_ISSUE_FALLBACK_STATUS,
  CLAIM_MOBILE_REGISTRATION_REQUIRED_STATUS,
])
const MINI_PROGRAM_MOBILE_REGISTRATION_ERROR_CODE = 'mini_program_mobile_registration_required'
const MINI_PROGRAM_MOBILE_REGISTRATION_FALLBACK_MESSAGE =
  '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7\uff0c\u626b\u7801\u8fdb\u5165\u5c0f\u7a0b\u5e8f'
const MOBILE_PATTERN = /^1[3-9]\d{9}$/

const normalizeP6Reward = (reward = {}) => ({
  reward_code: reward.reward_code ?? reward.reward_id ?? '',
  reward_id: reward.reward_id ?? reward.reward_code ?? '',
  reward_type: reward.reward_type ?? reward.rewardType ?? 'coupon',
  title: reward.title ?? '',
  unit_text: reward.unit_text ?? '',
  desc: reward.desc ?? '',
  status: reward.status ?? 'unused',
  button_text: reward.button_text ?? P6_REWARD_CLAIM_TEXT,
  image_url: reward.image_url ?? '',
  action: {
    type: reward.action?.type ?? 'mini_program_coupon_package',
    target: reward.action?.target ?? '',
  },
})
const isP6GiftDisplayReward = (reward) => reward?.reward_type === 'gift_lottery_qualification'
const getP6RewardCode = (reward) => reward?.reward_code || reward?.reward_id || ''
const isP6FixedReward = (reward) => P6_FIXED_REWARD_CODE_SET.has(getP6RewardCode(reward))
const mergeP6RewardSlot = (base = {}, reward = {}) => ({
  ...base,
  ...reward,
  action: {
    type: reward.action?.type || base.action?.type || 'mini_program_coupon_package',
    target: reward.action?.target || base.action?.target || MINI_PROGRAM_COUPON_PAGE,
  },
})
const resolveP6SlotButtonText = (status) => (status === 'unused' ? P6_REWARD_USE_TEXT : P6_REWARD_CLAIM_TEXT)
const buildFixedP6DisplayRewards = (suppliedRewards, claimedRewards) => {
  const slotByCode = new Map()

  DEFAULT_P6_CENTER.claimed_rewards
    .map(normalizeP6Reward)
    .filter(isP6FixedReward)
    .forEach((reward) => {
      const code = getP6RewardCode(reward)
      slotByCode.set(code, {
        ...reward,
        reward_code: code,
        reward_id: code,
        status: 'unclaimed',
        button_text: P6_REWARD_CLAIM_TEXT,
      })
    })

  suppliedRewards
    .filter((reward) => !isP6GiftDisplayReward(reward) && isP6FixedReward(reward))
    .forEach((reward) => {
      const code = getP6RewardCode(reward)
      const status = reward.status === 'unused' ? 'unused' : 'unclaimed'
      slotByCode.set(code, {
        ...mergeP6RewardSlot(slotByCode.get(code), reward),
        reward_code: code,
        reward_id: code,
        status,
        button_text: resolveP6SlotButtonText(status),
      })
    })

  const claimedByCode = new Map()
  claimedRewards
    .filter(isP6FixedReward)
    .forEach((reward) => {
      const code = getP6RewardCode(reward)
      if (!claimedByCode.has(code)) {
        claimedByCode.set(code, reward)
      }
    })

  return P6_FIXED_REWARD_CODES.map((code) => {
    const template = slotByCode.get(code) ?? normalizeP6Reward({ reward_code: code, reward_id: code, status: 'unclaimed' })
    const claimed = claimedByCode.get(code)
    const status = claimed ? 'unused' : template.status === 'unused' ? 'unused' : 'unclaimed'
    const reward = claimed
      ? {
          ...mergeP6RewardSlot(template, claimed),
          image_url: template.image_url || claimed.image_url,
        }
      : template

    return {
      ...reward,
      reward_code: code,
      reward_id: code,
      status,
      button_text: resolveP6SlotButtonText(status),
    }
  })
}

const normalizeP6Center = (center = {}) => {
  const progress = {
    ...DEFAULT_P6_CENTER.progress,
    ...(center.progress ?? {}),
  }
  const lightTarget = Number(progress.light_target) || DEFAULT_P6_CENTER.progress.light_target
  const completedDays = Array.isArray(progress.completed_days) ? progress.completed_days : []
  const claimedRewards = (center.claimed_rewards ?? [])
    .map(normalizeP6Reward)
    .filter((reward) => reward.status !== 'unclaimed')
  const giftReward = {
    ...DEFAULT_P6_CENTER.gift_reward,
    ...(center.gift_reward ?? {}),
    action: {
      ...DEFAULT_P6_CENTER.gift_reward.action,
      ...(center.gift_reward?.action ?? {}),
    },
  }
  const suppliedDisplayRewards = Array.isArray(center.display_rewards) && center.display_rewards.length > 0
    ? center.display_rewards.map(normalizeP6Reward)
    : []
  const displayGift = suppliedDisplayRewards.find(isP6GiftDisplayReward) ?? giftReward
  const displayRewards = [...buildFixedP6DisplayRewards(suppliedDisplayRewards, claimedRewards), displayGift]

  return {
    ...DEFAULT_P6_CENTER,
    ...center,
    progress: {
      ...progress,
      shared_count: Number(progress.shared_count) || 0,
      share_target: Number(progress.share_target) || DEFAULT_P6_CENTER.progress.share_target,
      lit_days: Number(progress.lit_days) || completedDays.length,
      light_target: lightTarget,
      completed_days: completedDays
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= lightTarget),
      gift_qualified: Boolean(progress.gift_qualified),
    },
    claimed_rewards: claimedRewards,
    gift_reward: giftReward,
    display_rewards: displayRewards,
    product_recommend: center.product_recommend
      ? {
          ...DEFAULT_P6_CENTER.product_recommend,
          ...center.product_recommend,
          action: {
            ...DEFAULT_P6_CENTER.product_recommend.action,
            ...(center.product_recommend.action ?? {}),
          },
        }
      : DEFAULT_P6_CENTER.product_recommend,
    draw_again_action: {
      ...DEFAULT_P6_CENTER.draw_again_action,
      ...(center.draw_again_action ?? {}),
      action: {
        ...DEFAULT_P6_CENTER.draw_again_action.action,
        ...(center.draw_again_action?.action ?? {}),
      },
    },
    rules_action: {
      ...DEFAULT_P6_CENTER.rules_action,
      ...(center.rules_action ?? {}),
      action: {
        ...DEFAULT_P6_CENTER.rules_action.action,
        ...(center.rules_action?.action ?? {}),
      },
    },
  }
}

const normalizeP7Rules = (rules = {}) => ({
  ...DEFAULT_P7_RULES,
  ...rules,
  rules: (rules.rules?.length ? rules.rules : DEFAULT_P7_RULES.rules).map((rule, index) => ({
    rule_no: Number(rule.rule_no) || index + 1,
    content: rule.content ?? '',
  })),
  wechat_group: {
    ...DEFAULT_P7_RULES.wechat_group,
    ...(rules.wechat_group ?? {}),
  },
})

const normalizeP8Prize = (prize = {}) => {
  const qualification = {
    ...DEFAULT_P8_PRIZE.qualification,
    ...(prize.qualification ?? {}),
  }
  const lotteryStatus = {
    ...DEFAULT_P8_PRIZE.lottery_status,
    ...(prize.lottery_status ?? {}),
  }
  const wechatGroup = {
    ...DEFAULT_P8_PRIZE.wechat_group,
    ...(prize.wechat_group ?? {}),
  }

  return {
    ...DEFAULT_P8_PRIZE,
    ...prize,
    hero: {
      ...DEFAULT_P8_PRIZE.hero,
      ...(prize.hero ?? {}),
    },
    qualification: {
      ...qualification,
      qualified: qualification.qualified !== false,
      lottery_no: qualification.lottery_no ?? '',
    },
    benefits: (prize.benefits?.length ? prize.benefits : DEFAULT_P8_PRIZE.benefits).map((benefit, index) => ({
      id: benefit.id ?? `benefit_${index + 1}`,
      title: benefit.title ?? '',
      desc: benefit.desc ?? '',
    })),
    lottery_status: {
      ...lotteryStatus,
      status: lotteryStatus.status ?? 'pending',
      status_text: lotteryStatus.status_text || DEFAULT_P8_PRIZE.lottery_status.status_text,
      draw_time_desc: lotteryStatus.draw_time_desc || DEFAULT_P8_PRIZE.lottery_status.draw_time_desc,
      notice: lotteryStatus.notice || DEFAULT_P8_PRIZE.lottery_status.notice,
      publicity_title: lotteryStatus.publicity_title || DEFAULT_P8_PRIZE.lottery_status.publicity_title,
      publicity_desc: lotteryStatus.publicity_desc || DEFAULT_P8_PRIZE.lottery_status.publicity_desc,
    },
    wechat_group: {
      ...wechatGroup,
      benefits: wechatGroup.benefits?.length ? wechatGroup.benefits : DEFAULT_P8_PRIZE.wechat_group.benefits,
    },
  }
}

const resolvePreviewPage = (page) => {
  const normalized = PREVIEW_PAGE_ALIASES[page] ?? page

  return PREVIEW_PAGES.has(normalized) ? normalized : 'home'
}

const buildCanonicalSearch = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  const params = new URLSearchParams(window.location.search)
  params.delete('page')
  const value = params.toString()

  return value ? `?${value}` : ''
}

const getClaimErrorMessage = (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error || '')
  if (!rawMessage) {
    return '领取失败，请稍后重试'
  }

  try {
    const parsed = JSON.parse(rawMessage)
    if (typeof parsed?.detail === 'string' && parsed.detail) {
      return parsed.detail
    }
  } catch {
    // Plain API errors are already user-facing enough for this flow.
  }

  return rawMessage
}
const getClaimIssueErrorCode = (error) =>
  String(error?.error_code || error?.errorCode || error?.payload?.error_code || error?.payload?.errorCode || '')
const getClaimIssueStatus = (error) => Number(error?.status ?? error?.statusCode ?? error?.response?.status)
const getClaimIssueFallbackMessage = (error) =>
  getClaimIssueErrorCode(error) === MINI_PROGRAM_MOBILE_REGISTRATION_ERROR_CODE
    ? MINI_PROGRAM_MOBILE_REGISTRATION_FALLBACK_MESSAGE
    : '领取成功，扫码-进入小程序'
const isMiniProgramMobileRegistrationError = (error) =>
  getClaimIssueErrorCode(error) === MINI_PROGRAM_MOBILE_REGISTRATION_ERROR_CODE
const isClaimIssueFallbackError = (error) => {
  const status = getClaimIssueStatus(error)
  if (!CLAIM_ISSUE_FALLBACK_STATUSES.has(status)) {
    return false
  }

  if (getClaimIssueErrorCode(error) === MINI_PROGRAM_MOBILE_REGISTRATION_ERROR_CODE) {
    return true
  }

  const message = String(error?.message || error?.payload?.message || error?.payload?.detail || '')
  return message.includes('发券失败')
}
const maskMobile = (mobile = '') => `${mobile.slice(0, 3)}****${mobile.slice(-4)}`

const syncBrowserRoute = (page, { replace = false, preserveSearch = false } = {}) => {
  if (typeof window === 'undefined') {
    return
  }

  const targetPath = PAGE_ROUTES[page] ?? PAGE_ROUTES.home
  const targetSearch = preserveSearch ? buildCanonicalSearch() : ''
  const target = `${targetPath}${targetSearch}`
  const current = `${window.location.pathname}${window.location.search}`

  if (current === target) {
    return
  }

  window.history[replace ? 'replaceState' : 'pushState']({}, '', target)
}

const isTestMode = () => import.meta.env.MODE === 'test'

const createUserKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `h5_${crypto.randomUUID()}`
  }

  return `h5_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const getLocalUserKey = () => {
  if (typeof window === 'undefined') {
    return createUserKey()
  }

  const stored = window.localStorage.getItem(SESSION_USER_KEY_STORAGE)
  if (stored) {
    return stored
  }

  const created = createUserKey()
  window.localStorage.setItem(SESSION_USER_KEY_STORAGE, created)
  return created
}

export function useP1Activity(options = {}) {
  const apiClient = options.apiClient ?? activityApi
  const backendEnabled = Boolean(options.apiClient) || !isTestMode()
  const initialPage = resolvePreviewPage(options.initialPage)
  const sessionToken = ref(options.initialSessionToken ?? '')
  const userKey = ref(options.userKey ?? getLocalUserKey())
  const latestDrawId = ref(options.initialDrawId ?? null)
  const sessionPromise = ref(null)
  const drawChance = ref(options.initialChance ?? DEFAULT_DRAW_CHANCE)
  const shareRewardCount = ref(options.initialShareRewardCount ?? 0)
  const currentPage = ref(initialPage)
  const p2Panel = ref('')
  const p2Result = ref(normalizeP2Result(options.initialP2Result))
  const p2Status = ref(options.initialP2Status ?? 'success')
  const p4Detail = ref(normalizeP4Detail(options.initialP4Detail))
  const currentResultProduct = ref(null)
  const rotateResultProductForEntry = () => {
    currentResultProduct.value = claimNextResultProduct()
    p4Detail.value = withResultProduct(p4Detail.value, currentResultProduct.value)
  }
  if ((initialPage === 'p2' || initialPage === 'p4') && !options.initialP4Detail?.product?.productImage) {
    rotateResultProductForEntry()
  }
  const p4DetailLoaded = ref(Boolean(options.initialP4Detail))
  const p4Status = ref(options.initialP4Status ?? 'success')
  const p4ExplainVisible = ref(initialPage === 'p4')
  const p4ThinkingLines = ref(P4_THINKING_LINES)
  const p4ThinkingStepCount = ref(p4Status.value === 'loading' ? 1 : P4_THINKING_LINES.length)
  const p4VisibleThinkingLines = computed(() => p4ThinkingLines.value.slice(0, p4ThinkingStepCount.value))
  const p4ClaimStatus = ref(p4Detail.value.benefit.claimStatus)
  const p4ClaimMessage = ref('')
  const p5Result = ref(normalizeP5Result(options.initialP5Result))
  const p5ClaimStatus = ref('input')
  const p5Mobile = ref('')
  const p5MobileError = ref('')
  const p5UseStatus = ref('idle')
  const p5UseMessage = ref('')
  const showP5ClaimSuccess = ref(false)
  const p6Center = ref(normalizeP6Center(options.initialP6Center))
  const p6Status = ref(options.initialP6Status ?? 'success')
  const p7Rules = ref(normalizeP7Rules(options.initialP7Rules))
  const p8Prize = ref(normalizeP8Prize(options.initialP8Prize))
  const rulesReturnPage = ref('home')
  const p8ReturnPage = ref('p6')
  const p6ActionStatus = ref('idle')
  const p6ActionMessage = ref('')
  const showShareGuide = ref(false)
  const showMiniProgramFallback = ref(false)
  const miniProgramFallbackMessage = ref('扫码-进入小程序')
  const miniProgramFallbackTarget = ref('')
  const tipMessage = ref('')
  const isDrawTemporarilyDisabled = ref(false)
  const showDrawAnimation = ref(false)
  const drawAnimationStatus = ref('idle')

  const getCurrentBenefitRewardCode = () => {
    const benefit = p4Detail.value.benefit ?? {}
    const benefitReward = benefit.reward ?? {}
    const p5Reward = p5Result.value.reward ?? {}
    const normalizeRewardCode = (rewardCode) =>
      rewardCode && rewardCode !== DEFAULT_P5_RESULT.reward.couponId ? rewardCode : null

    return (
      normalizeRewardCode(p5Reward.reward_code) ||
      normalizeRewardCode(p5Reward.rewardCode) ||
      normalizeRewardCode(p5Reward.couponId) ||
      normalizeRewardCode(benefitReward.reward_code) ||
      normalizeRewardCode(benefitReward.rewardCode) ||
      normalizeRewardCode(benefitReward.couponId) ||
      normalizeRewardCode(benefit.rewardCode) ||
      null
    )
  }
  const getVisibleP5RewardCode = () => {
    const reward = p5Result.value.reward ?? {}

    return (
      reward.reward_code ||
      reward.rewardCode ||
      reward.couponId ||
      p4Detail.value.benefit?.rewardCode ||
      null
    )
  }
  const drawRequestStatus = ref('idle')
  const drawRequestMessage = ref('')
  const drawAnimationFinished = ref(false)
  let tipTimer = null
  let p4ClaimMessageTimer = null
  let p4RewardRedirectTimer = null
  let p4ThinkingTimer = null
  let p4ThinkingStartedAt = 0
  let p4ExplainRequestId = 0
  const clearTipTimer = () => {
    if (tipTimer) {
      clearTimeout(tipTimer)
      tipTimer = null
    }
  }
  const clearP4ClaimMessageTimer = () => {
    if (p4ClaimMessageTimer) {
      clearTimeout(p4ClaimMessageTimer)
      p4ClaimMessageTimer = null
    }
  }
  const clearP4RewardRedirectTimer = () => {
    if (p4RewardRedirectTimer) {
      clearTimeout(p4RewardRedirectTimer)
      p4RewardRedirectTimer = null
    }
  }
  const clearP4ThinkingTimer = () => {
    if (p4ThinkingTimer) {
      clearTimeout(p4ThinkingTimer)
      p4ThinkingTimer = null
    }
  }
  const scheduleNextP4ThinkingLine = () => {
    clearP4ThinkingTimer()
    if (p4Status.value !== 'loading' || p4ThinkingStepCount.value >= p4ThinkingLines.value.length) {
      return
    }

    p4ThinkingTimer = setTimeout(() => {
      p4ThinkingStepCount.value += 1
      p4ThinkingTimer = null
      scheduleNextP4ThinkingLine()
    }, P4_THINKING_STEP_MS)
  }
  const startP4Thinking = () => {
    p4ThinkingLines.value = P4_THINKING_LINES
    p4ThinkingStepCount.value = 1
    p4ThinkingStartedAt = Date.now()
    scheduleNextP4ThinkingLine()
  }
  const stopP4Thinking = () => {
    clearP4ThinkingTimer()
    p4ThinkingStepCount.value = p4ThinkingLines.value.length
  }
  const waitForP4ThinkingMinimum = () => {
    const elapsed = Date.now() - p4ThinkingStartedAt
    const remaining = Math.max(0, P4_THINKING_MIN_VISIBLE_MS - elapsed)
    return remaining ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve()
  }
  const clearTip = () => {
    clearTipTimer()
    tipMessage.value = ''
    isDrawTemporarilyDisabled.value = false
  }
  const clearP4ClaimMessage = () => {
    clearP4ClaimMessageTimer()
    p4ClaimMessage.value = ''
  }
  const scheduleClaimedBenefitRewardRedirect = () => {
    clearP4RewardRedirectTimer()
    clearP4ClaimMessageTimer()
    p4ClaimMessage.value = CLAIMED_BENEFIT_REWARD_REDIRECT_MESSAGE
    trackEvent('claimed_benefit_reward_redirect_prompt', {
      draw_id: latestDrawId.value,
      reward_code: getVisibleP5RewardCode(),
    })
    p4RewardRedirectTimer = setTimeout(() => {
      p4RewardRedirectTimer = null
      trackEvent('claimed_benefit_reward_redirect_auto', {
        draw_id: latestDrawId.value,
        reward_code: getVisibleP5RewardCode(),
      })
      goRewards()
    }, CLAIMED_BENEFIT_REWARD_REDIRECT_MS)
  }
  const showTimedTip = (message) => {
    clearTipTimer()
    tipMessage.value = message
    isDrawTemporarilyDisabled.value = true
    tipTimer = setTimeout(() => {
      tipMessage.value = ''
      isDrawTemporarilyDisabled.value = false
      tipTimer = null
    }, TIP_VISIBLE_MS)
  }
  const resetDrawAnimation = () => {
    showDrawAnimation.value = false
    drawAnimationStatus.value = 'idle'
    drawRequestStatus.value = 'idle'
    drawRequestMessage.value = ''
    drawAnimationFinished.value = false
    isDrawTemporarilyDisabled.value = false
  }
  const startDrawAnimation = () => {
    clearTip()
    showDrawAnimation.value = true
    drawAnimationStatus.value = 'playing'
    drawRequestStatus.value = 'loading'
    drawRequestMessage.value = ''
    drawAnimationFinished.value = false
    isDrawTemporarilyDisabled.value = true
    trackEvent('draw_animation_start')
  }
  const finishDrawAnimationIfReady = () => {
    if (!showDrawAnimation.value || !drawAnimationFinished.value) {
      return
    }

    if (drawRequestStatus.value === 'loading') {
      drawAnimationStatus.value = 'waiting'
      return
    }

    const status = drawRequestStatus.value
    const message = drawRequestMessage.value
    showDrawAnimation.value = false
    drawAnimationStatus.value = 'idle'
    drawRequestStatus.value = 'idle'
    drawRequestMessage.value = ''
    drawAnimationFinished.value = false
    isDrawTemporarilyDisabled.value = false

    if (status === 'ready') {
      rotateResultProductForEntry()
      setCurrentPage('p2')
      trackEvent('draw_animation_end', { draw_id: latestDrawId.value })
      trackEvent('result_page_view', { draw_id: latestDrawId.value })
      trackEvent('result_page_render_success', { draw_id: latestDrawId.value })
      return
    }

    if (status === 'no_chance') {
      showTimedTip(message || NO_CHANCE_TIP)
      trackEvent('draw_no_chance_view')
      return
    }

    if (status === 'error') {
      setCurrentPage('p2')
      trackEvent('draw_animation_end', { status: 'error' })
      trackEvent('result_page_load_error')
    }
  }
  const resolveDrawRequest = (status, message = '') => {
    drawRequestStatus.value = status
    drawRequestMessage.value = message
    finishDrawAnimationIfReady()
  }
  const completeDrawAnimation = () => {
    drawAnimationFinished.value = true
    finishDrawAnimationIfReady()
  }
  const failDrawAnimation = () => {
    trackEvent('draw_animation_load_fail')
    drawAnimationFinished.value = true
    finishDrawAnimationIfReady()
  }
  const showTimedP4ClaimMessage = (message = '福利已领取，可到我的奖励查看') => {
    clearP4ClaimMessageTimer()
    p4ClaimMessage.value = message
    p4ClaimMessageTimer = setTimeout(() => {
      p4ClaimMessage.value = ''
      p4ClaimMessageTimer = null
    }, TIP_VISIBLE_MS)
  }
  const rulesScrollToBottomTracked = ref(false)
  const setCurrentPage = (page, routeOptions) => {
    currentPage.value = page
    syncBrowserRoute(page, routeOptions)
  }

  syncBrowserRoute(currentPage.value, { replace: true, preserveSearch: true })

  if (p4ClaimStatus.value === 'claimed') {
    showTimedP4ClaimMessage(p4Detail.value.benefit.claimMessage || '福利已领取，可到我的奖励查看')
  }

  const applyDailyState = (dailyState = {}) => {
    if (Number.isFinite(Number(dailyState.remaining_draw_count))) {
      drawChance.value = Number(dailyState.remaining_draw_count)
    }
    if (Number.isFinite(Number(dailyState.share_reward_count_today))) {
      shareRewardCount.value = Number(dailyState.share_reward_count_today)
    }
  }

  const applyProgress = (progress = {}) => {
    if (!progress || Object.keys(progress).length === 0) {
      return
    }

    p6Center.value = normalizeP6Center({
      ...p6Center.value,
      progress: {
        ...p6Center.value.progress,
        ...progress,
      },
      gift_reward: {
        ...p6Center.value.gift_reward,
        status: progress.gift_qualified ? 'qualified' : p6Center.value.gift_reward.status,
        button_text: progress.gift_qualified ? P6_GIFT_USE_TEXT : p6Center.value.gift_reward.button_text,
      },
    })
  }

  const applySessionPayload = (payload = {}) => {
    if (payload.session_token) {
      sessionToken.value = payload.session_token
    }
    applyDailyState(payload.daily_state)
    applyProgress(payload.progress)
  }

  const ensureSession = async () => {
    if (!backendEnabled) {
      return ''
    }

    if (sessionToken.value) {
      return sessionToken.value
    }

    if (!sessionPromise.value) {
      sessionPromise.value = apiClient
        .createSession({
          user_key: userKey.value,
          source_page: options.initialPage ?? 'p1',
          source_channel: 'h5',
          share_token: options.shareToken,
        })
        .then((payload) => {
          applySessionPayload(payload)
          if (currentPage.value === 'home') {
            trackEvent('activity_home_view', {
              draw_chance: drawChance.value,
              share_count_today: shareRewardCount.value,
            })
          }
          return sessionToken.value
        })
        .finally(() => {
          sessionPromise.value = null
        })
    }

    return sessionPromise.value
  }

  const shareProgressText = computed(
    () => `今日分享奖励 ${shareRewardCount.value}/${MAX_DAILY_SHARE_REWARDS}`,
  )

  const trackEvent = (eventName, eventPayload = {}) => {
    if (!backendEnabled || !eventName) {
      return
    }

    apiClient.trackEvent?.({
      session_token: sessionToken.value || undefined,
      page_code: currentPage.value,
      event_name: eventName,
      event_payload: eventPayload,
      client_time: new Date().toISOString(),
    }).catch(() => {})
  }

  const closeMiniProgramFallback = () => {
    showMiniProgramFallback.value = false
    miniProgramFallbackTarget.value = ''
  }

  const openMiniProgramFallback = (
    targetUrl = MINI_PROGRAM_COUPON_PAGE,
    actionType = 'mini_program',
    message = '扫码-进入小程序',
  ) => {
    if (showMiniProgramFallback.value && miniProgramFallbackTarget.value === targetUrl) {
      return
    }

    showP5ClaimSuccess.value = false
    miniProgramFallbackTarget.value = targetUrl || MINI_PROGRAM_COUPON_PAGE
    miniProgramFallbackMessage.value = message
    showMiniProgramFallback.value = true
    trackEvent('mini_program_qrcode_fallback_view', {
      action_type: actionType,
      target: miniProgramFallbackTarget.value,
    })
  }

  const goHome = () => {
    resetDrawAnimation()
    clearP4RewardRedirectTimer()
    closeMiniProgramFallback()
    setCurrentPage('home')
    p2Panel.value = ''
    clearP4ClaimMessage()
    p5UseMessage.value = ''
    p6ActionMessage.value = ''
    showP5ClaimSuccess.value = false
    clearTip()
  }

  onBeforeUnmount(() => {
    clearTipTimer()
    clearP4ClaimMessageTimer()
    clearP4RewardRedirectTimer()
    clearP4ThinkingTimer()
  })

  const loadRules = async () => {
    if (!backendEnabled || !apiClient.getRulesDetail) {
      return
    }

    try {
      p7Rules.value = normalizeP7Rules(await apiClient.getRulesDetail())
      trackEvent('rules_page_render_success')
      if (p7Rules.value.wechat_group?.qrcode_url) {
        trackEvent('rules_qrcode_exposure')
      }
    } catch {
      trackEvent('rules_page_render_fail')
      trackEvent('rules_page_load_fail')
    }
  }

  const goRules = () => {
    trackEvent('rule_click')
    rulesReturnPage.value = currentPage.value === 'rules' ? rulesReturnPage.value : currentPage.value
    setCurrentPage('rules')
    loadRules()
    trackEvent('rules_page_view')
  }

  const goRewards = async () => {
    clearP4RewardRedirectTimer()
    trackEvent('my_reward_click')
    trackEvent('reward_center_page_view')
    setCurrentPage('p6')
    p6ActionMessage.value = ''
    if (backendEnabled) {
      p6Status.value = 'loading'
      try {
        const token = await ensureSession()
        p6Center.value = normalizeP6Center(await apiClient.getRewardCenter({ session_token: token }))
        p6Status.value = 'success'
      } catch {
        p6Status.value = 'error'
      }
    }
    trackEvent(p6Status.value === 'error' ? 'reward_center_load_fail' : 'reward_center_render_success')
    trackEvent('progress_module_exposure')
    trackEvent('reward_card_exposure')
    trackEvent('product_recommend_exposure')
  }

  const handleDraw = async (source = 'button') => {
    if (isDrawTemporarilyDisabled.value || showDrawAnimation.value) {
      return
    }

    trackEvent(source === 'tube' ? 'draw_tube_click' : 'draw_entry_click')

    if (backendEnabled) {
      if (drawChance.value <= 0) {
        showTimedTip(NO_CHANCE_TIP)
        trackEvent('draw_no_chance_view')
        return
      }

      p2Status.value = 'loading'
      p2Panel.value = ''
      p4ExplainVisible.value = false
      p4DetailLoaded.value = false
      p4Status.value = 'success'
      clearP4ClaimMessage()
      showP5ClaimSuccess.value = false
      startDrawAnimation()
      try {
        const token = await ensureSession()
        const payload = await apiClient.executeDraw({ session_token: token, source })
        if (!payload.success) {
          p2Status.value = 'success'
          applyDailyState(payload.daily_state)
          resolveDrawRequest('no_chance', payload.message || NO_CHANCE_TIP)
          return
        }

        latestDrawId.value = payload.draw_id
        p2Result.value = normalizeP2Result(payload.result)
        applyDailyState(payload.daily_state)
        applyProgress(payload.progress)
        p2Status.value = 'success'
        trackEvent('draw_success', { draw_id: payload.draw_id })
        resolveDrawRequest('ready')
      } catch {
        p2Status.value = 'error'
        trackEvent('draw_fail')
        resolveDrawRequest('error')
      }
      return
    }

    if (drawChance.value > 0) {
      p2Panel.value = ''
      p2Status.value = 'success'
      p4ExplainVisible.value = false
      p4DetailLoaded.value = false
      p4Status.value = 'success'
      clearP4ClaimMessage()
      showP5ClaimSuccess.value = false
      startDrawAnimation()
      resolveDrawRequest('ready')
      return
    }

    showTimedTip(NO_CHANCE_TIP)
    trackEvent('draw_no_chance_view')
  }

  const openShareGuide = () => {
    trackEvent('share_get_chance_click')
    showShareGuide.value = true
  }

  const closeShareGuide = () => {
    showShareGuide.value = false
  }

  const applyP4Detail = (detail = {}) => {
    if (detail.draw_id || detail.drawId) {
      latestDrawId.value = detail.draw_id ?? detail.drawId
    }
    const normalizedDetail = normalizeP4Detail(detail)
    p4Detail.value = currentResultProduct.value
      ? withResultProduct(normalizedDetail, currentResultProduct.value)
      : normalizedDetail
    p4ThinkingLines.value = p4Detail.value.thinkingProcess
    p4ClaimStatus.value = p4Detail.value.benefit.claimStatus
    p4DetailLoaded.value = true
    if (p4ClaimStatus.value === 'claimed') {
      showTimedP4ClaimMessage(p4Detail.value.benefit.claimMessage || '福利已领取，可到我的奖励查看')
    }
  }

  const loadP4DetailForBenefit = async () => {
    if (!backendEnabled || p4DetailLoaded.value) {
      return p4Status.value === 'success'
    }

    if (p4Status.value === 'loading') {
      return false
    }

    const requestId = p4ExplainRequestId + 1
    p4ExplainRequestId = requestId
    p4Status.value = 'loading'
    clearP4ThinkingTimer()
    clearP4ClaimMessage()
    try {
      const token = await ensureSession()
      const detail = await apiClient.getExplainDetail({ session_token: token, draw_id: latestDrawId.value })
      if (requestId !== p4ExplainRequestId) {
        return false
      }
      applyP4Detail(detail)
      p4Status.value = 'success'
      trackEvent('explain_load_success', { draw_id: latestDrawId.value, source: 'benefit' })
      return true
    } catch {
      if (requestId !== p4ExplainRequestId) {
        return false
      }
      p4DetailLoaded.value = false
      p4Status.value = 'error'
      p4ClaimMessage.value = '福利信息加载失败，请稍后重试'
      trackEvent('explain_load_fail', { draw_id: latestDrawId.value, source: 'benefit' })
      return false
    }
  }

  const openP2Explain = async ({ trigger = 'ask' } = {}) => {
    trackEvent(trigger === 'ask' ? 'ask_xiaopu_click' : 'benefit_auto_explain_start')
    p4ExplainVisible.value = true
    p2Panel.value = ''
    clearP4ClaimMessage()
    p5UseMessage.value = ''
    p6ActionMessage.value = ''
    showP5ClaimSuccess.value = false

    if (p4Status.value === 'loading') {
      return
    }

    if (backendEnabled && p4DetailLoaded.value && p4Status.value === 'success') {
      trackEvent('ai_explain_page_view', { draw_id: latestDrawId.value })
      trackEvent('ai_explain_render_success', { draw_id: latestDrawId.value })
      return
    }

    if (backendEnabled) {
      const requestId = p4ExplainRequestId + 1
      p4ExplainRequestId = requestId
      p4Status.value = 'loading'
      startP4Thinking()
      try {
        const token = await ensureSession()
        const [detail] = await Promise.all([
          apiClient.getExplainDetail({ session_token: token, draw_id: latestDrawId.value }),
          waitForP4ThinkingMinimum(),
        ])
        if (requestId !== p4ExplainRequestId || p4Status.value !== 'loading') {
          return
        }
        applyP4Detail(detail)
        stopP4Thinking()
        p4Status.value = 'success'
        trackEvent('explain_load_success', { draw_id: latestDrawId.value })
        trackEvent('ai_explain_page_view', { draw_id: latestDrawId.value })
        trackEvent('ai_explain_render_success', { draw_id: latestDrawId.value })
        trackEvent('ai_explain_product_exposure', {
          draw_id: latestDrawId.value,
          product_id: p4Detail.value.product.productId,
        })
      } catch {
        await waitForP4ThinkingMinimum()
        if (requestId !== p4ExplainRequestId || p4Status.value !== 'loading') {
          return
        }
        stopP4Thinking()
        p4DetailLoaded.value = false
        p4Status.value = 'error'
        trackEvent('explain_load_fail', { draw_id: latestDrawId.value })
        trackEvent('ai_explain_load_fail', { draw_id: latestDrawId.value })
      }
      return
    }

    p4Status.value = 'success'
    p4DetailLoaded.value = true
  }

  const openP2Benefit = async () => {
    if (backendEnabled && (!p4DetailLoaded.value || p4Status.value === 'error')) {
      const ready = await loadP4DetailForBenefit()
      if (!ready) {
        return
      }
    }

    if (p4Status.value !== 'success') {
      return
    }

    await claimP4Benefit()
  }

  const goP2Back = () => {
    trackEvent('p2_back_click')
    goHome()
  }

  const goP4Back = () => {
    trackEvent('p4_back_click')
    p4ExplainRequestId += 1
    clearP4ThinkingTimer()
    clearP4RewardRedirectTimer()
    setCurrentPage('p2')
    clearP4ClaimMessage()
    p5UseMessage.value = ''
    showP5ClaimSuccess.value = false
  }

  const openP2Poster = () => {
    // Replace with POST /api/poster/generate when poster generation is available.
    trackEvent('share_poster_click')
    p2Panel.value = 'poster'
  }

  const closeP2Panel = () => {
    p2Panel.value = ''
  }

  const retryP2Result = async () => {
    if (backendEnabled && latestDrawId.value && apiClient.getDrawResultDetail) {
      p2Status.value = 'loading'
      try {
        const token = await ensureSession()
        const detail = await apiClient.getDrawResultDetail({ session_token: token, draw_id: latestDrawId.value })
        p2Result.value = normalizeP2Result(detail.result ?? detail)
        p2Status.value = 'success'
        trackEvent('result_page_render_success', { draw_id: latestDrawId.value })
      } catch {
        p2Status.value = 'error'
        trackEvent('result_page_load_error', { draw_id: latestDrawId.value })
      }
      return
    }

    p2Status.value = 'success'
    trackEvent('result_page_retry_click')
  }

  const retryP4Detail = async () => {
    if (backendEnabled) {
      await openP2Explain()
      return
    }

    p4Status.value = 'success'
    clearP4ClaimMessage()
    p5UseMessage.value = ''
    showP5ClaimSuccess.value = false
    trackEvent('ai_explain_retry_click')
  }

  const retryP6Center = async () => {
    if (backendEnabled) {
      await goRewards()
      return
    }

    p6Status.value = 'success'
    p6ActionMessage.value = ''
    trackEvent('reward_center_render_success')
  }

  const claimP4Benefit = async () => {
    if (p4Status.value !== 'success' || p4ClaimStatus.value === 'claiming') {
      return
    }

    if (p4ClaimStatus.value === 'claimed') {
      scheduleClaimedBenefitRewardRedirect()
      return
    }

    if (p4ClaimStatus.value === 'claimed') {
      showTimedP4ClaimMessage('福利已领取，可到我的奖励查看')
      return
    }

    trackEvent('exclusive_benefit_click')
    let popupBenefit = p4Detail.value.benefit
    if (p4ClaimStatus.value === 'claimed') {
      showTimedP4ClaimMessage(p4Detail.value.benefit.claimMessage || '福利已领取，可到我的奖励查看')
      return
    }

    p5ClaimStatus.value = 'input'
    p5Result.value = buildP5InputResultFromBenefit(popupBenefit)
    p5MobileError.value = ''
    p5UseMessage.value = ''
    showP5ClaimSuccess.value = true
    trackEvent('benefit_mobile_popup_view', {
      draw_id: latestDrawId.value,
      reward_code: getVisibleP5RewardCode(),
    })
    return

    if (backendEnabled) {
      p4ClaimStatus.value = 'claiming'
      clearP4ClaimMessageTimer()
      p4ClaimMessage.value = '福利领取中，请稍候'
      try {
        const token = await ensureSession()
        const result = await apiClient.claimBenefit({
          session_token: token,
          draw_id: latestDrawId.value,
          reward_code: p4Detail.value.benefit.rewardCode,
        })
        p5Result.value = normalizeP5Result(result)
        p4ClaimStatus.value = 'claimed'
        clearP4ClaimMessage()
        showP5ClaimSuccess.value = true
        p5UseMessage.value = ''
        trackEvent('exclusive_benefit_claim_success')
        trackEvent('benefit_claim_success_page_view')
        trackEvent('benefit_claim_result_render_success')
        trackEvent('coupon_card_exposure', {
          coupon_id: p5Result.value.reward.couponId,
        })
      } catch {
        p4ClaimStatus.value = 'unclaimed'
        clearP4ClaimMessageTimer()
        p4ClaimMessage.value = '福利领取失败，请稍后重试'
        trackEvent('exclusive_benefit_claim_fail')
        trackEvent('benefit_claim_result_load_fail')
      }
      return
    }

    p4ClaimStatus.value = 'claimed'
    clearP4ClaimMessage()
    showP5ClaimSuccess.value = true
    p5UseMessage.value = ''
    trackEvent('exclusive_benefit_claim_success')
    trackEvent('benefit_claim_success_page_view')
    trackEvent('benefit_claim_result_render_success')
    trackEvent('coupon_card_exposure', {
      coupon_id: p5Result.value.reward.couponId,
    })
  }

  const focusP5MobileInput = () => {
    trackEvent('benefit_mobile_input_focus', {
      draw_id: latestDrawId.value,
      reward_code: p4Detail.value.benefit.rewardCode,
    })
  }

  const validateP5Mobile = () => {
    const mobile = String(p5Mobile.value || '').trim()
    if (!mobile) {
      p5MobileError.value = '请输入手机号'
      trackEvent('benefit_mobile_validate_fail', { error_code: 'mobile_required', has_mobile: false })
      return ''
    }

    if (!MOBILE_PATTERN.test(mobile)) {
      p5MobileError.value = '请输入正确手机号'
      trackEvent('benefit_mobile_validate_fail', { error_code: 'mobile_invalid', has_mobile: true })
      return ''
    }

    p5MobileError.value = ''
    return mobile
  }

  const syncP6RewardClaimState = () => {
    const rewardCode = getVisibleP5RewardCode()
    if (!P6_FIXED_REWARD_CODE_SET.has(rewardCode)) {
      return
    }

    const existingDisplay = (p6Center.value.display_rewards ?? []).find((reward) => getP6RewardCode(reward) === rewardCode)
    const existingClaimed = (p6Center.value.claimed_rewards ?? []).find((reward) => getP6RewardCode(reward) === rewardCode)
    const p5Reward = p5Result.value.reward ?? {}
    const p5Action = p5Result.value.action ?? {}
    const claimedReward = normalizeP6Reward({
      ...existingDisplay,
      ...existingClaimed,
      reward_code: rewardCode,
      reward_id: existingClaimed?.reward_id || existingDisplay?.reward_id || `${rewardCode}_claimed`,
      reward_type: existingDisplay?.reward_type || existingClaimed?.reward_type || p5Reward.reward_type || 'coupon',
      title: existingDisplay?.title || p5Reward.title || p5Reward.amountText || '',
      unit_text: existingDisplay?.unit_text || p5Reward.unit_text || p5Reward.unitText || '',
      desc: existingDisplay?.desc || p5Reward.desc || p5Reward.couponName || '',
      status: 'unused',
      button_text: P6_REWARD_USE_TEXT,
      image_url: existingDisplay?.image_url || existingClaimed?.image_url || p5Reward.image_url || p5Reward.imageUrl || '',
      action: {
        type: p5Action.type || existingClaimed?.action?.type || existingDisplay?.action?.type || 'mini_program_coupon_package',
        target: p5Action.target || existingClaimed?.action?.target || existingDisplay?.action?.target || MINI_PROGRAM_COUPON_PAGE,
      },
    })

    p6Center.value = normalizeP6Center({
      ...p6Center.value,
      claimed_rewards: [
        claimedReward,
        ...(p6Center.value.claimed_rewards ?? []).filter((reward) => getP6RewardCode(reward) !== rewardCode),
      ],
    })
  }

  const markP5ClaimSuccess = (result, mobile) => {
    p5Result.value = normalizeP5Result(result)
    syncP6RewardClaimState()
    p4ClaimStatus.value = 'claimed'
    p5ClaimStatus.value = 'claimed'
    clearP4ClaimMessage()
    showP5ClaimSuccess.value = true
    const maskedMobile = p5Result.value.receiver_mobile_masked || p5Result.value.receiverMobileMasked || maskMobile(mobile)
    p5UseMessage.value = `领取成功，已绑定 ${maskedMobile}`
    trackEvent('exclusive_benefit_claim_success')
    trackEvent('benefit_claim_result_render_success')
    trackEvent('coupon_card_exposure', {
      coupon_id: p5Result.value.reward.couponId,
    })
  }
  const buildP5ClaimIssueFallbackResult = (mobile) =>
    normalizeP5Result({
      ...p5Result.value,
      pageTitle: '领取成功',
      claimStatus: 'claimed',
      receiver_mobile_masked: maskMobile(mobile),
      reward: {
        ...p5Result.value.reward,
        couponStatus: 'unused',
      },
      action: {
        ...p5Result.value.action,
        buttonText: '去使用',
        type: 'mini_program_coupon_package',
        target: p5Result.value.action?.target || MINI_PROGRAM_COUPON_PAGE,
      },
    })

  const redirectP5ClaimAfterMobileBind = async ({ fallbackMessage = '领取成功，扫码-进入小程序' } = {}) => {
    const couponTarget =
      p5Result.value.action?.type === 'mini_program_coupon_package' && p5Result.value.action?.target
        ? p5Result.value.action.target
        : MINI_PROGRAM_COUPON_PAGE

    trackEvent('use_benefit_click', {
      trigger: 'auto_after_mobile_bind',
      claim_no: p5Result.value.claim_no ?? p5Result.value.claimNo,
      action_type: 'mini_program_coupon_package',
    })

    p5UseStatus.value = 'redirecting'
    const redirected = await goMiniProgramCouponPage(couponTarget, {
      fail: () => openMiniProgramFallback(couponTarget, 'mini_program_coupon_package', fallbackMessage),
    })
    p5UseStatus.value = 'idle'

    if (redirected) {
      showP5ClaimSuccess.value = false
      p5MobileError.value = ''
      p5UseMessage.value = ''
      showTimedP4ClaimMessage('领取成功，正在前往小程序我的优惠券')
      trackEvent('use_benefit_redirect_success', {
        trigger: 'auto_after_mobile_bind',
        action_type: 'mini_program_coupon_package',
        target: couponTarget,
      })
      return
    }

    openMiniProgramFallback(couponTarget, 'mini_program_coupon_package', fallbackMessage)
    trackEvent('use_benefit_redirect_fail', {
      trigger: 'auto_after_mobile_bind',
      action_type: 'mini_program_coupon_package',
      target: couponTarget,
    })
  }

  const submitP5MobileClaim = async () => {
    if (p5ClaimStatus.value === 'submitting') {
      return
    }

    if (p5Result.value.claimStatus === 'claimed') {
      await useP5Benefit()
      return
    }

    trackEvent('benefit_mobile_submit_click', {
      draw_id: latestDrawId.value,
      reward_code: p4Detail.value.benefit.rewardCode,
      has_mobile: Boolean(p5Mobile.value),
    })

    const mobile = validateP5Mobile()
    if (!mobile) {
      p5ClaimStatus.value = 'invalid'
      return
    }

    if (backendEnabled) {
      p5ClaimStatus.value = 'submitting'
      p4ClaimStatus.value = 'claiming'
      p5UseMessage.value = ''
      try {
        const token = await ensureSession()
        const result = await apiClient.claimBenefit({
          session_token: token,
          draw_id: latestDrawId.value,
          reward_code: getVisibleP5RewardCode(),
          mobile,
          claim_channel: 'h5',
        })
        markP5ClaimSuccess(result, mobile)
        await redirectP5ClaimAfterMobileBind()
      } catch (error) {
        if (isClaimIssueFallbackError(error)) {
          const issueErrorCode = getClaimIssueErrorCode(error)
          trackEvent('exclusive_benefit_claim_issue_fallback', {
            status: getClaimIssueStatus(error) || CLAIM_ISSUE_FALLBACK_STATUS,
            error_code: issueErrorCode || undefined,
            draw_id: latestDrawId.value,
            reward_code: getVisibleP5RewardCode(),
          })

          if (isMiniProgramMobileRegistrationError(error)) {
            const couponTarget =
              p5Result.value.action?.type === 'mini_program_coupon_package' && p5Result.value.action?.target
                ? p5Result.value.action.target
                : MINI_PROGRAM_COUPON_PAGE

            applyDailyState(error?.payload?.daily_state)
            p4ClaimStatus.value = 'unclaimed'
            p5ClaimStatus.value = 'input'
            p5MobileError.value = ''
            p5UseMessage.value = ''
            clearP4ClaimMessage()
            openMiniProgramFallback(
              couponTarget,
              'mini_program_coupon_package',
              getClaimIssueFallbackMessage(error),
            )
            trackEvent('use_benefit_redirect_fail', {
              trigger: 'mobile_registration_required',
              action_type: 'mini_program_coupon_package',
              target: couponTarget,
            })
            return
          }

          markP5ClaimSuccess(buildP5ClaimIssueFallbackResult(mobile), mobile)
          await redirectP5ClaimAfterMobileBind({ fallbackMessage: getClaimIssueFallbackMessage(error) })
          return
        }

        p4ClaimStatus.value = 'unclaimed'
        p5ClaimStatus.value = 'input'
        p5UseMessage.value = getClaimErrorMessage(error)
        trackEvent('exclusive_benefit_claim_fail')
        trackEvent('benefit_claim_result_load_fail')
      }
      return
    }

    markP5ClaimSuccess(
      {
        ...p5Result.value,
        pageTitle: '领取成功',
        claimStatus: 'claimed',
        receiver_mobile_masked: `${mobile.slice(0, 3)}****${mobile.slice(-4)}`,
        action: {
          ...p5Result.value.action,
          buttonText: '去领取',
        },
      },
      mobile,
    )
  }

  const closeP5ClaimSuccess = () => {
    trackEvent('benefit_mobile_popup_close', {
      has_input: Boolean(p5Mobile.value),
      claim_status: p5Result.value.claimStatus,
    })
    showP5ClaimSuccess.value = false
    clearP4ClaimMessage()
    p5UseMessage.value = ''
    p5MobileError.value = ''
  }

  const runConfiguredAction = async (action, messageRef, fallbackMessage) => {
    if (!action?.target) {
      messageRef.value = fallbackMessage
      return false
    }

    const isMiniProgramAction = String(action.type ?? '').startsWith('mini_program')
    let miniProgramFallbackShown = false
    const showMiniProgramFallbackForAction = () => {
      if (miniProgramFallbackShown) {
        return
      }
      miniProgramFallbackShown = true
      messageRef.value = ''
      openMiniProgramFallback(action.target, action.type)
    }

    if (action.type === 'mini_program_coupon_package') {
      const redirected = await goMiniProgramCouponPage(action.target, {
        fail: showMiniProgramFallbackForAction,
      })
      if (!redirected) {
        showMiniProgramFallbackForAction()
        return true
      }

      messageRef.value = redirected ? '' : fallbackMessage || CLAIM_SUCCESS_COUPON_FALLBACK_MESSAGE
      return redirected
    }

    if (isMiniProgramAction) {
      const redirected = await goMiniProgramCouponPage(action.target, {
        fail: showMiniProgramFallbackForAction,
      })
      if (!redirected) {
        showMiniProgramFallbackForAction()
      }
      return true
    }

    if (typeof window !== 'undefined') {
      window.location.href = action.target
      return true
    }

    messageRef.value = `\u6d4b\u8bd5\u73af\u5883\u672a\u68c0\u6d4b\u5230\u5c0f\u7a0b\u5e8f\u6865\uff0c\u76ee\u6807\uff1a${action.target}`
    return true
  }

  const useP5Benefit = async () => {
    if (p5UseStatus.value === 'redirecting' || p5Result.value.reward.couponStatus !== 'unused') {
      return
    }

    trackEvent('use_benefit_click')

    if (backendEnabled && (await runConfiguredAction(p5Result.value.action, p5UseMessage, '使用入口暂未开放，请稍后再试。'))) {
      trackEvent('use_benefit_redirect_success')
      return
    }

    p5UseMessage.value = CLAIM_SUCCESS_COUPON_FALLBACK_MESSAGE
    trackEvent('use_benefit_redirect_fail')
  }

  const goP6Back = () => {
    trackEvent('reward_center_back_click')
    goHome()
  }

  const openP6Rules = () => {
    trackEvent('activity_rules_click')
    rulesReturnPage.value = 'p6'
    setCurrentPage('rules')
    p6ActionMessage.value = ''
    loadRules()
    trackEvent('rules_page_view')
  }

  const goP7Back = () => {
    trackEvent('rules_back_click')
    setCurrentPage(rulesReturnPage.value && rulesReturnPage.value !== 'rules' ? rulesReturnPage.value : 'home')
  }

  const openP8Prize = async () => {
    trackEvent('grand_prize_page_view')
    p8ReturnPage.value = 'p6'
    setCurrentPage('p8')
    p6ActionMessage.value = ''

    if (backendEnabled) {
      try {
        const token = await ensureSession()
        p8Prize.value = normalizeP8Prize(await apiClient.getGrandPrizeDetail({ session_token: token }))
      } catch {
        trackEvent('grand_prize_load_fail')
        trackEvent('grand_prize_render_fail')
        return
      }
    }

    if (p8Prize.value.qualification.qualified) {
      trackEvent('grand_prize_render_success')
      trackEvent('grand_prize_status_exposure')
      trackEvent('grand_prize_qrcode_exposure')
      return
    }

    trackEvent('grand_prize_not_qualified_view')
  }

  const trackP7ScrollToBottom = (event) => {
    if (rulesScrollToBottomTracked.value) {
      return
    }

    const target = event?.target
    const reachedBottom =
      !target || target.scrollHeight <= target.clientHeight || target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (reachedBottom) {
      rulesScrollToBottomTracked.value = true
      trackEvent('rules_scroll_to_bottom')
    }
  }

  const trackP7QrcodeClick = () => {
    trackEvent('rules_qrcode_click')
  }

  const trackP7QrcodeLoadFail = () => {
    trackEvent('rules_qrcode_load_fail')
  }

  const trackP8QrcodeClick = () => {
    trackEvent('grand_prize_qrcode_click')
  }

  const trackP8QrcodeLoadFail = () => {
    trackEvent('grand_prize_qrcode_load_fail')
  }

  const goP8Back = () => {
    trackEvent('grand_prize_back_click')
    setCurrentPage(p8ReturnPage.value || 'p6')
  }

  const drawAgainFromP6 = () => {
    trackEvent('draw_again_click')
    goHome()
  }

  const useP6Reward = async (reward) => {
    if (p6ActionStatus.value === 'redirecting' || !reward) {
      return
    }

    const isGift = reward.reward_type === 'gift_lottery_qualification'
    const isGiftAvailable = isGift && ['qualified', 'unused'].includes(reward.status)
    const isCouponAvailable = !isGift && reward.status === 'unused'
    const isCouponUnclaimed = !isGift && reward.status === 'unclaimed'

    if (isGift && !isGiftAvailable) {
      trackEvent('reward_not_qualified_click')
      p6ActionMessage.value = '暂未达标：分享5个好友，或累计点亮7天后可使用985和牛礼盒抽奖资格。'
      return
    }

    if (isCouponUnclaimed) {
      trackEvent('reward_unclaimed_click', {
        reward_code: getP6RewardCode(reward),
      })
      p6ActionMessage.value = '请先完成抽签并领取成功，成功后这里会变为去使用。'
      return
    }

    if (!isCouponAvailable && !isGiftAvailable) {
      p6ActionMessage.value = '该奖励当前不可使用。'
      return
    }

    trackEvent('reward_use_click')
    if (isGift) {
      p6ActionMessage.value = '正在查询大奖资格...'
      openP8Prize()
      return
    }

    if (backendEnabled && (await runConfiguredAction(reward.action, p6ActionMessage, '已领取，请前往小程序我的优惠券查看。'))) {
      trackEvent('reward_use_redirect_success')
      return
    }

    p6ActionMessage.value = '已领取，请前往小程序我的优惠券查看。'
    trackEvent('reward_use_redirect_fail')
  }

  const openP6Product = async () => {
    if (p6ActionStatus.value === 'redirecting') {
      return
    }

    trackEvent('product_recommend_click')
    if (
      backendEnabled &&
      (await runConfiguredAction(p6Center.value.product_recommend?.action, p6ActionMessage, '商品详情入口暂未开放，请稍后再试。'))
    ) {
      trackEvent('product_recommend_redirect_success')
      return
    }

    p6ActionMessage.value = '商品详情入口暂未开放，请稍后再试。'
    trackEvent('product_recommend_redirect_fail')
  }

  const completeShare = async (shareChannel = 'wechat') => {
    if (backendEnabled) {
      try {
        const token = await ensureSession()
        const result = await apiClient.recordShare({ session_token: token, share_channel: shareChannel })
        applyDailyState(result.daily_state)
        trackEvent(result.reward_granted ? 'share_chance_add_success' : 'share_chance_limit_reached', {
          share_token: result.share_token,
        })
        return result
      } catch {
        trackEvent('share_chance_add_fail')
      }
      return null
    }

    if (shareRewardCount.value < MAX_DAILY_SHARE_REWARDS) {
      shareRewardCount.value += 1
      drawChance.value += 1
      trackEvent('share_chance_add_success')
      return {
        reward_granted: true,
        daily_state: {
          remaining_draw_count: drawChance.value,
          share_reward_count_today: shareRewardCount.value,
        },
      }
    }

    trackEvent('share_chance_limit_reached')
    return {
      reward_granted: false,
      daily_state: {
        remaining_draw_count: drawChance.value,
        share_reward_count_today: shareRewardCount.value,
      },
    }
  }

  if (backendEnabled) {
    ensureSession()
      .then(() => {
        if (initialPage === 'p6') {
          return goRewards()
        }
        if (initialPage === 'rules') {
          trackEvent('rules_page_view')
          return loadRules()
        }
        if (initialPage === 'p8') {
          return openP8Prize()
        }
        if (initialPage === 'p4') {
          return openP2Explain()
        }
        return undefined
      })
      .catch(() => {
        trackEvent('activity_home_load_error')
        showTimedTip('活动加载失败，请稍后重试')
      })
  }

  return {
    closeP5ClaimSuccess,
    closeShareGuide,
    completeDrawAnimation,
    completeShare,
    currentPage,
    drawChance,
    latestDrawId,
    goHome,
    goP2Back,
    goP4Back,
    goRewards,
    goRules,
    failDrawAnimation,
    handleDraw,
    closeP2Panel,
    openP2Explain,
    openP2Poster,
    openShareGuide,
    p2Panel,
    p2Result,
    p2Status,
    p4ClaimMessage,
    p4ClaimStatus,
    p4Detail,
    p4ExplainVisible,
    p4ThinkingLines,
    p4VisibleThinkingLines,
    p4Status,
    p5Result,
    p5ClaimStatus,
    p5Mobile,
    p5MobileError,
    p5UseMessage,
    p5UseStatus,
    p6ActionMessage,
    p6ActionStatus,
    p6Center,
    p6Status,
    p7Rules,
    p8Prize,
    claimP4Benefit,
    drawAgainFromP6,
    goP8Back,
    isDrawTemporarilyDisabled,
    goP6Back,
    openP6Product,
    openP6Rules,
    openP2Benefit,
    goP7Back,
    retryP4Detail,
    retryP6Center,
    retryP2Result,
    shareProgressText,
    shareRewardCount,
    sessionToken,
    showDrawAnimation,
    drawAnimationStatus,
    showShareGuide,
    showMiniProgramFallback,
    showP5ClaimSuccess,
    tipMessage,
    miniProgramFallbackMessage,
    miniProgramFallbackTarget,
    closeMiniProgramFallback,
    trackP7QrcodeClick,
    trackP7QrcodeLoadFail,
    trackP7ScrollToBottom,
    trackP8QrcodeClick,
    trackP8QrcodeLoadFail,
    useP6Reward,
    useP5Benefit,
    focusP5MobileInput,
    submitP5MobileClaim,
    trackEvent,
  }
}
