export const WECHAT_SHARE_JS_API_LIST = [
  'updateAppMessageShareData',
  'updateTimelineShareData',
  'onMenuShareAppMessage',
  'onMenuShareTimeline',
]

const getWechatBridge = () => (typeof window === 'undefined' ? undefined : window.wx)

export const getWechatSignatureUrl = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return `${window.location.origin}${window.location.pathname}${window.location.search}`.replace(/#.*$/, '')
}

export const toAbsoluteShareUrl = (value = '') => {
  if (!value || typeof window === 'undefined') {
    return value
  }

  return new URL(value, window.location.origin).href
}

const isWechatDebugEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('wxdebug') === '1'
}

export const configureWechatShare = async ({
  apiClient,
  title,
  desc,
  timelineTitle,
  link,
  imgUrl,
  onShareSuccess,
} = {}) => {
  const wx = getWechatBridge()
  const getWechatJssdkSignature = apiClient?.getWechatJssdkSignature
  if (!wx || typeof wx.config !== 'function' || typeof getWechatJssdkSignature !== 'function') {
    return { configured: false, reason: 'wechat_unavailable' }
  }

  const signature = await getWechatJssdkSignature({ url: getWechatSignatureUrl() })
  const jsApiList = signature.jsApiList?.length ? signature.jsApiList : WECHAT_SHARE_JS_API_LIST
  const shareLink = toAbsoluteShareUrl(link)
  const shareImage = toAbsoluteShareUrl(imgUrl)

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const applyShareData = () => {
      let configured = false
      const friendShareData = {
        title,
        desc,
        link: shareLink,
        imgUrl: shareImage,
        success: () => onShareSuccess?.('friend'),
      }
      const timelineShareData = {
        title: timelineTitle || title,
        link: shareLink,
        imgUrl: shareImage,
        success: () => onShareSuccess?.('timeline'),
      }
      if (typeof wx.updateAppMessageShareData === 'function') {
        wx.updateAppMessageShareData(friendShareData)
        configured = true
      }
      if (typeof wx.onMenuShareAppMessage === 'function') {
        wx.onMenuShareAppMessage(friendShareData)
        configured = true
      }
      if (typeof wx.updateTimelineShareData === 'function') {
        wx.updateTimelineShareData(timelineShareData)
        configured = true
      }
      if (typeof wx.onMenuShareTimeline === 'function') {
        wx.onMenuShareTimeline(timelineShareData)
        configured = true
      }
      finish({ configured, reason: configured ? 'ready' : 'share_api_unavailable' })
    }

    if (typeof wx.error === 'function') {
      wx.error((error) => finish({ configured: false, reason: 'wechat_config_error', error }))
    }

    if (typeof wx.ready === 'function') {
      wx.ready(applyShareData)
    } else {
      applyShareData()
    }

    wx.config({
      debug: isWechatDebugEnabled(),
      appId: signature.appId,
      timestamp: signature.timestamp,
      nonceStr: signature.nonceStr,
      signature: signature.signature,
      jsApiList,
    })
  })
}
