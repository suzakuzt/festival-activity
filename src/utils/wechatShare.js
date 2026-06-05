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

const formatDebugValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const emitWechatShareDebug = (onDebugEvent, label, value) => {
  if (typeof onDebugEvent !== 'function') {
    return
  }

  try {
    const result = onDebugEvent(label, value)
    result?.catch?.(() => {})
  } catch {
    // Diagnostic reporting must never affect the share setup path.
  }
}

const renderWechatShareDebugPanel = () => {
  if (!isWechatDebugEnabled() || typeof document === 'undefined') {
    return
  }

  const entries = window.__WECHAT_SHARE_DEBUG__ || []
  let panel = document.querySelector('[data-testid="wechat-share-debug-panel"]')
  if (!panel) {
    panel = document.createElement('pre')
    panel.dataset.testid = 'wechat-share-debug-panel'
    panel.style.position = 'fixed'
    panel.style.left = '8px'
    panel.style.right = '8px'
    panel.style.bottom = '8px'
    panel.style.zIndex = '99999'
    panel.style.maxHeight = '42vh'
    panel.style.overflow = 'auto'
    panel.style.margin = '0'
    panel.style.padding = '10px'
    panel.style.borderRadius = '8px'
    panel.style.background = 'rgba(0, 0, 0, 0.82)'
    panel.style.color = '#fff'
    panel.style.font = '12px/1.45 monospace'
    panel.style.whiteSpace = 'pre-wrap'
    document.body.appendChild(panel)
  }

  panel.textContent = [
    'WeChat Share Debug',
    ...entries.slice(-40).map((entry) => `[${entry.time}] ${entry.label}: ${formatDebugValue(entry.value)}`),
  ].join('\n')
}

const recordWechatShareDebug = (label, value = '', onDebugEvent) => {
  if (!isWechatDebugEnabled() || typeof window === 'undefined') {
    return
  }

  window.__WECHAT_SHARE_DEBUG__ = window.__WECHAT_SHARE_DEBUG__ || []
  window.__WECHAT_SHARE_DEBUG__.push({
    label,
    value,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  })
  renderWechatShareDebugPanel()
  console.log('[wechat-share-debug]', label, value)
  emitWechatShareDebug(onDebugEvent, label, value)
}

const getWechatApiAvailability = (wx) =>
  WECHAT_SHARE_JS_API_LIST.reduce((result, apiName) => {
    result[apiName] = typeof wx?.[apiName] === 'function'
    return result
  }, {})

const probeWechatShareImage = (src, onDebugEvent) => {
  if (!isWechatDebugEnabled() || !src || typeof window === 'undefined' || typeof Image !== 'function') {
    return
  }

  const image = new Image()
  image.onload = () =>
    recordWechatShareDebug('image_load_ok', {
      src,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }, onDebugEvent)
  image.onerror = () => recordWechatShareDebug('image_load_error', src, onDebugEvent)
  recordWechatShareDebug('image_load_start', src, onDebugEvent)
  image.src = src
}

export const configureWechatShare = async ({
  apiClient,
  title,
  desc,
  timelineTitle,
  link,
  imgUrl,
  onShareSuccess,
  onDebugEvent,
} = {}) => {
  const wx = getWechatBridge()
  const getWechatJssdkSignature = apiClient?.getWechatJssdkSignature
  if (!wx || typeof wx.config !== 'function' || typeof getWechatJssdkSignature !== 'function') {
    recordWechatShareDebug('wechat_unavailable', {
      hasWx: Boolean(wx),
      hasConfig: typeof wx?.config === 'function',
      hasSignatureApi: typeof getWechatJssdkSignature === 'function',
    }, onDebugEvent)
    return { configured: false, reason: 'wechat_unavailable' }
  }

  const signatureUrl = getWechatSignatureUrl()
  recordWechatShareDebug('signature_url', signatureUrl, onDebugEvent)
  let signature
  try {
    signature = await getWechatJssdkSignature({ url: signatureUrl })
  } catch (error) {
    recordWechatShareDebug('signature_error', error instanceof Error ? error.message : error, onDebugEvent)
    throw error
  }
  const jsApiList = signature.jsApiList?.length ? signature.jsApiList : WECHAT_SHARE_JS_API_LIST
  const shareLink = toAbsoluteShareUrl(link)
  const shareImage = toAbsoluteShareUrl(imgUrl)
  recordWechatShareDebug('signature_ok', {
    appId: signature.appId,
    timestamp: signature.timestamp,
    jsApiList,
  }, onDebugEvent)
  recordWechatShareDebug('share_title', title, onDebugEvent)
  recordWechatShareDebug('share_desc', desc, onDebugEvent)
  recordWechatShareDebug('timeline_title', timelineTitle || title, onDebugEvent)
  recordWechatShareDebug('share_link', shareLink, onDebugEvent)
  recordWechatShareDebug('share_image', shareImage, onDebugEvent)
  recordWechatShareDebug('api_available_before_config', getWechatApiAvailability(wx), onDebugEvent)
  probeWechatShareImage(shareImage, onDebugEvent)

  return new Promise((resolve) => {
    let settled = false
    let readyFired = false
    const finish = (result) => {
      if (!settled) {
        settled = true
        recordWechatShareDebug('finish', result, onDebugEvent)
        resolve(result)
      }
    }
    const applyShareData = () => {
      readyFired = true
      recordWechatShareDebug('wx_ready', getWechatApiAvailability(wx), onDebugEvent)
      let configured = false
      const createShareData = (shareData, target, apiName) => ({
        ...shareData,
        success: () => {
          recordWechatShareDebug(`${apiName}_success`, { target }, onDebugEvent)
          onShareSuccess?.(target)
        },
        fail: (error) => recordWechatShareDebug(`${apiName}_fail`, error, onDebugEvent),
        complete: (result) => recordWechatShareDebug(`${apiName}_complete`, result, onDebugEvent),
      })
      const friendShareBaseData = {
        title,
        desc,
        link: shareLink,
        imgUrl: shareImage,
      }
      const timelineShareBaseData = {
        title: timelineTitle || title,
        link: shareLink,
        imgUrl: shareImage,
      }
      if (typeof wx.updateAppMessageShareData === 'function') {
        const friendShareData = createShareData(friendShareBaseData, 'friend', 'updateAppMessageShareData')
        recordWechatShareDebug('call_updateAppMessageShareData', friendShareData, onDebugEvent)
        wx.updateAppMessageShareData(friendShareData)
        configured = true
      }
      if (typeof wx.onMenuShareAppMessage === 'function') {
        const friendShareData = createShareData(friendShareBaseData, 'friend', 'onMenuShareAppMessage')
        recordWechatShareDebug('call_onMenuShareAppMessage', friendShareData, onDebugEvent)
        wx.onMenuShareAppMessage(friendShareData)
        configured = true
      }
      if (typeof wx.updateTimelineShareData === 'function') {
        const timelineShareData = createShareData(timelineShareBaseData, 'timeline', 'updateTimelineShareData')
        recordWechatShareDebug('call_updateTimelineShareData', timelineShareData, onDebugEvent)
        wx.updateTimelineShareData(timelineShareData)
        configured = true
      }
      if (typeof wx.onMenuShareTimeline === 'function') {
        const timelineShareData = createShareData(timelineShareBaseData, 'timeline', 'onMenuShareTimeline')
        recordWechatShareDebug('call_onMenuShareTimeline', timelineShareData, onDebugEvent)
        wx.onMenuShareTimeline(timelineShareData)
        configured = true
      }
      finish({ configured, reason: configured ? 'ready' : 'share_api_unavailable' })
    }

    if (typeof wx.error === 'function') {
      wx.error((error) => {
        recordWechatShareDebug('wx_error', error, onDebugEvent)
        finish({ configured: false, reason: 'wechat_config_error', error })
      })
    }

    const configPayload = {
      debug: false,
      appId: signature.appId,
      timestamp: signature.timestamp,
      nonceStr: signature.nonceStr,
      signature: signature.signature,
      jsApiList,
    }
    recordWechatShareDebug('wx_config_call', {
      debug: configPayload.debug,
      appId: configPayload.appId,
      timestamp: configPayload.timestamp,
      jsApiList: configPayload.jsApiList,
    }, onDebugEvent)
    try {
      wx.config(configPayload)
    } catch (error) {
      recordWechatShareDebug('wx_config_throw', error instanceof Error ? error.message : error, onDebugEvent)
      finish({ configured: false, reason: 'wechat_config_throw', error })
      return
    }

    if (typeof wx.ready === 'function') {
      wx.ready(applyShareData)
    } else {
      applyShareData()
    }

    if (isWechatDebugEnabled()) {
      window.setTimeout(() => {
        if (!readyFired && !settled) {
          recordWechatShareDebug('wx_ready_timeout', 'wx.ready did not fire within 5000ms', onDebugEvent)
        }
      }, 5000)
    }
  })
}
