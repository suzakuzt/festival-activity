import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import App from './App.vue'
import { activityApi } from './api/activityApi'
import { useP1Activity } from './composables/useP1Activity'
import {
  MINI_PROGRAM_COUPON_PAGE,
  MINI_PROGRAM_POSTER_SAVE_PAGE,
  goMiniProgramCouponPage,
  goMiniProgramPosterSavePage,
} from './utils/miniProgramBridge'
import { installRuntimeMonitor } from './utils/runtimeMonitor'

vi.mock('./components/HelloWorld.vue', () => ({
  default: {
    template: '<div data-testid="vite-starter" />',
  },
}))

vi.mock('qrcode', () => ({
  default: {
    toString: vi.fn(async (value) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${value}</text></svg>`),
  },
}))

const mountHome = (props = {}) => {
  window.history.replaceState({}, '', '/activity/home')

  return mount(App, { props })
}
const mountRules = (props = {}) => {
  window.history.replaceState({}, '', '/activity/rules')

  return mount(App, { props: { initialPage: 'rules', ...props } })
}
const mountResult = (props = {}) => {
  window.history.replaceState({}, '', '/activity/result')

  return mount(App, { props: { initialPage: 'p2', ...props } })
}
const mountActivityState = (options = {}) => {
  let activity
  const Harness = defineComponent({
    setup() {
      activity = useP1Activity(options)
      return () => null
    },
  })

  mount(Harness)
  return activity
}
const readSource = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')
const readBinary = (relativePath) => readFileSync(resolve(process.cwd(), relativePath))
const sha256File = (relativePath) => createHash('sha256').update(readBinary(relativePath)).digest('hex').toUpperCase()
const fileSizeKb = (relativePath) => Math.round((readBinary(relativePath).length / 1024) * 10) / 10

const readPngSize = (relativePath) => {
  const buffer = readBinary(relativePath)

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

const flushPromises = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('P1 activity home', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    delete window.wx
    delete window.__wxjs_environment
  })

  it('loads the WeChat JS-SDK for mini-program web-view navigation', () => {
    const html = readSource('index.html')

    expect(html).toContain('https://res.wx.qq.com/open/js/jweixin-1.6.0.js')
  })

  it('keeps the activity share poster out of the initial home DOM and uses the optimized WebP asset', async () => {
    const wrapper = mountHome()

    expect(wrapper.find('.activity-share-poster-image').exists()).toBe(false)
    await wrapper.get('[data-testid="share-entry"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="home-share-activity-poster"]').find('.activity-share-poster-image').attributes('src')).toContain(
      'share_activity_poster.webp',
    )
  })

  it('uses metadata preload for the draw animation video instead of downloading the full animation eagerly', () => {
    const source = readSource('src/App.vue')

    expect(source).not.toContain('preload="auto"')
    expect(source).toContain('preload="metadata"')
    expect(source).toContain('drawAnimationVideoSrc')
  })

  it('shows the home page only after first-screen core image preloading is released', () => {
    const source = readSource('src/App.vue')

    expect(source).toContain('firstScreenImages')
    expect(source).toContain('pageReady')
    expect(source).toContain('first-screen-loading')
    expect(source).not.toContain('share_activity_poster.png')
  })

  it('provides a sharp-based asset compression script for oversized public images', () => {
    const script = readSource('scripts/compress-assets.mjs')

    expect(script).toContain("from 'sharp'")
    expect(script).toContain('public/assets')
    expect(script).toContain('500')
    expect(script).toContain('webp')
  })

  it('navigates to the mini-program coupon page only when the web-view bridge exists', async () => {
    const navigateTo = vi.fn()
    const fail = vi.fn()
    window.wx = {
      miniProgram: {
        getEnv: (callback) => callback({ miniprogram: true }),
        navigateTo,
      },
    }

    await expect(goMiniProgramCouponPage()).resolves.toBe(true)
    expect(navigateTo).toHaveBeenCalledWith({ url: MINI_PROGRAM_COUPON_PAGE })
    await expect(goMiniProgramCouponPage(`${MINI_PROGRAM_COUPON_PAGE}?claim_token=ct_test`, { fail })).resolves.toBe(true)
    expect(navigateTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: `${MINI_PROGRAM_COUPON_PAGE}?claim_token=ct_test`, fail }),
    )

    window.wx = {
      miniProgram: {
        navigateTo,
      },
    }
    await expect(goMiniProgramCouponPage()).resolves.toBe(false)

    delete window.wx
    await expect(goMiniProgramCouponPage()).resolves.toBe(false)
  })

  it('falls back instead of waiting forever when the mini-program environment callback never returns', async () => {
    vi.useFakeTimers()
    try {
      const navigateTo = vi.fn()
      const resolved = vi.fn()
      window.wx = {
        miniProgram: {
          getEnv: vi.fn(),
          navigateTo,
        },
      }

      goMiniProgramCouponPage().then(resolved)
      await vi.advanceTimersByTimeAsync(350)

      expect(resolved).toHaveBeenCalledWith(false)
      expect(navigateTo).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('navigates to the mini-program poster-save page with an encoded poster image url', async () => {
    const navigateTo = vi.fn()
    window.wx = {
      miniProgram: {
        getEnv: (callback) => callback({ miniprogram: true }),
        navigateTo,
      },
    }
    const posterUrl = 'https://gkcq2026.nat100.top/api/poster/image/home_poster_test'

    expect(await goMiniProgramPosterSavePage(posterUrl)).toBe(true)
    expect(navigateTo).toHaveBeenCalledWith({
      url: `${MINI_PROGRAM_POSTER_SAVE_PAGE}?posterUrl=${encodeURIComponent(posterUrl)}`,
    })

    delete window.wx
    expect(await goMiniProgramPosterSavePage(posterUrl)).toBe(false)
    expect(await goMiniProgramPosterSavePage('')).toBe(false)
  })

  it('does not open the poster-save page from a normal WeChat browser', async () => {
    const navigateTo = vi.fn()
    window.wx = {
      miniProgram: {
        getEnv: (callback) => callback({ miniprogram: false }),
        navigateTo,
      },
    }

    expect(await goMiniProgramPosterSavePage('https://gkcq2026.nat100.top/api/poster/image/home_poster_test')).toBe(
      false,
    )
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('uses the real mini-program my-coupon page path for coupon targets', () => {
    const files = [
      'src/composables/useP1Activity.js',
      'database/sqlite/002_seed_basic_mock_config.sql',
      'database/mysql/002_seed_basic_mock_config.sql',
    ]
    const contents = files.map(readSource).join('\n')
    const legacyCouponPage = ['/pages', `coupon${String.fromCharCode(45)}package`, 'index'].join('/')

    expect(contents).toContain('/pages/my-coupon/index')
    expect(contents).not.toContain(legacyCouponPage)
  })

  it('renders the confirmed P1 home copy with 1 default draw chance', () => {
    const wrapper = mountHome()

    expect(wrapper.text()).toContain('立即摇签')
    expect(wrapper.text()).toContain('我的摇签机会 1次')
    expect(wrapper.text()).toContain('活动规则')
    expect(wrapper.get('[data-testid="home-rewards-entry"]').text()).toBe('每日打卡')
    expect(wrapper.text()).toContain('分享获取次数')
    expect(wrapper.text()).not.toContain('今日已摇签')
  })

  it('renders a continuous golden reward barrage with every coupon tier on home', () => {
    const wrapper = mountHome()
    const items = wrapper.findAll('[data-testid="home-barrage-item"]')
    const rewardPattern = /^\d{3}\*{5}\d{3}\u62bd\u4e2d\d+(?:\.\d+)?(?:\u5143|\u6298)\u4f18\u60e0\u5238$/
    const realCarrierPrefixes = new Set(['130', '138', '156', '177', '189'])
    const itemTexts = items.map((item) => item.text())
    const uniqueTexts = [...new Set(itemTexts)]
    const prefixes = items.map((item) => item.text().slice(0, 3))
    const rewardTypes = items.map((item) =>
      item.text().replace(/^\d{3}\*{5}\d{3}\u62bd\u4e2d/, '').replace(/\u4f18\u60e0\u5238$/, ''),
    )

    expect(wrapper.get('[data-testid="home-barrage"]').attributes('aria-hidden')).toBe('true')
    expect(items).toHaveLength(10)
    expect(uniqueTexts).toHaveLength(5)
    expect(items[0].text()).toBe('138*****438\u62bd\u4e2d10\u5143\u4f18\u60e0\u5238')
    expect(itemTexts).toContain('177*****219\u62bd\u4e2d9\u6298\u4f18\u60e0\u5238')
    expect(itemTexts).toContain('156*****706\u62bd\u4e2d7.5\u6298\u4f18\u60e0\u5238')
    expect(wrapper.get('[data-testid="home-barrage-track"]').attributes('style')).toBe(
      '--barrage-track-height: 333.33333333333337%; --barrage-item-height: 10%; --barrage-duration: 12s;',
    )
    expect(items.map((item) => item.attributes('style'))).toEqual(new Array(10).fill(undefined))
    expect(wrapper.get('[data-testid="home-barrage-track"]').text()).toMatch(
      /^138\*{5}438.*130\*{5}721.*189\*{5}906.*177\*{5}219.*156\*{5}706.*138\*{5}438/s,
    )
    expect(wrapper.findAll('.home-barrage-text')).toHaveLength(10)
    expect(prefixes.every((prefix) => realCarrierPrefixes.has(prefix))).toBe(true)
    expect([...new Set(rewardTypes)]).toEqual(['10\u5143', '20\u5143', '30\u5143', '9\u6298', '7.5\u6298'])
    expect(items.every((item) => rewardPattern.test(item.text()))).toBe(true)
  })

  it('uses rebuilt P1 design assets instead of legacy sliced filenames', () => {
    const wrapper = mountHome()
    const html = wrapper.html()

    expect(html).toContain('bg_rank_success.webp')
    expect(html).toContain('element_lottery_box.webp')
    expect(html).toContain('btn_draw_now.webp')
    expect(html).toContain('btn_activity_rules.webp')
    expect(html).toContain('lottery-shadow')
    expect(html).not.toContain('element_lottery_shadow.png')
    expect(html).not.toContain('home-bg-p1.png')
    expect(html).not.toContain('home-tube-p1.png')
    expect(html).not.toContain('home-button-p1.png')
    expect(html).not.toContain('home-rule-p1.png')
    expect(html).not.toContain('home-title-p1.png')
    expect(html).not.toContain('text_title_prize.png')
    expect(html).not.toContain('button.png')
    expect(html).not.toContain('title.png')
  })

  it('uses the latest button and lottery-box image assets', () => {
    expect(readPngSize('public/assets/home/btn_draw_now.png')).toEqual({
      width: 1450,
      height: 386,
    })
    expect(readPngSize('public/assets/home/element_lottery_box.png')).toEqual({
      width: 1254,
      height: 1254,
    })
  })

  it('shows the provided image logo on home and removes Prime Cuts stamp images from other pages', () => {
    const home = mountHome()
    const result = mountResult()
    const rewards = mount(App, { props: { initialPage: 'p6' } })

    const logo = home.get('[data-testid="brand-logo-home"]')
    expect(logo.attributes('src')).toContain('logo_prime_cuts_home.webp')
    expect(logo.attributes('alt')).toBe('Prime Cuts 璞莱牧')
    expect(home.find('[data-testid="brand-wordmark-home"]').exists()).toBe(false)
    expect(readPngSize('public/assets/home/logo_prime_cuts_home.png')).toEqual({
      width: 305,
      height: 98,
    })
    expect(result.find('[data-testid="brand-logo-result"]').exists()).toBe(false)
    expect(rewards.find('[data-testid="brand-logo-rewards"]').exists()).toBe(false)
  })

  it('imports the P4-1 unified result design assets', () => {
    expect(readPngSize('public/assets/p4/bg_ai_result_page.png')).toEqual({
      width: 941,
      height: 1672,
    })
    expect(readPngSize('public/assets/p4/text_beef_super_luck_sign.png')).toEqual({
      width: 1881,
      height: 461,
    })
    expect(readPngSize('public/assets/p4/element_luck_tag_vertical_full.png')).toEqual({
      width: 319,
      height: 2106,
    })
    expect(readPngSize('public/assets/p4/product_flat_iron_steak.png')).toEqual({
      width: 1105,
      height: 657,
    })
    expect(fileSizeKb('public/assets/p4/product_ribeye_steak.webp')).toBeLessThan(500)
    expect(readPngSize('public/assets/p4/product_sirloin_steak.png')).toEqual({
      width: 1206,
      height: 699,
    })
    expect(readPngSize('public/assets/p4/product_tenderloin_steak.png')).toEqual({
      width: 1226,
      height: 739,
    })
    expect(readPngSize('public/assets/p4/text_ai_result_scroll_header_double_tassel.png')).toEqual({
      width: 2236,
      height: 590,
    })
    expect(readPngSize('public/assets/p4/element_ai_result_blank_scroll_panel.png')).toEqual({
      width: 1121,
      height: 845,
    })
    expect(readPngSize('public/assets/p4/text_claim_exclusive_reward_sign.png')).toEqual({
      width: 1854,
      height: 487,
    })
  })

  it('keeps the P1 home layout relaxed around the lottery area', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.rule-entry\s*{[^}]*top:\s*1\.9%;/s)
    expect(css).toMatch(/\.lottery-shadow\s*{[^}]*top:\s*66\.6%;[^}]*left:\s*53%;[^}]*width:\s*50%;[^}]*radial-gradient\(ellipse at 70% 58%/s)
    expect(css).toMatch(/\.lottery-tube\s*{[^}]*top:\s*39\.5%;[^}]*width:\s*68%;/s)
    expect(css).toMatch(/\.lottery-tube img\s*{[^}]*filter:\s*none;/s)
    expect(css).toMatch(/\.draw-button\s*{[^}]*top:\s*81\.4%;[^}]*width:\s*70%;/s)
    expect(css).toMatch(/\.bottom-nav\s*{[^}]*bottom:\s*2\.4%;/s)
    expect(css).not.toContain('.brand-logo')
    expect(css).toMatch(/\.home-brand-logo\s*{[^}]*top:\s*3\.4%;[^}]*left:\s*5\.1%;[^}]*width:\s*23%;/s)
    expect(css).toMatch(/\.home-brand-logo\s*{[^}]*object-fit:\s*contain;/s)
    expect(css).toMatch(/\.home-barrage\s*{[^}]*top:\s*32\.2%;[^}]*left:\s*50%;[^}]*width:\s*80%;[^}]*height:\s*9\.6%;[^}]*transform:\s*translateX\(-50%\);/s)
    expect(css).toMatch(/\.home-barrage-item\s*{[^}]*font-size:\s*clamp\(9\.5px,\s*2\.2vw,\s*11px\);/s)
    expect(css).toMatch(/\.home-barrage-track\s*{[^}]*height:\s*var\(--barrage-track-height\);[^}]*animation:\s*home-barrage-scroll/s)
    expect(css).toMatch(/\.home-barrage-item\s*{[^}]*position:\s*static;[^}]*flex:\s*0\s+0\s+var\(--barrage-item-height\);/s)
    expect(css).toMatch(/\.home-barrage-item\s*{[^}]*width:\s*100%;/s)
    expect(css).toMatch(/\.home-barrage-text\s*{[^}]*width:\s*100%;[^}]*text-align:\s*center;/s)
    expect(css).toMatch(/\.home-barrage-item\s*{[^}]*color:\s*#f8d982;/s)
    expect(css).toMatch(/@keyframes home-barrage-scroll[\s\S]*transform:\s*translateY\(0\)[\s\S]*transform:\s*translateY\(-50%\)/)
    expect(css).not.toContain('home-barrage-rise')
    expect(css).not.toContain('.home-brand-wordmark-main')
    expect(css).not.toContain('.home-brand-wordmark-sub')
    expect(css).not.toContain('.p2-brand-logo')
    expect(css).not.toContain('.p6-brand-logo')
  })

  it('keeps the current home palette and avoids decorative stage overlays', () => {
    const css = readSource('src/style.css')

    expect(css).toContain('--theme-primary: #b80606;')
    expect(css).toContain('--gold-deep: #c99b4d;')
    expect(css).toMatch(/html,\s*body\s*{[^}]*background:\s*#230201;/s)
    expect(css).toMatch(/#app\s*{[^}]*background:\s*#230201;/s)
    expect(css).not.toContain('background: #8c0300;')
    expect(css).not.toContain('.home-stage::before')
    expect(css).toMatch(/\.home-stage\s*{[^}]*background-size:\s*100% 100%;/s)
    expect(css).toMatch(/\.lottery-shadow\s*{[^}]*mix-blend-mode:\s*multiply;/s)
  })

  it('routes to the P2 placeholder when the primary draw button has chance', async () => {
    const wrapper = mountHome()

    await wrapper.get('[data-testid="draw-button"]').trigger('click')
    await wrapper.get('[data-testid="draw-animation-fallback"]').trigger('animationend')

    expect(wrapper.text()).toContain('六月考运签')
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').exists()).toBe(true)
  })

  it('uses the same draw entrance when clicking the lottery tube', async () => {
    const wrapper = mountHome()

    await wrapper.get('[data-testid="lottery-tube"]').trigger('click')
    await wrapper.get('[data-testid="draw-animation-fallback"]').trigger('animationend')

    expect(wrapper.text()).toContain('六月考运签')
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').exists()).toBe(true)
  })

  it('shows the no-chance tip instead of routing when draw chance is zero', async () => {
    const wrapper = mountHome({ initialChance: 0 })

    await wrapper.get('[data-testid="draw-button"]').trigger('click')

    expect(wrapper.text()).toContain('今日机会已用完，分享可再得机会')
    expect(wrapper.text()).not.toContain('六月考运签')
  })

  it('renders P2/P4 as one asset-based result page with a collapsed AI scroll', () => {
    const wrapper = mountResult({
      initialP2Result: {
        signType: '过儿签',
        signLevel: 'TOP_SIGN',
        fortuneHint: '考试期间，不要叫我真名，叫我过儿。',
        mainTextColumns: ['考试期间，不要叫我真名，叫我过儿。'],
        goodFor: 'LEFT_COPY',
        avoid: 'RIGHT_COPY',
      },
      initialP4Detail: {
        explainLines: ['INLINE_AI_COPY'],
        product: {
          productName: 'PRODUCT_NAME',
          productImage: 'product_flat_iron_steak.png',
        },
        benefit: {
          claimButtonText: 'CLAIM_NOW',
        },
      },
    })
    const html = wrapper.html()

    expect(wrapper.get('[data-testid="p2-combined-card"]').exists()).toBe(true)
    expect(html).toContain('bg_ai_result_page.webp')
    expect(html).not.toContain('text_beef_super_luck_sign.png')
    expect(html).not.toContain('element_luck_tag_vertical_full.png')
    expect(html).toContain('text_ai_result_scroll_header_double_tassel.webp')
    expect(html).toContain('text_claim_exclusive_reward_sign.webp')
    expect(wrapper.text()).toContain('过儿签')
    expect(wrapper.text()).toContain('考试期间，不要叫我真名，叫我过儿。')
    expect(wrapper.findAll('[data-testid="p2-fortune-line"]').map((line) => line.text())).toEqual([
      '考试期间，',
      '不要叫我真名，',
      '叫我过儿。',
    ])
    expect(wrapper.get('.p2-fortune-emphasis').text()).toBe('过儿')
    expect(wrapper.text()).not.toContain('拨云见吉')
    expect(wrapper.find('[data-testid="p2-left-luck"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="p2-right-luck"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('LEFT_COPY')
    expect(wrapper.text()).not.toContain('RIGHT_COPY')
    expect(wrapper.get('[data-testid="p2-product-image"]').attributes('src')).toContain('product_flat_iron_steak.webp')
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').classes()).not.toContain('is-open')
    expect(wrapper.get('[data-testid="p2-ai-panel"]').text()).not.toContain('INLINE_AI_COPY')
    expect(wrapper.get('[data-testid="p2-claim-benefit"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="share-poster"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="share-poster"]').text()).toBe('分享得好礼')
  })

  it('renders configured fortune text columns as separate result lines', () => {
    const wrapper = mountResult({
      initialP2Result: {
        signType: '过儿签',
        fortuneHeadline: '过儿签',
        fortuneHint: '',
        mainTextColumns: ['考试期间，', '别叫我真名，', '叫我过儿，', '最好叫我全过儿。'],
      },
    })

    expect(wrapper.findAll('[data-testid="p2-fortune-line"]').map((line) => line.text())).toEqual([
      '考试期间，',
      '别叫我真名，',
      '叫我过儿，',
      '最好叫我全过儿。',
    ])
  })

  it('keeps the result-page claim button visible after claim and removes the daily check-in entry', () => {
    const wrapper = mountResult({
      initialP4Detail: {
        benefit: {
          claimStatus: 'claimed',
        },
      },
    })

    expect(wrapper.get('[data-testid="p2-claim-benefit"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="p4-rewards-entry"]').exists()).toBe(false)
  })

  it('removes both vertical side fortune copies from the result page', () => {
    const wrapper = mountResult({
      initialP2Result: {
        goodFor: '吉｜坏事开始转弯',
        avoid: '吉｜压力自动降噪',
      },
    })

    expect(wrapper.find('[data-testid="p2-left-luck"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="p2-right-luck"]').exists()).toBe(false)
    expect(wrapper.find('.p2-side-text').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('坏事开始转弯')
    expect(wrapper.text()).not.toContain('压力自动降噪')
  })

  it('opens the activity share poster with QR code but without the product image', async () => {
    const wrapper = mountResult({
      initialP2Result: {
        goodFor: 'LEFT_COPY',
        avoid: 'RIGHT_COPY',
      },
      initialP4Detail: {
        product: {
          productName: 'PRODUCT_NAME',
          productImage: 'product_flat_iron_steak.png',
        },
      },
    })

    await wrapper.get('[data-testid="share-poster"]').trigger('click')

    const poster = wrapper.get('[data-testid="p2-poster-dialog"]')
    expect(poster.find('[data-testid="p2-share-activity-poster"]').attributes('src')).toContain(
      'share_activity_poster.webp',
    )
    expect(poster.find('[data-testid="p2-poster-qrcode"]').attributes('src')).toContain('qrcode_wechat_group.png')
    expect(poster.find('[data-testid="p2-product-image"]').exists()).toBe(false)
    expect(poster.html()).not.toContain('product_flat_iron_steak.webp')
    expect(poster.find('[data-testid="save-p2-poster"]').exists()).toBe(false)
    expect(poster.get('[data-testid="p2-poster-longpress-tip"]').text()).toBe('长按海报可保存/分享')
    expect(poster.get('[data-testid="close-p2-panel"]').attributes('aria-label')).toBe('关闭')

    await poster.get('[data-testid="close-p2-panel"]').trigger('click')

    expect(wrapper.find('[data-testid="p2-poster-dialog"]').exists()).toBe(false)
  })

  it('adds a draw chance and uses the tracked share link when opening the home share poster', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_home_share' })
    const recordShare = vi.fn().mockResolvedValue({
      success: true,
      share_token: 'SH_HOME_TEST',
      share_url: '/activity/home?share_token=SH_HOME_TEST',
      reward_granted: true,
      daily_state: {
        remaining_draw_count: 1001,
        share_reward_count_today: 1,
      },
    })
    const wrapper = mountHome({
      apiClient: {
        createSession,
        recordShare,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
    })

    await wrapper.get('[data-testid="share-entry"]').trigger('click')
    await flushPromises()

    expect(recordShare).toHaveBeenCalledWith({ session_token: 'sess_home_share', share_channel: 'home_share' })
    expect(wrapper.text()).toContain('1001')
    expect(decodeURIComponent(wrapper.get('[data-testid="home-share-qrcode"]').attributes('src'))).toContain(
      '/activity/home?share_token=SH_HOME_TEST',
    )
  })

  it('adds a draw chance and uses the tracked share link when opening the result share poster', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_result_share' })
    const recordShare = vi.fn().mockResolvedValue({
      success: true,
      share_token: 'SH_RESULT_TEST',
      share_url: '/activity/home?share_token=SH_RESULT_TEST',
      reward_granted: true,
      daily_state: {
        remaining_draw_count: 1002,
        share_reward_count_today: 1,
      },
    })
    const wrapper = mountResult({
      apiClient: {
        createSession,
        recordShare,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
    })

    await wrapper.get('[data-testid="share-poster"]').trigger('click')
    await flushPromises()

    expect(recordShare).toHaveBeenCalledWith({ session_token: 'sess_result_share', share_channel: 'result_share' })
    expect(wrapper.get('[data-testid="p2-poster-dialog"]').exists()).toBe(true)
    expect(decodeURIComponent(wrapper.get('[data-testid="p2-poster-qrcode"]').attributes('src'))).toContain(
      '/activity/home?share_token=SH_RESULT_TEST',
    )
  })

  it('uses the approved 2026-05-26 activity poster asset for every share entry', async () => {
    const home = mountHome()
    const result = mountResult()
    const approvedPosterHash = '62511C56BBA69EF1C74A4F5384A3774A1982739ECC346D797A7EF08AB0366E17'

    expect(sha256File('public/assets/share/share_activity_poster.webp')).toBe(approvedPosterHash)
    expect(fileSizeKb('public/assets/share/share_activity_poster.webp')).toBeLessThan(500)

    await home.get('[data-testid="share-entry"]').trigger('click')
    await result.get('[data-testid="share-poster"]').trigger('click')

    expect(home.get('[data-testid="home-share-activity-poster"]').find('.activity-share-poster-image').attributes('src')).toContain(
      'share_activity_poster.webp',
    )
    expect(result.get('[data-testid="p2-share-activity-poster"]').attributes('src')).toContain(
      'share_activity_poster.webp',
    )
  })

  it('renders the home share poster as one generated image before users long-press it', async () => {
    const previewDataUrl = 'data:image/png;base64,home-composed-preview'
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_home' })
    const canvasContext = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
    }
    const originalImage = globalThis.Image
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext)
    const toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(previewDataUrl)
    globalThis.Image = class {
      constructor() {
        this.naturalWidth = 941
        this.naturalHeight = 1672
      }

      set src(value) {
        this._src = value
        setTimeout(() => this.onload?.(), 0)
      }
    }
    const wrapper = mountHome({
      apiClient: { createSession, trackEvent: vi.fn().mockResolvedValue({}) },
    })

    await wrapper.get('[data-testid="share-entry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-share-activity-poster"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="home-share-generated-preview"]').attributes('src')).toBe(previewDataUrl)
    expect(wrapper.find('[data-testid="save-home-share-poster"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="home-share-poster-longpress-tip"]').text()).toBe('长按海报可保存/分享')
    expect(canvasContext.fillRect).toHaveBeenCalled()
    expect(canvasContext.drawImage).toHaveBeenCalled()

    wrapper.unmount()
    globalThis.Image = originalImage
    getContextSpy.mockRestore()
    toDataUrlSpy.mockRestore()
  })

  it('renders the result share poster as one generated image before users long-press it', async () => {
    const previewDataUrl = 'data:image/png;base64,result-composed-preview'
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_result' })
    const canvasContext = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
    }
    const originalImage = globalThis.Image
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext)
    const toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(previewDataUrl)
    globalThis.Image = class {
      constructor() {
        this.naturalWidth = 941
        this.naturalHeight = 1672
      }

      set src(value) {
        this._src = value
        setTimeout(() => this.onload?.(), 0)
      }
    }
    const wrapper = mountResult({
      apiClient: { createSession, trackEvent: vi.fn().mockResolvedValue({}) },
    })

    await wrapper.get('[data-testid="share-poster"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="p2-poster-card"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="p2-poster-generated-preview"]').attributes('src')).toBe(previewDataUrl)
    expect(wrapper.find('[data-testid="save-p2-poster"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="p2-poster-longpress-tip"]').text()).toBe('长按海报可保存/分享')
    expect(canvasContext.fillRect).toHaveBeenCalled()
    expect(canvasContext.drawImage).toHaveBeenCalled()

    wrapper.unmount()
    globalThis.Image = originalImage
    getContextSpy.mockRestore()
    toDataUrlSpy.mockRestore()
  })

  it('rotates the default P2/P4 beef product image on each result-page entry', () => {
    const renderedImages = []

    for (let index = 0; index < 5; index += 1) {
      const wrapper = mountResult()
      renderedImages.push(wrapper.get('[data-testid="p2-product-image"]').attributes('src'))
      wrapper.unmount()
    }

    expect(renderedImages.map((src) => src.split('/').pop())).toEqual([
      'product_flat_iron_steak.webp',
      'product_ribeye_steak.webp',
      'product_sirloin_steak.webp',
      'product_tenderloin_steak.webp',
      'product_flat_iron_steak.webp',
    ])
  })

  it('opens the AI scroll inline on P2 without switching to the P4 page', async () => {
    const wrapper = mountResult({
      initialP4Detail: {
        explainLines: ['INLINE_AI_COPY'],
        product: {
          productName: 'PRODUCT_NAME',
          productImage: 'product_ribeye_steak.png',
        },
      },
    })

    await wrapper.get('[data-testid="ask-xiaopu"]').trigger('click')

    expect(wrapper.get('[data-testid="p2-combined-card"]').exists()).toBe(true)
    expect(wrapper.find('.p4-page').exists()).toBe(false)
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').classes()).toContain('is-open')
    expect(wrapper.get('[data-testid="p2-ai-result"]').text()).toContain('INLINE_AI_COPY')
    expect(wrapper.get('[data-testid="share-poster"]').classes()).toContain('is-explain-open')
  })

  it('keeps the share poster action clickable after the AI scroll opens', async () => {
    const wrapper = mountResult({
      initialP4Detail: {
        explainLines: ['INLINE_AI_COPY'],
      },
    })

    await wrapper.get('[data-testid="ask-xiaopu"]').trigger('click')
    await wrapper.get('[data-testid="share-poster"]').trigger('click')

    expect(wrapper.get('[data-testid="p2-poster-dialog"]').exists()).toBe(true)
  })

  it('keeps the P2/P4 sign typography and tilted beef product aligned to the reference design', () => {
    const css = readSource('src/style.css')

    expect(css).not.toMatch(/\.p2-title-sign\s*{[^}]*width:\s*56%;/s)
    expect(css).toMatch(/\.p2-stage\s*{[^}]*width:\s*min\(100vw,\s*430px\);[^}]*aspect-ratio:\s*941\s*\/\s*1672;/s)
    expect(css).toMatch(/\.p2-fortune-copy\s*{[^}]*top:\s*10\.2%;/s)
    expect(css).toMatch(/\.p2-fortune-copy h2\s*{[^}]*font-family:\s*"STXingkai",\s*"华文行楷",\s*"FZKai-Z03S",\s*"KaiTi",\s*"STKaiti",\s*serif;/s)
    expect(css).toMatch(/\.p2-ai-panel\s*{[^}]*font-family:\s*"STKaiti",\s*"KaiTi",\s*"Kaiti SC",\s*"Songti SC",\s*serif;/s)
    expect(css).toMatch(/\.p2-result-body\s*{[^}]*top:\s*74\.2%;[^}]*height:\s*15\.6%;/s)
    expect(css).toMatch(/\.p2-fortune-copy h2\s*{[^}]*font-size:\s*clamp\(24px,\s*6\.2vw,\s*31px\);/s)
    expect(css).toMatch(/\.p2-fortune-copy p\s*{[^}]*max-width:\s*76%;[^}]*margin:\s*1\.7%\s*auto\s*0;[^}]*font-size:\s*clamp\(25px,\s*7\.4vw,\s*34px\);[^}]*line-height:\s*1\.34;/s)
    expect(css).toMatch(/\.p2-fortune-line\s*{[^}]*display:\s*block;/s)
    expect(css).toMatch(/\.p2-fortune-emphasis\s*{[^}]*color:\s*#b42418;/s)
    expect(css).toMatch(/\.p2-product-hero\s*{[^}]*left:\s*29%;[^}]*width:\s*22%;[^}]*height:\s*58%;/s)
    expect(css).toMatch(/\.p2-product-hero::after\s*{[^}]*radial-gradient\(ellipse/s)
    expect(css).toMatch(/\.p2-product-hero img\s*{[^}]*transform:\s*rotate\(-4deg\)\s*scale\(0\.92\);/s)
    expect(css).toMatch(/\.p2-ai-panel\s*{[^}]*top:\s*36\.5%;[^}]*width:\s*76%;/s)
    expect(css).toMatch(/\.p2-scroll-head\s*{[^}]*width:\s*72%;[^}]*margin:\s*0 auto;/s)
    expect(css).toMatch(/\.p2-scroll-body\s*{[^}]*url\("\/assets\/p4\/element_ai_result_blank_scroll_panel\.webp"\)/s)
    expect(css).toMatch(/\.p2-scroll-body\s*{[^}]*width:\s*94%;[^}]*margin:\s*-16\.5%\s*auto\s*0;/s)
    expect(css).toMatch(/\.p2-ai-scroll\.is-open \.p2-scroll-body\s*{[^}]*min-height:\s*252px;[^}]*max-height:\s*292px;[^}]*padding:\s*42px\s*30px\s*46px;/s)
    expect(css).toMatch(/\.p2-ai-result\s*{[^}]*max-height:\s*200px;/s)
    expect(css).toMatch(/\.p2-ai-result\s*{[^}]*overflow:\s*hidden;/s)
    expect(css).not.toMatch(/\.p2-ai-result\s*{[^}]*overflow-y:\s*auto;/s)
    expect(css).toMatch(/\.p2-ai-result p\s*{[^}]*font-size:\s*clamp\(14px,\s*3\.45vw,\s*16px\);/s)
    expect(css).not.toMatch(/\.p2-scroll-foot\s*{[^}]*radial-gradient/s)
    expect(css).toMatch(/\.p2-ai-loading\s*{[^}]*gap:\s*4px;/s)
    expect(css).toMatch(/\.p2-ai-panel \.p4-thinking-line\s*{[^}]*font-size:\s*13px;/s)
    expect(css).toMatch(/\.p2-claim-button\s*{[^}]*bottom:\s*3\.4%;[^}]*width:\s*56%;/s)
    expect(css).toMatch(/\.p2-poster-button\s*{[^}]*top:\s*66\.6%;[^}]*bottom:\s*auto;[^}]*width:\s*24%;[^}]*min-height:\s*20px;[^}]*padding:\s*0\s*0\s*3px;[^}]*border-bottom:\s*2px solid #a51d13;[^}]*font-size:\s*clamp\(13px,\s*3\.5vw,\s*15px\);[^}]*font-weight:\s*900;[^}]*letter-spacing:\s*0;/s)
    expect(css).toMatch(/\.p2-poster-button\.is-explain-open\s*{[^}]*top:\s*66\.6%;[^}]*bottom:\s*auto;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s)
    expect(css).toMatch(/\.p2-result-body\s*{[^}]*pointer-events:\s*none;/s)
    expect(css).not.toMatch(/\.p2-poster-button\.is-explain-open\s*{[^}]*pointer-events:\s*none;/s)
    expect(css).toMatch(/\.modal-mask\s*{[^}]*overflow-y:\s*auto;/s)
    expect(css).toMatch(/\.p2-poster-dialog\s*{[^}]*width:\s*min\(84vw,\s*332px\);/s)
    expect(css).toMatch(/\.p2-poster-dialog\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
    expect(css).toMatch(/\.p2-poster-dialog\s*{[^}]*max-height:\s*calc\(100svh - 48px - var\(--safe-top\) - var\(--safe-bottom\)\);/s)
    expect(css).toMatch(/\.p2-poster-card\s*{[^}]*background:\s*#a10805;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.activity-share-poster-image\s*{[^}]*aspect-ratio:\s*941\s*\/\s*1672;/s)
    expect(css).toMatch(/\.activity-share-poster-qrcode\s*{[^}]*left:\s*15%;[^}]*top:\s*84\.7%;[^}]*width:\s*21\.2%;/s)
    expect(css).toMatch(/\.p2-poster-generated-preview\s*{[^}]*max-height:\s*min\(calc\(100svh - 170px - var\(--safe-top\) - var\(--safe-bottom\)\),\s*640px\);/s)
    expect(css).toMatch(/\.p2-poster-generated-preview\s*{[^}]*border:\s*0;/s)
    expect(css).toMatch(/\.p2-poster-generated-preview\s*{[^}]*border-radius:\s*0;/s)
    expect(css).toMatch(/\.p2-poster-generated-preview\s*{[^}]*background:\s*transparent;/s)
    expect(css).not.toMatch(/\.p2-poster-generated-preview\s*{[^}]*background:\s*#f7ddb1;/s)
    expect(css).toMatch(/@media \(max-height:\s*720px\)\s*{[^}]*\.p2-stage\s*{[^}]*width:\s*min\(100vw,\s*405px\);/s)
    expect(css).toMatch(/@media \(max-height:\s*680px\)\s*{[^}]*\.p2-stage\s*{[^}]*width:\s*min\(100vw,\s*382px\);/s)
    expect(css).toMatch(/@media \(max-height:\s*640px\)\s*{[^}]*\.p2-stage\s*{[^}]*width:\s*min\(100vw,\s*360px\);/s)
  })

  it('opens the benefit mobile popup without forcing the AI scroll open first', async () => {
    const wrapper = mountResult({
      initialP4Detail: {
        explainLines: ['INLINE_AI_COPY'],
        product: {
          productName: 'PRODUCT_NAME',
          productImage: 'product_sirloin_steak.png',
        },
        benefit: {
          claimButtonText: 'CLAIM_NOW',
          rewardCode: 'coupon_10',
          reward: {
            couponId: 'coupon_10',
            amountText: '10',
            unitText: '元券',
            couponName: '10元券',
          },
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')

    const popup = wrapper.get('[data-testid="p5-mobile-claim-popup"]')
    const input = wrapper.get('[data-testid="p5-mobile-input"]')
    expect(popup.exists()).toBe(true)
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('请输入手机号')
    expect(popup.text()).toContain('手机号')
    expect(popup.text()).not.toMatch(/[璇緭鎵満鍙]/)
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').classes()).not.toContain('is-open')
    expect(wrapper.find('[data-testid="p2-ai-result"]').exists()).toBe(false)
  })

  it('shows a claimed-benefit hint before auto jumping to the rewards progress page', async () => {
    vi.useFakeTimers()
    const wrapper = mountResult({
      initialP4Detail: {
        benefit: {
          claimStatus: 'claimed',
        },
      },
    })

    try {
      await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')

      expect(wrapper.get('.p4-claim-tip').text()).toContain('即将跳转到我的考运进度')
      expect(window.location.pathname).toBe('/activity/result')

      await vi.advanceTimersByTimeAsync(1999)
      expect(window.location.pathname).toBe('/activity/result')

      await vi.advanceTimersByTimeAsync(1)
      expect(window.location.pathname).toBe('/activity/rewards')
      expect(wrapper.get('.p6-stage').exists()).toBe(true)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('redirects to the mini-program my-coupon page after a successful mobile claim', async () => {
    const navigateTo = vi.fn()
    const couponTarget = `${MINI_PROGRAM_COUPON_PAGE}?claim_token=ct_test&claim_no=CL_TEST`
    window.wx = {
      miniProgram: {
        getEnv: (callback) => callback({ miniprogram: true }),
        navigateTo,
      },
    }
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const claimBenefit = vi.fn().mockResolvedValue({
      claimStatus: 'claimed',
      receiver_mobile_masked: '138****8000',
      reward: {
        couponId: 'coupon_10',
        couponName: '10元券',
        couponStatus: 'unused',
      },
      action: {
        type: 'mini_program_coupon_package',
        target: couponTarget,
      },
    })
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_10',
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13800138000')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(claimBenefit).toHaveBeenCalledWith(
      expect.objectContaining({
        session_token: 'sess_test',
        mobile: '13800138000',
        claim_channel: 'h5',
      }),
    )
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: couponTarget }))
    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)
  })

  it('shows the mini-program QR fallback after a successful claim outside mini-program web-view', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const claimBenefit = vi.fn().mockResolvedValue({
      claimStatus: 'claimed',
      receiver_mobile_masked: '138****8000',
      reward: {
        couponId: 'coupon_10',
        couponName: '10元券',
        couponStatus: 'unused',
      },
    })
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_10',
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13800138000')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mini-program-fallback-tip"]').text()).toBe('领取成功，扫码-进入小程序')
    expect(wrapper.find('[data-testid="p5-mobile-claim-popup"]').exists()).toBe(false)
  })

  it('continues to the mini-program QR fallback when mobile claim returns a 502 issue error', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const issueError = new Error('发券失败，请稍后重试')
    issueError.status = 502
    const claimBenefit = vi.fn().mockRejectedValue(issueError)
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
          reward: {
            couponId: 'coupon_30',
            amountText: '30',
            couponName: '无门槛30元券',
          },
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13040695156')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).not.toContain('发券失败')
    expect(wrapper.text()).toContain('已领取')
    expect(wrapper.get('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mini-program-fallback-tip"]').text()).toBe('领取成功，扫码-进入小程序')
    expect(wrapper.find('[data-testid="p5-mobile-claim-popup"]').exists()).toBe(false)
  })

  it('prompts mini-program mobile registration when coupon issue returns a status 3 failure', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const registrationError = new Error('\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7')
    registrationError.status = 502
    registrationError.payload = {
      success: false,
      error_code: 'mini_program_mobile_registration_required',
      message: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
      detail: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
    }
    const claimBenefit = vi.fn().mockRejectedValue(registrationError)
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
          reward: {
            couponId: 'coupon_30',
            amountText: '30',
            couponName: '\u65e0\u95e8\u69db30\u5143\u5238',
          },
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13222323232')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mini-program-fallback-tip"]').text()).toBe(
      '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7\uff0c\u626b\u7801\u8fdb\u5165\u5c0f\u7a0b\u5e8f',
    )
    expect(wrapper.find('[data-testid="p5-mobile-claim-popup"]').exists()).toBe(false)
  })

  it('keeps mobile-registration issue failures retryable after the user registers in the mini-program', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const registrationError = new Error('\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7')
    registrationError.status = 502
    registrationError.payload = {
      success: false,
      error_code: 'mini_program_mobile_registration_required',
      message: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
      detail: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
    }
    const claimBenefit = vi
      .fn()
      .mockRejectedValueOnce(registrationError)
      .mockResolvedValueOnce({
        claimStatus: 'claimed',
        receiver_mobile_masked: '132****3232',
        reward: {
          couponId: 'coupon_30',
          reward_code: 'coupon_30',
          couponStatus: 'unused',
        },
        action: {
          type: 'mini_program_coupon_package',
          target: MINI_PROGRAM_COUPON_PAGE,
        },
      })
    const activity = mountActivityState({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialPage: 'p2',
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
          reward: {
            couponId: 'coupon_30',
            reward_code: 'coupon_30',
            amountText: '30',
            couponName: '\u65e0\u95e8\u69db30\u5143\u5238',
          },
        },
      },
    })

    await activity.openP2Benefit()
    activity.p5Mobile.value = '13222323232'
    await activity.submitP5MobileClaim()
    await flushPromises()

    expect(activity.showMiniProgramFallback.value).toBe(true)
    expect(activity.p4ClaimStatus.value).toBe('unclaimed')
    expect(activity.p5ClaimStatus.value).toBe('input')
    expect(activity.p5Result.value.claimStatus).toBe('input')

    activity.closeMiniProgramFallback()
    await activity.openP2Benefit()
    activity.p5Mobile.value = '13222323232'
    await activity.submitP5MobileClaim()
    await flushPromises()

    expect(claimBenefit).toHaveBeenCalledTimes(2)
    expect(activity.p4ClaimStatus.value).toBe('claimed')
    expect(activity.p5ClaimStatus.value).toBe('claimed')
    expect(activity.p5Result.value.claimStatus).toBe('claimed')
  })

  it('restores the displayed draw chance when mobile registration is required', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const registrationError = new Error('\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7')
    registrationError.status = 502
    registrationError.payload = {
      success: false,
      error_code: 'mini_program_mobile_registration_required',
      message: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
      detail: '\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7',
      daily_state: {
        remaining_draw_count: 1,
        used_draw_count: 0,
      },
    }
    const claimBenefit = vi.fn().mockRejectedValueOnce(registrationError)
    const activity = mountActivityState({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialChance: 0,
      initialPage: 'p2',
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
          reward: {
            couponId: 'coupon_30',
            reward_code: 'coupon_30',
            amountText: '30',
            couponName: '\u65e0\u95e8\u69db30\u5143\u5238',
          },
        },
      },
    })

    await activity.openP2Benefit()
    activity.p5Mobile.value = '13222323232'
    await activity.submitP5MobileClaim()
    await flushPromises()

    expect(activity.drawChance.value).toBe(1)
    expect(activity.p4ClaimStatus.value).toBe('unclaimed')
  })

  it('marks the matching P6 coupon usable after a 502 issue fallback claim', async () => {
    window.wx = {
      miniProgram: {},
    }
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const issueError = new Error('发券失败，请稍后重试')
    issueError.status = 502
    const claimBenefit = vi.fn().mockRejectedValue(issueError)
    const activity = mountActivityState({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialPage: 'p2',
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
          reward: {
            couponId: 'coupon_30',
            reward_code: 'coupon_30',
            amountText: '30',
            couponName: '无门槛30元券',
          },
        },
      },
    })

    await activity.openP2Benefit()
    activity.p5Mobile.value = '13040695156'
    await activity.submitP5MobileClaim()
    await flushPromises()

    const reward = activity.p6Center.value.display_rewards.find((item) => item.reward_code === 'coupon_30')

    expect(reward.status).toBe('unused')
    expect(reward.button_text).toBe('\u53bb\u4f7f\u7528')

    activity.closeMiniProgramFallback()
    await activity.useP6Reward(reward)
    await flushPromises()

    expect(activity.p6ActionMessage.value).not.toContain('璇峰厛瀹屾垚鎶界')
    expect(activity.showMiniProgramFallback.value).toBe(true)
  })

  it('redirects to mini-program without QR fallback when a 502 issue fallback can navigate', async () => {
    const navigateTo = vi.fn()
    window.wx = {
      miniProgram: {
        getEnv: (callback) => callback({ miniprogram: true }),
        navigateTo,
      },
    }
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const issueError = new Error('发券失败，请稍后重试')
    issueError.status = 502
    const claimBenefit = vi.fn().mockRejectedValue(issueError)
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_30',
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13040695156')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).not.toContain('发券失败')
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: MINI_PROGRAM_COUPON_PAGE }))
    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)
  })

  it('does not redirect to the coupon page when mobile claim fails', async () => {
    const navigateTo = vi.fn()
    window.wx = {
      miniProgram: {
        navigateTo,
      },
    }
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const claimBenefit = vi.fn().mockRejectedValue(new Error('手机号已领取过'))
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_10',
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13800138000')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(navigateTo).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('手机号已领取过')
  })

  it('does not use the 502 issue fallback for non-issuing errors', async () => {
    const createSession = vi.fn().mockResolvedValue({ session_token: 'sess_test' })
    const configError = new Error('发券配置缺失，请稍后重试')
    configError.status = 502
    const claimBenefit = vi.fn().mockRejectedValue(configError)
    const wrapper = mountResult({
      apiClient: {
        createSession,
        claimBenefit,
        trackEvent: vi.fn().mockResolvedValue({}),
      },
      initialP4Detail: {
        benefit: {
          rewardCode: 'coupon_10',
        },
      },
    })

    await wrapper.get('[data-testid="p2-claim-benefit"]').trigger('click')
    await wrapper.get('[data-testid="p5-mobile-input"]').setValue('13800138000')
    await wrapper.get('[data-testid="p5-submit-claim"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="p5-mobile-claim-popup"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('发券配置缺失，请稍后重试')
  })

  it('exposes API response status when claim requests fail', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue('{"success":false,"message":"发券失败，请稍后重试","detail":"发券失败，请稍后重试"}'),
    })

    try {
      await expect(
        activityApi.claimBenefit({
          session_token: 'sess_test',
          draw_id: 10,
          reward_code: 'coupon_30',
          mobile: '13040695156',
          claim_channel: 'h5',
        }),
      ).rejects.toMatchObject({
        status: 502,
        payload: expect.objectContaining({
          detail: '发券失败，请稍后重试',
        }),
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reuses the combined result card when opening the legacy P4 route directly', () => {
    window.history.replaceState({}, '', '/activity/explain')

    const wrapper = mount(App, {
      props: {
        initialPage: 'p4',
        initialP4Detail: {
          explainLines: ['DIRECT_AI_COPY'],
          product: {
            productName: 'PRODUCT_NAME',
            productImage: 'product_tenderloin_steak.png',
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="p2-combined-card"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="p2-ai-scroll"]').classes()).toContain('is-open')
    expect(wrapper.get('[data-testid="p2-ai-result"]').text()).toContain('DIRECT_AI_COPY')
  })

  it('opens a large QR preview from the rules page and closes it', async () => {
    const wrapper = mountRules()

    await wrapper.get('[data-testid="p7-qrcode-hotspot"]').trigger('click')

    const preview = wrapper.get('[data-testid="p7-qrcode-preview"]')
    expect(preview.isVisible()).toBe(true)
    expect(preview.find('img').attributes('src')).toContain('qrcode_wechat_group.png')
    expect(preview.find('strong').exists()).toBe(false)

    await wrapper.get('[data-testid="p7-qrcode-preview-close"]').trigger('click')

    expect(wrapper.find('[data-testid="p7-qrcode-preview"]').exists()).toBe(false)
  })

  it('renders the rules QR inline while preserving the preview hotspot', async () => {
    const wrapper = mountRules()

    const frame = wrapper.get('[data-testid="p7-inline-qrcode"]')
    expect(frame.find('img').attributes('src')).toContain('qrcode_wechat_group.png')

    await wrapper.get('[data-testid="p7-qrcode-hotspot"]').trigger('click')

    expect(wrapper.get('[data-testid="p7-qrcode-preview"]').isVisible()).toBe(true)
  })

  it('positions the inline rules QR over the latest left-side frame', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p7-wechat-card\s*{[^}]*position:\s*absolute;[^}]*z-index:\s*5;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/s)
    expect(css).toMatch(/\.p7-qrcode-frame\s*{[^}]*position:\s*absolute;[^}]*top:\s*80\.62%;[^}]*left:\s*15\.35%;[^}]*width:\s*19\.45%;/s)
    expect(css).toMatch(/\.p7-qrcode-frame img\s*{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s)
    expect(css).toMatch(/\.p7-qrcode-hotspot\s*{[^}]*top:\s*80\.08%;[^}]*left:\s*14\.45%;[^}]*width:\s*21\.36%;/s)
    expect(css).not.toMatch(/\.p7-rules-card,\s*\.p7-wechat-card\s*{[^}]*clip:\s*rect/s)
  })

  it('keeps the enlarged QR preview on a clean white surface without clipping styles', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p7-qrcode-preview-mask\s*{[^}]*background:\s*#fff;/s)
    expect(css).toMatch(/\.p7-qrcode-preview-panel\s*{[^}]*width:\s*min\(78vw,\s*340px\);/s)
    expect(css).toMatch(/\.p7-qrcode-preview-image\s*{[^}]*object-fit:\s*contain;/s)
    expect(css).not.toMatch(/\.p7-qrcode-preview-image\s*{[^}]*box-shadow:/s)
  })

  it('uses the complete enterprise WeChat QR asset for the rules preview', () => {
    expect(readPngSize('public/assets/p7/qrcode_wechat_group.png')).toEqual({
      width: 396,
      height: 396,
    })
  })

  it('uses the enterprise WeChat QR asset on the P8 prize page', () => {
    const p8Qrcode = readFileSync(resolve(process.cwd(), 'public/assets/p8/qrcode_grand_prize_wechat.png'))
    const enterpriseWechatQrcode = readFileSync(resolve(process.cwd(), 'public/assets/p7/qrcode_wechat_group.png'))

    expect(p8Qrcode.equals(enterpriseWechatQrcode)).toBe(true)
  })

  it('keeps P8 QR code, status, and WeChat layers when grand-prize qualification is locked', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: false,
            qualify_desc: 'LOCKED_DESC',
            prize_title: 'LOCKED_PRIZE',
            lottery_no: '',
          },
          lottery_status: {
            status: 'locked',
            status_text: 'LOCKED_STATUS',
            draw_time_desc: 'LOCKED_DRAW_TIME',
            notice: 'LOCKED_NOTICE',
            publicity_title: 'LOCKED_PUBLICITY',
            publicity_desc: 'LOCKED_PUBLICITY_DESC',
          },
          wechat_group: {
            qrcode_url: 'qrcode_grand_prize_wechat.png',
            qrcode_id: 'grand_prize_wechat_default',
            title: 'LOCKED_WECHAT_TITLE',
            benefits: ['LOCKED_WECHAT_BENEFIT'],
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="p8-not-qualified"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="p8-lottery-no"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="p8-qrcode"]').find('img').attributes('src')).toContain(
      'qrcode_grand_prize_wechat.png',
    )
    expect(wrapper.text()).toContain('LOCKED_STATUS')
    expect(wrapper.text()).toContain('LOCKED_PUBLICITY_DESC')
    expect(wrapper.text()).toContain('LOCKED_WECHAT_BENEFIT')
  })

  it('locks the P8 status values into the background label column', () => {
    const wrapper = mount(App, { props: { initialPage: 'p8' } })
    const css = readSource('src/style.css')

    expect(wrapper.findAll('.p8-status-row dt').every((label) => label.classes().includes('sr-only'))).toBe(true)
    expect(css).toMatch(/\.p8-status-list\s*{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s)
    expect(css).toMatch(/\.p8-status-list\s*{[^}]*top:\s*-4%;[^}]*left:\s*16\.7%;[^}]*width:\s*31\.8%;[^}]*height:\s*92%;/s)
    expect(css).toMatch(/\.p8-status-row\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
    expect(css).toMatch(/\.p8-status-row dd\s*{[^}]*width:\s*100%;[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
  })

  it('renders the P8 locked qualification copy without mojibake', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: false,
            qualify_desc: '分享5个好友，或累计点亮7天，赢取985和牛礼盒抽奖资格！',
            prize_title: '985 和牛礼盒',
            lottery_no: '',
          },
        },
      },
    })
    const text = wrapper.text()

    expect(text).toContain('大奖资格暂未解锁')
    expect(text).toContain('返回我的奖励')
    expect(text).not.toMatch(/澶у|杩斿|閹|闁|鎴戠殑濂栧姳/)
  })

  it('keeps the P8 lottery number slot empty when no lottery number exists', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: false,
            qualify_desc: '分享5个好友，或累计点亮7天，赢取985和牛礼盒抽奖资格！',
            prize_title: '985 和牛礼盒',
            lottery_no: '',
          },
        },
      },
    })

    expect(wrapper.find('.p8-status-lottery-no').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('抽奖编号生成中，请稍后刷新')
  })

  it('renders the P8 draw date and lottery number on the prize page', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: true,
            qualify_desc: 'QUALIFIED_DESC',
            prize_title: '985 和牛礼盒',
            lottery_no: 'GP20260526000024',
          },
          lottery_status: {
            status: 'pending',
            status_text: '待开奖',
            draw_time_desc: '2026-06-18 10:00',
            notice: '中奖编号将在本页面与企微社群同步公示',
            publicity_title: '中奖公示',
            publicity_desc: '开奖后将在此更新',
          },
        },
      },
    })

    expect(wrapper.find('[data-testid="p8-lottery-no"]').exists()).toBe(false)
    expect(wrapper.get('.p8-draw-time').text()).toBe('2026-06-18 10:00')
    expect(wrapper.get('.p8-status-lottery-no').text()).toBe('GP20260526000024')
  })

  it('uses result artwork on the P8 publicity area after the draw is resolved', () => {
    const won = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: true,
            lottery_no: 'GP20260526000024',
          },
          lottery_status: {
            status: 'won',
            status_text: '已开奖',
            draw_time_desc: '2026-06-18 10:00',
            publicity_title: '恭喜中奖',
            publicity_desc: '您的编号 GP20260526000024 已中奖，请留意企微通知',
            is_drawn: true,
            is_winner: true,
          },
        },
      },
    })
    const lost = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: true,
            lottery_no: 'GP20260526000025',
          },
          lottery_status: {
            status: 'not_won',
            status_text: '已开奖',
            draw_time_desc: '2026-06-18 10:00',
            publicity_title: '已开奖',
            publicity_desc: '您的编号 GP20260526000025 未中奖，感谢参与',
            is_drawn: true,
            is_winner: false,
          },
        },
      },
    })
    const pending = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: true,
            lottery_no: 'GP20260526000026',
          },
          lottery_status: {
            status: 'pending',
            status_text: '待开奖',
            draw_time_desc: '2026-06-18 10:00',
            publicity_title: '中奖公示',
            publicity_desc: '开奖后将在此更新',
            is_drawn: false,
            is_winner: false,
          },
        },
      },
    })

    expect(readPngSize('public/assets/p8/result_grand_prize_won.png')).toEqual({ width: 1254, height: 1254 })
    expect(readPngSize('public/assets/p8/result_grand_prize_not_won.png')).toEqual({ width: 1254, height: 1254 })
    expect(won.get('[data-testid="p8-publicity-result"]').attributes('src')).toContain('result_grand_prize_won.webp')
    expect(won.get('[data-testid="p8-publicity-result"]').attributes('alt')).toBe('恭喜中奖')
    expect(lost.get('[data-testid="p8-publicity-result"]').attributes('src')).toContain(
      'result_grand_prize_not_won.webp',
    )
    expect(lost.get('[data-testid="p8-publicity-result"]').attributes('alt')).toBe('未中奖')
    expect(pending.find('[data-testid="p8-publicity-result"]').exists()).toBe(false)
  })

  it('keeps left P8 draw data while simplifying the winner publicity copy', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p8',
        initialP8Prize: {
          qualification: {
            qualified: true,
            qualify_desc: 'QUALIFIED_DESC',
            prize_title: '985 和牛礼盒',
            lottery_no: 'GP20260526000024',
          },
          lottery_status: {
            status: 'won',
            status_text: '已开奖',
            draw_time_desc: '2026-06-18 10:00',
            notice: '中奖编号将在本页面与企微社群同步公示',
            publicity_title: '恭喜中奖',
            publicity_desc: '您的编号 GP20260526000024 已中奖，请留意企微通知',
          },
        },
      },
    })
    const css = readSource('src/style.css')
    const statusCopy = wrapper.get('.p8-status-copy')

    expect(statusCopy.text()).toContain('已开奖')
    expect(statusCopy.text()).toContain('2026-06-18 10:00')
    expect(statusCopy.text()).toContain('GP20260526000024')
    expect(wrapper.get('[data-testid="p8-publicity-result"]').attributes('src')).toContain(
      'result_grand_prize_won.webp',
    )
    expect(statusCopy.classes()).toContain('is-winner')
    expect(wrapper.get('.p8-status-value').text()).toBe('已开奖')
    expect(wrapper.find('.p8-publicity-desc').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('开奖后将在此更新')
    expect(css).toMatch(/\.p8-publicity-result\s*{[^}]*top:\s*-31%;[^}]*right:\s*3\.8%;[^}]*width:\s*38\.4%;[^}]*height:\s*173%;/s)
    expect(css).toMatch(/\.p8-publicity-result\s*{[^}]*border-radius:\s*8px;[^}]*mix-blend-mode:\s*multiply;[^}]*object-fit:\s*cover;/s)
  })

  it('keeps P8 fallback prize copy free of mojibake at the source', () => {
    const source = readSource('src/composables/useP1Activity.js')
    const initialP8Defaults = source.slice(
      source.indexOf('const DEFAULT_P8_PRIZE = {'),
      source.indexOf('Object.assign(DEFAULT_P7_RULES'),
    )
    const p8Overrides = source.slice(
      source.indexOf('Object.assign(DEFAULT_P8_PRIZE'),
      source.indexOf('const normalizeP2Result'),
    )
    const p8Source = `${initialP8Defaults}\n${p8Overrides}`

    expect(p8Source).toContain('牛气大奖资格已确认')
    expect(p8Source).not.toMatch(/閹|闁|缁|濞|娑|鐗|瀵|鏉|顨|绱|鍩\?|鐗\?|\?\?\?/)
  })

  it('keeps P7 fallback rules copy free of mojibake at the source', () => {
    const source = readSource('src/composables/useP1Activity.js')
    const initialP7Defaults = source.slice(
      source.indexOf('const DEFAULT_P7_RULES = {'),
      source.indexOf('const DEFAULT_P8_PRIZE = {'),
    )
    const p7Overrides = source.slice(
      source.indexOf('Object.assign(DEFAULT_P7_RULES'),
      source.indexOf('Object.assign(DEFAULT_P8_PRIZE'),
    )
    const p7Source = `${initialP7Defaults}\n${p7Overrides}`

    expect(p7Source).toContain('活动规则')
    expect(p7Source).toContain('用户每日默认获得 1 次抽签机会。')
    expect(p7Source).toContain('扫码添加企微')
    expect(p7Source).not.toMatch(/闁|閹|濞|娑|杩斿|\?\?\?/)
  })

  it('keeps rewards page buttons flat without extra shadows', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p6-reward-action\s*{[^}]*box-shadow:\s*none;/s)
    expect(css).toMatch(/\.p6-back-button img,\s*\.p6-rule-button img,\s*\.p6-draw-again img,\s*\.p6-product-action img\s*{[^}]*filter:\s*none;/s)
  })

  it('restores the P6 product recommendation and keeps draw-again below it', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p6',
      },
    })
    const css = readSource('src/style.css')

    expect(wrapper.find('.p6-product-card').exists()).toBe(true)
    expect(wrapper.find('[data-testid="p6-product-action"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('\u7cbe\u9009\u597d\u7269\u63a8\u8350')
    expect(wrapper.get('[data-testid="p6-draw-again"]').exists()).toBe(true)
    expect(css).toMatch(/\.p6-product-card\s*{[^}]*top:\s*80%;/s)
    expect(css).toMatch(/\.p6-draw-again\s*{[^}]*top:\s*89\.9%;/s)
    expect(css).toContain('.p6-product-action')
  })

  it('keeps the P8 status rows aligned and QR code restrained', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p8-status-copy\s*{[^}]*top:\s*65\.95%;[^}]*left:\s*30\.45%;[^}]*width:\s*68%;[^}]*height:\s*7\.35%;/s)
    expect(css).toMatch(/\.p8-status-list\s*{[^}]*top:\s*-4%;[^}]*left:\s*16\.7%;[^}]*width:\s*31\.8%;[^}]*height:\s*92%;/s)
    expect(css).toMatch(/\.p8-status-value,\s*\.p8-draw-time,\s*\.p8-status-lottery-no\s*{/)
    expect(css).toMatch(/\.p8-status-row dd\s*{[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
    expect(css).toMatch(/\.p8-status-lottery-no\s*{[^}]*font-size:\s*clamp\(7\.8px,\s*1\.9vw,\s*9px\);/s)
    expect(css).toMatch(/\.p8-qrcode-frame\s*{[^}]*top:\s*83\.72%;[^}]*right:\s*16\.15%;[^}]*width:\s*25\.1%;[^}]*padding:\s*2\.2%;[^}]*box-sizing:\s*border-box;/s)
    expect(css).toMatch(/\.p8-qrcode-frame\s*{[^}]*background:\s*transparent;/s)
  })

  it('keeps the P8 back button visually consistent with previous pages', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p2-back-button,\s*\.p4-back-button,\s*\.p6-back-button,\s*\.p7-back-button,\s*\.p8-back-button\s*{/)
    expect(css).toMatch(/\.p2-back-button::before,\s*\.p4-back-button::before,\s*\.p6-back-button::before,\s*\.p8-back-button::before\s*{[^}]*width:\s*22%;/s)
    expect(css).toMatch(/\.p2-back-button::after,\s*\.p4-back-button::after,\s*\.p6-back-button::after,\s*\.p8-back-button::after\s*{[^}]*inset:\s*14%;/s)
    expect(css).not.toMatch(/\.p8-back-button\s*{[^}]*border:\s*1\.5px/s)
    expect(css).not.toMatch(/\.p8-back-button::after\s*{[^}]*content:\s*none;/s)
  })

  it('keeps P6 reward action buttons compact on mobile cards', () => {
    const css = readSource('src/style.css')

    expect(css).toMatch(/\.p6-reward-action\s*{[^}]*width:\s*min\(58%,\s*72px\);/s)
    expect(css).toMatch(/\.p6-reward-action\s*{[^}]*min-height:\s*28px;/s)
    expect(css).toMatch(/\.p6-reward-action\s*{[^}]*font-size:\s*clamp\(12px,\s*3\.05vw,\s*13px\);/s)
    expect(css).toMatch(/\.p6-reward-action\s*{[^}]*letter-spacing:\s*0\.04em;/s)
    expect(css).toMatch(/@media \(max-height:\s*640px\)\s*{[\s\S]*?\.p6-reward-action\s*{[^}]*width:\s*min\(54%,\s*64px\);/s)
  })

  it('changes P6 coupon buttons from claim to use only after the coupon is claimed', () => {
    const wrapper = mount(App, {
      props: {
        apiClient: {
          trackEvent: vi.fn().mockResolvedValue({}),
        },
        initialPage: 'p6',
        initialP6Center: {
          claimed_rewards: [
            {
              reward_code: 'coupon_10',
              reward_id: 'coupon_10_claimed',
              reward_type: 'coupon',
              title: '10',
              unit_text: '元',
              desc: '无门槛券',
              status: 'unused',
              action: {
                type: 'mini_program_coupon_package',
                target: MINI_PROGRAM_COUPON_PAGE,
              },
            },
          ],
        },
      },
    })

    const buttons = wrapper.findAll('[data-testid="p6-reward-action"]').map((button) => button.text())

    expect(buttons.slice(0, 5)).toEqual(['去使用', '去领取', '去领取', '去领取', '去领取'])
  })

  it('shows the mini-program QR fallback when claimed P6 coupon navigation is unavailable', async () => {
    const navigateTo = vi.fn()
    window.wx = {
      miniProgram: {},
    }
    const wrapper = mount(App, {
      props: {
        apiClient: {
          trackEvent: vi.fn().mockResolvedValue({}),
        },
        initialPage: 'p6',
        initialP6Center: {
          claimed_rewards: [
            {
              reward_code: 'coupon_10',
              reward_id: 'coupon_10_claimed',
              reward_type: 'coupon',
              title: '10',
              unit_text: '元',
              desc: '无门槛券',
              status: 'unused',
              action: {
                type: 'mini_program_coupon_package',
                target: MINI_PROGRAM_COUPON_PAGE,
              },
            },
          ],
        },
      },
    })
    const buttons = wrapper.findAll('[data-testid="p6-reward-action"]')

    expect(buttons[0].text()).toBe('去使用')
    expect(buttons[0].attributes('disabled')).toBeUndefined()
    await buttons[0].trigger('click')
    await flushPromises()

    expect(navigateTo).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mini-program-fallback-tip"]').text()).toBe('扫码-进入小程序')
    expect(wrapper.get('[data-testid="mini-program-fallback-qrcode"]').attributes('src')).toContain(
      'mini_program_qrcode.jpg',
    )
    await wrapper.get('[data-testid="mini-program-fallback-close"]').trigger('click')
    expect(wrapper.find('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(false)

    expect(buttons[1].text()).toBe('去领取')
    expect(buttons[1].attributes('disabled')).toBeUndefined()
    await buttons[1].trigger('click')

    expect(wrapper.get('.p6-action-tip').text()).toContain('请先完成抽签并领取成功')
  })

  it('keeps the default mini-program coupon target when a claimed P6 coupon has an empty action target', async () => {
    window.wx = {
      miniProgram: {},
    }
    const trackEvent = vi.fn().mockResolvedValue({})
    const wrapper = mount(App, {
      props: {
        apiClient: {
          trackEvent,
        },
        initialPage: 'p6',
        initialP6Center: {
          claimed_rewards: [
            {
              reward_code: 'coupon_10',
              reward_id: 'coupon_10_claimed',
              reward_type: 'coupon',
              title: '10',
              unit_text: '元',
              desc: '无门槛券',
              status: 'unused',
              action: {
                type: 'mini_program_coupon_package',
                target: '',
              },
            },
          ],
        },
      },
    })

    const buttons = wrapper.findAll('[data-testid="p6-reward-action"]')

    expect(buttons[0].text()).toBe('去使用')
    await buttons[0].trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="mini-program-fallback-dialog"]').exists()).toBe(true)
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'mini_program_qrcode_fallback_view',
        event_payload: expect.objectContaining({
          target: MINI_PROGRAM_COUPON_PAGE,
        }),
      }),
    )
  })

  it('uses qualification states for the P6 gift box action', () => {
    const locked = mount(App, {
      props: {
        initialPage: 'p6',
      },
    })
    const unlocked = mount(App, {
      props: {
        initialPage: 'p6',
        initialP6Center: {
          display_rewards: [
            {
              reward_id: 'gift_985',
              reward_type: 'gift_lottery_qualification',
              title: '985和牛礼盒',
              desc: '抽奖资格',
              status: 'qualified',
              button_text: '去使用',
              action: {
                type: 'gift_qualification_detail',
                target: '/activity/grand-prize',
              },
            },
          ],
        },
      },
    })

    expect(locked.get('[data-testid="p6-gift-action"]').text()).toBe('未达标')
    expect(locked.get('[data-testid="p6-gift-action"]').classes()).toContain('is-muted')
    expect(unlocked.get('[data-testid="p6-gift-action"]').text()).toBe('去查看')
  })

  it('opens a qualified P6 gift through the H5 grand-prize detail API', async () => {
    const navigateTo = vi.fn()
    const giftTarget = '/pages/product/detail?id=gift_985'
    const getGrandPrizeDetail = vi.fn().mockResolvedValue({
      qualification: {
        qualified: true,
        qualify_desc: 'QUALIFIED_DESC',
        prize_title: '985 和牛礼盒',
        lottery_no: 'GP20260526000024',
      },
      lottery_status: {
        status: 'won',
        status_text: '已开奖',
        draw_time_desc: '2026-06-18 10:00',
        notice: '中奖编号将在本页面与企微社群同步公示',
        publicity_title: '恭喜中奖',
        publicity_desc: '您的编号 GP20260526000024 已中奖，请留意企微通知',
      },
      wechat_group: {
        qrcode_url: 'qrcode_grand_prize_wechat.png',
      },
    })
    window.wx = {
      miniProgram: {
        navigateTo,
      },
    }

    const wrapper = mount(App, {
      props: {
        initialPage: 'p6',
        apiClient: {
          createSession: vi.fn().mockResolvedValue({ session_token: 'sess_test' }),
          getRewardCenter: vi.fn().mockResolvedValue({
            display_rewards: [
              {
                reward_id: 'gift_985',
                reward_type: 'gift_lottery_qualification',
                title: '985和牛礼盒',
                desc: '抽奖资格',
                status: 'qualified',
                button_text: '去查看',
                action: {
                  type: 'mini_program_product_detail',
                  target: giftTarget,
                },
              },
            ],
          }),
          getGrandPrizeDetail,
          trackEvent: vi.fn().mockResolvedValue({}),
        },
      },
    })

    await flushPromises()
    await wrapper.get('[data-testid="p6-gift-action"]').trigger('click')
    await flushPromises()

    expect(navigateTo).not.toHaveBeenCalledWith({ url: giftTarget })
    expect(getGrandPrizeDetail).toHaveBeenCalledWith({ session_token: 'sess_test' })
    expect(wrapper.find('[data-testid="p8-qrcode"]').exists()).toBe(true)
    expect(wrapper.get('.p8-status-value').text()).toBe('已开奖')
    expect(wrapper.get('[data-testid="p8-publicity-result"]').attributes('src')).toContain(
      'result_grand_prize_won.webp',
    )
    expect(wrapper.find('.p8-publicity-desc').exists()).toBe(false)
  })

  it('renders the rewards page copy without mojibake', () => {
    const wrapper = mount(App, {
      props: {
        initialPage: 'p6',
      },
    })
    const text = wrapper.text()

    expect(text).toContain('我的奖励')
    expect(text).toContain('我的考运进度')
    expect(text).toContain('已分享')
    expect(text).toContain('/5')
    expect(text).toContain('人')
    expect(text).toContain('精选好物推荐')
    expect(text).not.toMatch(/[\uFFFD\uE000-\uF8FF]|\u6d5c\?|\u5bb8\u63d2\u578e\u6d5c|\u93b4\u6220\u6b91|\u6fc2\u6827\u59f3|\u6769\u65bf\u6d16|\u5a32\u8bf2\u59e9|\u7eee\u9e43/)
  })

  it('configures the mobile viewport for safe-area webview rendering', () => {
    const html = readSource('index.html')

    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('interactive-widget=resizes-content')
  })

  it('adds mobile safe-area spacing and short-screen fallbacks', () => {
    const css = readSource('src/style.css')

    expect(css).toContain('--safe-top: env(safe-area-inset-top, 0px);')
    expect(css).toContain('--safe-bottom: env(safe-area-inset-bottom, 0px);')
    expect(css).toMatch(/\.home-page,\s*\.p2-page,\s*\.p4-page,\s*\.p6-page,\s*\.p7-page,\s*\.p8-page\s*{[^}]*padding-top:\s*var\(--safe-top\);/s)
    expect(css).toMatch(/\.modal-mask\s*{[^}]*padding:\s*max\(24px,\s*calc\(24px \+ var\(--safe-top\)\)\)\s*max\(24px,\s*calc\(24px \+ var\(--safe-right\)\)\)\s*max\(24px,\s*calc\(24px \+ var\(--safe-bottom\)\)\)\s*max\(24px,\s*calc\(24px \+ var\(--safe-left\)\)\);/s)
    expect(css).toMatch(/\.p5-popup-mask\s*{[^}]*padding:\s*max\(24px,\s*calc\(24px \+ var\(--safe-top\)\)\)\s*0\s*max\(24px,\s*calc\(24px \+ var\(--safe-bottom\)\)\);/s)
    expect(css).toMatch(/\.p6-page\s*{[^}]*padding-bottom:\s*calc\(96px \+ var\(--safe-bottom\)\);/s)
    expect(css).toMatch(/\.p7-qrcode-preview-mask\s*{[^}]*padding:\s*max\(56px,\s*calc\(56px \+ var\(--safe-top\)\)\)\s*max\(24px,\s*calc\(24px \+ var\(--safe-right\)\)\)\s*max\(32px,\s*calc\(32px \+ var\(--safe-bottom\)\)\)\s*max\(24px,\s*calc\(24px \+ var\(--safe-left\)\)\);/s)
    expect(css).not.toContain('local-api-debug-panel')
    expect(css).toMatch(/@media \(max-height:\s*640px\)\s*{/s)
  })

  it('does not render the local API debug pill on activity pages', () => {
    const wrapper = mountResult()

    expect(wrapper.find('[data-testid="local-api-debug-toggle"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('local-api-debug')
  })

  it('reports runtime warnings for missing page nodes, console warnings, and resource load failures', () => {
    document.body.innerHTML = '<main class="p2-page"><section data-testid="p2-combined-card"></section></main>'
    const reports = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const monitor = installRuntimeMonitor({
      getPageCode: () => 'p2',
      report: (eventName, payload) => reports.push({ eventName, payload }),
    })

    monitor.checkPageNodes()
    console.warn('asset warning', { code: 'missing' })
    const image = document.createElement('img')
    image.src = '/assets/missing.png'
    document.body.appendChild(image)
    image.dispatchEvent(new Event('error', { bubbles: true }))
    monitor.dispose()
    warnSpy.mockRestore()

    expect(reports.map((entry) => entry.eventName)).toContain('runtime_page_node_missing')
    expect(reports.map((entry) => entry.eventName)).toContain('runtime_console_warning')
    expect(reports.map((entry) => entry.eventName)).toContain('runtime_resource_load_error')
    expect(reports.find((entry) => entry.eventName === 'runtime_page_node_missing')?.payload.selector).toBe(
      '[data-testid="p2-product-image"]',
    )
  })

  it('opens the home share poster with close control and long-press tip only', async () => {
    const wrapper = mountHome({ initialChance: 0 })

    await wrapper.get('[data-testid="share-entry"]').trigger('click')
    expect(wrapper.text()).toContain('分享引导')
    expect(wrapper.get('[data-testid="home-share-activity-poster"]').find('.activity-share-poster-image').attributes('src')).toContain(
      'share_activity_poster.webp',
    )
    expect(wrapper.get('[data-testid="home-share-qrcode"]').attributes('src')).toContain('qrcode_wechat_group.png')
    expect(wrapper.find('[data-testid="save-home-share-poster"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="home-share-poster-longpress-tip"]').text()).toBe('长按海报可保存/分享')
    expect(wrapper.get('[data-testid="close-share-guide"]').attributes('aria-label')).toBe('关闭')
    expect(wrapper.find('[data-testid="share-complete"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('模拟完成分享')
    expect(wrapper.text()).not.toContain('知道了')

    await wrapper.get('[data-testid="close-share-guide"]').trigger('click')

    expect(wrapper.find('[data-testid="home-share-poster-dialog"]').exists()).toBe(false)
  })
})
