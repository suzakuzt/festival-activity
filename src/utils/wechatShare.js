export const WECHAT_SHARE_JS_API_LIST = ['updateAppMessageShareData', 'updateTimelineShareData']

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
      if (typeof wx.updateAppMessageShareData === 'function') {
        wx.updateAppMessageShareData({
          title,
          desc,
          link: shareLink,
          imgUrl: shareImage,
          success: () => onShareSuccess?.('friend'),
        })
        configured = true
      }
      if (typeof wx.updateTimelineShareData === 'function') {
        wx.updateTimelineShareData({
          title: timelineTitle || title,
          link: shareLink,
          imgUrl: shareImage,
          success: () => onShareSuccess?.('timeline'),
        })
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
      debug: false,
      appId: signature.appId,
      timestamp: signature.timestamp,
      nonceStr: signature.nonceStr,
      signature: signature.signature,
      jsApiList,
    })
  })
}
