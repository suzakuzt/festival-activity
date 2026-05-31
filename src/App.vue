<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activityApi } from './api/activityApi'
import { useP1Activity } from './composables/useP1Activity'
import { goMiniProgramPosterSavePage } from './utils/miniProgramBridge'
import { installRuntimeMonitor } from './utils/runtimeMonitor'
import { createShareQrcodeDataUrl } from './utils/shareQrcode'

const props = defineProps({
  initialPage: {
    type: String,
    default: undefined,
  },
  initialChance: {
    type: Number,
    default: 1,
  },
  initialShareRewardCount: {
    type: Number,
    default: 0,
  },
  initialP2Result: {
    type: Object,
    default: undefined,
  },
  initialP2Status: {
    type: String,
    default: 'success',
  },
  initialP4Detail: {
    type: Object,
    default: undefined,
  },
  initialP4Status: {
    type: String,
    default: 'success',
  },
  initialP5Result: {
    type: Object,
    default: undefined,
  },
  initialP6Center: {
    type: Object,
    default: undefined,
  },
  initialP6Status: {
    type: String,
    default: 'success',
  },
  initialP7Rules: {
    type: Object,
    default: undefined,
  },
  initialP8Prize: {
    type: Object,
    default: undefined,
  },
  apiClient: {
    type: Object,
    default: undefined,
  },
})

const queryParams = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
const queryInitialPage = queryParams.get('page') ?? undefined
const queryShareToken = queryParams.get('share_token') ?? undefined
const pathInitialPage = typeof window === 'undefined' ? undefined : window.location.pathname

const {
  closeP5ClaimSuccess,
  closeP2Panel,
  closeShareGuide,
  completeDrawAnimation,
  completeShare,
  currentPage,
  drawAnimationStatus,
  drawChance,
  failDrawAnimation,
  goHome,
  goP2Back,
  goP4Back,
  goRewards,
  goRules,
  handleDraw,
  isDrawTemporarilyDisabled,
  latestDrawId,
  openP2Explain,
  openP2Benefit,
  openP2Poster,
  openShareGuide,
  p2Panel,
  p2Result,
  p2Status,
  p4ClaimMessage,
  p4ClaimStatus,
  p4Detail,
  p4ExplainVisible,
  p4VisibleThinkingLines,
  p4Status,
  p5ClaimStatus,
  p5Mobile,
  p5MobileError,
  p5Result,
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
  goP7Back,
  goP6Back,
  openP6Product,
  openP6Rules,
  retryP4Detail,
  retryP6Center,
  retryP2Result,
  sessionToken,
  showDrawAnimation,
  showShareGuide,
  showMiniProgramFallback,
  showP5ClaimSuccess,
  miniProgramFallbackMessage,
  miniProgramFallbackTarget,
  tipMessage,
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
} = useP1Activity({
  ...props,
  initialPage: props.initialPage ?? queryInitialPage ?? pathInitialPage,
  shareToken: queryShareToken,
})

const chanceText = computed(() => `我的摇签机会 ${drawChance.value}次`)
const homeAsset = (name) => `${import.meta.env.BASE_URL}assets/home/${name}`
const p2Asset = (name) => `${import.meta.env.BASE_URL}assets/p2/${name}`
const p4Asset = (name) => `${import.meta.env.BASE_URL}assets/p4/${name}`
const p5Asset = (name) => `${import.meta.env.BASE_URL}assets/p5/${name}`
const p6Asset = (name) => `${import.meta.env.BASE_URL}assets/p6/${name}`
const p7Asset = (name) => `${import.meta.env.BASE_URL}assets/p7/${name}`
const p8Asset = (name) => `${import.meta.env.BASE_URL}assets/p8/${name}`
const shareAsset = (name) => `${import.meta.env.BASE_URL}assets/share/${name}`
const miniProgramFallbackQrcodeSrc = computed(
  () => import.meta.env.VITE_MINI_PROGRAM_QRCODE_URL || shareAsset('mini_program_qrcode.jpg'),
)
const webpName = (name) => String(name || '').replace(/\.(png|jpe?g)$/i, '.webp')
const optimizeLocalAssetUrl = (value) => {
  if (!value || /^https?:\/\//i.test(value) || /qrcode/i.test(value)) {
    return value
  }

  return value.replace(/\.(png|jpe?g)(\?.*)?$/i, '.webp$2')
}
const localImageAsset = (asset, name) => asset(webpName(name))
const homeImageAsset = (name) => localImageAsset(homeAsset, name)
const p4ImageAsset = (name) => localImageAsset(p4Asset, name)
const p5ImageAsset = (name) => localImageAsset(p5Asset, name)
const p6ImageAsset = (name) => localImageAsset(p6Asset, name)
const p7ImageAsset = (name) => localImageAsset(p7Asset, name)
const p8ImageAsset = (name) => localImageAsset(p8Asset, name)
const activitySharePosterSrc = ref('')
const ensureActivitySharePosterSrc = () => {
  if (!activitySharePosterSrc.value) {
    activitySharePosterSrc.value = shareAsset('share_activity_poster.webp')
  }

  return activitySharePosterSrc.value
}
const drawAnimationVideoSrc = computed(() => (showDrawAnimation.value ? homeAsset('CQ2-transparent-3s.webm') : ''))
const FIRST_SCREEN_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 0 : 4000
const firstScreenImages = [
  homeImageAsset('bg_rank_success.jpg'),
  homeImageAsset('logo_prime_cuts_home.png'),
  homeImageAsset('element_lottery_box.png'),
  homeImageAsset('btn_draw_now.png'),
  p6ImageAsset('btn_activity_rules.png'),
]
const pageReady = ref(currentPage.value !== 'home')
const isHomeFirstScreenLoading = computed(() => currentPage.value === 'home' && !pageReady.value)
const preloadImage = (src) =>
  new Promise((resolve) => {
    if (!src || typeof Image === 'undefined') {
      resolve()
      return
    }

    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = src
  })
const releaseFirstScreen = async () => {
  if (currentPage.value !== 'home' || pageReady.value) {
    pageReady.value = true
    return
  }

  await Promise.race([
    Promise.all(firstScreenImages.map(preloadImage)),
    new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_TIMEOUT_MS)),
  ])
  pageReady.value = true
}
const P5_FALLBACK_COUPON_IMAGE = 'element_coupon_20yuan_card.png'
const HOME_BARRAGE_VISIBLE_ROWS = 3
const HOME_BARRAGE_DURATION = '12s'
const homeBarragePrizeItems = [
  {
    id: 'coupon-138438',
    text: '138*****438抽中10元优惠券',
  },
  {
    id: 'coupon-130721',
    text: '130*****721抽中20元优惠券',
  },
  {
    id: 'coupon-189906',
    text: '189*****906抽中30元优惠券',
  },
  {
    id: 'coupon-177219',
    text: '177*****219抽中9折优惠券',
  },
  {
    id: 'coupon-156706',
    text: '156*****706抽中7.5折优惠券',
  },
]
const homeBarrageItems = [...homeBarragePrizeItems, ...homeBarragePrizeItems].map((item, index) => ({
  ...item,
  id: `${item.id}-${index}`,
}))
const homeBarrageTrackStyle = {
  '--barrage-track-height': `${(homeBarrageItems.length / HOME_BARRAGE_VISIBLE_ROWS) * 100}%`,
  '--barrage-item-height': `${100 / homeBarrageItems.length}%`,
  '--barrage-duration': HOME_BARRAGE_DURATION,
}
const stageStyle = computed(() => ({
  backgroundImage: `url(${homeImageAsset('bg_rank_success.jpg')})`,
}))
const playDrawAnimation = (event) => {
  event.currentTarget?.play?.().catch(() => {})
}
const canUseTransparentDrawVideo = computed(() => {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent || ''
  if (/MicroMessenger|iPhone|iPad|iPod/i.test(userAgent)) {
    return false
  }

  const video = document.createElement('video')
  return Boolean(
    video.canPlayType('video/webm; codecs="vp9"') ||
      video.canPlayType('video/webm; codecs="vp8"') ||
      video.canPlayType('video/webm'),
  )
})
const p2StageStyle = computed(() => ({
  backgroundImage: `url(${p4ImageAsset('bg_ai_result_page.png')})`,
}))
const p4StageStyle = computed(() => ({
  backgroundImage: `url(${p4ImageAsset('bg_ai_result_page.png')})`,
}))
const p6StageStyle = computed(() => ({
  backgroundImage: `url(${p6ImageAsset('bg_exam_progress_page.jpg')})`,
}))
const p7StageStyle = computed(() => ({
  backgroundImage: `url(${p7ImageAsset('bg_activity_rules_page.png')})`,
}))
const p8StageStyle = computed(() => ({
  backgroundImage: `url(${p8ImageAsset('bg_checkin_reward_result_page.png')})`,
}))
const p2SignTag = computed(() => `${p2Result.value.signType} 路 ${p2Result.value.signLevel}`)
const p2FortuneHeadline = computed(() => {
  const mainHeadline = p2Result.value.mainTextColumns?.find((text) => text)

  return p2Result.value.fortuneHeadline || p2Result.value.signType || mainHeadline || '过儿签'
})
const p2FortuneHint = computed(() => p2Result.value.fortuneHint || p2Result.value.mainTextColumns?.find((text) => text) || '点击卷轴，查看你的解签内容')
const P2_FORTUNE_HINT_LINE_MAP = {
  '考试期间，不要叫我真名，叫我过儿。': ['考试期间，', '不要叫我真名，', '叫我过儿。'],
  '世界上最宽广的是什么？考试范围。': ['世界上最宽广的是什么？', '考试范围。'],
  '快要考试了，别人在复习，自己在预习。': ['快要考试了，', '别人在复习，', '自己在预习。'],
  '给书磕个头，就当是复习过了吧。': ['给书磕个头，', '就当是复习过了吧。'],
  '想在这次考试咸鱼翻身的，没想到粘锅了。': ['想在这次考试咸鱼翻身的，', '没想到粘锅了。'],
}
const splitFortuneHintLines = (text = '') => {
  const normalized = String(text).trim()
  if (P2_FORTUNE_HINT_LINE_MAP[normalized]) {
    return P2_FORTUNE_HINT_LINE_MAP[normalized]
  }

  const parts = normalized.match(/[^，。！？!?]+[，。！？!?]?/g)?.map((line) => line.trim()).filter(Boolean)
  return parts?.length ? parts.slice(0, 3) : [normalized]
}
const splitFortuneHighlightSegments = (line, highlight) => {
  if (!highlight || !line.includes(highlight)) {
    return [{ text: line, highlight: false }]
  }

  return line.split(highlight).flatMap((part, index, parts) => {
    const segments = []
    if (part) {
      segments.push({ text: part, highlight: false })
    }
    if (index < parts.length - 1) {
      segments.push({ text: highlight, highlight: true })
    }
    return segments
  })
}
const p2FortuneHighlightText = computed(() => String(p2FortuneHeadline.value || '').replace(/签$/, '').trim())
const p2FortuneHintLines = computed(() => {
  const configuredLines = p2Result.value.mainTextColumns?.filter((text) => String(text || '').trim()) ?? []
  const lines = configuredLines.length > 1 ? configuredLines : splitFortuneHintLines(p2FortuneHint.value)

  return lines.map((line, index) => ({
    id: `${index}-${line}`,
    segments: splitFortuneHighlightSegments(line, p2FortuneHighlightText.value),
  }))
})
const splitGlyphs = (text = '') => Array.from(text)
const P2_SIDE_COMFORT_GLYPH_LIMIT = 10
const P2_SIDE_MAX_GLYPH_LIMIT = 12
const normalizeP2SideCopy = (text = '') => String(text).replace(/^\s*[吉凶宜忌]\s*[｜|:：]\s*/, '')
const getP2SideGlyphs = (text = '') =>
  splitGlyphs(normalizeP2SideCopy(text)).filter((char) => !['。', '，', '、', '；', '：', '｜', '|', ',', ';', ':', ' '].includes(char))
const splitSideGlyphs = (text = '') => {
  const glyphs = getP2SideGlyphs(text)

  return glyphs.length > P2_SIDE_MAX_GLYPH_LIMIT ? glyphs.slice(0, P2_SIDE_COMFORT_GLYPH_LIMIT) : glyphs
}
const getP2SideCopyClass = (text = '') => {
  const glyphCount = getP2SideGlyphs(text).length

  return {
    'is-dense': glyphCount > P2_SIDE_COMFORT_GLYPH_LIMIT,
    'is-clipped': glyphCount > P2_SIDE_MAX_GLYPH_LIMIT,
  }
}
const p2MainColumns = computed(() =>
  p2Result.value.mainTextColumns.map((text, index) => ({
    id: `${index}-${text}`,
    text,
    chars: splitGlyphs(text),
  })),
)
const p2GoodForChars = computed(() => splitSideGlyphs(p2Result.value.goodFor))
const p2AvoidChars = computed(() => splitSideGlyphs(p2Result.value.avoid))
const sharePosterSaveMessage = ref('')
const sharePosterPreviewSrc = ref('')
const p2PosterSaveMessage = ref('')
const p2PosterPreviewSrc = ref('')
const p2PanelTitle = computed(() => (p2Panel.value === 'poster' ? '分享' : '今日解签内容'))
const p2PanelText = computed(() => {
  if (p2Panel.value === 'poster') {
    return '后续接入 POST /api/poster/generate，生成当前签文分享内容。'
  }

  return `${p2Result.value.explainText} 后续接入 GET /api/explain/detail。`
})
let runtimeMonitor
const p4ProductImageFailed = ref(false)
const resolveP4ProductImage = (image) => {
  if (!image || p4ProductImageFailed.value) {
    return p4ImageAsset('product_flat_iron_steak.png')
  }

  if (image.startsWith('http')) {
    return image
  }

  if (image.startsWith('/')) {
    return optimizeLocalAssetUrl(image)
  }

  return p4ImageAsset(image)
}
const p4ProductImageSrc = computed(() => resolveP4ProductImage(p4Detail.value.product.productImage))
const resolveP5CouponImage = (reward) => {
  const image = reward?.imageUrl ?? reward?.image_url ?? reward?.rewardImageUrl ?? reward?.reward_image_url
  if (image) {
    if (image.startsWith('http')) {
      return image
    }

    return image.startsWith('/') ? optimizeLocalAssetUrl(image) : p5ImageAsset(image)
  }

  return p5ImageAsset(P5_FALLBACK_COUPON_IMAGE)
}
const p5CouponImageSrc = computed(() => resolveP5CouponImage(p5Result.value.reward))
const p4ClaimButtonText = computed(() => {
  if (p4ClaimStatus.value === 'claiming') {
    return '领取中'
  }
  if (p4ClaimStatus.value === 'claimed') {
    return '已领取'
  }

  return p4Detail.value.benefit.claimButtonText || '领取专属福利'
})
const p4ClaimButtonDisabled = computed(() => p4Status.value !== 'success' || p4ClaimStatus.value === 'claiming')
const p2BenefitButtonDisabled = computed(() => p4Status.value === 'loading' || p4ClaimStatus.value === 'claiming')
const shouldShowP4ClaimButton = computed(() => p4Status.value === 'success')
const p4ClaimTipText = computed(() => p4ClaimMessage.value)
const handleP4ProductImageError = () => {
  p4ProductImageFailed.value = true
}
const p5UseButtonText = computed(() => {
  if (p5UseStatus.value === 'redirecting') {
    return '跳转中'
  }

  return p5Result.value.action.buttonText || '去使用'
})
const p5UseButtonDisabled = computed(
  () => p5UseStatus.value === 'redirecting' || p5Result.value.reward.couponStatus !== 'unused',
)
const isP5Claimed = computed(() => p5Result.value.claimStatus === 'claimed')
const p5PrimaryButtonText = computed(() => {
  if (p5ClaimStatus.value === 'submitting') {
    return '领取中...'
  }

  return isP5Claimed.value ? p5UseButtonText.value : '去领取'
})
const p5PrimaryButtonDisabled = computed(
  () => p5ClaimStatus.value === 'submitting' || (isP5Claimed.value && p5UseButtonDisabled.value),
)
const handleP5PrimaryAction = () => {
  if (isP5Claimed.value) {
    useP5Benefit()
    return
  }

  submitP5MobileClaim()
}
const p6ProductImageFailed = ref(false)
const p7QrcodeFailed = ref(false)
const p8QrcodeFailed = ref(false)
const showP7QrcodePreview = ref(false)
const p6Progress = computed(() => p6Center.value.progress)
const p6ShareCount = computed(() => Number(p6Progress.value.shared_count) || 0)
const p6ShareTarget = computed(() => Number(p6Progress.value.share_target) || 5)
const p6CompletedDays = computed(() => new Set(p6Progress.value.completed_days ?? []))
const p6ProgressDays = computed(() => {
  const total = Number(p6Progress.value.light_target) || 7

  return Array.from({ length: total }, (_, index) => {
    const day = index + 1

    return {
      day,
      complete: p6CompletedDays.value.has(day),
    }
  })
})
const p6RewardCards = computed(() => p6Center.value.display_rewards ?? [
  ...(p6Center.value.claimed_rewards ?? []).slice(0, 5),
  p6Center.value.gift_reward,
])
const p6RewardGridClass = computed(() => ({
  'is-two-row': p6RewardCards.value.length > 3,
}))
const p6Product = computed(() => p6Center.value.product_recommend)
const p6DrawAgainButtonText = computed(() => p6Center.value.draw_again_action.button_text || '再抽一次')

const normalizeP6RewardTitle = (reward) => String(reward?.title ?? '').replace(/\s/g, '')
const resolveP6RewardImageName = (reward) => {
  if (reward?.image_url) {
    return reward.image_url
  }

  if (reward?.reward_type === 'gift_lottery_qualification') {
    return 'product_gift_box.png'
  }

  const title = normalizeP6RewardTitle(reward)

  if (reward?.reward_type === 'discount_coupon') {
    if (title.includes('7.5')) {
      return 'element_coupon_75off_card.png'
    }
    if (title.includes('9')) {
      return 'element_coupon_9off_card.png'
    }
  }

  if (title.includes('30')) {
    return 'element_coupon_30yuan_card.png'
  }
  if (title.includes('20')) {
    return 'element_coupon_20yuan_card.png'
  }
  if (title.includes('10')) {
    return 'element_coupon_10yuan_card.png'
  }

  return ''
}
const resolveP6AssetUrl = (value) => {
  if (!value) {
    return ''
  }

  if (value.startsWith('http')) {
    return value
  }

  if (value.startsWith('/')) {
    return optimizeLocalAssetUrl(value)
  }

  return p6ImageAsset(value)
}
const resolveP6RewardImage = (reward) => resolveP6AssetUrl(resolveP6RewardImageName(reward))
const resolveP6ProductImage = (image) => {
  if (!image || p6ProductImageFailed.value) {
    return p4ImageAsset('product_flat_iron_steak.png')
  }

  if (image.startsWith('http')) {
    return image
  }

  if (image.startsWith('/')) {
    return optimizeLocalAssetUrl(image)
  }

  return image.startsWith('card_') || image.startsWith('product_') ? p4ImageAsset(image) : p6ImageAsset(image)
}
const p6ProductImageSrc = computed(() => resolveP6ProductImage(p6Product.value?.image_url))
const p7QrcodeSrc = computed(() => {
  const qrcode = p7Rules.value.wechat_group.qrcode_url

  if (!qrcode || p7QrcodeFailed.value) {
    return ''
  }

  if (qrcode.startsWith('http') || qrcode.startsWith('/')) {
    return qrcode
  }

  return p7Asset(qrcode)
})
const sharePosterQrcodeSrc = ref('')
const sharePosterUrl = ref('')
const activityPosterQrcodeSrc = computed(() => sharePosterQrcodeSrc.value)
const ACTIVITY_SHARE_POSTER_WIDTH = 941
const ACTIVITY_SHARE_POSTER_HEIGHT = 1672
const ACTIVITY_SHARE_POSTER_QR = {
  left: 0.15,
  top: 0.847,
  size: 0.212,
}
const POSTER_LONGPRESS_TIP = '长按海报可保存/分享'
const POSTER_SAVE_SUCCESS_MESSAGE = '保存成功，手机端请长按上方图片保存到相册'
const POSTER_GENERATED_MESSAGE = '海报已生成，手机端请长按上方图片保存到相册'
const MINI_PROGRAM_POSTER_SAVE_MESSAGE = '正在打开小程序保存到相册...'
const toAbsolutePosterUrl = (posterUrl) => {
  if (!posterUrl) {
    return ''
  }

  if (/^https?:\/\//i.test(posterUrl)) {
    return posterUrl
  }

  if (typeof window === 'undefined') {
    return posterUrl
  }

  return new URL(posterUrl, window.location.origin).href
}
const resetSharePosterQrcode = () => {
  sharePosterQrcodeSrc.value = ''
  sharePosterUrl.value = ''
}
const updateSharePosterQrcode = async (shareResult) => {
  const shareUrl = shareResult?.share_url
  if (!shareUrl) {
    return false
  }

  const absoluteShareUrl = toAbsolutePosterUrl(shareUrl)
  sharePosterUrl.value = absoluteShareUrl
  try {
    sharePosterQrcodeSrc.value = await createShareQrcodeDataUrl(absoluteShareUrl)
    return Boolean(sharePosterQrcodeSrc.value)
  } catch {
    sharePosterQrcodeSrc.value = ''
    return false
  }
}
const loadPosterCanvasImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
const drawPosterText = (ctx, text, x, y, options = {}) => {
  const {
    color = '#6a2b19',
    font = '28px KaiTi, STKaiti, serif',
    lineHeight = 40,
    maxWidth = 620,
  } = options
  const lines = String(text || '').split('\n').filter(Boolean)

  ctx.save()
  ctx.fillStyle = color
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight, maxWidth)
  })
  ctx.restore()
}
const savePosterRecord = async (imageDataUrl, posterType = 'result_share') => {
  const savePoster = props.apiClient?.savePoster ?? activityApi.savePoster
  if (!savePoster) {
    return null
  }

  const payload = {
    session_token: sessionToken.value || undefined,
    page_code: currentPage.value,
    poster_type: posterType,
    image_data_url: imageDataUrl,
  }

  if (posterType === 'result_share') {
    payload.draw_id = latestDrawId.value || undefined
    payload.sign_text = {
      headline: p2FortuneHeadline.value,
      hint: p2FortuneHint.value,
      good_for: p2Result.value.goodFor,
      avoid: p2Result.value.avoid,
    }
  }

  return savePoster(payload)
}
const downloadPosterCanvas = (canvas) => {
  const download = (url) => {
    const link = document.createElement('a')
    link.href = url
    link.download = `牛气上上签-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        return
      }
      const url = URL.createObjectURL(blob)
      download(url)
      window.setTimeout(() => URL.revokeObjectURL(url), 1200)
    }, 'image/png')
    return
  }

  download(canvas.toDataURL('image/png'))
}
const renderActivityPosterCanvas = async () => {
  if (typeof document === 'undefined') {
    return null
  }

  let activityPoster = null
  try {
    activityPoster = await loadPosterCanvasImage(ensureActivitySharePosterSrc())
  } catch {
    activityPoster = null
  }

  const canvas = document.createElement('canvas')
  const width = Number(activityPoster?.naturalWidth || activityPoster?.width) || ACTIVITY_SHARE_POSTER_WIDTH
  const height = Number(activityPoster?.naturalHeight || activityPoster?.height) || ACTIVITY_SHARE_POSTER_HEIGHT
  const scale = 1
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  ctx.scale(scale, scale)
  if (activityPoster) {
    ctx.drawImage(activityPoster, 0, 0, width, height)
  } else {
    ctx.fillStyle = '#b80606'
    ctx.fillRect(0, 0, width, height)
    drawPosterText(ctx, '高考抽签\n专属福利', width / 2, height * 0.24, {
      color: '#fff4d2',
      font: 'bold 76px Microsoft YaHei, sans-serif',
      lineHeight: 96,
      maxWidth: width * 0.8,
    })
    drawPosterText(ctx, '扫码参与高考抽签活动', width / 2, height * 0.78, {
      color: '#ffe3a5',
      font: 'bold 34px Microsoft YaHei, sans-serif',
      maxWidth: width * 0.8,
    })
  }

  try {
    if (activityPosterQrcodeSrc.value) {
      const qrcode = await loadPosterCanvasImage(activityPosterQrcodeSrc.value)
      const qrSize = width * ACTIVITY_SHARE_POSTER_QR.size
      const qrX = width * ACTIVITY_SHARE_POSTER_QR.left
      const qrY = height * ACTIVITY_SHARE_POSTER_QR.top
      ctx.fillStyle = '#fff'
      ctx.fillRect(qrX, qrY, qrSize, qrSize)
      ctx.drawImage(qrcode, qrX, qrY, qrSize, qrSize)
    }
  } catch {
    drawPosterText(ctx, '扫码参与活动', width * 0.256, height * 0.894, {
      color: '#8a2818',
      font: '20px Microsoft YaHei, sans-serif',
      maxWidth: width * 0.18,
    })
  }

  return canvas
}
const prepareActivityPosterPreview = async (setPreview, isCurrent) => {
  try {
    const canvas = await renderActivityPosterCanvas()
    if (!canvas || !isCurrent()) {
      return
    }

    const previewSrc = canvas.toDataURL('image/png')
    if (previewSrc && isCurrent()) {
      setPreview((currentSrc) => currentSrc || previewSrc)
    }
  } catch {
    // Keep the static poster visible if preview composition fails.
  }
}
const prepareHomeSharePosterPreview = () =>
  prepareActivityPosterPreview(
    (src) => {
      sharePosterPreviewSrc.value = typeof src === 'function' ? src(sharePosterPreviewSrc.value) : src
    },
    () => showShareGuide.value,
  )
const prepareP2SharePosterPreview = () =>
  prepareActivityPosterPreview(
    (src) => {
      p2PosterPreviewSrc.value = typeof src === 'function' ? src(p2PosterPreviewSrc.value) : src
    },
    () => p2Panel.value === 'poster',
  )
const completeShareForPoster = async (shareChannel) => {
  const result = await completeShare(shareChannel)
  return updateSharePosterQrcode(result)
}
const openHomeSharePoster = () => {
  resetSharePosterQrcode()
  ensureActivitySharePosterSrc()
  openShareGuide()
  void completeShareForPoster('home_share').then((hasTrackedQrcode) => {
    if (hasTrackedQrcode && showShareGuide.value) {
      sharePosterPreviewSrc.value = ''
      prepareHomeSharePosterPreview()
    }
  })
}
const openResultSharePoster = () => {
  resetSharePosterQrcode()
  ensureActivitySharePosterSrc()
  openP2Poster()
  void completeShareForPoster('result_share').then((hasTrackedQrcode) => {
    if (hasTrackedQrcode && p2Panel.value === 'poster') {
      p2PosterPreviewSrc.value = ''
      prepareP2SharePosterPreview()
    }
  })
}
const saveActivityPoster = async ({ posterType, setMessage, setPreview, shareChannel = 'poster_save' }) => {
  setMessage('保存中...')
  const canvas = await renderActivityPosterCanvas()

  if (!canvas) {
    setMessage('海报生成失败，请稍后重试')
    return
  }

  const imageDataUrl = canvas.toDataURL('image/png')
  let shouldDownloadFallback = true
  try {
    const result = await savePosterRecord(imageDataUrl, posterType)
    const posterUrl = result?.poster_url || ''
    const previewUrl = posterUrl || imageDataUrl
    setPreview(previewUrl)
    setMessage(result?.saved ? POSTER_SAVE_SUCCESS_MESSAGE : POSTER_GENERATED_MESSAGE)
    trackEvent('poster_save_success', {
      poster_id: result?.poster_id,
      saved: Boolean(result?.saved),
      poster_type: posterType,
    })
    await completeShare(shareChannel)

    const redirected = Boolean(
      result?.saved && posterUrl && (await goMiniProgramPosterSavePage(toAbsolutePosterUrl(posterUrl))),
    )
    if (redirected) {
      shouldDownloadFallback = false
      setMessage(MINI_PROGRAM_POSTER_SAVE_MESSAGE)
      trackEvent('poster_native_save_redirect_success', {
        poster_id: result?.poster_id,
        poster_type: posterType,
      })
    }
  } catch (error) {
    setPreview(imageDataUrl)
    setMessage(POSTER_GENERATED_MESSAGE)
    trackEvent('poster_save_fail', {
      message: error instanceof Error ? error.message : 'poster save failed',
      poster_type: posterType,
    })
    await completeShare(shareChannel)
  }

  if (shouldDownloadFallback) {
    downloadPosterCanvas(canvas)
  }
}
const saveHomeSharePoster = () =>
  saveActivityPoster({
    posterType: 'home_share',
    setMessage: (message) => {
      sharePosterSaveMessage.value = message
    },
    setPreview: (src) => {
      sharePosterPreviewSrc.value = typeof src === 'function' ? src(sharePosterPreviewSrc.value) : src
    },
  })
const saveP2Poster = () =>
  saveActivityPoster({
    posterType: 'result_share',
    setMessage: (message) => {
      p2PosterSaveMessage.value = message
    },
    setPreview: (src) => {
      p2PosterPreviewSrc.value = typeof src === 'function' ? src(p2PosterPreviewSrc.value) : src
    },
  })
const openP7QrcodePreview = () => {
  trackP7QrcodeClick()
  if (p7QrcodeSrc.value) {
    showP7QrcodePreview.value = true
  }
}
const closeP7QrcodePreview = () => {
  showP7QrcodePreview.value = false
}
const p8HeroLines = computed(() => String(p8Prize.value.hero.title ?? '').split(/\n/).filter(Boolean))
const p8Qualification = computed(() => p8Prize.value.qualification)
const p8LotteryStatus = computed(() => p8Prize.value.lottery_status)
const p8WechatGroup = computed(() => p8Prize.value.wechat_group)
const p8LotteryNoText = computed(() => p8Qualification.value.lottery_no || '')
const isP8Drawn = computed(() => Boolean(p8LotteryStatus.value.is_drawn) || ['won', 'not_won', 'drawn'].includes(p8LotteryStatus.value.status))
const isP8Winner = computed(() => p8LotteryStatus.value.status === 'won' || p8LotteryStatus.value.is_winner)
const p8PublicityResultAlt = computed(() => (isP8Winner.value ? '恭喜中奖' : '未中奖'))
const p8PublicityResultSrc = computed(() => {
  if (!isP8Drawn.value) {
    return ''
  }

  return p8ImageAsset(isP8Winner.value ? 'result_grand_prize_won.png' : 'result_grand_prize_not_won.png')
})
const p8QrcodeSrc = computed(() => {
  const qrcode = p8WechatGroup.value.qrcode_url

  if (!qrcode || p8QrcodeFailed.value) {
    return ''
  }

  if (qrcode.startsWith('http') || qrcode.startsWith('/')) {
    return qrcode
  }

  return p8Asset(qrcode)
})
const isP6GiftReward = (reward) => reward?.reward_type === 'gift_lottery_qualification'
const isP6RewardPending = (reward) => !isP6GiftReward(reward) && reward?.status !== 'unused'
const isP6RewardDisabled = () => false
const getP6RewardActionTestId = (reward) => (isP6GiftReward(reward) ? 'p6-gift-action' : 'p6-reward-action')
const getP6RewardButtonText = (reward) => {
  if (isP6GiftReward(reward)) {
    return ['qualified', 'unused'].includes(reward?.status) ? '\u53bb\u67e5\u770b' : reward?.button_text || ''
  }

  if (reward?.status === 'unused') {
    return '\u53bb\u4f7f\u7528'
  }

  if (reward?.status === 'unclaimed') {
    return '\u53bb\u9886\u53d6'
  }

  return reward?.button_text || '\u5f85\u62bd\u53d6'
}
const handleP6ProductImageError = () => {
  p6ProductImageFailed.value = true
}
const handleP7QrcodeError = () => {
  p7QrcodeFailed.value = true
  trackP7QrcodeLoadFail()
}
const handleActivityPosterQrcodeError = () => {
  if (sharePosterQrcodeSrc.value) {
    sharePosterQrcodeSrc.value = ''
  }
}
const handleP8QrcodeError = () => {
  p8QrcodeFailed.value = true
  trackP8QrcodeLoadFail()
}

watch(showShareGuide, (visible) => {
  if (!visible) {
    sharePosterSaveMessage.value = ''
    sharePosterPreviewSrc.value = ''
    resetSharePosterQrcode()
    return
  }

  prepareHomeSharePosterPreview()
})

watch(p2Panel, (panel) => {
  if (panel !== 'poster') {
    p2PosterSaveMessage.value = ''
    p2PosterPreviewSrc.value = ''
    resetSharePosterQrcode()
    return
  }

  prepareP2SharePosterPreview()
})

watch(currentPage, () => {
  showP7QrcodePreview.value = false
  sharePosterSaveMessage.value = ''
  sharePosterPreviewSrc.value = ''
  p2PosterSaveMessage.value = ''
  p2PosterPreviewSrc.value = ''
  resetSharePosterQrcode()
  requestAnimationFrame(() => {
    const scroller = document.scrollingElement || document.documentElement
    if (scroller) {
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    }
    document.body.scrollTop = 0
    document.body.scrollLeft = 0
  })
})

watch(p2Panel, () => {
  p2PosterSaveMessage.value = ''
  p2PosterPreviewSrc.value = ''
})

watch(p4Detail, () => {
  p4ProductImageFailed.value = false
})

watch(p6Center, () => {
  p6ProductImageFailed.value = false
})

watch(p7Rules, () => {
  p7QrcodeFailed.value = false
  showP7QrcodePreview.value = false
})

watch(p8Prize, () => {
  p8QrcodeFailed.value = false
})

onMounted(async () => {
  runtimeMonitor = installRuntimeMonitor({
    getPageCode: () => currentPage.value,
    report: (eventName, payload) => trackEvent(eventName, payload),
  })
  void releaseFirstScreen()
  await nextTick()
  runtimeMonitor?.checkPageNodes()
})

watch(currentPage, async () => {
  if (currentPage.value === 'home') {
    void releaseFirstScreen()
  }
  await nextTick()
  runtimeMonitor?.checkPageNodes()
})

onBeforeUnmount(() => {
  runtimeMonitor?.dispose()
  runtimeMonitor = undefined
})
</script>

<template>
  <div v-if="isHomeFirstScreenLoading" class="first-screen-loading" role="status" aria-live="polite">
    加载中...
  </div>

  <main
    v-if="currentPage === 'home'"
    class="home-page"
    :class="{ 'is-first-screen-loading': isHomeFirstScreenLoading }"
    aria-label="P1 活动首页"
  >
    <section class="home-stage" :style="stageStyle">
      <img
        class="home-brand-logo"
        data-testid="brand-logo-home"
        :src="homeImageAsset('logo_prime_cuts_home.png')"
        alt="Prime Cuts 璞莱牧"
        decoding="async"
        fetchpriority="high"
      />

      <button class="rule-entry" type="button" aria-label="活动规则" @click="goRules">
        <img :src="p6ImageAsset('btn_activity_rules.png')" alt="" decoding="async" fetchpriority="high" />
        <span class="sr-only">活动规则</span>
      </button>

      <div class="home-barrage" data-testid="home-barrage" aria-hidden="true">
        <div class="home-barrage-track" data-testid="home-barrage-track" :style="homeBarrageTrackStyle">
          <span
            v-for="item in homeBarrageItems"
            :key="item.id"
            class="home-barrage-item"
            data-testid="home-barrage-item"
          >
            <span class="home-barrage-text">{{ item.text }}</span>
          </span>
        </div>
      </div>

      <span
        class="lottery-shadow"
        :class="{ 'is-animation-hidden': showDrawAnimation }"
        data-testid="lottery-shadow"
        aria-hidden="true"
      ></span>

      <button
        class="lottery-tube"
        :class="{ 'is-animation-hidden': showDrawAnimation }"
        data-testid="lottery-tube"
        type="button"
        aria-label="点击签筒立即摇签"
        :disabled="isDrawTemporarilyDisabled"
        @click="handleDraw('tube')"
      >
        <img :src="homeImageAsset('element_lottery_box.png')" alt="" decoding="async" fetchpriority="high" />
        <span class="sr-only">签筒</span>
      </button>

      <button
        class="draw-button"
        data-testid="draw-button"
        type="button"
        aria-label="立即摇签"
        :disabled="isDrawTemporarilyDisabled"
        @click="handleDraw('button')"
      >
        <img :src="homeImageAsset('btn_draw_now.png')" alt="" decoding="async" fetchpriority="high" />
        <span class="sr-only">立即摇签</span>
      </button>

      <p v-if="tipMessage" class="chance-tip" role="alert">{{ tipMessage }}</p>

      <nav class="bottom-nav" aria-label="首页快捷入口">
        <button data-testid="home-rewards-entry" type="button" @click="goRewards">每日打卡</button>
        <p aria-live="polite">{{ chanceText }}</p>
        <button data-testid="share-entry" type="button" @click="openHomeSharePoster">分享获取次数</button>
      </nav>
    </section>

    <div v-if="showShareGuide" class="modal-mask" role="presentation">
      <section
        class="p2-poster-dialog home-share-poster-dialog"
        data-testid="home-share-poster-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <h2 id="share-title" class="sr-only">分享引导</h2>
        <button
          class="p2-poster-dismiss"
          data-testid="close-share-guide"
          type="button"
          aria-label="关闭"
          @click="closeShareGuide"
        >
          <span class="sr-only">关闭</span>
        </button>
        <article
          v-if="activitySharePosterSrc && !sharePosterPreviewSrc"
          class="p2-poster-card"
          data-testid="home-share-activity-poster"
        >
          <img
            class="activity-share-poster-image"
            :src="activitySharePosterSrc"
            alt="高考抽签专属福利活动页"
            loading="lazy"
            decoding="async"
          />
          <span class="activity-share-poster-qrcode">
            <img
              v-if="activityPosterQrcodeSrc"
              data-testid="home-share-qrcode"
              :src="activityPosterQrcodeSrc"
              alt="活动二维码"
              :data-share-url="sharePosterUrl"
              loading="lazy"
              decoding="async"
              @error="handleActivityPosterQrcodeError"
            />
            <span v-else>二维码暂未配置</span>
          </span>
        </article>
        <img
          v-else
          class="p2-poster-generated-preview"
          data-testid="home-share-generated-preview"
          :src="sharePosterPreviewSrc"
          alt="生成的分享图片"
          loading="lazy"
          decoding="async"
        />
        <p
          class="p2-poster-save-message"
          data-testid="home-share-poster-longpress-tip"
          role="status"
        >
          {{ POSTER_LONGPRESS_TIP }}
        </p>
      </section>
    </div>
  </main>

  <main
    v-else-if="currentPage === 'p2' || currentPage === 'p4'"
    class="p2-page"
    :class="{ 'is-legacy-p4-route': currentPage === 'p4' }"
    aria-label="P2 今日考运签结果页"
  >
    <section class="p2-stage" :style="p2StageStyle">
      <h1 class="sr-only">六月考运签</h1>

      <button
        class="p2-back-button"
        data-testid="p2-back"
        type="button"
        aria-label="返回"
        @click="currentPage === 'p4' ? goP4Back() : goP2Back()"
      >
        <span class="sr-only">返回</span>
      </button>

      <div v-if="p2Status === 'loading'" class="p2-state" role="status">
        <strong>签文加载中</strong>
        <p>正在为你生成今日考运签。</p>
      </div>

      <div v-else-if="p2Status === 'error'" class="p2-state" role="alert">
        <strong>签文加载失败，请稍后再试</strong>
        <button type="button" @click="retryP2Result">重新加载</button>
      </div>

      <template v-else>
        <article class="p2-combined-card" data-testid="p2-combined-card">
          <p class="sr-only">{{ p2SignTag }}</p>
          <section class="p2-fortune-copy" aria-label="今日签文">
            <h2>{{ p2FortuneHeadline }}</h2>
            <p class="p2-fortune-hint">
              <span
                v-for="line in p2FortuneHintLines"
                :key="line.id"
                class="p2-fortune-line"
                data-testid="p2-fortune-line"
              >
                <span
                  v-for="(segment, index) in line.segments"
                  :key="`${line.id}-${index}-${segment.text}`"
                  :class="{ 'p2-fortune-emphasis': segment.highlight }"
                >
                  {{ segment.text }}
                </span>
              </span>
            </p>
          </section>

          <div class="p2-result-body">
            <section class="p2-product-hero" aria-label="福利商品">
              <img
                data-testid="p2-product-image"
                :src="p4ProductImageSrc"
                alt=""
                loading="lazy"
                decoding="async"
                @error="handleP4ProductImageError"
              />
              <p class="sr-only">{{ p4Detail.product.productName }}</p>
            </section>
          </div>

          <section class="p2-ai-panel" data-testid="p2-ai-panel" aria-label="AI 解签">
            <div class="p2-ai-scroll" :class="{ 'is-open': p4ExplainVisible }" data-testid="p2-ai-scroll">
              <button
                class="p2-scroll-head"
                data-testid="ask-xiaopu"
                type="button"
                :aria-expanded="p4ExplainVisible ? 'true' : 'false'"
                @click="openP2Explain"
              >
                <img
                  :src="p4ImageAsset('text_ai_result_scroll_header_double_tassel.png')"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span class="sr-only">AI 解签，轻触启签</span>
              </button>

              <div class="p2-scroll-body">
                <div v-if="p4ExplainVisible && p4Status === 'loading'" class="p2-ai-loading" role="status">
                  <div class="p4-loading-mark" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <strong class="p4-loading-title">AI 解签中</strong>
                  <ol class="p4-thinking-list" aria-label="AI 解签生成进度">
                    <li v-for="line in p4VisibleThinkingLines" :key="line" class="p4-thinking-line">
                      <span class="p4-thinking-dot" aria-hidden="true"></span>
                      <span class="p4-thinking-text">{{ line }}</span>
                    </li>
                  </ol>
                </div>

                <div v-else-if="p4ExplainVisible && p4Status === 'error'" class="p2-ai-error" role="alert">
                  <strong>解签结果加载失败，请稍后再试</strong>
                  <button type="button" @click="retryP4Detail">重新加载</button>
                </div>

                <div v-else-if="p4ExplainVisible" class="p2-ai-result" data-testid="p2-ai-result">
                  <p v-for="line in p4Detail.explainLines" :key="line">{{ line }}</p>
                </div>
              </div>
            </div>
          </section>
        </article>

        <button
          v-if="shouldShowP4ClaimButton"
          class="p2-claim-button"
          data-testid="p2-claim-benefit"
          type="button"
          :disabled="p2BenefitButtonDisabled"
          @click="openP2Benefit"
        >
          <img
            :src="p4ImageAsset('text_claim_exclusive_reward_sign.png')"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span class="sr-only">{{ p4ClaimButtonText }}</span>
        </button>

        <button
          class="p2-poster-button"
          :class="{ 'is-explain-open': p4ExplainVisible }"
          data-testid="share-poster"
          type="button"
          @click="openResultSharePoster"
        >
          分享得好礼
        </button>

        <p v-if="p4ClaimTipText" class="p4-claim-tip" role="status">{{ p4ClaimTipText }}</p>

      </template>
    </section>

    <div v-if="p2Panel" class="modal-mask" role="presentation">
      <section
        v-if="p2Panel === 'poster'"
        class="p2-poster-dialog"
        data-testid="p2-poster-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="p2-poster-title"
      >
        <h2 id="p2-poster-title" class="sr-only">分享得好礼</h2>
        <button
          class="p2-poster-dismiss"
          data-testid="close-p2-panel"
          type="button"
          aria-label="关闭"
          @click="closeP2Panel"
        >
          <span class="sr-only">关闭</span>
        </button>
        <article v-if="!p2PosterPreviewSrc" class="p2-poster-card" data-testid="p2-poster-card">
          <img
            class="activity-share-poster-image"
            data-testid="p2-share-activity-poster"
            :src="activitySharePosterSrc"
            alt="高考抽签专属福利活动页"
            loading="lazy"
            decoding="async"
          />
          <span class="activity-share-poster-qrcode">
            <img
              v-if="activityPosterQrcodeSrc"
              data-testid="p2-poster-qrcode"
              :src="activityPosterQrcodeSrc"
              alt="活动二维码"
              :data-share-url="sharePosterUrl"
              loading="lazy"
              decoding="async"
              @error="handleActivityPosterQrcodeError"
            />
            <span v-else>二维码暂未配置</span>
          </span>
        </article>
        <img
          v-else
          class="p2-poster-generated-preview"
          data-testid="p2-poster-generated-preview"
          :src="p2PosterPreviewSrc"
          alt="生成的分享图片"
          loading="lazy"
          decoding="async"
        />
        <p class="p2-poster-save-message" data-testid="p2-poster-longpress-tip" role="status">
          {{ POSTER_LONGPRESS_TIP }}
        </p>
      </section>

      <section v-else class="share-dialog p2-dialog" role="dialog" aria-modal="true" aria-labelledby="p2-panel-title">
        <h2 id="p2-panel-title">{{ p2PanelTitle }}</h2>
        <p>{{ p2PanelText }}</p>
        <div class="dialog-actions">
          <button data-testid="close-p2-panel" type="button" @click="closeP2Panel">知道了</button>
        </div>
      </section>
    </div>
  </main>

  <main v-else-if="currentPage === 'p6'" class="p6-page" aria-label="P6 我的奖励页">
    <section class="p6-stage" :style="p6StageStyle">
      <h1 class="sr-only">{{ p6Center.page_title }}</h1>

      <button class="p6-back-button" data-testid="p6-back" type="button" aria-label="返回" @click="goP6Back">
        <span class="sr-only">返回</span>
      </button>

      <button
        class="p6-rule-button"
        data-testid="p6-rules"
        type="button"
        aria-label="活动规则"
        @click="openP6Rules"
      >
        <img :src="p6ImageAsset('btn_activity_rules.png')" alt="" loading="lazy" decoding="async" />
        <span class="sr-only">{{ p6Center.rules_action.button_text }}</span>
      </button>

      <div v-if="p6Status === 'loading'" class="p6-state" role="status">
        <strong>奖励加载中</strong>
        <p>正在同步你的考运进度和奖励。</p>
      </div>

      <div v-else-if="p6Status === 'error'" class="p6-state" role="alert">
        <strong>我的奖励加载失败，请稍后再试</strong>
        <button type="button" @click="retryP6Center">重新加载</button>
      </div>

      <template v-else>
        <section class="p6-progress-summary" aria-label="我的考运进度">
          <h2 class="sr-only">我的考运进度</h2>
          <p class="p6-share-label">已分享</p>
          <p class="p6-share-count" aria-live="polite">
            <strong>{{ p6ShareCount }}</strong>
            <span class="p6-share-target">/{{ p6ShareTarget }}</span>
            <span class="p6-share-unit">人</span>
          </p>
          <p class="p6-progress-desc">{{ p6Progress.progress_desc }}</p>

          <ol class="p6-day-list" aria-label="点亮进度">
            <li
              v-for="item in p6ProgressDays"
              :key="item.day"
              class="p6-day-node"
              :class="{ 'is-complete': item.complete }"
              :aria-label="`第${item.day}天${item.complete ? '已点亮' : '未点亮'}`"
            >
              <span class="p6-day-number">{{ item.day }}</span>
              <small>第{{ item.day }}天</small>
            </li>
          </ol>
        </section>

        <section class="p6-reward-grid" :class="p6RewardGridClass" aria-label="我的奖励">
          <h2 class="sr-only">我的奖励</h2>
          <article
            v-for="reward in p6RewardCards"
            :key="reward.reward_id"
            class="p6-reward-card"
            :class="{ 'is-gift': isP6GiftReward(reward) }"
            data-testid="p6-reward-card"
          >
            <img
              v-if="resolveP6RewardImage(reward)"
              class="p6-reward-image"
              :src="resolveP6RewardImage(reward)"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <div v-else class="p6-gift-visual" aria-hidden="true">
              <strong>985+</strong>
              <span>和牛礼盒</span>
            </div>

            <span class="sr-only">{{ reward.title }} {{ reward.unit_text }} {{ reward.desc }}</span>

            <button
              class="p6-reward-action"
              :class="{
                'is-muted': isP6GiftReward(reward) && reward.status === 'not_qualified',
                'is-pending': isP6RewardPending(reward),
              }"
              :data-testid="getP6RewardActionTestId(reward)"
              type="button"
              :disabled="isP6RewardDisabled(reward) || p6ActionStatus === 'redirecting'"
              @click="useP6Reward(reward)"
            >
              {{ getP6RewardButtonText(reward) }}
            </button>
          </article>
        </section>

        <section v-if="p6Product" class="p6-product-card" aria-label="精选好物推荐">
          <h2 class="sr-only">精选好物推荐</h2>
          <img
            class="p6-product-image"
            :src="p6ProductImageSrc"
            alt=""
            loading="lazy"
            decoding="async"
            @error="handleP6ProductImageError"
          />
          <div class="p6-product-copy">
            <h3 class="sr-only">{{ p6Product.title }}</h3>
            <p>{{ p6Product.subtitle }}</p>
            <button
              class="p6-product-action"
              data-testid="p6-product-action"
              type="button"
              :disabled="p6ActionStatus === 'redirecting'"
              @click="openP6Product"
            >
              <img :src="p6ImageAsset('btn_go_see.png')" alt="" loading="lazy" decoding="async" />
              <span class="sr-only">{{ p6Product.button_text }}</span>
            </button>
          </div>
        </section>

        <p v-if="p6ActionMessage" class="p6-action-tip" role="status">{{ p6ActionMessage }}</p>

        <button
          class="p6-draw-again"
          data-testid="p6-draw-again"
          type="button"
          :disabled="p6ActionStatus === 'redirecting'"
          @click="drawAgainFromP6"
        >
          <img :src="p6ImageAsset('btn_draw_again.png')" alt="" loading="lazy" decoding="async" />
          <span class="sr-only">{{ p6DrawAgainButtonText }}</span>
        </button>
      </template>
    </section>
  </main>

  <main v-else-if="currentPage === 'p8'" class="p8-page" aria-label="P8 大奖资格确认页">
    <section class="p8-stage" :style="p8StageStyle">
      <button class="p8-back-button" data-testid="p8-back" type="button" aria-label="返回" @click="goP8Back">
        <span class="sr-only">返回</span>
      </button>

      <header class="p8-hero-copy" aria-label="大奖资格标题">
        <h1>
          <span v-for="line in p8HeroLines" :key="line">{{ line }}</span>
        </h1>
        <p>{{ p8Prize.hero.subtitle }}</p>
      </header>

      <section class="p8-qualification-copy" aria-label="大奖资格信息">
        <h2>{{ p8Qualification.qualify_desc }}</h2>
        <p>{{ p8Qualification.prize_title }}</p>
        <ul>
          <li v-for="benefit in p8Prize.benefits" :key="benefit.id">
            {{ benefit.title }} {{ benefit.desc }}
          </li>
        </ul>
      </section>

      <section class="p8-status-copy" :class="{ 'is-winner': isP8Winner }" aria-label="开奖状态">
        <dl class="p8-status-list">
          <div class="p8-status-row">
            <dt class="sr-only">当前状态:</dt>
            <dd class="p8-status-value">{{ p8LotteryStatus.status_text }}</dd>
          </div>
          <div class="p8-status-row">
            <dt class="sr-only">开奖时间:</dt>
            <dd class="p8-draw-time">{{ p8LotteryStatus.draw_time_desc }}</dd>
          </div>
          <div v-if="p8LotteryNoText" class="p8-status-row">
            <dt class="sr-only">你的抽奖编号:</dt>
            <dd class="p8-status-lottery-no">{{ p8LotteryNoText }}</dd>
          </div>
        </dl>
        <p class="p8-status-notice">{{ p8LotteryStatus.notice }}</p>
        <img
          v-if="p8PublicityResultSrc"
          class="p8-publicity-result"
          data-testid="p8-publicity-result"
          :src="p8PublicityResultSrc"
          :alt="p8PublicityResultAlt"
          loading="lazy"
          decoding="async"
        />
        <strong class="p8-publicity-title">{{ isP8Drawn ? p8PublicityResultAlt : p8LotteryStatus.publicity_title }}</strong>
        <p v-if="!isP8Drawn" class="p8-publicity-desc">{{ p8LotteryStatus.publicity_desc }}</p>
      </section>

      <section class="p8-wechat-copy" aria-label="企微二维码">
        <h2>{{ p8WechatGroup.title }}</h2>
        <ul>
          <li v-for="benefit in p8WechatGroup.benefits" :key="benefit">{{ benefit }}</li>
        </ul>
      </section>

      <div class="p8-qrcode-frame" data-testid="p8-qrcode" @click="trackP8QrcodeClick">
        <img
          v-if="p8QrcodeSrc"
          :src="p8QrcodeSrc"
          alt="企微二维码"
          loading="lazy"
          decoding="async"
          @error="handleP8QrcodeError"
        />
        <span v-else>企微二维码暂未配置</span>
      </div>

      <section v-if="!p8Qualification.qualified" class="p8-not-qualified" data-testid="p8-not-qualified" role="alert">
        <strong>大奖资格暂未解锁</strong>
        <p>{{ p8Qualification.qualify_desc }}</p>
        <button type="button" @click="goP8Back">返回我的奖励</button>
      </section>
    </section>
  </main>

  <main v-else-if="currentPage === 'rules'" class="p7-page" aria-label="P7 活动规则页" @scroll.passive="trackP7ScrollToBottom">
    <section class="p7-stage" :style="p7StageStyle">
      <button class="p7-back-button" data-testid="p7-back" type="button" aria-label="返回" @click="goP7Back">
        <span class="sr-only">返回</span>
      </button>

      <header class="p7-heading">
        <h1>{{ p7Rules.page_title }}</h1>
        <p>{{ p7Rules.subtitle }}</p>
      </header>

      <section class="p7-rules-card" aria-label="活动规则说明">
        <h2 class="sr-only">活动规则说明</h2>
        <ol class="p7-rule-list">
          <li
            v-for="rule in p7Rules.rules"
            :key="rule.rule_no"
            class="p7-rule-item"
            data-testid="p7-rule-item"
          >
            <span class="p7-rule-number">{{ rule.rule_no }}</span>
            <p>{{ rule.content }}</p>
          </li>
        </ol>
      </section>

      <section class="p7-wechat-card" aria-label="扫码添加企微">
        <div class="p7-qrcode-frame" data-testid="p7-inline-qrcode" @click="trackP7QrcodeClick">
          <img
            v-if="p7QrcodeSrc"
            :src="p7QrcodeSrc"
            alt="企微二维码"
            loading="lazy"
            decoding="async"
            @error="handleP7QrcodeError"
          />
          <span v-else>二维码暂未配置</span>
        </div>
        <div class="p7-wechat-copy">
          <strong>{{ p7Rules.wechat_group.title }}</strong>
          <p>{{ p7Rules.wechat_group.desc }}</p>
        </div>
      </section>

      <button
        v-if="p7QrcodeSrc"
        class="p7-qrcode-hotspot"
        data-testid="p7-qrcode-hotspot"
        type="button"
        aria-label="Open QR code preview"
        @click="openP7QrcodePreview"
      >
        <span class="sr-only">Open QR code preview</span>
      </button>
    </section>
  </main>

  <section v-else class="placeholder-page">
    <h1>页面暂未开放</h1>
    <p>请返回首页重新进入活动。</p>
    <button type="button" @click="goHome">返回首页</button>
  </section>

  <div v-if="showP5ClaimSuccess" class="p5-popup-mask" role="presentation">
    <section
      class="p5-popup-panel"
      data-testid="p5-mobile-claim-popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="p5-popup-title"
    >
      <h2 id="p5-popup-title" class="p5-popup-title">
        {{ isP5Claimed ? p5Result.pageTitle : '领取优惠券' }}
      </h2>

      <button
        class="p5-close-button"
        data-testid="p5-close"
        type="button"
        aria-label="关闭"
        @click="closeP5ClaimSuccess"
      >
        <span class="sr-only">关闭</span>
      </button>

      <section class="p5-coupon-card" :aria-label="p5Result.reward.couponName">
        <img :key="p5CouponImageSrc" :src="p5CouponImageSrc" alt="" loading="lazy" decoding="async" />
        <span class="sr-only">
          {{ p5Result.reward.couponLabel }} {{ p5Result.reward.thresholdText }}
          {{ p5Result.reward.amountText }}{{ p5Result.reward.unitText }}
        </span>
      </section>

      <form class="p5-mobile-form" @submit.prevent="handleP5PrimaryAction">
        <span class="p5-mobile-placeholder-cover" aria-hidden="true"></span>
        <label class="p5-mobile-label" for="p5-mobile-input">手机号</label>
        <input
          id="p5-mobile-input"
          v-model.trim="p5Mobile"
          class="p5-mobile-input"
          data-testid="p5-mobile-input"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          maxlength="11"
          placeholder="请输入手机号"
          :disabled="p5ClaimStatus === 'submitting' || isP5Claimed"
          @focus="focusP5MobileInput"
        />
        <p v-if="p5MobileError" class="p5-mobile-error" data-testid="p5-mobile-error" role="alert">
          {{ p5MobileError }}
        </p>

        <button
          class="p5-use-button p5-primary-button"
          data-testid="p5-submit-claim"
          type="submit"
          :disabled="p5PrimaryButtonDisabled"
        >
          <span>{{ p5PrimaryButtonText }}</span>
        </button>

        <p v-if="p5UseMessage" class="p5-use-tip" role="status">{{ p5UseMessage }}</p>
      </form>
    </section>
  </div>

  <div
    v-if="showMiniProgramFallback"
    class="modal-mask mini-program-fallback-mask"
    role="presentation"
    @click.self="closeMiniProgramFallback"
  >
    <section
      class="mini-program-fallback-dialog"
      data-testid="mini-program-fallback-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mini-program-fallback-title"
    >
      <button
        class="p2-poster-dismiss mini-program-fallback-close"
        data-testid="mini-program-fallback-close"
        type="button"
        aria-label="关闭"
        @click="closeMiniProgramFallback"
      >
        <span class="sr-only">关闭</span>
      </button>
      <h2 id="mini-program-fallback-title" data-testid="mini-program-fallback-tip">
        {{ miniProgramFallbackMessage }}
      </h2>
      <img
        class="mini-program-fallback-qrcode"
        data-testid="mini-program-fallback-qrcode"
        :src="miniProgramFallbackQrcodeSrc"
        alt="小程序二维码"
        loading="lazy"
        decoding="async"
      />
      <p>使用微信扫码后进入小程序查看优惠券</p>
      <span v-if="miniProgramFallbackTarget" class="sr-only">{{ miniProgramFallbackTarget }}</span>
    </section>
  </div>

  <div
    v-if="showP7QrcodePreview"
    class="p7-qrcode-preview-mask"
    data-testid="p7-qrcode-preview"
    role="presentation"
    @click.self="closeP7QrcodePreview"
  >
    <section class="p7-qrcode-preview-panel" role="dialog" aria-modal="true" aria-label="QR code preview">
      <button
        class="p7-qrcode-preview-close"
        data-testid="p7-qrcode-preview-close"
        type="button"
        aria-label="Close QR code preview"
        @click="closeP7QrcodePreview"
      >
        <span class="sr-only">Close QR code preview</span>
      </button>
      <img
        class="p7-qrcode-preview-image"
        :src="p7QrcodeSrc"
        alt="QR code preview"
        loading="lazy"
        decoding="async"
        @error="handleP7QrcodeError"
      />
    </section>
  </div>

  <div
    v-if="showDrawAnimation"
    class="draw-animation-overlay"
    data-testid="draw-animation-overlay"
    aria-label="抽签动画"
  >
    <section class="draw-animation-shell" role="status" aria-live="polite">
      <video
        v-if="canUseTransparentDrawVideo"
        class="draw-animation-video"
        data-testid="draw-animation-video"
        autoplay
        muted
        playsinline
        webkit-playsinline
        preload="metadata"
        @canplay="playDrawAnimation"
        @ended="completeDrawAnimation"
        @error="failDrawAnimation"
      >
        <source
          v-if="drawAnimationVideoSrc"
          data-testid="draw-animation-webm-source"
          :src="drawAnimationVideoSrc"
          type="video/webm"
        >
      </video>
      <img
        v-else
        class="draw-animation-video draw-animation-fallback"
        data-testid="draw-animation-fallback"
        :src="homeImageAsset('element_lottery_box.png')"
        alt=""
        loading="lazy"
        decoding="async"
        @animationend="completeDrawAnimation"
        @error="failDrawAnimation"
      >
      <p v-if="drawAnimationStatus === 'waiting'" class="draw-animation-status">抽签结果生成中</p>
    </section>
  </div>

</template>

