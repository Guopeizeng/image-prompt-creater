/**
 * PVOS Hosted Lite - Frontend Injection
 * Adds anonymous event collection, feedback entry, and submission features
 * to the sealed standalone workbench shell.
 */

(function() {
  'use strict';

  // Configuration
  const API_BASE = window.PVOS_API_BASE || window.location.origin;
  const VERSION = '5.16.1';
  const V517_EXPERIENCE_NAME = 'V5.17 Quick Create';
  const UI_BUILD = 'V6.1.1 Poster Structure Runtime · 2026-06-12';
  const SESSION_KEY = 'pvos_session_id';
  const TELEMETRY_KEY = 'pvos_telemetry_consent';
  const PROJECT_KEY_SESSION = 'pvos_project_key';

  // Safe storage bridge. Standalone file previews and browser sandboxes may expose
  // an opaque origin where localStorage/sessionStorage throw SecurityError.
  const memoryStorage = { local: Object.create(null), session: Object.create(null) };
  function storageGet(kind, key) {
    try {
      const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
      return storage.getItem(key);
    } catch (_) {
      return Object.prototype.hasOwnProperty.call(memoryStorage[kind], key) ? memoryStorage[kind][key] : null;
    }
  }
  function storageSet(kind, key, value) {
    try {
      const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
      storage.setItem(key, value);
    } catch (_) {
      memoryStorage[kind][key] = String(value);
    }
  }
  function storageRemove(kind, key) {
    try {
      const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
      storage.removeItem(key);
    } catch (_) {
      delete memoryStorage[kind][key];
    }
  }

  // Allowed event names
  const ALLOWED_EVENTS = [
    'app_open', 'route_selected', 'text_strategy_changed',
    'prompt_copied', 'layout_opened', 'base_image_uploaded',
    'poster_exported', 'feedback_submitted', 'submission_created'
  ];

  // Generate or retrieve session ID
  function getSessionId() {
    let sid = storageGet('session', SESSION_KEY);
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      storageSet('session', SESSION_KEY, sid);
    }
    return sid;
  }

  // Check if telemetry is enabled
  function isTelemetryEnabled() {
    const consent = storageGet('local', TELEMETRY_KEY);
    if (consent === null) {
      // Privacy-first default. The user can opt in from the visible top-bar toggle.
      return false;
    }
    return consent === 'true';
  }

  // Set telemetry consent
  function setTelemetryConsent(enabled) {
    storageSet('local', TELEMETRY_KEY, enabled ? 'true' : 'false');
  }

  function updateTelemetryButton() {
    const button = document.getElementById('pvos-telemetry-btn');
    if (!button) return;
    const enabled = isTelemetryEnabled();
    button.textContent = enabled ? '匿名统计：开' : '匿名统计：关';
    button.title = enabled ? '点击关闭匿名使用统计' : '点击开启匿名使用统计';
  }

  function toggleTelemetryConsent() {
    setTelemetryConsent(!isTelemetryEnabled());
    updateTelemetryButton();
    showToast(isTelemetryEnabled() ? '匿名统计已开启' : '匿名统计已关闭');
  }

  window.pvosSetTelemetryConsent = function(enabled) {
    setTelemetryConsent(Boolean(enabled));
    updateTelemetryButton();
  };

  window.pvosToggleTelemetryConsent = toggleTelemetryConsent;

  function projectHeaders() {
    const key = window.PVOS_PROJECT_KEY || storageGet('session', PROJECT_KEY_SESSION) || '';
    return key ? { 'X-Project-Key': key } : {};
  }

  async function coreFetch(path, options) {
    const source = options || {};
    const request = Object.assign({}, source, { headers: Object.assign({}, source.headers || {}, projectHeaders()) });
    const timeoutMs = Number(request.timeoutMs || 12000);
    delete request.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (!request.signal) request.signal = controller.signal;
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== 'string') {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    try {
      const response = await fetch(API_BASE + path, request);
      if (!response.ok) {
        let detail = 'Core API request failed';
        try { detail = (await response.json()).detail || detail; } catch (_) {}
        throw new Error(detail);
      }
      return response.json();
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('Core API request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Machine-callable bridge for the same Core used by Agent Skills.
  // The legacy Human-First workbench remains available as a compatibility shell.
  window.PVOSCoreAPI = {
    version: VERSION,
    uiBuild: UI_BUILD,
    apiBase: API_BASE,
    setProjectKey(key) {
      if (key) storageSet('session', PROJECT_KEY_SESSION, key);
      else storageRemove('session', PROJECT_KEY_SESSION);
    },
    commands() { return coreFetch('/api/v1/commands'); },
    manifest() { return coreFetch('/api/v1/library/manifest'); },
    recommendRoutes(payload) { return coreFetch('/api/v1/routes/recommend', { method: 'POST', body: payload }); },
    resolveComponents(payload) { return coreFetch('/api/v1/components/resolve', { method: 'POST', body: payload }); },
    validateDirectorConfig(payload) { return coreFetch('/api/v1/configs/validate', { method: 'POST', body: payload }); },
    compilePrompt(payload) { return coreFetch('/api/v1/prompts/compile', { method: 'POST', body: payload }); },
    createLayoutPlan(payload) { return coreFetch('/api/v1/layout-plans', { method: 'POST', body: payload }); },
    createCharacter(payload) { return coreFetch('/api/v1/characters', { method: 'POST', body: payload }); },
    createWorkflow(payload) { return coreFetch('/api/v1/workflows', { method: 'POST', body: payload }); },
    getWorkflow(runId) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId)); },
    recommendWorkflowRoutes(runId) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/recommend-routes', { method: 'POST' }); },
    selectWorkflowRoute(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/select-route', { method: 'POST', body: payload }); },
    approve(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/approvals', { method: 'POST', body: payload }); },
    compileWorkflowPrompt(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/compile-prompt', { method: 'POST', body: payload || {} }); },
    createGenerationQueue(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/generation-queue', { method: 'POST', body: payload || {} }); },
    recordOutput(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/artifacts', { method: 'POST', body: payload }); },
    selectOutput(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/select-output', { method: 'POST', body: payload }); },
    createWorkflowLayoutPlan(runId) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/layout-plan', { method: 'POST' }); },
    recordFeedback(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/feedback', { method: 'POST', body: payload }); },
    proposeRuleUpdate(runId, payload) { return coreFetch('/api/v1/workflows/' + encodeURIComponent(runId) + '/rule-updates', { method: 'POST', body: payload }); }
  };

  // Send event to server (async, non-blocking)
  function sendEvent(eventName, metadata) {
    if (!isTelemetryEnabled()) return;
    if (!ALLOWED_EVENTS.includes(eventName)) return;

    const payload = {
      event_name: eventName,
      session_id: getSessionId(),
      release_version: VERSION,
      timestamp: new Date().toISOString(),
      route_id: metadata?.route_id || null,
      text_strategy: metadata?.text_strategy || null,
      metadata_json: JSON.stringify(metadata || {})
    };

    // Non-blocking POST
    fetch(API_BASE + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {}); // Silent fail
  }

  // Show toast notification
  function showToast(message, duration) {
    duration = duration || 2500;
    let toast = document.getElementById('pvos-hosted-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pvos-hosted-toast';
      toast.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
        'padding:10px 16px', 'border:1px solid rgba(180,147,85,.55)',
        'border-radius:9px', 'background:rgba(22,25,27,.96)',
        'box-shadow:0 14px 40px rgba(0,0,0,.38)',
        'color:#ead7a1', 'font-size:11px', 'font-weight:700',
        'opacity:0', 'transform:translateY(8px)',
        'transition:opacity .18s,transform .18s'
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
    }, duration);
  }

  // ========================================================================
  // Feedback UI
  // ========================================================================

  function createFeedbackPanel() {
    // Check if already created
    if (document.getElementById('pvos-feedback-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'pvos-feedback-panel';
    panel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99990',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,.72)', 'backdrop-filter:blur(5px)'
    ].join(';');
    panel.innerHTML = `
      <div style="
        width:min(480px,calc(100vw - 40px));
        background:#111315;
        border:1px solid rgba(180,147,85,.28);
        border-radius:12px;
        padding:24px;
        box-shadow:0 20px 60px rgba(0,0,0,.5);
      ">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <h3 style="margin:0;font-size:14px;color:#ead8a6;">反馈问题</h3>
          <button onclick="pvosCloseFeedback()" style="
            margin-left:auto;background:transparent;border:none;color:#7d8688;
            font-size:18px;cursor:pointer;padding:4px 8px;
          ">×</button>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">满意度</label>
          <div style="display:flex;gap:8px;">
            <button class="pvos-fb-rating" data-rating="close" style="
              flex:1;padding:10px;border:1px solid rgba(255,255,255,.10);
              background:#151719;color:#dcd6ca;border-radius:8px;font-size:11px;
              cursor:pointer;
            ">✓ 满意</button>
            <button class="pvos-fb-rating" data-rating="usable" style="
              flex:1;padding:10px;border:1px solid rgba(255,255,255,.10);
              background:#151719;color:#dcd6ca;border-radius:8px;font-size:11px;
              cursor:pointer;
            ">～ 一般</button>
            <button class="pvos-fb-rating" data-rating="dissatisfied" style="
              flex:1;padding:10px;border:1px solid rgba(255,255,255,.10);
              background:#151719;color:#dcd6ca;border-radius:8px;font-size:11px;
              cursor:pointer;
           ">✗ 不满意</button>
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">问题类型</label>
          <select id="pvos-fb-issue" style="
            width:100%;background:#0c0f10;border:1px solid rgba(255,255,255,.11);
            border-radius:7px;color:#e8e0d2;padding:10px9px;font-size:11px;
          ">
            <option value="">— 选择问题类型 —</option>
            <option value="route">路线选择</option>
            <option value="prompt">Prompt 生成</option>
            <option value="typography">字体排版</option>
            <option value="discoverability">功能发现</option>
            <option value="export">导出问题</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">补充说明（可选）</label>
          <textarea id="pvos-fb-comment" style="
            width:100%;min-height:80px;background:#0c0f10;
            border:1px solid rgba(255,255,255,.11);border-radius:7px;
            color:#e8e0d2;padding:10px9px;font-size:11px;resize:vertical;
          " placeholder="描述你遇到的问题或建议..."></textarea>
        </div>
        <button onclick="pvosSubmitFeedback()" style="
          width:100%;padding:12px;background:linear-gradient(135deg,#7b6236,#5f4c2c);
          border:1px solid #967945;border-radius:8px;color:#fff1c7;
          font-size:12px;font-weight:700;cursor:pointer;
        ">提交反馈</button>
        <p style="text-align:center;margin-top:12px;font-size:10px;color:#687174;">
          反馈为匿名提交，可跳过
        </p>
      </div>
    `;
    document.body.appendChild(panel);

    // Rating button handlers
    panel.querySelectorAll('.pvos-fb-rating').forEach(btn => {
      btn.addEventListener('click', function() {
        panel.querySelectorAll('.pvos-fb-rating').forEach(b => {
          b.style.borderColor = 'rgba(255,255,255,.10)';
          b.style.background = '#151719';
        });
        this.style.borderColor = 'rgba(180,147,85,.68)';
        this.style.background = 'rgba(180,147,85,.12)';
        this.dataset.selected = 'true';
      });
    });
  }

  // Separate submission panel to avoid collision with feedback panel
  function createSubmissionPanel() {
    // Check if already created
    if (document.getElementById('pvos-submission-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'pvos-submission-panel';
    panel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99990',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,.72)', 'backdrop-filter:blur(5px)'
    ].join(';');
    panel.innerHTML = `
      <div style="
        width:min(520px,calc(100vw - 40px));
        max-height:calc(100vh - 80px);
        overflow-y:auto;
        background:#111315;
        border:1px solid rgba(180,147,85,.28);
        border-radius:12px;
        padding:24px;
        box-shadow:0 20px 60px rgba(0,0,0,.5);
      ">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <h3 style="margin:0;font-size:14px;color:#ead8a6;">投稿模板</h3>
          <button onclick="pvosCloseSubmission()" style="
            margin-left:auto;background:transparent;border:none;color:#7d8688;
            font-size:18px;cursor:pointer;padding:4px 8px;
          ">×</button>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">标题 *</label>
          <input id="pvos-sub-title" style="
            width:100%;background:#0c0f10;border:1px solid rgba(255,255,255,.11);
            border-radius:7px;color:#e8e0d2;padding:10px 9px;font-size:11px;
          " placeholder="给你的模板起个名字" maxlength="200">
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">描述（可选）</label>
          <textarea id="pvos-sub-desc" style="
            width:100%;min-height:60px;background:#0c0f10;
            border:1px solid rgba(255,255,255,.11);border-radius:7px;
            color:#e8e0d2;padding:10px 9px;font-size:11px;resize:vertical;
          " placeholder="描述这个模板的特点和适用场景..." maxlength="2000"></textarea>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">引用路线（当前）</label>
          <input id="pvos-sub-route" style="
            width:100%;background:#0c0f10;border:1px solid rgba(255,255,255,.11);
            border-radius:7px;color:#e8e0d2;padding:10px 9px;font-size:11px;
          " placeholder="当前路线 ID" readonly>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">Prompt 摘录（可选）</label>
          <textarea id="pvos-sub-prompt" style="
            width:100%;min-height:60px;background:#0c0f10;
            border:1px solid rgba(255,255,255,.11);border-radius:7px;
            color:#e8e0d2;padding:10px 9px;font-size:11px;resize:vertical;
          " placeholder="摘录一段你满意的 Prompt..." maxlength="500"></textarea>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:10px;color:#929a9d;margin-bottom:8px;letter-spacing:.1em">附件（最多 5 个文件，单个最大 8MB）</label>
          <input id="pvos-sub-files" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.json" style="
            width:100%;background:#0c0f10;border:1px solid rgba(255,255,255,.11);
            border-radius:7px;color:#e8e0d2;padding:8px;font-size:11px;
          ">
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input id="pvos-sub-public" type="checkbox" style="accent-color:#a9874b">
            <span style="font-size:11px;color:#aeb4b5;">允许公开候选（不选中则仅后台可见）</span>
          </label>
        </div>
        <button onclick="pvosSubmitSubmission()" style="
          width:100%;padding:12px;background:linear-gradient(135deg,#7b6236,#5f4c2c);
          border:1px solid #967945;border-radius:8px;color:#fff1c7;
          font-size:12px;font-weight:700;cursor:pointer;
        ">提交投稿</button>
        <p style="text-align:center;margin-top:12px;font-size:10px;color:#687174;">
          投稿不会自动进入正式库，需要后台审阅
        </p>
      </div>
    `;
    document.body.appendChild(panel);
  }

  window.pvosOpenFeedback = function() {
    createFeedbackPanel();
    const panel = document.getElementById('pvos-feedback-panel');
    if (panel) {
      panel.style.display = 'flex';
    }
  };

  window.pvosCloseFeedback = function() {
    const panel = document.getElementById('pvos-feedback-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  };

  window.pvosSubmitFeedback = function() {
    const panel = document.getElementById('pvos-feedback-panel');
    const ratingBtn = panel.querySelector('.pvos-fb-rating[data-selected="true"]');
    const rating = ratingBtn ? ratingBtn.dataset.rating : null;
    const issueType = document.getElementById('pvos-fb-issue')?.value || '';
    const comment = document.getElementById('pvos-fb-comment')?.value || '';

    if (!rating) {
      showToast('请选择满意度');
      return;
    }

    const payload = {
      rating: rating,
      issue_type: issueType || null,
      comment: comment || null,
      route_id: window.route ? window.route().id : null,
      text_strategy: window.v5131TextState ? v5131TextState.strategy : null,
      release_version: VERSION,
      session_id: getSessionId()
    };

       fetch(API_BASE + '/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(response => {
      if (!response.ok) {
        showToast('提交失败，请稍后重试');
        return;
      }
      showToast('反馈已提交，感谢你的意见');
      pvosCloseFeedback();
      sendEvent('feedback_submitted', { rating, issue_type: issueType });
    }).catch(() => {
      showToast('提交失败，请稍后重试');
    });
  };

  // ========================================================================
  // Submission UI
  // ========================================================================

  window.pvosOpenSubmission = function() {
    createSubmissionPanel();
    const panel = document.getElementById('pvos-submission-panel');
    if (panel) {
      panel.style.display = 'flex';
      // Pre-fill route if available
      const routeInput = document.getElementById('pvos-sub-route');
      if (routeInput && window.route) {
        routeInput.value = window.route().id || '';
      }
    }
  };

  window.pvosCloseSubmission = function() {
    const panel = document.getElementById('pvos-submission-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  };

  window.pvosSubmitSubmission = function() {
    const title = document.getElementById('pvos-sub-title')?.value?.trim();
    if (!title) {
      showToast('请输入标题');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', document.getElementById('pvos-sub-desc')?.value?.trim() || '');
    formData.append('route_id', document.getElementById('pvos-sub-route')?.value || '');
    formData.append('prompt_excerpt', document.getElementById('pvos-sub-prompt')?.value?.trim() || '');
    formData.append('allow_public_candidate', document.getElementById('pvos-sub-public')?.checked ? 'true' : 'false');

    const fileInput = document.getElementById('pvos-sub-files');
    const files = fileInput?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < Math.min(files.length, 5); i++) {
        formData.append('files', files[i]);
      }
    }

    fetch(API_BASE + '/api/submissions', {
      method: 'POST',
      body: formData
    }).then(response => {
      if (!response.ok) {
        showToast('投稿失败，请稍后重试');
        return;
      }
      showToast('投稿已提交，等待后台审阅');
      pvosCloseSubmission();
      sendEvent('submission_created', { route_id: formData.get('route_id') });
    }).catch(() => {
      showToast('投稿失败，请稍后重试');
    });
  };

  // ========================================================================
  // V5.17 Experience upgrade: simpler first-screen creation flow
  // ========================================================================

  const V517_STYLE_ID = 'v517-experience-upgrade-styles';
  const V517_POSES = [
    { id: 'natural', label: '自然站姿', hint: '稳定清楚，适合作为默认写真起点。', match: ['站', 'standing', 'portrait', 'neutral'] },
    { id: 'turn', label: '回头侧身', hint: '更有故事感，但保持颈线和肩颈自然。', match: ['回头', '侧身', 'turn', 'shoulder'] },
    { id: 'walk', label: '行走抓拍', hint: '让画面像正在发生，适合街头和纪实。', match: ['行走', '走', 'walk', 'street'] },
    { id: 'sit', label: '坐姿松弛', hint: '更安静、更杂志，适合封面与访谈感。', match: ['坐', 'sit', 'seated'] },
    { id: 'stage', label: '舞台动作', hint: '手势和身体更打开，适合演出海报。', match: ['舞台', '音乐', 'guitar', 'stage', 'perform'] },
    { id: 'close', label: '近景看镜头', hint: '强化眼神和脸部可读性。', match: ['看镜头', '直视', 'close', 'gaze', 'camera'] },
  ];

  const V517_SCENES = {
    portrait: { task: 'portrait', title: '高级人物写真', text: '人物叙事', intent: '保留人物辨识度，做一张高级、自然、有呼吸的人像成片。' },
    editorial: { task: 'editorial', title: '杂志封面', text: 'COVER STORY', intent: '人物像杂志封面主角，画面有编辑留白、标题区和清晰视觉层级。' },
    poster: { task: 'experimental', title: '海报大片', text: '视觉海报', intent: '做一张真正具有平面设计骨架的视觉海报：人物、主标题容器、底部信息带、辅助色块和留白形成明确层级；准确文字可在后期叠加。' },
    graduation: { task: 'graduation', title: '毕业纪念', text: '平静高考', intent: '做一张阳光、纪实、带成长感的毕业纪念海报。' },
    wedding: { task: 'wedding', title: '婚礼成片', text: 'WEDDING DAY', intent: '做一张真实亲密、幸福但不俗套的婚礼成片。' },
    stage: { task: 'experimental', title: '演出巡演', text: 'LIVE TOUR', intent: '做一张独立音乐巡演海报，人物姿态更有舞台感和动态。' },
    street: { task: 'portrait', title: '街头电影感', text: 'CITY WALK', intent: '做一张街头电影剧照感的人像，动作自然，环境有叙事。' },
  };
  const V517_TEMPLATES = [
    { id: 'portrait-soft', group: 'portrait', scene: 'portrait', pose: 'natural', textMode: 'reserve-layout', title: '高级人物写真', tag: '稳定起点', text: '人物叙事', brief: '保留人物辨识度，做一张高级、自然、有呼吸的人像成片。', image: 'references/typography_reference_batch02_contact_sheet.jpg' },
    { id: 'editorial-cover', group: 'editorial', scene: 'editorial', pose: 'sit', textMode: 'reserve-layout', title: '杂志封面', tag: '编辑留白', text: 'COVER STORY', brief: '人物像杂志封面主角，画面有编辑留白、标题区和清晰视觉层级。', image: 'references/english-font-batch01/font_batch_contact.jpg' },
    { id: 'poster-title', group: 'poster', scene: 'poster', pose: 'turn', textMode: 'poster-structure', title: '海报大片', tag: '版式骨架', text: '视觉海报', brief: '做一张真正具有平面设计骨架的视觉海报：人物、主标题容器、底部信息带、辅助色块和留白形成明确层级；准确文字可在后期叠加。', image: 'references/typography_reference_batch03_final_contact_sheet.jpg' },
    { id: 'stage-tour', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'poster-structure', title: '演出巡演', tag: '舞台动态', text: 'LIVE TOUR', brief: '做一张独立音乐巡演海报，人物姿态更有舞台感和动态。', image: 'references/english-font-batch01/微信图片_20260603131143_1532_464_thumb.jpg' },
    { id: 'street-film', group: 'street', scene: 'street', pose: 'walk', textMode: 'clean-base', title: '街头电影感', tag: '行走抓拍', text: 'CITY WALK', brief: '做一张街头电影剧照感的人像，动作自然，环境有叙事。', image: 'references/chinese-font-batch01/微信图片_20260603130237_1497_464_thumb.jpg' },
    { id: 'graduation-light', group: 'graduation', scene: 'graduation', pose: 'close', textMode: 'reserve-layout', title: '毕业纪念', tag: '阳光纪实', text: '平静高考', brief: '做一张阳光、纪实、带成长感的毕业纪念海报。', image: 'references/chinese-font-batch02/微信图片_20260603130233_1493_464_thumb.jpg' },
    { id: 'wedding-real', group: 'wedding', scene: 'wedding', pose: 'natural', textMode: 'reserve-layout', title: '婚礼成片', tag: '真实亲密', text: 'WEDDING DAY', brief: '做一张真实亲密、幸福但不俗套的婚礼成片。', image: 'references/typography-relation-batch01/微信图片_20260603131140_1529_464_thumb.jpg' },
  ];
  const V6_STYLE_TARGET_PER_GROUP = 12;
  const V517_CURATED_STYLE_VARIANTS = [
    ...V517_TEMPLATES,
    { id: 'portrait-clean-luxury', group: 'portrait', scene: 'portrait', pose: 'close', textMode: 'reserve-layout', title: '干净奢感肖像', tag: '近景眼神', text: 'PORTRAIT', brief: '做一张更克制、更奢侈品广告感的人像，脸部清楚，背景干净，眼神自然。' },
    { id: 'portrait-film-still', group: 'portrait', scene: 'portrait', pose: 'turn', textMode: 'clean-base', title: '电影剧照肖像', tag: '叙事光影', text: 'STILL FRAME', brief: '让人物像电影剧照主角，保留辨识度，姿势更松弛，光线有故事。' },
    { id: 'editorial-minimal', group: 'editorial', scene: 'editorial', pose: 'natural', textMode: 'reserve-layout', title: '极简封面', tag: '大留白', text: 'MINIMAL ISSUE', brief: '做一张极简杂志封面底图，大面积留白，人物稳定高级，文字后期排版。' },
    { id: 'editorial-bold-type', group: 'editorial', scene: 'editorial', pose: 'sit', textMode: 'poster-structure', title: '大字封面', tag: '刊头结构', text: 'COVER STORY', brief: '让画面有强刊头结构和杂志层级，但不要让文字遮挡脸部。' },
    { id: 'poster-cinematic', group: 'poster', scene: 'poster', pose: 'walk', textMode: 'reserve-layout', title: '电影海报', tag: '大片留白', text: 'COMING SOON', brief: '做一张电影海报式人物成片，主体清晰，标题区域明确，光影有戏剧感。' },
    { id: 'poster-graphic', group: 'poster', scene: 'poster', pose: 'turn', textMode: 'poster-structure', title: '图形海报', tag: '结构参与', text: 'VISUAL POSTER', brief: '做一张图形感更强的海报，允许抽象排版结构参与，但脸部必须干净可读。' },
    { id: 'stage-backstage', group: 'stage', scene: 'stage', pose: 'walk', textMode: 'clean-base', title: '后台纪实', tag: '纪实抓拍', text: 'BACKSTAGE', brief: '做一张后台纪实感演出照片，人物像刚下台或上场前，动态自然。' },
    { id: 'stage-spotlight', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'reserve-layout', title: '聚光灯舞台', tag: '强舞台光', text: 'SPOTLIGHT', brief: '做一张聚光灯下的舞台海报，动作打开，眼神有生命力，反光不过度。' },
    { id: 'street-night', group: 'street', scene: 'street', pose: 'walk', textMode: 'clean-base', title: '夜街电影感', tag: '夜景氛围', text: 'NIGHT WALK', brief: '做一张夜晚街头电影感人像，霓虹和环境参与叙事，但人物脸部保持自然。' },
    { id: 'street-cafe', group: 'street', scene: 'street', pose: 'sit', textMode: 'reserve-layout', title: '咖啡馆纪实', tag: '生活切片', text: 'CITY NOTE', brief: '做一张咖啡馆或城市生活切片人像，姿势松弛，画面安静耐看。' },
    { id: 'graduation-campus', group: 'graduation', scene: 'graduation', pose: 'walk', textMode: 'reserve-layout', title: '校园长廊', tag: '青春纪实', text: 'GRADUATION', brief: '做一张校园长廊或操场边的毕业纪念照，阳光自然，不要模板感。' },
    { id: 'graduation-poster', group: 'graduation', scene: 'graduation', pose: 'close', textMode: 'poster-structure', title: '毕业海报', tag: '成长标题', text: '平静高考', brief: '做一张可加标题的毕业成长海报，人物眼神清楚，情绪平静有力量。' },
    { id: 'wedding-editorial', group: 'wedding', scene: 'wedding', pose: 'natural', textMode: 'reserve-layout', title: '婚礼杂志感', tag: '克制高级', text: 'WEDDING DAY', brief: '做一张婚礼杂志感成片，真实亲密但不俗套，留出准确文字排版区。' },
    { id: 'wedding-candid', group: 'wedding', scene: 'wedding', pose: 'walk', textMode: 'clean-base', title: '婚礼抓拍', tag: '真实瞬间', text: 'OUR DAY', brief: '做一张真实婚礼抓拍，动作像正在发生，表情自然，避免摆拍僵硬。' },
    { id: 'portrait-direct-flash', group: 'portrait', scene: 'portrait', pose: 'natural', textMode: 'clean-base', title: '直闪真实肖像', tag: '真实质感', text: 'REAL FACE', brief: '做一张直闪但不过曝的人像，皮肤真实、眼睛清楚，避免玻璃反光抢戏。' },
    { id: 'portrait-shadow-drama', group: 'portrait', scene: 'portrait', pose: 'turn', textMode: 'reserve-layout', title: '光影侧脸', tag: '轮廓叙事', text: 'SHADOW LINE', brief: '用侧向光和干净暗部塑造脸部轮廓，保留五官，不把人物做成硬摆拍。' },
    { id: 'portrait-room-documentary', group: 'portrait', scene: 'portrait', pose: 'sit', textMode: 'clean-base', title: '房间纪实', tag: '生活现场', text: 'ROOM NOTE', brief: '做一张室内生活现场感肖像，环境有细节但不乱，人物姿态自然。' },
    { id: 'editorial-interview', group: 'editorial', scene: 'editorial', pose: 'sit', textMode: 'reserve-layout', title: '人物专访', tag: '编辑叙事', text: 'INTERVIEW', brief: '做一张人物专访封面底图，姿态沉稳，标题区明确，适合后期放长标题。' },
    { id: 'editorial-fashion-page', group: 'editorial', scene: 'editorial', pose: 'turn', textMode: 'poster-structure', title: '时装内页', tag: '姿态结构', text: 'LOOK BOOK', brief: '做一张时装杂志内页感人物图，姿势更有线条，背景克制，文字不压脸。' },
    { id: 'editorial-clean-newsstand', group: 'editorial', scene: 'editorial', pose: 'close', textMode: 'reserve-layout', title: '报刊封面', tag: '清晰刊面', text: 'FRONT PAGE', brief: '做一张报刊封面式人像，层级清楚，留出刊头和副标题空间。' },
    { id: 'poster-minimal-symbol', group: 'poster', scene: 'poster', pose: 'natural', textMode: 'reserve-layout', title: '符号极简海报', tag: '强符号', text: 'SIGNAL', brief: '做一张更克制的符号化海报，人物和一个核心视觉符号形成记忆点。' },
    { id: 'poster-exhibition', group: 'poster', scene: 'poster', pose: 'sit', textMode: 'poster-structure', title: '展览海报', tag: '平面秩序', text: 'EXHIBITION', brief: '做一张展览主视觉海报，人物像展品或策展对象，画面有平面设计秩序。' },
    { id: 'poster-neo-noir', group: 'poster', scene: 'poster', pose: 'walk', textMode: 'clean-base', title: '新黑色大片', tag: '冷暖冲突', text: 'NOIR', brief: '做一张新黑色电影海报，冷暖光冲突明显，人物轮廓清楚，脸部不过暗。' },
    { id: 'stage-rehearsal', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'clean-base', title: '排练现场', tag: '未完成感', text: 'REHEARSAL', brief: '做一张排练室或空舞台现场感照片，动作真实，情绪集中，不要商业棚拍感。' },
    { id: 'stage-festival-poster', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'poster-structure', title: '音乐节主视觉', tag: '大场景', text: 'FESTIVAL', brief: '做一张音乐节主视觉，人物和舞台气氛同时成立，保留大标题区域。' },
    { id: 'stage-vinyl-cover', group: 'stage', scene: 'stage', pose: 'natural', textMode: 'reserve-layout', title: '唱片封面', tag: '专辑感', text: 'SIDE A', brief: '做一张唱片封面式人物图，构图方正、情绪集中，适合后期放专辑标题。' },
    { id: 'street-rain-window', group: 'street', scene: 'street', pose: 'close', textMode: 'clean-base', title: '雨窗街景', tag: '湿润反光', text: 'RAIN NOTE', brief: '做一张雨天窗边或街口电影感人像，反光克制，脸部和眼神保持清楚。' },
    { id: 'street-subway-frame', group: 'street', scene: 'street', pose: 'walk', textMode: 'reserve-layout', title: '地铁抓拍', tag: '城市节奏', text: 'SUBWAY', brief: '做一张地铁或站台抓拍感人像，运动中保持清晰，环境线条形成节奏。' },
    { id: 'street-bookstore', group: 'street', scene: 'street', pose: 'sit', textMode: 'clean-base', title: '书店切片', tag: '安静叙事', text: 'BOOK SHOP', brief: '做一张书店或小店生活切片，人物松弛，背景细节服务情绪。' },
    { id: 'graduation-library', group: 'graduation', scene: 'graduation', pose: 'sit', textMode: 'reserve-layout', title: '图书馆毕业照', tag: '安静成长', text: 'THE LAST PAGE', brief: '做一张图书馆或教室毕业纪念照，克制、干净、有结束和开始的感觉。' },
    { id: 'graduation-sunset-field', group: 'graduation', scene: 'graduation', pose: 'walk', textMode: 'clean-base', title: '操场黄昏', tag: '青春余晖', text: 'AFTER SCHOOL', brief: '做一张操场黄昏毕业照，逆光自然，动作像正在离开校园。' },
    { id: 'graduation-certificate-cover', group: 'graduation', scene: 'graduation', pose: 'close', textMode: 'poster-structure', title: '证书封面感', tag: '正式纪念', text: 'CLASS OF', brief: '做一张正式但不僵硬的毕业纪念封面，脸部清楚，标题区规整。' },
    { id: 'wedding-film-couple', group: 'wedding', scene: 'wedding', pose: 'walk', textMode: 'clean-base', title: '胶片婚礼', tag: '温柔颗粒', text: 'FILM LOVE', brief: '做一张胶片质感婚礼抓拍，暖色不过腻，动作自然，人物关系真实。' },
    { id: 'wedding-vow-close', group: 'wedding', scene: 'wedding', pose: 'close', textMode: 'reserve-layout', title: '誓言近景', tag: '情绪近景', text: 'I DO', brief: '做一张婚礼誓言或交换戒指前后的近景，表情自然，不要机械复刻。' },
    { id: 'wedding-night-banquet', group: 'wedding', scene: 'wedding', pose: 'natural', textMode: 'poster-structure', title: '夜宴婚礼', tag: '灯光氛围', text: 'TONIGHT', brief: '做一张夜宴婚礼成片，灯光有氛围但不过度，人物肤色和身材比例自然。' },
    { id: 'portrait-aperture-focus', group: 'portrait', scene: 'portrait', pose: 'close', textMode: 'reserve-layout', title: '窄框聚焦肖像', tag: '局部裁切', text: 'FOCUS', brief: '借鉴窄框聚焦和眼神窗口逻辑，让脸部成为中心，边缘裁切克制，不破坏五官。' },
    { id: 'portrait-archive-grid', group: 'portrait', scene: 'portrait', pose: 'natural', textMode: 'poster-structure', title: '档案网格肖像', tag: '理性秩序', text: 'ARCHIVE', brief: '用档案网格和小标签建立理性气质，人物保持完整，不让数据感压过脸。' },
    { id: 'portrait-warm-sepia', group: 'portrait', scene: 'portrait', pose: 'sit', textMode: 'clean-base', title: '暖褐记忆肖像', tag: '城市剪影', text: 'MEMORY', brief: '做一张暖褐城市记忆感肖像，背景像旧照片里的地点，表情自然不僵。' },
    { id: 'portrait-ink-engraved', group: 'portrait', scene: 'portrait', pose: 'turn', textMode: 'reserve-layout', title: '雕版人物图腾', tag: '古典纹理', text: 'TOTEM', brief: '把古典雕版纹理作为背景秩序，不直接覆盖脸部，保留人物的真实皮肤和眼神。' },
    { id: 'editorial-newsprint-sunburst', group: 'editorial', scene: 'editorial', pose: 'natural', textMode: 'poster-structure', title: '报纸放射封面', tag: '复古刊面', text: 'SPECIAL ISSUE', brief: '借鉴报纸放射线和复古印刷，建立封面张力，标题区明确但不烧字。' },
    { id: 'editorial-type-mask', group: 'editorial', scene: 'editorial', pose: 'close', textMode: 'poster-structure', title: '字体镂空封面', tag: '文字结构', text: 'PROFILE', brief: '允许大字形作为构图结构，但只做空间关系，准确文字仍交给排版层。' },
    { id: 'editorial-brutalist-bio', group: 'editorial', scene: 'editorial', pose: 'sit', textMode: 'reserve-layout', title: '传记海报封面', tag: '粗野排版', text: 'BIOGRAPHY', brief: '做一张人物传记封面，排版更硬朗，画面有重量，人物姿态稳。' },
    { id: 'editorial-luxury-ligature', group: 'editorial', scene: 'editorial', pose: 'turn', textMode: 'reserve-layout', title: '轻奢连字封面', tag: '品牌感', text: 'LIGATURE', brief: '借鉴轻奢连字和高反差衬线气质，画面干净、有品牌封面感。' },
    { id: 'poster-torn-mosaic', group: 'poster', scene: 'poster', pose: 'turn', textMode: 'poster-structure', title: '撕裂马赛克海报', tag: '拼贴冲击', text: 'MOSAIC', brief: '用撕裂拼贴和马赛克碎片制造冲击，但人物关键脸部区域必须可读。' },
    { id: 'poster-halftone-dossier', group: 'poster', scene: 'poster', pose: 'close', textMode: 'reserve-layout', title: '网点档案海报', tag: '红黑档案', text: 'DOSSIER', brief: '借鉴网点碎片和档案海报，形成强视觉记忆，避免把文字索引写进 Prompt。' },
    { id: 'poster-eye-focus', group: 'poster', scene: 'poster', pose: 'close', textMode: 'poster-structure', title: '眼神聚焦海报', tag: '局部强记忆', text: 'EYE LINE', brief: '以眼神和局部裁切为核心，海报结构强，但表情不夸张、不诡异。' },
    { id: 'poster-woodcut-punk', group: 'poster', scene: 'poster', pose: 'stage', textMode: 'clean-base', title: '朋克木刻海报', tag: '粗粝线条', text: 'PUNK CUT', brief: '用木刻和朋克线条增加力量感，只作为背景和轮廓语言，不覆盖面部识别。' },
    { id: 'stage-rock-brush', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'poster-structure', title: '摇滚笔刷舞台', tag: '粗粝边缘', text: 'RANGER', brief: '借鉴摇滚笔刷和速度感字体气质，人物动作打开，边缘粗粝但脸部干净。' },
    { id: 'stage-neon-club', group: 'stage', scene: 'stage', pose: 'walk', textMode: 'clean-base', title: '霓虹俱乐部', tag: '夜场动线', text: 'NEON CLUB', brief: '做一张夜场或 Livehouse 氛围图，灯光有层次，不让玻璃反光和雾效抢戏。' },
    { id: 'stage-crowd-silhouette', group: 'stage', scene: 'stage', pose: 'stage', textMode: 'reserve-layout', title: '人群剪影舞台', tag: '大场面', text: 'CROWD', brief: '人物与远处观众或灯阵形成舞台尺度，主体比例稳定，不做夸张身材。' },
    { id: 'stage-ticket-poster', group: 'stage', scene: 'stage', pose: 'natural', textMode: 'poster-structure', title: '票根巡演海报', tag: '票据结构', text: 'TICKET', brief: '借鉴票根和巡演信息层级，只生成结构和留白，不渲染精确小字。' },
    { id: 'street-hongkong-night', group: 'street', scene: 'street', pose: 'walk', textMode: 'clean-base', title: '港风夜街', tag: '招牌氛围', text: 'HK NIGHT', brief: '做一张港风夜街人像，招牌和湿地反光服务氛围，但不要复制可读商标。' },
    { id: 'street-candid-direct-flash', group: 'street', scene: 'street', pose: 'natural', textMode: 'clean-base', title: '街拍直闪', tag: '即时真实', text: 'SNAP', brief: '像真实街拍快照，直闪有冲击但不过曝，身体比例和表情保持自然。' },
    { id: 'street-phone-booth', group: 'street', scene: 'street', pose: 'close', textMode: 'reserve-layout', title: '电话亭切片', tag: '城市道具', text: 'CALLING', brief: '用电话亭、橱窗或街边小道具建立叙事，人物不是摆拍广告。' },
    { id: 'street-crosswalk-grid', group: 'street', scene: 'street', pose: 'walk', textMode: 'poster-structure', title: '斑马线网格', tag: '几何节奏', text: 'CROSSWALK', brief: '把斑马线、路灯和建筑线条变成构图节奏，人物行走自然清楚。' },
    { id: 'graduation-newspaper-cover', group: 'graduation', scene: 'graduation', pose: 'natural', textMode: 'poster-structure', title: '毕业报刊封面', tag: '纪念专刊', text: 'CLASS NEWS', brief: '做一张毕业专刊封面，像校园报纸或纪念册首页，文字区规整。' },
    { id: 'graduation-friends-montage', group: 'graduation', scene: 'graduation', pose: 'walk', textMode: 'reserve-layout', title: '同窗蒙太奇', tag: '群像记忆', text: 'TOGETHER', brief: '适合多人或朋友毕业照，画面有蒙太奇感但每张脸都要清楚自然。' },
    { id: 'graduation-blue-hour', group: 'graduation', scene: 'graduation', pose: 'sit', textMode: 'clean-base', title: '蓝调放学后', tag: '安静夜色', text: 'BLUE HOUR', brief: '用傍晚蓝调和校园灯光营造结束感，情绪安静，不做过度煽情。' },
    { id: 'graduation-floral-border', group: 'graduation', scene: 'graduation', pose: 'close', textMode: 'reserve-layout', title: '花边纪念册', tag: '轻量边框', text: 'YEARBOOK', brief: '借鉴轻花边和纪念册排版，边框不压人物，适合后期放祝福文案。' },
    { id: 'graduation-torn-memory', group: 'graduation', scene: 'graduation', pose: 'walk', textMode: 'poster-structure', title: '撕纸青春纪念', tag: '拼贴回忆', text: 'YOUTH MEMORY', brief: '用轻量撕纸和相册拼贴感表现毕业回忆，人物表情自然，标题区留给后期排版。' },
    { id: 'wedding-old-money', group: 'wedding', scene: 'wedding', pose: 'natural', textMode: 'reserve-layout', title: '老钱婚礼肖像', tag: '克制礼服', text: 'VOWS', brief: '做一张克制高级的婚礼肖像，礼服质感真实，背景干净但不空。' },
    { id: 'wedding-garden-walk', group: 'wedding', scene: 'wedding', pose: 'walk', textMode: 'clean-base', title: '花园行走抓拍', tag: '自然亲密', text: 'GARDEN', brief: '在花园或户外自然光里行走，亲密感来自动作，不靠夸张表情。' },
    { id: 'wedding-red-room', group: 'wedding', scene: 'wedding', pose: 'sit', textMode: 'poster-structure', title: '红室婚礼大片', tag: '东方氛围', text: 'RED ROOM', brief: '用红色空间和礼序感制造东方婚礼氛围，肤色自然，画面不过俗。' },
    { id: 'wedding-invitation-cover', group: 'wedding', scene: 'wedding', pose: 'close', textMode: 'reserve-layout', title: '请柬封面感', tag: '留白优雅', text: 'INVITATION', brief: '做一张适合请柬或婚礼封面的留白人像，后期排版空间明确。' },
  ];
  const V6_GROUP_ROUTE_RULES = {
    portrait: [/人像|肖像|眼神|面部|人物|身份|档案|传记|图腾/],
    editorial: [/杂志|封面|编辑|报刊|专访|时装|刊|品牌|轻奢/],
    poster: [/海报|拼贴|撕|网点|镂空|木刻|大片|观念|主视觉|符号/],
    stage: [/演出|舞台|音乐|巡演|唱片|票根|摇滚|live|festival|club/i],
    street: [/街|城市|地铁|站台|咖啡|书店|雨|港|橱窗|抓拍/],
    graduation: [/毕业|校园|同窗|高考|纪念|操场|图书馆|教室|青春/],
    wedding: [/婚礼|婚恋|情侣|誓言|请柬|礼服|花园|夜宴|亲密/],
  };
  const V6_GROUP_TEXT = {
    portrait: 'PORTRAIT',
    editorial: 'COVER STORY',
    poster: 'VISUAL POSTER',
    stage: 'LIVE TOUR',
    street: 'CITY WALK',
    graduation: 'GRADUATION',
    wedding: 'WEDDING DAY',
  };
  const V6_GROUP_SCENE = {
    portrait: 'portrait',
    editorial: 'editorial',
    poster: 'poster',
    stage: 'stage',
    street: 'street',
    graduation: 'graduation',
    wedding: 'wedding',
  };

  // Quick-create cards must resolve to a real canonical route.  Without this
  // binding the card title can diverge from the compiled prompt and silently
  // inherit whichever route happened to be active before the click.
  const V6_GROUP_DEFAULT_ROUTE_ID = {
    portrait: 'airy-afternoon-mag',
    editorial: 'b02-cream-serif-clean-cover',
    poster: 'u-torn-mosaic',
    stage: 'm-live-typewall',
    street: 'b03-hk-neon-alley-fashion',
    graduation: 'graduation-sunlit-campus-documentary',
    wedding: 'love-archival',
  };
  const V6_GROUP_TYPOGRAPHY_PACK_IDS = {
    portrait: ['en-editorial-high-contrast-serif', 'cn-editorial-cyan-poetry'],
    editorial: ['en-luxury-ligature-display', 'cn-seal-caption-kit'],
    poster: ['en-red-kinetic-fashion-poster', 'cn-seal-caption-kit'],
    stage: ['en-brush-rock-script', 'en-motionblur-editorial-microtype'],
    street: ['en-street-facade-margin-caption', 'en-handwritten-diary-marker'],
    graduation: ['en-seasonal-soft-caption', 'cn-editorial-cyan-poetry'],
    wedding: ['en-romantic-swirl-serif', 'cn-seal-caption-kit'],
  };
  const V6_CURATED_ROUTE_ID_BY_STYLE = {
    'portrait-soft': 'airy-afternoon-mag',
    'portrait-clean-luxury': 'b02-cream-serif-clean-cover',
    'portrait-film-still': 'u-sepia-memory',
    'portrait-direct-flash': 'b03-hk-neon-alley-fashion',
    'portrait-shadow-drama': 'u-aperture',
    'portrait-room-documentary': 'male-window-morning-lifestyle',
    'portrait-aperture-focus': 'u-aperture',
    'portrait-archive-grid': 'm-archive-grid',
    'portrait-warm-sepia': 'u-sepia-memory',
    'portrait-ink-engraved': 'm-literary-prop',
    'editorial-cover': 'b02-cream-serif-clean-cover',
    'editorial-minimal': 'b02-cream-serif-clean-cover',
    'editorial-bold-type': 'u-type-mask',
    'editorial-interview': 'm-brutalist-bio',
    'editorial-fashion-page': 'colorfield-fashion-cover',
    'editorial-clean-newsstand': 'hk-vintage-magazine',
    'editorial-newsprint-sunburst': 'hk-vintage-magazine',
    'editorial-type-mask': 'u-type-mask',
    'editorial-brutalist-bio': 'm-brutalist-bio',
    'editorial-luxury-ligature': 'b02-cream-serif-clean-cover',
    'poster-title': 'u-type-mask',
    'poster-cinematic': 'm-noir-icon',
    'poster-graphic': 'u-type-mask',
    'poster-minimal-symbol': 'm-noir-icon',
    'poster-exhibition': 'm-brutalist-bio',
    'poster-neo-noir': 'm-noir-icon',
    'poster-torn-mosaic': 'u-torn-mosaic',
    'poster-halftone-dossier': 'u-halftone-dossier',
    'poster-eye-focus': 'u-eye-focus',
    'poster-woodcut-punk': 'm-ochre-story',
    'stage-tour': 'b05-forest-road-indie-tour-poster',
    'stage-backstage': 'b03-retro-underground-gig-poster',
    'stage-spotlight': 'm-live-typewall',
    'stage-rehearsal': 'b03-retro-underground-gig-poster',
    'stage-festival-poster': 'm-live-typewall',
    'stage-vinyl-cover': 'b05-darkglass-music-daily-cover',
    'stage-rock-brush': 'm-live-typewall',
    'stage-neon-club': 'b03-retro-underground-gig-poster',
    'stage-crowd-silhouette': 'm-live-typewall',
    'stage-ticket-poster': 'b03-retro-underground-gig-poster',
    'street-film': 'b03-hk-neon-alley-fashion',
    'street-night': 'b03-hk-neon-alley-fashion',
    'street-cafe': 'female-cafe-window-refined-editorial',
    'street-rain-window': 'b02-neon-rainy-shopwindow',
    'street-subway-frame': 'male-night-neon-transit-film',
    'street-bookstore': 'male-bookstore-headphones-lifestyle',
    'street-hongkong-night': 'b03-hk-neon-alley-fashion',
    'street-candid-direct-flash': 'b03-hk-neon-alley-fashion',
    'street-phone-booth': 'male-90s-graffiti-camera-street',
    'street-crosswalk-grid': 'male-night-neon-transit-film',
    'graduation-light': 'graduation-sunlit-campus-documentary',
    'graduation-campus': 'graduation-sunlit-campus-documentary',
    'graduation-poster': 'graduation-sunlit-campus-documentary',
    'graduation-library': 'graduation-campus-memory-film',
    'graduation-sunset-field': 'graduation-forest-poetic',
    'graduation-certificate-cover': 'graduation-architectural-quiet',
    'graduation-newspaper-cover': 'graduation-campus-memory-film',
    'graduation-friends-montage': 'graduation-sunlit-campus-documentary',
    'graduation-blue-hour': 'graduation-campus-memory-film',
    'graduation-floral-border': 'graduation-forest-poetic',
    'graduation-torn-memory': 'graduation-campus-memory-film',
    'wedding-real': 'love-archival',
    'wedding-editorial': 'love-newspaper',
    'wedding-candid': 'cn-wedding-room-candid',
    'wedding-film-couple': 'love-openfield',
    'wedding-vow-close': 'love-archival',
    'wedding-night-banquet': 'cn-wedding-red-studio-classic',
    'wedding-old-money': 'cn-wedding-brocade-editorial',
    'wedding-garden-walk': 'love-openfield',
    'wedding-red-room': 'cn-wedding-red-studio-classic',
    'wedding-invitation-cover': 'love-painted',
  };

  function v517CanonicalRouteExists(routeId) {
    return !!(routeId && Array.isArray(window.PVOS_LIBRARY?.styles)
      && window.PVOS_LIBRARY.styles.some((route) => route.id === routeId));
  }

  function v517ResolveRouteForStyle(item) {
    const preferred = item?.routeId || V6_CURATED_ROUTE_ID_BY_STYLE[item?.id] || V6_GROUP_DEFAULT_ROUTE_ID[item?.group];
    if (v517CanonicalRouteExists(preferred)) return preferred;
    const routes = Array.isArray(window.PVOS_LIBRARY?.styles) ? window.PVOS_LIBRARY.styles : [];
    const group = item?.group || 'portrait';
    const fallback = routes.find((route) => v517RouteGroup(route) === group);
    return fallback?.id || routes[0]?.id || '';
  }
  const V6_ROUTE_PICK_LIMIT = 220;
  const V517_RELATION_LABELS = {
    'independent-layout': '独立排版',
    'background-anchor': '背景衬底',
    'interleaved-subject': '与人物穿插',
    'subject-mask': '人物镂空',
    'ink-overlay': '墨迹覆盖',
  };
  const V517_STRATEGY_HEADINGS = {
    clean: 'TEXT PARTICIPATION STRATEGY — CLEAN IMAGE BASE',
    'reserve-space': 'TEXT PARTICIPATION STRATEGY — RESERVE SPACE WITHOUT RENDERING',
    'poster-layout': 'TEXT PARTICIPATION STRATEGY — POSTER STRUCTURE WITHOUT READABLE COPY',
    'decorative-glyph': 'TEXT PARTICIPATION STRATEGY — DECORATIVE GLYPH TEXTURE',
    'integrated-text': 'TEXT PARTICIPATION STRATEGY — INTEGRATE USER-SPECIFIED COPY',
    'free-experiment': 'TEXT PARTICIPATION STRATEGY — FREE TYPOGRAPHIC EXPERIMENT',
  };
  const V6_PROMPT_QUALITY_SECTIONS = [
    'reference-role',
    'identity-expression-gaze',
    'body-pose-anatomy',
    'scene-composition-light',
    'typography-intent',
    'negative-constraints',
    'final-priority',
  ];
  const V6_COMPONENT_STACK_IDS = ['scenePreset', 'propPreset', 'layoutModule', 'lightingPreset'];

  function v517InjectStyles() {
    if (document.getElementById(V517_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = V517_STYLE_ID;
    style.textContent = `
      .v517-shell{--paper:#eee7d8;--ink:#1a0b08;--line:rgba(238,231,216,.16);--line-strong:rgba(216,179,95,.46);--muted:#9da89f;--accent:#d8b35f;--cyan:#6fb7bd;--rust:#b46a4f;grid-column:1/-1;position:relative;margin:0;border:1px solid var(--line-strong);background:#0f100d;color:#eee7d8;box-shadow:0 24px 80px rgba(0,0,0,.34);height:calc(100vh - 56px);min-height:0;overflow:hidden}
      .v517-shell:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(238,231,216,.055) 1px,transparent 1px),linear-gradient(180deg,rgba(238,231,216,.045) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(180deg,rgba(0,0,0,.68),transparent 64%);opacity:.55}
      .v517-shell:after{content:"PVOS";position:absolute;right:18px;bottom:-44px;font-family:Impact,"Arial Black",sans-serif;font-size:128px;line-height:1;color:rgba(238,231,216,.035);pointer-events:none}
      .v517-head{position:relative;z-index:1;display:grid;grid-template-columns:1fr auto;align-items:stretch;border-bottom:1px solid var(--line);height:92px;min-height:0;overflow:hidden}
      .v517-head-main{padding:12px 18px;display:grid;align-content:center}
      .v517-kicker{font-size:10px;letter-spacing:.18em;color:#8fc5c8;text-transform:uppercase}
      .v517-head h2{margin:2px 0 0;font-family:Georgia,"Times New Roman","Songti SC",serif;font-size:clamp(24px,2.6vw,38px);font-weight:900;line-height:.96;color:#f2dfb4;letter-spacing:0}
      .v517-head p{margin:5px 0 0;color:#a6b0a7;font-size:11px;line-height:1.35;max-width:720px}
      .v517-actions{display:grid;grid-auto-flow:column;align-items:stretch;border-left:1px solid var(--line)}
      .v517-actions .btn{height:100%;min-width:132px;border:0;border-radius:0;background:transparent;color:#eee7d8;border-left:1px solid var(--line)}
      .v517-layout{position:relative;z-index:1;display:grid;grid-template-columns:minmax(260px,21vw) minmax(520px,1fr) minmax(320px,24vw);height:calc(100% - 92px);min-height:0}
      .v517-panel{min-width:0;min-height:0;height:100%;border-right:1px solid var(--line);background:rgba(15,16,13,.74);overflow:hidden}
      .v517-panel:last-child{border-right:0}
      .v517-panel h3,.v517-template-head h3,.v517-control-panel h3{margin:0;color:#d8b35f;font-size:11px;letter-spacing:.16em;text-transform:uppercase}
      .v517-intent-panel{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto}
      .v517-rail-block{padding:10px 12px;border-bottom:1px solid var(--line)}
      .v517-section-note{margin:5px 0 8px;color:#9ba79f;font-size:10px;line-height:1.35}
      .v517-field{display:grid;gap:5px;margin-bottom:9px}.v517-hidden-field{display:none!important}
      .v517-field label{font-size:10px;letter-spacing:.08em;color:#97aaa4}
      .v517-field select,.v517-field textarea,.v517-field input{width:100%;background:#0b0c0a;border:1px solid rgba(238,231,216,.16);color:#f1eadb;padding:8px;font-size:12px;outline:none;border-radius:0}
      .v517-field textarea{min-height:64px;resize:vertical;line-height:1.45}
      .v517-template-reference-control{margin-top:9px;padding-top:8px;border-top:1px solid var(--line)}.v517-template-reference-control .v517-section-note{display:block;margin:5px 0 0}.v517-template-reference-control .v517-seg{font-size:10px}
      .v517-field select:focus,.v517-field textarea:focus,.v517-field input:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(216,179,95,.12)}
      .v517-flow{display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px 10px;border-top:1px solid var(--line)}
      .v517-flow div{border:1px solid var(--line);padding:7px;min-height:42px;background:rgba(238,231,216,.025)}
      .v517-flow b{display:block;color:#70b7bb;font-size:9px;margin-bottom:2px}.v517-flow span{display:block;color:#eee7d8;font-size:11px;line-height:1.15}.v517-flow small{display:none;color:#8f9e98;font-size:10px;line-height:1.35;margin-top:2px}
      .v517-template-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
      .v517-template-head span{font-size:10px;color:#8fa39d;text-align:right}
      .v517-template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
      .v517-template{position:relative;min-height:48px;border:1px solid rgba(238,231,216,.13);background:#11120f!important;overflow:hidden;cursor:pointer;text-align:left;color:#fff;padding:8px;display:flex;flex-direction:column;justify-content:center}
      .v517-template:first-child{grid-column:auto;min-height:48px}
      .v517-template:before{display:none}
      .v517-template>*{position:relative}.v517-template b{font-size:11px;line-height:1.2;padding-right:34px}.v517-template small{margin-top:2px;color:#e5c783;font-size:9px}.v517-template span{display:none;margin-top:3px;color:#c8d3cf;font-size:10px;line-height:1.35}
      .v517-template.active{box-shadow:inset 3px 0 0 var(--accent);background-color:#181510}
      .v517-template-count{position:absolute;right:6px;top:6px;z-index:1;border:1px solid rgba(238,231,216,.22);background:rgba(6,9,9,.68);color:#e9d7a1;font-size:8px;padding:2px 4px}
      .v517-template-panel{display:grid;grid-template-rows:minmax(240px,42%) auto minmax(0,1fr);background:#11120f}
      .v517-stage{position:relative;overflow:hidden;border-bottom:1px solid var(--line);min-height:0;background:#eee7d8;color:#1a0b08}
      .v517-stage-image{position:absolute;inset:0;background-image:var(--v517-stage-image);background-size:cover;background-position:center;filter:saturate(.72) contrast(1.08);opacity:.18}
      .v517-stage-lines{position:absolute;inset:-6% -5%;background:repeating-linear-gradient(92deg,transparent 0 13px,rgba(26,11,8,.58) 14px 15px,transparent 16px 25px);transform:skewX(-7deg);opacity:.72;mask-image:radial-gradient(circle at 48% 44%,transparent 0 16%,#000 18% 100%)}
      .v517-stage-lines:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 42% 45%,transparent 0 23%,rgba(238,231,216,.65) 24% 27%,transparent 29%),radial-gradient(ellipse at 68% 32%,transparent 0 18%,rgba(238,231,216,.44) 19% 22%,transparent 24%)}
      .v517-stage-top{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:1fr auto;border-bottom:1px solid rgba(26,11,8,.72);background:rgba(238,231,216,.72);backdrop-filter:blur(2px)}
      .v517-stage-top span{padding:9px 12px;border-right:1px solid rgba(26,11,8,.72);font-size:10px;letter-spacing:.18em;text-transform:uppercase}
      .v517-stage-title{position:absolute;left:24px;right:24px;bottom:50px;font-family:Impact,"Arial Black","Microsoft YaHei",sans-serif;font-size:clamp(52px,8vw,116px);line-height:.88;color:#1a0b08;text-transform:uppercase}
      .v517-stage-caption{position:absolute;left:24px;right:24px;bottom:18px;display:flex;gap:14px;align-items:center;color:#1a0b08;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
      .v517-stage-caption:before,.v517-stage-caption:after{content:"";height:1px;background:rgba(26,11,8,.72);flex:1}
      .v517-stage-meta{position:absolute;right:18px;top:56px;max-width:220px;color:#1a0b08;font-size:12px;line-height:1.5;text-align:right}
      .v517-style-panel{display:grid;grid-template-rows:auto 1fr;min-height:0}
      .v517-style-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line)}
      .v517-style-head b{font-size:11px;color:#d8b35f;letter-spacing:.14em;text-transform:uppercase}.v517-style-head span{font-size:10px;color:#829693;text-align:right}
      .v517-style-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;overflow:auto}
      .v517-style-card{min-height:86px;border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(238,231,216,.025);color:#dfe8e5;text-align:left;padding:9px;cursor:pointer}
      .v517-style-card:nth-child(3n){border-right:0}
      .v517-style-card b{display:block;color:#f0deb2;font-size:12px;line-height:1.2;margin-bottom:4px}.v517-style-card small{display:block;color:#95c3c5;font-size:9px;margin-bottom:5px}.v517-style-card span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#96a6a3;font-size:10px;line-height:1.35}
      .v517-style-card.active{background:rgba(216,179,95,.13);box-shadow:inset 0 0 0 1px rgba(216,179,95,.48)}
      .v517-output-panel{display:grid;grid-template-rows:auto auto 1fr auto;border-color:rgba(216,179,95,.24);background:#12110d}
      .v517-inspector-block{padding:10px 12px;border-bottom:1px solid var(--line)}
      .v517-status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px;border-top:0}
      .v517-status div{border:1px solid var(--line);padding:7px;font-size:10px;color:#95a3a0;min-height:42px;overflow-wrap:anywhere}
      .v517-status b{display:block;color:#e7d29b;font-size:11px;margin-bottom:2px}
      .v517-control-panel{display:grid;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);min-height:0}
      .v517-control-panel h3{margin-bottom:-3px}
      .v517-segments,.v517-pose-grid{display:grid;gap:7px}
      .v517-segments{grid-template-columns:repeat(3,minmax(0,1fr));margin:0}
      #v517ExpressionMode{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v517-seg,.v517-pose{border:1px solid rgba(238,231,216,.13);background:rgba(238,231,216,.035);color:#d9e2de;text-align:left;padding:7px;cursor:pointer;border-radius:0}
      .v517-seg{font-size:11px;text-align:center}
      .v517-seg.active,.v517-pose.active{border-color:#d8b35f;background:rgba(216,179,95,.16);color:#fff4d7}
      .v517-pose-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .v517-pose b{display:block;font-size:12px;margin-bottom:0;color:inherit}
      .v517-pose span{display:none;font-size:10px;line-height:1.35;color:#9ea8a6}
      .v517-output-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.v517-output-actions .btn{width:100%;justify-content:center}
      .v517-output-panel .v517-output-actions .btn:first-child{grid-column:1/-1}
      #v517CopyPromptBtn{border-color:rgba(111,183,189,.48);color:#bce6e8;background:rgba(111,183,189,.08)}
      .v517-output-actions.v517-output-actions-secondary{grid-template-columns:1fr;margin-top:8px}
      .v517-output-note{color:#8fa19e;font-size:10px;line-height:1.35;margin-top:7px}
      .v517-prompt-summary{border:1px solid rgba(255,255,255,.1);background:linear-gradient(135deg,rgba(213,173,99,.10),rgba(67,117,122,.08));padding:12px;margin:0 0 10px}
      .v517-prompt-summary h3{margin:0 0 6px;color:#f1dfb4;font-size:14px}.v517-prompt-summary p{margin:0;color:#aeb9b6;font-size:12px;line-height:1.5}
      .v517-prompt-stats{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.v517-prompt-stats span{font-size:10px;color:#d4c38b;border:1px solid rgba(213,173,99,.25);padding:4px 7px;background:rgba(0,0,0,.16)}
      .v517-prompt-details{border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);padding:0;margin-top:8px}.v517-prompt-details>summary{cursor:pointer;padding:9px 10px;color:#d8c688;font-size:12px}
      .v517-prompt-details[open]>summary{border-bottom:1px solid rgba(255,255,255,.08)}.v517-prompt-details .prompt{border:0;border-radius:0;min-height:360px}
      body.v517-experience #v5130ProductCard,body.v517-experience .v591-focus-note,body.v517-experience .stage-tab[data-view="preview"],body.v517-experience #previewView{display:none!important}
      body.v517-experience #v5130AlphaBadge,body.v517-experience #v5130GuideTopBtn,body.v517-experience #v591ToolsMenu{display:none!important}
      body.v517-experience .version{max-width:190px}
      .pvos-support-menu{position:relative}
      .pvos-support-menu>summary{list-style:none}.pvos-support-menu>summary::-webkit-details-marker{display:none}
      .pvos-support-popover{position:absolute;right:0;top:calc(100% + 8px);z-index:70;display:grid;gap:6px;min-width:142px;padding:8px;border:1px solid rgba(216,179,95,.32);background:#0d0f0f;box-shadow:0 16px 46px rgba(0,0,0,.42)}
      .pvos-support-menu:not([open]) .pvos-support-popover{display:none}
      .pvos-support-popover .btn{width:100%;justify-content:flex-start}
      body.theme-daylight .pvos-support-popover{background:#fffefa;border-color:rgba(26,11,8,.18);box-shadow:0 16px 36px rgba(52,46,36,.16)}
      body.v517-experience .v5111-layout-flow{display:none!important}
      body.v517-experience .v5112-layout-tools{display:none!important}
      body.v517-experience.v591-route-browser-open #v591RouteBrowserBtn{display:none!important}
      body.v517-experience #ws-assetLibrary .drawer-tab[onclick*="localBridge"],body.v517-experience #ws-assetLibrary .drawer-tab[onclick*="rules"],body.v517-experience #ws-assetLibrary .drawer-tab[onclick*="architecture"]{display:none!important}
      body.v517-experience #ws-assetLibrary.active .drawer-head .btn{display:none!important}
      body.v517-experience #ws-assetLibrary .drawer-head h2{font-size:0}
      body.v517-experience #ws-assetLibrary .drawer-head h2:after{content:"素材库";font-size:14px;letter-spacing:.12em;color:#ead8a6}
      body.v517-experience #ws-assetLibrary .asset-card code{display:none!important}
      body.v517-experience #ws-assetLibrary .asset-card .badge.gold{display:none!important}
      body.theme-daylight.v517-experience #ws-assetLibrary .drawer-head h2:after{color:#91543d}
      body.v517-experience #ws-workbench>aside.sidebar,body.v517-experience #ws-workbench>section.controls,body.v517-experience #ws-workbench>section.stage{display:none!important}
      body.v517-experience.v517-pro-workbench-open{overflow:hidden}
      body.v517-experience.v517-pro-workbench-open #ws-workbench{display:grid!important;grid-template-columns:270px 370px minmax(0,1fr);position:fixed;inset:64px 14px 14px;z-index:80;height:auto;min-height:0;background:#0b0f10;border:1px solid rgba(213,173,99,.30);box-shadow:0 22px 80px rgba(0,0,0,.58);overflow:hidden}
      body.v517-experience.v517-pro-workbench-open #v517QuickCreate{display:none}
      body.v517-experience.v517-pro-workbench-open #ws-workbench>aside.sidebar,body.v517-experience.v517-pro-workbench-open #ws-workbench>section.controls,body.v517-experience.v517-pro-workbench-open #ws-workbench>section.stage{display:block!important;min-height:0}
      .v517-workbench-close{display:none;position:fixed;right:28px;top:76px;z-index:90}
      body.v517-pro-workbench-open .v517-workbench-close{display:inline-flex}
      body.v517-pro-workbench-open .v517-shell{filter:blur(1px);pointer-events:none}
      body.theme-daylight.v517-pro-workbench-open #ws-workbench{background:#fffefa;border-color:rgba(61,78,78,.20);box-shadow:0 18px 60px rgba(41,51,46,.22)}
      .v517-drag-layer{cursor:move;outline:1px solid transparent;outline-offset:4px;touch-action:none;user-select:none}
      .v517-drag-layer:hover,.v517-drag-layer.v517-dragging{outline-color:rgba(126,211,220,.72);background:rgba(8,18,20,.10)}
      .v517-drag-handle{position:absolute;right:-9px;bottom:-9px;width:15px;height:15px;border:1px solid rgba(126,211,220,.85);background:#0d1516;z-index:12;cursor:nwse-resize;box-shadow:0 2px 8px rgba(0,0,0,.35)}
      .v517-guide-legend{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}
      .v517-guide-legend span{font-size:9px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.035);color:#99aaa7;padding:3px 6px}
      .v517-line-label{position:absolute;z-index:8;pointer-events:none;font-size:8px;line-height:1.2;padding:2px 5px;background:rgba(5,8,8,.72);border:1px solid rgba(255,255,255,.12);color:#d8c98f;text-shadow:none;letter-spacing:0}
      #lsPoster .v55-zone{font-size:0;padding:0}
      .v517-line-label.face{top:26%;left:32%}.v517-line-label.safe{top:8%;left:8%}.v517-line-label.masthead{top:4%;right:6%}.v517-line-label.bottom{bottom:4%;right:6%}.v517-line-label.hand{top:51%;right:18%}
      .poster:not(.show-safe) .v517-line-label.safe,.poster:not(.show-v55-zones) .v517-line-label.face,.poster:not(.show-v55-zones) .v517-line-label.masthead,.poster:not(.show-v55-zones) .v517-line-label.bottom,.poster:not(.show-hand-zone) .v517-line-label.hand{display:none}
      .v517-primary{min-width:130px}
      .v517-mobile-hint{display:none}
      body.theme-daylight .v517-shell{--line:rgba(26,11,8,.18);--line-strong:rgba(26,11,8,.62);--muted:#5d6b67;background:#eee7d8;color:#1a0b08;border-color:rgba(26,11,8,.72);box-shadow:0 18px 48px rgba(78,72,60,.13)}
      body.theme-daylight .v517-shell:before{background:linear-gradient(90deg,rgba(26,11,8,.055) 1px,transparent 1px),linear-gradient(180deg,rgba(26,11,8,.045) 1px,transparent 1px);background-size:64px 64px}
      body.theme-daylight .v517-shell:after{color:rgba(26,11,8,.045)}
      body.theme-daylight .v517-head{border-color:rgba(26,11,8,.28)}body.theme-daylight .v517-head h2{color:#1a0b08}body.theme-daylight .v517-head p{color:#5b6863}
      body.theme-daylight .v517-actions{border-color:rgba(26,11,8,.28)}body.theme-daylight .v517-actions .btn{color:#1a0b08;border-color:rgba(26,11,8,.24)}
      body.theme-daylight .v517-kicker{color:#397b82}
      body.theme-daylight .v517-panel{background:#eee7d8;border-color:rgba(26,11,8,.22)}
      body.theme-daylight .v517-panel h3,body.theme-daylight .v517-template-head h3,body.theme-daylight .v517-control-panel h3,body.theme-daylight .v517-style-head b{color:#7a4d21}
      body.theme-daylight .v517-section-note,body.theme-daylight .v517-template-head span,body.theme-daylight .v517-style-head span,body.theme-daylight .v517-output-note{color:#5b6863}
      body.theme-daylight .v517-rail-block,body.theme-daylight .v517-template-head,body.theme-daylight .v517-style-head,body.theme-daylight .v517-inspector-block,body.theme-daylight .v517-control-panel,body.theme-daylight .v517-flow,body.theme-daylight .v517-flow div,body.theme-daylight .v517-status,body.theme-daylight .v517-status div{border-color:rgba(26,11,8,.18)}
      body.theme-daylight .v517-field select,body.theme-daylight .v517-field textarea,body.theme-daylight .v517-field input{background:#fffdf6;color:#1f2a29;border-color:rgba(26,11,8,.22)}
      body.theme-daylight .v517-seg,body.theme-daylight .v517-pose,body.theme-daylight .v517-style-card{background:#f7f1e4;color:#34413e;border-color:rgba(26,11,8,.16)}
      body.theme-daylight .v517-flow b,body.theme-daylight .v517-status b{color:#81561f}
      body.theme-daylight .v517-flow span{color:#1a0b08}body.theme-daylight .v517-flow small,body.theme-daylight .v517-status div{color:#56625f}
      body.theme-daylight .v517-seg.active,body.theme-daylight .v517-pose.active,body.theme-daylight .v517-style-card.active{background:#ead6a6;border-color:#996b24;color:#1a0b08;box-shadow:inset 0 0 0 1px rgba(153,107,36,.34)}
      body.theme-daylight .v517-style-card b{color:#6e4a1e}body.theme-daylight .v517-style-card small{color:#397b82}body.theme-daylight .v517-style-card span{color:#5b6863}
      body.theme-daylight .v517-output-panel{background:#e8dfcb}
      body.theme-daylight #v517CopyPromptBtn{background:#e5f0ed;border-color:rgba(57,123,130,.28);color:#2f6d73}
      body.theme-daylight #v517CopyPromptBtn:disabled,body.theme-daylight .btn:disabled{opacity:.58;color:#7f8d8a}
      body.theme-daylight .v517-prompt-summary{background:#f6eddb;border-color:rgba(26,11,8,.14)}body.theme-daylight .v517-prompt-summary h3{color:#1a0b08}body.theme-daylight .v517-prompt-summary p{color:#566763}body.theme-daylight .v517-prompt-details{background:#fffefa;border-color:rgba(26,11,8,.14)}body.theme-daylight .v517-prompt-details>summary{color:#6f4f20}
      body.theme-daylight .v517-drag-layer:hover,body.theme-daylight .v517-drag-layer.v517-dragging{background:rgba(114,182,200,.12)}body.theme-daylight .v517-drag-handle{background:#fffefa;border-color:rgba(71,125,135,.8)}body.theme-daylight .v517-guide-legend span{background:#fffefa;border-color:rgba(67,90,91,.16);color:#61706d}body.theme-daylight .v517-line-label{background:rgba(255,253,246,.85);color:#7a5a2e;border-color:rgba(67,90,91,.16)}
      body.v517-experience{background:#0b0b08;color:#eee7d8}body.v517-experience .topbar{background:rgba(10,10,8,.96);border-bottom-color:rgba(199,169,105,.20)}body.v517-experience .btn.primary{background:#d8b35f;border-color:#e4c270;color:#14110b}body.v517-experience .btn{border-radius:0}body.v517-experience .card,body.v517-experience .sidebar,body.v517-experience .controls,body.v517-experience .stage{border-color:rgba(128,143,137,.18)}
      body.v517-experience.theme-daylight{background:#eee7d8;color:#1a0b08}body.v517-experience.theme-daylight .topbar{background:rgba(238,231,216,.96);border-bottom-color:rgba(26,11,8,.18)}body.v517-experience.theme-daylight .btn.primary{background:#1a0b08;border-color:#1a0b08;color:#fffdf4}
      @media(min-width:1081px) and (max-height:820px){.v517-shell{height:calc(100vh - 52px)}.v517-head{height:72px}.v517-head-main{padding:9px 14px}.v517-head h2{font-size:24px}.v517-head p{display:none}.v517-layout{height:calc(100% - 72px);grid-template-columns:minmax(230px,20vw) minmax(480px,1fr) minmax(300px,23vw)}.v517-rail-block,.v517-template-head,.v517-style-head,.v517-inspector-block,.v517-control-panel{padding:8px 10px}.v517-field textarea{min-height:54px}.v517-template{min-height:42px}.v517-template:first-child{min-height:42px}.v517-template span,.v517-style-card span,.v517-pose span,.v517-flow small,.v517-output-note,.v517-mobile-hint{display:none}.v517-template-panel{grid-template-rows:minmax(210px,40%) auto minmax(0,1fr)}.v517-stage-title{font-size:58px}.v517-style-card{min-height:50px}.v517-status div{min-height:36px;padding:6px}.v517-pose-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.v517-seg,.v517-pose{padding:6px}}
      @media(max-width:1280px) and (min-width:1081px){.v517-layout{grid-template-columns:minmax(240px,22vw) minmax(460px,1fr) minmax(300px,25vw)}.v517-head p{max-width:560px}.v517-actions .btn{min-width:120px}.v517-style-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v517-style-card:nth-child(3n){border-right:1px solid var(--line)}.v517-style-card:nth-child(2n){border-right:0}}
      @media(max-width:1080px){.v517-shell{height:auto;min-height:auto;overflow:visible}.v517-head{grid-template-columns:1fr;height:auto}.v517-actions{border-left:0;border-top:1px solid var(--line);grid-auto-flow:row}.v517-actions .btn{min-height:46px}.v517-layout{grid-template-columns:1fr;height:auto;min-height:auto}.v517-panel{height:auto;overflow:visible}.v517-intent-panel,.v517-template-panel,.v517-output-panel{border-right:0;border-bottom:1px solid var(--line)}.v517-template-panel{grid-template-rows:auto auto auto}.v517-template-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v517-style-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v517-output-panel .v517-status{grid-template-columns:repeat(2,minmax(0,1fr))}.v517-control-panel{grid-template-columns:1fr}}
      @media(max-width:640px){.v517-head-main{padding:14px}.v517-head h2{font-size:30px}.v517-actions{grid-auto-flow:row}.v517-stage{min-height:280px}.v517-stage-title{font-size:52px}.v517-stage-meta{left:18px;right:18px;top:54px;text-align:left;max-width:none}.v517-stage-caption{display:none}.v517-segments,.v517-pose-grid,.v517-template-grid,.v517-flow,.v517-output-actions,.v517-style-grid,.v517-output-panel .v517-status{grid-template-columns:1fr}.v517-status{grid-template-columns:1fr}.v517-mobile-hint{display:block;color:#8aa19e;font-size:11px;margin-top:6px}.v517-template,.v517-template:first-child{grid-column:auto;min-height:92px}body.v517-experience.v517-pro-workbench-open #ws-workbench{inset:86px 8px 8px;display:block!important;overflow:auto}.v517-workbench-close{right:14px;top:96px}}
    `;
    document.head.appendChild(style);
  }

  function v517PanelHtml() {
    return `
      <section id="v517QuickCreate" class="v517-shell" aria-label="快速创作">
        <div class="v517-head">
          <div class="v517-head-main">
            <div class="v517-kicker">快速创作</div>
            <h2>生图指令工作台</h2>
            <p>左侧选风格，中间看方向，右侧生成和复制。准确文字、字体和导出进入成品排版。</p>
          </div>
          <div class="v517-actions">
            <button class="btn" type="button" id="v517ProWorkbenchBtn">打开专业指令面板</button>
          </div>
        </div>
        <div class="v517-layout">
          <div class="v517-panel v517-intent-panel">
            <div class="v517-rail-block">
              <h3>风格方向</h3>
              <p class="v517-section-note">先选大方向，再在中间选择具体风格。</p>
              <div class="v517-field v517-hidden-field">
                <select id="v517Scene">
                  <option value="portrait">高级人物写真</option>
                  <option value="editorial">杂志封面</option>
                  <option value="poster">海报大片</option>
                  <option value="stage">演出巡演</option>
                  <option value="street">街头电影感</option>
                  <option value="graduation">毕业纪念</option>
                  <option value="wedding">婚礼成片</option>
                </select>
              </div>
            </div>
            <div id="v517TemplateGrid" class="v517-template-grid"></div>
            <div class="v517-rail-block">
              <h3>创作需求</h3>
              <p class="v517-section-note">只写必要目标，完整 Prompt 默认隐藏。</p>
              <div class="v517-field">
                <label for="v517Brief">一句话需求</label>
                <textarea id="v517Brief" placeholder="例如：把这张人物照做成独立音乐巡演海报，姿态更自然，画面高级一点，文字不要挡脸。"></textarea>
              </div>
              <div class="v517-field">
                <label for="v517Text">排版文字（可选）</label>
                <input id="v517Text" value="" placeholder="可留空；只用于文字参与或后期排版">
              </div>
            </div>
            <div class="v517-flow" aria-label="创作流程">
              <div><b>01</b><span>调查目标</span><small>画面、素材、排版字</small></div>
              <div><b>02</b><span>判断变量</span><small>风格、姿势、风险</small></div>
              <div><b>03</b><span>集中行动</span><small>生成、复制、排版</small></div>
            </div>
          </div>
          <div class="v517-panel v517-template-panel">
            <div class="v517-stage" id="v517VisualStage" aria-label="成片视觉舞台">
              <div class="v517-stage-image" id="v517StageImage"></div>
              <div class="v517-stage-lines"></div>
              <div class="v517-stage-top">
                <span id="v517StageMeta">当前方向</span>
                <span id="v517StageClock">待生成</span>
              </div>
              <div class="v517-stage-meta" id="v517StageBrief">选择风格后，这里会同步当前画面方向。</div>
              <div class="v517-stage-title" id="v517StageTitle">VISUAL OS</div>
              <div class="v517-stage-caption" id="v517StageCaption">具体风格</div>
            </div>
            <div class="v517-template-head"><h3>具体风格</h3><span>同步路线、构图、光影和文字策略</span></div>
            <div id="v517StylePanel" class="v517-style-panel" aria-label="具体风格选择">
              <div class="v517-style-head"><b id="v517StyleTitle">选择具体风格</b><span id="v517StyleHint">先选上方成片类型</span></div>
              <div id="v517StyleGrid" class="v517-style-grid"></div>
            </div>
          </div>
          <div class="v517-panel v517-output-panel">
            <div class="v517-inspector-block">
              <h3>生成控制</h3>
              <p class="v517-section-note">只显示会影响生图结果的选择。</p>
              <div class="v517-status" id="v517Status">
                <div><b>目标</b><span>待生成</span></div>
                <div><b>变量</b><span>自然站姿 / 保留原表情</span></div>
                <div><b>取势</b><span>留白后期排字</span></div>
                <div><b>动作</b><span>生成 Prompt / 复制 Prompt</span></div>
              </div>
            </div>
            <div class="v517-control-panel">
              <h3>人物与文字</h3>
              <p class="v517-section-note">表情只保留原表情和默认微笑。</p>
              <div class="v517-pose-grid" id="v517PoseGrid"></div>
              <div class="v517-segments" id="v517TextMode">
                <button class="v517-seg active" type="button" data-mode="reserve-layout">留白后期排字</button>
                <button class="v517-seg" type="button" data-mode="clean-base">干净无字底图</button>
                <button class="v517-seg" type="button" data-mode="poster-structure">海报结构参与</button>
              </div>
              <div class="v517-field v517-template-reference-control">
                <label>版式模板图（复杂海报可选）</label>
                <div class="v517-segments" id="v6TemplateReferenceMode" aria-label="版式模板图规则">
                  <button class="v517-seg active" type="button" data-template-reference="recommended">自动建议</button>
                  <button class="v517-seg" type="button" data-template-reference="none">不用模板</button>
                  <button class="v517-seg" type="button" data-template-reference="attached">已附模板图</button>
                </div>
                <small id="v6TemplateReferenceHint" class="v517-section-note">复杂拼贴、旧刊和多层海报建议额外上传一张模板图；普通封面无需强制上传。</small>
              </div>
              <div class="v517-segments" id="v517ExpressionMode">
                <button class="v517-seg active" type="button" data-expression="source-natural">保留原表情</button>
                <button class="v517-seg" type="button" data-expression="soft-smile">默认微笑</button>
              </div>
              <div class="v517-mobile-hint">移动端建议先完成快速创作，再打开“专业视图”。</div>
            </div>
            <div class="v517-inspector-block">
              <h3>输出</h3>
              <div class="v517-segments" id="v6ProviderMode" aria-label="目标生图模型">
                <button class="v517-seg active" type="button" data-provider="gpt-image">GPT 生图</button>
                <button class="v517-seg" type="button" data-provider="doubao-seedream">豆包生图</button>
              </div>
              <div class="v517-segments" id="v6SceneRichness" aria-label="场景丰富度">
                <button class="v517-seg" type="button" data-richness="compact">场景·紧凑</button>
                <button class="v517-seg active" type="button" data-richness="standard">场景·标准</button>
                <button class="v517-seg" type="button" data-richness="rich">场景·丰富</button>
              </div>
              <div class="v517-output-actions">
                <button class="btn primary" type="button" id="v517CreateBtn">生成 Prompt</button>
                <button class="btn" type="button" id="v517CopyPromptBtn">复制 Prompt</button>
                <button class="btn" type="button" id="v517LayoutBtn">进入排版</button>
              </div>
              <div class="v517-output-note" id="v6ProviderNote">提示词适配仅负责生成可复制 Prompt，不会直接调用外部模型；准确文字、字体和 PNG 导出进入排版工作区完成。</div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function v517Mount() {
    if (document.getElementById('v517QuickCreate')) return;
    const workbench = document.getElementById('ws-workbench');
    if (!workbench) return;
    workbench.insertAdjacentHTML('afterbegin', v517PanelHtml());
    if (!document.getElementById('v517WorkbenchClose')) {
      workbench.insertAdjacentHTML('beforeend', '<button id="v517WorkbenchClose" class="btn v517-workbench-close" type="button">收起专业面板</button>');
    }
    v517RenderPoses('natural');
    v517Bind();
    // The legacy professional panel initializes with a historical cream-cover
    // preset.  The quick panel must explicitly select its own neutral default
    // so the first visible direction and the compiled route are identical.
    v517OpenTemplateGroup('portrait', 'portrait-soft');
    document.body.classList.add('v517-experience');
    document.body.dataset.pvosUiBuild = UI_BUILD;
    window.PVOS_UI_BUILD = UI_BUILD;
    const promptTab = document.querySelector('.ws-tab[data-ws="workbench"]');
    if (promptTab) promptTab.textContent = '快速创作';
  }

  function v517RenderPoses(activeId) {
    const grid = document.getElementById('v517PoseGrid');
    if (!grid) return;
    grid.innerHTML = V517_POSES.map((pose) => (
      `<button class="v517-pose${pose.id === activeId ? ' active' : ''}" type="button" data-pose="${pose.id}" title="${escapeHtml(pose.hint)}"><b>${escapeHtml(pose.label)}</b><span>${escapeHtml(pose.hint)}</span></button>`
    )).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function v517RouteText(route) {
    return [
      route?.name_zh,
      route?.category,
      route?.subcategory,
      route?.summary,
      route?.prompt_core_en,
      route?.id,
    ].filter(Boolean).join(' ');
  }

  function v517RouteGroup(route) {
    const text = v517RouteText(route);
    for (const [group, rules] of Object.entries(V6_GROUP_ROUTE_RULES)) {
      if (rules.some((rule) => rule.test(text))) return group;
    }
    return '';
  }

  function v517PoseFromRoute(route, group) {
    const text = v517RouteText(route);
    if (/舞台|演出|摇滚|巡演|音乐|动作|动势/i.test(text)) return 'stage';
    if (/街|地铁|站台|行走|抓拍|长廊|操场|花园/i.test(text)) return 'walk';
    if (/近景|眼神|面部|半身|特写|局部/i.test(text)) return 'close';
    if (/坐|咖啡|书店|室内|访谈|专访/i.test(text)) return 'sit';
    if (/侧|回头|转身|剪影/i.test(text)) return 'turn';
    if (group === 'stage') return 'stage';
    if (group === 'street' || group === 'graduation') return 'walk';
    return 'natural';
  }

  function v517TextModeFromRoute(route, group) {
    const text = v517RouteText(route);
    const layout = route?.recommended?.layout || '';
    if (/镂空|巨字|标题|字体|刊头|报纸|海报|票根|dossier|magazine|newspaper|mask|giant/i.test(text + ' ' + layout)) return 'poster-structure';
    if (/纯净|干净|街拍|纪实|抓拍|生活|clean/i.test(text + ' ' + layout)) return 'clean-base';
    if (group === 'poster' || group === 'editorial') return 'poster-structure';
    return 'reserve-layout';
  }

  function v517BriefFromRoute(route, group) {
    const summary = String(route?.summary || '').trim();
    const base = summary || String(route?.prompt_core_en || '').replace(/\s+/g, ' ').slice(0, 72);
    const body = base || '从现有路线库提取视觉语法，保留人物自然和画面可读性。';
    const suffix = group === 'poster' || group === 'editorial'
      ? '文字只作为结构和留白参与，准确内容进入排版层。'
      : '人物比例、表情和眼神保持自然。';
    return `借鉴「${route?.name_zh || '路线库风格'}」：${body.replace(/[。.]$/, '')}。${suffix}`;
  }

  function v517VariantFromRoute(route, group) {
    const name = String(route?.name_zh || '').trim();
    if (!route?.id || !name) return null;
    return {
      id: `route-${route.id}`,
      group,
      scene: V6_GROUP_SCENE[group] || group,
      pose: v517PoseFromRoute(route, group),
      textMode: v517TextModeFromRoute(route, group),
      title: name.length > 9 ? name.slice(0, 9) : name,
      tag: String(route?.subcategory || route?.category || '路线库').slice(0, 8),
      text: V6_GROUP_TEXT[group] || 'VISUAL',
      brief: v517BriefFromRoute(route, group),
      routeId: route.id,
      source: 'route-library',
    };
  }

  function v517StyleRegistry() {
    const seen = new Set();
    const titleSeen = new Set();
    const styles = [];
    const add = (item) => {
      if (!item?.id || seen.has(item.id)) return false;
      const key = `${item.group}:${item.title}`;
      if (titleSeen.has(key)) return false;
      seen.add(item.id);
      titleSeen.add(key);
      styles.push(item);
      return true;
    };
    V517_CURATED_STYLE_VARIANTS.forEach(add);
    const routes = Array.isArray(window.PVOS_LIBRARY?.styles) ? window.PVOS_LIBRARY.styles.slice(0, V6_ROUTE_PICK_LIMIT) : [];
    for (const group of Object.keys(V6_GROUP_ROUTE_RULES)) {
      let count = styles.filter((item) => item.group === group).length;
      if (count >= V6_STYLE_TARGET_PER_GROUP) continue;
      for (const route of routes) {
        const routeGroup = v517RouteGroup(route);
        if (routeGroup !== group) continue;
        const item = v517VariantFromRoute(route, group);
        if (add(item)) count += 1;
        if (count >= V6_STYLE_TARGET_PER_GROUP) break;
      }
    }
    return styles;
  }

  function v517StylesForGroup(group) {
    return v517StyleRegistry().filter((item) => item.group === group);
  }

  function v517FindStyle(styleId) {
    return v517StyleRegistry().find((item) => item.id === styleId);
  }

  function v517ExposeStyleEngine() {
    window.PVOS_V6_STYLE_ENGINE = {
      targetPerGroup: V6_STYLE_TARGET_PER_GROUP,
      total: v517StyleRegistry().length,
      counts: Object.fromEntries(V517_TEMPLATES.map((template) => [template.group, v517StylesForGroup(template.group).length])),
      derivedCount: v517StyleRegistry().filter((item) => item.source === 'route-library').length,
      resolvedRouteCount: v517StyleRegistry().filter((item) => !!v517ResolveRouteForStyle(item)).length,
      unresolvedRouteCount: v517StyleRegistry().filter((item) => !v517ResolveRouteForStyle(item)).length,
    };
  }

  function v517RenderTemplates(activeId, activeGroup) {
    const grid = document.getElementById('v517TemplateGrid');
    if (!grid) return;
    grid.innerHTML = V517_TEMPLATES.map((item) => (
      `<button class="v517-template${item.id === activeId || item.group === activeGroup ? ' active' : ''}" type="button" data-template="${escapeHtml(item.id)}" data-group="${escapeHtml(item.group)}" title="${escapeHtml(item.brief)}"><em class="v517-template-count">${v517StylesForGroup(item.group).length} 种</em><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.tag)}</small><span>${escapeHtml(item.brief)}</span></button>`
    )).join('');
    v517ExposeStyleEngine();
  }

  function v517RenderStyles(group, activeId) {
    const grid = document.getElementById('v517StyleGrid');
    const title = document.getElementById('v517StyleTitle');
    const hint = document.getElementById('v517StyleHint');
    if (!grid) return;
    const variants = v517StylesForGroup(group);
    const parent = V517_TEMPLATES.find((item) => item.group === group) || V517_TEMPLATES[0];
    if (title) title.textContent = `${parent?.title || '成片'} · 具体风格`;
    if (hint) hint.textContent = '点具体风格会同步路线、姿势、文字策略';
    grid.innerHTML = variants.map((item) => (
      `<button class="v517-style-card${item.id === activeId ? ' active' : ''}" type="button" data-style="${escapeHtml(item.id)}" title="${escapeHtml(item.brief)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.tag)}</small><span>${escapeHtml(item.brief)}</span></button>`
    )).join('');
    v517ExposeStyleEngine();
  }

  function v517OpenTemplateGroup(group, defaultTemplateId) {
    const fallback = V517_TEMPLATES.find((item) => item.group === group) || V517_TEMPLATES[0];
    const defaultId = defaultTemplateId || fallback?.id;
    v517RenderTemplates(defaultId, group);
    v517RenderStyles(group, defaultId);
    if (defaultId) v517ApplyTemplate(defaultId);
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSuggestedLayoutText(value) {
    const el = document.getElementById('v517Text');
    if (!el) return;
    const suggestion = value ? `可留空；建议排版文字：${value}` : '可留空；只用于文字参与或后期排版';
    el.placeholder = suggestion;
    el.dataset.suggestedText = value || '';
  }

  function currentPose() {
    return document.querySelector('.v517-pose.active')?.dataset.pose || 'natural';
  }

  function currentTextMode() {
    return document.body.dataset.v517RequestedTextMode
      || document.querySelector('#v517TextMode .v517-seg.active')?.dataset.mode
      || 'reserve-layout';
  }

  const V6_GROUP_POSTER_LAYOUT_SKELETON = {
    portrait: '人物作为稳定主锚点；保留一个克制主标题容器、一个底部信息带和少量档案式辅助线。人物约占画面 55%–70%，图形层不压住脸部。',
    editorial: '建立杂志封面骨架：顶部刊头容器、侧边或底部副标题区、一个小型日期或期号区；人物与刊头形成明确前后关系，外边距整洁。',
    poster: '建立视觉海报骨架：人物主体偏右或偏中，主标题容器占画面宽度约 32%–48%，底部信息带约占高度 8%–12%，加入一到两个辅助色块或边界层。',
    stage: '建立巡演海报骨架：人物动作作为中心，背后保留大型标题容器，底部设置演出信息带，并使用一到两个节奏明确的票据、笔刷或舞台光辅助层。',
    street: '建立城市编辑海报骨架：人物与街道透视线共同构图，侧边保留窄标题容器，底部保留地点或日期信息带；不要复制街景中的可读商标。',
    graduation: '建立毕业纪念海报骨架：人物主体清晰，顶部或侧边保留成长主题标题容器，底部保留姓名与日期信息带，辅助图层克制且不做俗套模板。',
    wedding: '建立婚礼封面骨架：两人关系是主视觉，外边距保留请柬式标题容器，底部保留日期与姓名信息带，装饰层克制，不覆盖脸部和手部。',
  };

  function currentTemplateReferenceMode() {
    return document.querySelector('#v6TemplateReferenceMode .v517-seg.active')?.dataset.templateReference || 'recommended';
  }

  function v6TemplateReferenceHint(mode = currentTemplateReferenceMode()) {
    if (mode === 'attached') return '粘贴 Prompt 时，请将版式模板作为最后一张图片上传；只参考结构，不复制模板人物与文字。';
    if (mode === 'none') return '本次不依赖模板图，系统会按内置海报骨架生成。';
    return '复杂拼贴、旧刊和多层海报建议额外上传一张模板图；普通封面无需强制上传。';
  }

  function v6SetTemplateReferenceMode(mode) {
    const resolved = ['none', 'recommended', 'attached'].includes(mode) ? mode : 'recommended';
    document.querySelectorAll('#v6TemplateReferenceMode .v517-seg').forEach((item) => item.classList.toggle('active', item.dataset.templateReference === resolved));
    const hint = document.getElementById('v6TemplateReferenceHint');
    if (hint) hint.textContent = v6TemplateReferenceHint(resolved);
  }

  function v6PosterLayoutSkeletonForApi() {
    if (currentTextMode() !== 'poster-structure') return null;
    const item = activeStyleItem();
    return item?.posterSkeleton || V6_GROUP_POSTER_LAYOUT_SKELETON[item?.group] || V6_GROUP_POSTER_LAYOUT_SKELETON.poster;
  }

  function v6TemplateReferenceModeForApi() {
    return currentTextMode() === 'poster-structure' ? currentTemplateReferenceMode() : 'none';
  }

  function hasUserLayoutText() {
    return !!document.getElementById('v517Text')?.value?.trim();
  }

  function resolveTextMode(mode) {
    return mode;
  }

  function currentExpressionMode() {
    return document.querySelector('#v517ExpressionMode .v517-seg.active')?.dataset.expression || 'source-natural';
  }

  function v517BoundVisualDirection() {
    const currentRouteId = (typeof window.route === 'function' && window.route())
      ? window.route().id
      : document.getElementById('routeSelect')?.value || '';
    const boundRouteId = document.body.dataset.v517CurrentRouteId || '';
    if (!currentRouteId || !boundRouteId || currentRouteId !== boundRouteId) {
      return { label: null, brief: null };
    }
    return {
      label: document.body.dataset.v517CurrentStyleTitle || null,
      brief: document.body.dataset.v517CurrentStyleBrief || null,
    };
  }

  // V6 prompt-adapter lines: gpt-image and doubao-seedream select compiler
  // behavior only. They do not imply a direct external-model API connection.
  let v6DoubaoCompileSeq = 0;
  let v6DoubaoPrecompileTimer = null;
  let v6DoubaoReadySignature = '';
  function v6StalePromptError() {
    const err = new Error('Prompt compile response was superseded by a newer configuration');
    err.pvosStale = true;
    return err;
  }

  const V6_PROVIDER_DEFAULT_RICHNESS = { 'gpt-image': 'standard', 'doubao-seedream': 'rich' };
  const V6_SCENE_RICHNESS_EN = {
    compact: 'SCENE DETAIL DENSITY — COMPACT:\nKeep environmental description minimal. State only the dominant location, one key light source, and the essential mood.',
    standard: 'SCENE DETAIL DENSITY — STANDARD:\nDescribe the environment with enough material, light, and depth cues to feel authored: location character, dominant and secondary light behavior, two or three meaningful surface materials, and one atmospheric quality.',
    rich: 'SCENE DETAIL DENSITY — RICH:\nBuild the environment as a regionally described scene. Give the foreground, midground, and background each an explicit material, light, or prop detail, and include one atmospheric quality. Every described element must support the selected visual direction.',
  };

  function currentProviderMode() {
    return document.querySelector('#v6ProviderMode .v517-seg.active')?.dataset.provider || 'gpt-image';
  }

  function currentSceneRichness() {
    return document.querySelector('#v6SceneRichness .v517-seg.active')?.dataset.richness
      || V6_PROVIDER_DEFAULT_RICHNESS[currentProviderMode()]
      || 'standard';
  }

  function v6SetSceneRichness(richness) {
    document.querySelectorAll('#v6SceneRichness .v517-seg').forEach((item) => {
      item.classList.toggle('active', item.dataset.richness === richness);
    });
  }

  function v6ExposeProviderEngine() {
    window.PVOS_V6_PROVIDER_ENGINE = {
      contract: 'pvos-provider-profiles@1.2.0',
      provider: currentProviderMode(),
      sceneRichness: currentSceneRichness(),
      providers: ['gpt-image', 'doubao-seedream'],
      richnessLevels: ['compact', 'standard', 'rich'],
      templateReferenceMode: currentTemplateReferenceMode(),
      posterStructureStrategy: currentTextMode() === 'poster-structure' ? (hasUserLayoutText() ? 'integrated-text' : 'poster-layout') : null,
    };
  }

  function v6TextStrategyForApi() {
    const mode = currentTextMode();
    if (mode === 'clean-base') return 'clean';
    if (mode === 'poster-structure') return hasUserLayoutText() ? 'integrated-text' : 'poster-layout';
    return 'reserve-space';
  }

  function v6BuildDoubaoPayload() {
    const route = typeof window.route === 'function' ? window.route() : null;
    if (!route || !route.id) throw new Error('请先选择一个具体风格');
    const direction = v517BoundVisualDirection();
    return {
      route_id: route.id,
      provider: 'doubao-seedream',
      scene_richness: currentSceneRichness(),
      template_reference_mode: v6TemplateReferenceModeForApi(),
      template_reference_note: v6TemplateReferenceModeForApi() === 'attached' ? '最后一张上传图片为版式模板参考，只提取海报骨架、主体锚点、留白位置、图层关系与材质节奏。' : null,
      poster_layout_skeleton: v6PosterLayoutSkeletonForApi(),
      text_strategy: v6TextStrategyForApi(),
      text_relation: window.v5131TextState?.relation || 'independent-layout',
      generation_text: document.getElementById('v5131GenerationText')?.value?.trim()
        || document.getElementById('v517Text')?.value?.trim() || null,
      subject_notes: document.getElementById('v517Brief')?.value?.trim()
        || document.getElementById('subjectNote')?.value?.trim() || null,
      extra_request: document.getElementById('extra')?.value?.trim() || null,
      identity_level: String(document.getElementById('identity')?.value || '1'),
      face_mode: document.getElementById('face')?.value || 'auto',
      subject_scale: document.getElementById('scale')?.value || 'auto',
      outfit_mode: document.getElementById('wardrobe')?.value || 'auto',
      fusion_mode: document.getElementById('fusion')?.value || 'auto',
      motif_mode: document.getElementById('motif')?.value || 'none',
      ratio: document.getElementById('ratio')?.value || '4:5',
      selected_component_ids: (typeof componentGroups !== 'undefined' ? componentGroups : [])
        .map(([id]) => document.getElementById(id)?.value || '')
        .filter(Boolean),
      visual_template_id: typeof selectedVisualTemplateId === 'string' && selectedVisualTemplateId ? selectedVisualTemplateId : null,
      template_role_blocking_id: typeof selectedTemplateRoleBlockingId === 'string' && selectedTemplateRoleBlockingId ? selectedTemplateRoleBlockingId : null,
      single_action_blueprint_id: typeof selectedSingleActionBlueprintId === 'string' && selectedSingleActionBlueprintId ? selectedSingleActionBlueprintId : null,
      gaze_lock_id: typeof selectedGazeLockId === 'string' && selectedGazeLockId ? selectedGazeLockId : null,
      expression_preset_id: typeof selectedExpressionPresetId === 'string' && selectedExpressionPresetId ? selectedExpressionPresetId : null,
      composition_blueprint_id: typeof selectedCompositionBlueprintId === 'string' && selectedCompositionBlueprintId ? selectedCompositionBlueprintId : null,
      typography_interaction_preset_id: typeof selectedTypographyInteractionPresetId === 'string' && selectedTypographyInteractionPresetId ? selectedTypographyInteractionPresetId : null,
      typography_participation_mode_id: typeof selectedTypographyParticipationMode === 'string' && selectedTypographyParticipationMode ? selectedTypographyParticipationMode : null,
      visual_direction_label: direction.label,
      visual_direction_brief: direction.brief,
    };
  }

  function v6DoubaoPayloadSignature(payload = v6BuildDoubaoPayload()) {
    return JSON.stringify(payload);
  }

  function v6ScheduleDoubaoPrecompile() {
    if (currentProviderMode() !== 'doubao-seedream') return;
    clearTimeout(v6DoubaoPrecompileTimer);
    v6DoubaoPrecompileTimer = setTimeout(() => {
      v6CompileDoubaoPrompt()
        .then((result) => { if (result) v6ApplyDoubaoResult(result); })
        .catch((err) => { if (!err?.pvosStale) v517UpdateStatus({ next: '豆包 Prompt 预编译失败，可点击生成后重试' }); });
    }, 260);
  }

  async function v6CompileDoubaoPrompt() {
    clearTimeout(v6DoubaoPrecompileTimer);
    const requestSeq = ++v6DoubaoCompileSeq;
    const payload = v6BuildDoubaoPayload();
    const signature = v6DoubaoPayloadSignature(payload);
    let result;
    // Public stateless compile endpoint first (no project key needed for the
    // Human-First UI); fall back to the private Core path when a key is set.
    try {
      result = await coreFetch('/api/prompts/compile', { method: 'POST', body: payload });
    } catch (err) {
      if (window.PVOS_PROJECT_KEY || storageGet('session', PROJECT_KEY_SESSION)) {
        result = await window.PVOSCoreAPI.compilePrompt(payload);
      } else {
        throw err;
      }
    }
    if (requestSeq !== v6DoubaoCompileSeq) throw v6StalePromptError();
    result.__pvosSignature = signature;
    return result;
  }

  function v6ApplyDoubaoResult(result) {
    const box = document.getElementById('promptBox');
    if (box) box.value = result.prompt || '';
    const stats = document.getElementById('v517PromptStats');
    if (stats) {
      const chars = String(result.prompt || '').replace(/\s+/g, '').length;
      stats.innerHTML = `<span>豆包 Seedream Prompt：${chars} 字</span><span>场景丰富度：${result.provider?.scene_richness || currentSceneRichness()}</span><span>文字策略：${result.parity?.text_strategy || v6TextStrategyForApi()}</span><span>由 Core API 自然中文渲染</span>`;
    }
    v6DoubaoReadySignature = result.__pvosSignature || '';
    window.__pvosV6DoubaoReadySignature = v6DoubaoReadySignature;
    window.PVOS_V6_PROVIDER_ENGINE = Object.assign({}, window.PVOS_V6_PROVIDER_ENGINE, {
      provider: 'doubao-seedream',
      sceneRichness: result.provider?.scene_richness || currentSceneRichness(),
      lastContract: result.provider?.contract || 'pvos-provider-profiles@1.2.0',
      readySignature: v6DoubaoReadySignature,
    });
  }

  function v6UpdateProviderNote() {
    const note = document.getElementById('v6ProviderNote');
    if (!note) return;
    note.textContent = currentProviderMode() === 'doubao-seedream'
      ? '提示词适配：豆包 Seedream。海报结构模式即使不填写标题，也会生成主标题容器、信息带和辅助图层；复杂海报可额外上传模板图。这里只编译，不直连模型。'
      : '提示词适配：GPT 生图。丰富导演版会启用接近旧版 2000 词的重约束 Prompt；这里只编译，不直连模型。';
  }

  function activeQuickLabel(selector, fallback) {
    return document.querySelector(selector)?.textContent?.trim() || fallback;
  }

  function v608QuickTypographyIds() {
    const selectedRoute = typeof window.route === 'function' ? window.route() : null;
    const boundRoute = document.body.dataset.v517CurrentRouteId || '';
    const styleId = document.body.dataset.v517CurrentStyleId || '';
    if (!selectedRoute?.id || boundRoute !== selectedRoute.id || !styleId) return [];
    const item = v517FindStyle(styleId);
    const group = item?.group || v517RouteGroup(selectedRoute) || 'portrait';
    return [...new Set((item?.typographyPackIds || V6_GROUP_TYPOGRAPHY_PACK_IDS[group] || []).filter(Boolean))];
  }
  window.v608QuickTypographyIds = v608QuickTypographyIds;

  function activeStyleLabel() {
    return document.querySelector('#v517StyleGrid .v517-style-card.active b')?.textContent?.trim()
      || document.querySelector('#v517TemplateGrid .v517-template.active b')?.textContent?.trim()
      || '默认风格';
  }

  function activeStyleItem() {
    const activeId = document.querySelector('#v517StyleGrid .v517-style-card.active')?.dataset.style
      || document.querySelector('#v517TemplateGrid .v517-template.active')?.dataset.template
      || '';
    return v517FindStyle(activeId)
      || V517_TEMPLATES.find((item) => item.id === activeId)
      || V517_TEMPLATES[0];
  }

  function v517StageImageFor(item) {
    const source = item?.image || V517_TEMPLATES.find((template) => template.group === item?.group)?.image || V517_TEMPLATES[0]?.image || '';
    return source ? `url("${String(source).replace(/"/g, '%22')}")` : 'none';
  }

  function v517AnchorQuickCreate() {
    if (document.body.classList.contains('v517-pro-workbench-open')) return;
    const shell = document.getElementById('v517QuickCreate');
    if (!shell) return;
    [0, 80, 220, 420].forEach((delay) => {
      setTimeout(() => {
        if (!document.body.classList.contains('v517-pro-workbench-open')) {
          shell.scrollTop = 0;
          shell.scrollIntoView({ block: 'start' });
        }
      }, delay);
    });
  }

  function v517UpdateVisualStage(actionText) {
    const item = activeStyleItem();
    const title = document.getElementById('v517StageTitle');
    const meta = document.getElementById('v517StageMeta');
    const brief = document.getElementById('v517StageBrief');
    const caption = document.getElementById('v517StageCaption');
    const image = document.getElementById('v517StageImage');
    const routeName = document.getElementById('routeSelect')?.selectedOptions?.[0]?.textContent?.trim() || item?.title || '当前路线';
    const parent = V517_TEMPLATES.find((template) => template.group === item?.group);
    const userText = document.getElementById('v517Text')?.value?.trim();
    const displayTitle = userText || item?.text || item?.title || '视觉方向';
    if (title) title.textContent = displayTitle.length > 18 ? displayTitle.slice(0, 18) : displayTitle;
    if (meta) meta.textContent = `${parent?.title || '当前方向'} · ${item?.tag || '具体风格'}`;
    if (brief) brief.textContent = item?.brief || routeName;
    if (caption) caption.textContent = actionText || routeName;
    if (image) image.style.setProperty('--v517-stage-image', v517StageImageFor(item));
  }

  function v517RenderDecisionPanel(actionText) {
    const status = document.getElementById('v517Status');
    if (!status) {
      v517UpdateVisualStage(actionText);
      return;
    }
    const cells = Array.from(status.querySelectorAll('div span'));
    const sceneSelect = document.getElementById('v517Scene');
    const sceneLabel = sceneSelect?.selectedOptions?.[0]?.textContent?.trim() || '人物成片';
    const title = document.getElementById('v517Text')?.value?.trim() || '未填写排版文字';
    const routeName = document.getElementById('routeSelect')?.selectedOptions?.[0]?.textContent?.trim() || '自动推荐路线';
    const poseLabel = activeQuickLabel('.v517-pose.active b', '自然站姿');
    const expressionLabel = activeQuickLabel('#v517ExpressionMode .v517-seg.active', '保留原表情');
    const textModeLabel = activeQuickLabel('#v517TextMode .v517-seg.active', '留白后期排字');
    const styleLabel = activeStyleLabel();
    if (cells[0]) cells[0].textContent = `${sceneLabel} · ${title}`;
    if (cells[1]) cells[1].textContent = `${poseLabel} / ${expressionLabel}`;
    if (cells[2]) cells[2].textContent = `${styleLabel} · ${textModeLabel} · ${routeName}`;
    if (cells[3]) cells[3].textContent = actionText || document.body.dataset.v517DecisionAction || '生成 Prompt / 复制 Prompt';
    v517UpdateVisualStage(actionText || document.body.dataset.v517DecisionAction || routeName);
  }

  function v517ApplyTextMode(mode) {
    const intentMap = {
      'reserve-layout': { quick: 'reserve-layout', strategy: 'reserve-space' },
      'clean-base': { quick: 'clean-base', strategy: 'clean' },
      'poster-structure': { quick: 'poster-structure', strategy: 'integrated-text' },
    };
    const requestedMode = intentMap[mode] ? mode : 'reserve-layout';
    const effectiveMode = resolveTextMode(requestedMode);
    document.body.dataset.v517RequestedTextMode = requestedMode;
    const item = intentMap[effectiveMode] || intentMap['reserve-layout'];
    const legacyStrategy = effectiveMode === 'poster-structure'
      ? (hasUserLayoutText() ? 'integrated-text' : 'reserve-space')
      : item.strategy;
    document.querySelectorAll('#v517TextMode .v517-seg').forEach((button) => button.classList.toggle('active', button.dataset.mode === effectiveMode));
    if (typeof window.v5131SetTextStrategy === 'function') window.v5131SetTextStrategy(legacyStrategy);
    setValue('v58TypographyIntent', item.quick);
    if (requestedMode === 'poster-structure' && !hasUserLayoutText()) {
      document.body.dataset.v517DecisionAction = '海报骨架模式：生成无字结构底图，准确文字后期叠加';
    } else {
      delete document.body.dataset.v517DecisionAction;
    }
    v517UpdateStatus();
  }

  function v517ResetUnsupportedComponentStack(hasRouteBinding) {
    const showAll = document.getElementById('showAllComponents');
    if (showAll) showAll.checked = false;
    if (hasRouteBinding) {
      if (typeof window.refreshComponents === 'function') window.refreshComponents(true);
      return;
    }
    V6_COMPONENT_STACK_IDS.forEach((id) => setValue(id, ''));
    if (typeof window.refreshComponents === 'function') window.refreshComponents(false);
  }

  function v517ApplySceneDefaults(render = true) {
    const sceneId = document.getElementById('v517Scene')?.value || 'portrait';
    const scene = V517_SCENES[sceneId] || V517_SCENES.portrait;
    const brief = document.getElementById('v517Brief');
    if (brief && !brief.value) brief.value = scene.intent;
    setSuggestedLayoutText(scene.text);
    if (render) {
      const defaultTemplate = V517_TEMPLATES.find((item) => item.group === sceneId) || V517_TEMPLATES[0];
      if (defaultTemplate) v517OpenTemplateGroup(defaultTemplate.group, defaultTemplate.id);
      else v517ApplyQuickCreate(false);
    }
  }

  function findActionOption(poseId) {
    const select = document.getElementById('singleActionBlueprint');
    const pose = V517_POSES.find((item) => item.id === poseId) || V517_POSES[0];
    if (!select) return '';
    const options = Array.from(select.options).filter((option) => option.value);
    for (const word of pose.match) {
      const found = options.find((option) => (option.textContent + ' ' + option.value).toLowerCase().includes(String(word).toLowerCase()));
      if (found) return found.value;
    }
    return options[0]?.value || '';
  }

  function v517ApplyPose(poseId) {
    v517RenderPoses(poseId);
    if (typeof window.v591SetInterfaceMode === 'function') window.v591SetInterfaceMode('focused');
    const actionId = findActionOption(poseId);
    if (actionId && typeof window.v55SelectAction === 'function') {
      window.v55SelectAction(actionId);
    } else if (actionId) {
      setValue('singleActionBlueprint', actionId);
    }
    v517UpdateStatus();
    v6ScheduleDoubaoPrecompile();
  }

  function v608ClearQuickStyleBinding() {
    delete document.body.dataset.v517CurrentStyleId;
    delete document.body.dataset.v517CurrentStyleTitle;
    delete document.body.dataset.v517CurrentStyleBrief;
    delete document.body.dataset.v517CurrentRouteId;
    const state = window.PVOS_VISUAL_DIRECTION_STATE || null;
    if (state && state.source === 'quick') {
      window.PVOS_VISUAL_DIRECTION_STATE = {
        contract: state.contract || 'pvos-visual-direction-state@1.0.0',
        routeId: state.routeId || '',
        routeName: state.routeName || '',
        styleId: null,
        styleTitle: null,
        styleLabel: null,
        styleBrief: null,
        source: 'professional',
      };
    }
  }

  function v608SetRoute(routeId, { styleItem = null, source = 'professional', render = true } = {}) {
    if (!routeId || !v517CanonicalRouteExists(routeId)) return false;
    const select = document.getElementById('routeSelect');
    if (styleItem) {
      document.body.dataset.v517CurrentStyleId = styleItem.id || '';
      document.body.dataset.v517CurrentStyleTitle = styleItem.title || '';
      document.body.dataset.v517CurrentStyleBrief = styleItem.brief || '';
      document.body.dataset.v517CurrentRouteId = routeId;
    } else if (source === 'professional') {
      v608ClearQuickStyleBinding();
    }
    if (select) select.value = routeId;
    if (typeof window.choose === 'function') {
      try { window.choose(routeId, true); } catch (err) {}
    }
    if (render && typeof window.renderAll === 'function') window.renderAll();
    window.PVOS_VISUAL_DIRECTION_STATE = {
      contract: 'pvos-visual-direction-state@1.0.0',
      routeId,
      routeName: (typeof window.route === 'function' && window.route()) ? window.route().name_zh : '',
      styleId: styleItem?.id || null,
      styleTitle: styleItem?.title || null,
      styleLabel: styleItem?.title || null,
      styleBrief: styleItem?.brief || null,
      source,
    };
    return true;
  }

  function v608SyncQuickPanelFromProfessionalRoute(routeId) {
    if (!routeId || !v517CanonicalRouteExists(routeId)) return;
    // A professional route selection is authoritative. Clear any simple-panel
    // alias even when it happened to resolve to the same canonical route.
    v608ClearQuickStyleBinding();
    const route = (window.PVOS_LIBRARY?.styles || []).find((item) => item.id === routeId);
    const group = v517RouteGroup(route) || 'portrait';
    v517RenderTemplates('', group);
    v517RenderStyles(group, '');
    const routeBrief = v517BriefFromRoute(route, group);
    const brief = document.getElementById('v517Brief');
    if (brief && !brief.matches(':focus')) brief.value = routeBrief;
    const subjectNote = document.getElementById('subjectNote');
    if (subjectNote) subjectNote.value = routeBrief;
    const sceneSelect = document.getElementById('v517Scene');
    if (sceneSelect) sceneSelect.value = V6_GROUP_SCENE[group] || group;
    if (typeof window.renderAll === 'function') window.renderAll();
    v517UpdateStatus({ next: `专业路线已同步：${route?.name_zh || routeId}` });
    window.PVOS_VISUAL_DIRECTION_STATE = {
      contract: 'pvos-visual-direction-state@1.0.0',
      routeId,
      routeName: route?.name_zh || routeId,
      styleId: null,
      styleTitle: null,
      styleLabel: null,
      styleBrief: null,
      source: 'professional',
    };
  }
  window.v608OnProfessionalRouteChange = v608SyncQuickPanelFromProfessionalRoute;

  function v517ApplyTemplate(templateId, showMessage = false) {
    const item = v517FindStyle(templateId);
    if (!item) return;
    const resolvedRouteId = v517ResolveRouteForStyle(item);
    if (resolvedRouteId) {
      v608SetRoute(resolvedRouteId, { styleItem: item, source: 'quick', render: false });
      v517ResetUnsupportedComponentStack(true);
    } else {
      v608ClearQuickStyleBinding();
      v517ResetUnsupportedComponentStack(false);
    }
    const sceneSelect = document.getElementById('v517Scene');
    if (sceneSelect) sceneSelect.value = item.scene;
    setValue('v517Brief', item.brief);
    setSuggestedLayoutText(item.text);
    v517RenderTemplates(item.id, item.group);
    v517RenderStyles(item.group, item.id);
    v517RenderPoses(item.pose);
    v517ApplyTextMode(item.textMode);
    v517ApplyQuickCreate(showMessage);
  }

  function v517SyncCopy() {
    const text = document.getElementById('v517Text')?.value?.trim() || '';
    const brief = document.getElementById('v517Brief')?.value?.trim() || '';
    setValue('cnInput', text);
    setValue('genPrimaryText', text);
    setValue('layoutText', text ? `主标题：${text}\n副标题：\n姓名：\n日期：` : '主标题：\n副标题：\n姓名：\n日期：');
    setValue('subjectNote', brief);
    const expr = currentExpressionMode();
    const exprLine = expr === 'soft-smile'
      ? 'Expression policy: rebuild a natural relaxed soft smile through cheeks, eyelids, mouth corners, and eye focus together. Keep the person recognizable; avoid stiff grin, frozen eyes, uncanny asymmetry, over-smoothed mouth, and mismatched gaze.'
      : 'Expression policy: preserve the source expression intention, but rebuild facial muscles and eye focus naturally. Full identity preservation means facial features and recognizable gaze logic, not mechanical expression cloning; avoid uncanny frozen eyes, dead stare, tense mouth, and mismatched pupils.';
    // The brief already lives in subjectNote. Keep extra focused on truly
    // additional constraints so GPT prompts do not repeat the same paragraph.
    setValue('extra', exprLine);
    if (typeof window.v5131SetUserText === 'function') window.v5131SetUserText(text);
    if (document.body.dataset.v517RequestedTextMode === 'poster-structure') v517ApplyTextMode('poster-structure');
    v517UpdateStatus();
    v6ScheduleDoubaoPrecompile();
  }

  function v608SyncPromptAdapterState() {
    const provider = currentProviderMode();
    if (typeof window.pvosSetPromptProvider === 'function') window.pvosSetPromptProvider(provider, { compile: false });
    if (typeof window.pvosSetPromptRichness === 'function') window.pvosSetPromptRichness(currentSceneRichness(), { compile: false });
    return provider;
  }

  async function v608CompileCurrentPrompt() {
    const provider = v608SyncPromptAdapterState();
    if (typeof window.pvosCompileProviderPrompt === 'function') {
      const compiled = await window.pvosCompileProviderPrompt(provider, { force: true });
      // Both panels use the same Core Compiler. The simple panel presents a
      // deterministic compact view of the Core GPT prompt; the professional
      // panel keeps the complete standard / rich prompt.
      if (provider === 'gpt-image' && !document.body.classList.contains('v517-pro-workbench-open')) {
        const compact = v517CompactPrompt(compiled || '');
        const box = document.getElementById('promptBox');
        if (box) box.value = compact;
        return compact;
      }
      return compiled || '';
    }
    if (provider === 'doubao-seedream') {
      const result = await v6CompileDoubaoPrompt();
      if (result) v6ApplyDoubaoResult(result);
      return result?.prompt || '';
    }
    return document.getElementById('promptBox')?.value || '';
  }

  function v517ApplyQuickCreate(showMessage = true) {
    const sceneId = document.getElementById('v517Scene')?.value || 'portrait';
    const scene = V517_SCENES[sceneId] || V517_SCENES.portrait;
    const preservedRouteId = (typeof window.route === 'function' && window.route()) ? window.route().id : document.getElementById('routeSelect')?.value || '';
    if (typeof window.v591ApplyTaskPreset === 'function') window.v591ApplyTaskPreset(scene.task, false, { preserveRoute: true });
    if (preservedRouteId && document.getElementById('routeSelect')?.value !== preservedRouteId) {
      setValue('routeSelect', preservedRouteId);
      if (typeof window.choose === 'function') {
        try { window.choose(preservedRouteId, true); } catch (err) {}
      }
    }
    v517SyncCopy();
    v517ApplyTextMode(currentTextMode());
    v517ApplyPose(currentPose());
    if (typeof window.v58QuickDirectorApply === 'function') window.v58QuickDirectorApply(false);
    if (typeof window.switchStage === 'function') window.switchStage('prompt');
    if (typeof window.renderAll === 'function') window.renderAll();
    v6ExposeProviderEngine();
    const provider = currentProviderMode();
    v517UpdateStatus({ next: provider === 'doubao-seedream' ? '正在生成豆包中文 Prompt…' : '正在生成 GPT Prompt…' });
    v517AnchorQuickCreate();
    const promise = v608CompileCurrentPrompt()
      .then((prompt) => {
        if (!prompt) return null;
        v517UpdateStatus({ next: provider === 'doubao-seedream' ? '豆包 Prompt 已生成，可复制或进入排版' : 'GPT Prompt 已生成，可复制或进入排版' });
        if (showMessage && typeof window.showNotif === 'function') window.showNotif(provider === 'doubao-seedream' ? '豆包 Prompt 已生成，可复制' : 'GPT Prompt 已生成，可复制');
        return prompt;
      })
      .catch((err) => {
        if (err?.pvosStale) return null;
        v517UpdateStatus({ next: 'Prompt 生成失败' });
        if (typeof window.showNotif === 'function') window.showNotif('Prompt 编译失败：' + (err?.message || err));
        throw err;
      });
    window.__pvosV608Pending = promise;
    return promise;
  }

  function v517CopyPrompt(btn) {
    const provider = v608SyncPromptAdapterState();
    if (!document.body.classList.contains('v517-pro-workbench-open')) {
      // The simple panel copies exactly the prompt visible to the user.
      v517CopyPromptText(btn);
      return;
    }
    if (typeof window.copyPromptProvider === 'function') {
      window.copyPromptProvider(provider, btn);
      return;
    }
    v517CopyPromptText(btn);
  }

  function v517CopyPromptText(btn) {
    const text = document.getElementById('promptBox')?.value || '';
    if (!text.trim()) {
      if (typeof window.showNotif === 'function') window.showNotif('Prompt 还没有生成');
      return;
    }
    const done = () => {
      if (btn) {
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = old; }, 1200);
      }
      if (typeof window.showNotif === 'function') window.showNotif('Prompt 已复制，可直接粘贴到生图工具');
      v517UpdateStatus({ next: 'Prompt 已复制' });
      sendEvent('prompt_copied', {
        text_strategy: window.v5131TextState ? window.v5131TextState.strategy : null,
        source: 'quick_create',
      });
    };
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
    ta.remove();
    if (copied) {
      done();
      return;
    }
    const fail = () => {
      const box = document.getElementById('promptBox');
      if (box) { box.focus(); box.select(); }
      if (typeof window.showNotif === 'function') window.showNotif('复制失败：Prompt 已选中，请按 Ctrl+C 手动复制');
      v517UpdateStatus({ next: '复制失败，请按 Ctrl+C' });
    };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fail);
      else fail();
    } catch (err) {
      fail();
    }
  }

  function v517UpdateStatus(update) {
    if (update?.next) document.body.dataset.v517DecisionAction = update.next;
    v517RenderDecisionPanel(update?.next);
  }

  function v517SetProWorkbench(open) {
    document.body.classList.toggle('v517-pro-workbench-open', !!open);
    const button = document.getElementById('v517ProWorkbenchBtn');
    if (button) button.textContent = open ? '收起专业指令面板' : '打开专业指令面板';
    if (open) {
      if (typeof window.switchWs === 'function') window.switchWs('workbench');
      setTimeout(() => document.querySelector('#ws-workbench>.workspace')?.scrollIntoView({ block: 'nearest' }), 20);
    }
  }

  function v517InstallLayoutCanvasTools() {
    if (window.__v517LayoutCanvasToolsInstalled) return;
    window.__v517LayoutCanvasToolsInstalled = true;
    const slotById = {
      lsMainTitle: 'enPrimaryTitle',
      lsCnTitle: 'cnPrimaryTitle',
      lsSubtitle: 'cnSupportingText',
      lsMicroLayer: 'enSupportingText',
      lsSeal: 'sealAndCaption',
    };
    const labels = {
      lsMainTitle: '英文标题',
      lsCnTitle: '中文标题',
      lsSubtitle: '副标题',
      lsMicroLayer: '信息层',
      lsSeal: '题签',
    };
    const storageKey = 'pvos.v517.layoutLayerPositions.v1';
    const readState = () => {
      try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (err) { return {}; }
    };
    const writeState = (state) => {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (err) {}
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const posterPoint = (poster, event) => {
      const rect = poster.getBoundingClientRect();
      return {
        x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 96),
        y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 96),
      };
    };
    const applySavedPosition = (el) => {
      const saved = readState()[el.id];
      if (!saved) return;
      if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        el.style.left = `${saved.left}%`;
        el.style.top = `${saved.top}%`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    };
    const savePosition = (el) => {
      const state = readState();
      state[el.id] = {
        left: parseFloat(el.style.left || '0'),
        top: parseFloat(el.style.top || '0'),
      };
      writeState(state);
    };
    const setLayerPosition = (el, left, top) => {
      el.style.left = `${clamp(left, 0, 94)}%`;
      el.style.top = `${clamp(top, 0, 94)}%`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const resizeLayer = (el, size, commit = false) => {
      const nextSize = clamp(size, 7, 150);
      el.style.fontSize = `${nextSize}px`;
      if (commit && el.dataset.v517Slot && typeof window.v5114UpdateStyle === 'function') {
        window.v5114UpdateStyle(el.dataset.v517Slot, 'fontSizePx', nextSize);
      }
    };
    const addGuideLabels = () => {
      const poster = document.getElementById('lsPoster');
      if (!poster) return;
      const zoneText = { face: '脸部避让', masthead: '标题区', bottom: '底部信息', mask: '人物轮廓', hand: '手部避让', signage: '环境文字' };
      Object.entries(zoneText).forEach(([cls, text]) => {
        const zone = poster.querySelector(`.v55-zone.${cls}`);
        if (zone) zone.textContent = text;
      });
      if (!poster.dataset.v517Labels) {
        poster.dataset.v517Labels = 'true';
        poster.insertAdjacentHTML('beforeend', [
          '<span class="v517-line-label safe">安全边距</span>',
          '<span class="v517-line-label face">脸部避让</span>',
          '<span class="v517-line-label masthead">标题区</span>',
          '<span class="v517-line-label bottom">底部信息</span>',
          '<span class="v517-line-label hand">手部避让</span>',
        ].join(''));
      }
    };
    const addLegend = () => {
      const box = document.querySelector('#ws-layoutStudio .avoidance-box');
      if (!box || document.getElementById('v517GuideLegend')) return;
      box.insertAdjacentHTML('afterend', '<div id="v517GuideLegend" class="v517-guide-legend"><span>黄线：可排文字</span><span>红线：脸部避让</span><span>蓝线：人物轮廓</span><span>橙线：手部避让</span></div>');
    };
    const beginDrag = (el, event) => {
      if (!el || event.__v517DragStarted) return;
      event.__v517DragStarted = true;
      const poster = document.getElementById('lsPoster');
      if (!poster || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const resizing = !!event.target.closest('.v517-drag-handle');
      const moveEventName = event.type === 'mousedown' ? 'mousemove' : 'pointermove';
      const upEventName = event.type === 'mousedown' ? 'mouseup' : 'pointerup';
      const start = posterPoint(poster, event);
      const rect = el.getBoundingClientRect();
      const posterRect = poster.getBoundingClientRect();
      const startLeft = ((rect.left - posterRect.left) / posterRect.width) * 100;
      const startTop = ((rect.top - posterRect.top) / posterRect.height) * 100;
      const startSize = parseFloat(getComputedStyle(el).fontSize || '12');
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      el.classList.add('v517-dragging');
      el.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const now = posterPoint(poster, moveEvent);
        if (resizing) {
          const delta = ((moveEvent.clientX - startClientX) + (moveEvent.clientY - startClientY)) * 0.35;
          resizeLayer(el, startSize + delta, false);
        } else {
          const nextLeft = clamp(startLeft + (now.x - start.x), 0, 94);
          const nextTop = clamp(startTop + (now.y - start.y), 0, 94);
          setLayerPosition(el, nextLeft, nextTop);
        }
      };
      const up = () => {
        el.classList.remove('v517-dragging');
        el.releasePointerCapture?.(event.pointerId);
        document.removeEventListener(moveEventName, move);
        document.removeEventListener(upEventName, up);
        if (resizing) resizeLayer(el, parseFloat(getComputedStyle(el).fontSize || '12'), true);
        savePosition(el);
      };
      document.addEventListener(moveEventName, move);
      document.addEventListener(upEventName, up, { once: true });
    };
    const installLayer = (el) => {
      if (!el) return;
      el.dataset.v517Slot = slotById[el.id] || '';
      el.title = `${labels[el.id] || '文字层'}：拖动改位置，拖右下角改大小`;
      el.classList.add('v517-drag-layer');
      applySavedPosition(el);
      if (!el.querySelector(':scope > .v517-drag-handle')) {
        el.insertAdjacentHTML('beforeend', '<i class="v517-drag-handle" aria-hidden="true"></i>');
      }
      if (el.dataset.v517DragReady) return;
      el.dataset.v517DragReady = 'true';
      el.addEventListener('pointerdown', (event) => beginDrag(el, event));
      el.addEventListener('mousedown', (event) => beginDrag(el, event));
    };
    document.addEventListener('pointerdown', (event) => {
      const el = event.target.closest?.('.v517-drag-layer');
      if (el && slotById[el.id]) beginDrag(el, event);
    }, true);
    document.addEventListener('mousedown', (event) => {
      const el = event.target.closest?.('.v517-drag-layer');
      if (el && slotById[el.id]) beginDrag(el, event);
    }, true);
    window.v517MoveLayoutLayer = function(id, dxPx, dyPx) {
      const el = document.getElementById(id);
      const poster = document.getElementById('lsPoster');
      if (!el || !poster) return false;
      const rect = el.getBoundingClientRect();
      const posterRect = poster.getBoundingClientRect();
      const left = ((rect.left - posterRect.left + Number(dxPx || 0)) / posterRect.width) * 100;
      const top = ((rect.top - posterRect.top + Number(dyPx || 0)) / posterRect.height) * 100;
      setLayerPosition(el, left, top);
      savePosition(el);
      return true;
    };
    window.v517ResizeLayoutLayer = function(id, deltaPx) {
      const el = document.getElementById(id);
      if (!el) return false;
      const size = parseFloat(getComputedStyle(el).fontSize || '12') + Number(deltaPx || 0);
      resizeLayer(el, size, true);
      return true;
    };
    const apply = () => {
      addGuideLabels();
      addLegend();
      Object.keys(slotById).forEach((id) => installLayer(document.getElementById(id)));
    };
    const oldRenderAll = window.renderAll;
    if (typeof oldRenderAll === 'function') {
      window.renderAll = function() {
        const result = oldRenderAll.apply(this, arguments);
        setTimeout(apply, 0);
        return result;
      };
    }
    const oldSwitchWs = window.switchWs;
    if (typeof oldSwitchWs === 'function') {
      window.switchWs = function(name) {
        if (name !== 'workbench') v517SetProWorkbench(false);
        const result = oldSwitchWs.apply(this, arguments);
        if (name === 'layoutStudio') setTimeout(apply, 0);
        return result;
      };
    }
    setTimeout(apply, 0);
  }

  function v517RouteName() {
    try {
      const selectedRoute = typeof window.route === 'function' ? window.route() : null;
      return selectedRoute?.name_zh || document.getElementById('routeSelect')?.selectedOptions?.[0]?.textContent || '当前画面方向';
    } catch (err) {
      return '当前画面方向';
    }
  }

  function v608QuickDirectionMeta() {
    const selectedRoute = typeof window.route === 'function' ? window.route() : null;
    const currentRouteId = selectedRoute?.id || document.getElementById('routeSelect')?.value || '';
    const boundRoute = document.body.dataset.v517CurrentRouteId || '';
    const quickTitle = document.body.dataset.v517CurrentStyleTitle || '';
    const quickBrief = document.body.dataset.v517CurrentStyleBrief || '';
    if (currentRouteId && boundRoute === currentRouteId && (quickTitle || quickBrief)) {
      return { title: quickTitle, brief: quickBrief, routeId: currentRouteId, source: 'quick' };
    }
    const state = window.PVOS_VISUAL_DIRECTION_STATE || null;
    if (state && state.source === 'quick' && state.routeId === currentRouteId) {
      return {
        title: String(state.styleTitle || state.styleLabel || '').trim(),
        brief: String(state.styleBrief || '').trim(),
        routeId: currentRouteId,
        source: 'quick',
      };
    }
    return { title: '', brief: '', routeId: currentRouteId, source: 'professional' };
  }

  function v608ActiveDirectionName() {
    try {
      const selectedRoute = typeof window.route === 'function' ? window.route() : null;
      const quick = v608QuickDirectionMeta();
      if (quick.title) return quick.title;
      return selectedRoute?.name_zh || v517RouteName();
    } catch (err) {
      return v517RouteName();
    }
  }

  function v517RouteCorePrompt() {
    try {
      const selectedRoute = typeof window.route === 'function' ? window.route() : null;
      return selectedRoute?.prompt_core_en || selectedRoute?.summary || '';
    } catch (err) {
      return '';
    }
  }

  function v517ExtractKeptBlocks(sourceText) {
    const keepHeading = /^(CURATED STYLE VARIANT|TYPOGRAPHY HYBRID RECIPE|TEXT PARTICIPATION STRATEGY|SELECTED TYPOGRAPHY GRAMMAR|GENERATIVE TYPOGRAPHY INFLUENCE|\[SELECTED VISUAL TEMPLATE\]|\[ROUTE MOTION GRAMMAR|场景预设\s*—|服装与大型道具\s*—|构图模块\s*—|光影预设\s*—)/i;
    const headingBoundary = /^(?:[A-Z][A-Z0-9 ,/&()\-–—]+:|\[[^\]]+\]|场景预设\s*—|服装与大型道具\s*—|构图模块\s*—|光影预设\s*—)/;
    const dropLine = /(Layout Studio|SVG\s*\/\s*HTML|font[- ]slot|overlay layer|later SVG|later HTML|post-layout layer|future overlay zones|exact readable typography belongs|download|export|replacement checklist)/i;
    const blocks = [];
    let current = [];
    let keeping = false;
    const flush = () => {
      if (!keeping || !current.length) { current = []; return; }
      const block = current.filter((line) => !dropLine.test(line)).join('\n').trim();
      if (block) blocks.push(block);
      current = [];
    };
    String(sourceText || '').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (keeping && current.length) current.push('');
        return;
      }
      if (headingBoundary.test(trimmed)) {
        flush();
        keeping = keepHeading.test(trimmed);
        current = keeping ? [trimmed] : [];
        return;
      }
      if (keeping) current.push(line);
    });
    flush();
    const seen = new Set();
    return blocks.filter((block) => {
      const key = block.replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join('\n\n');
  }

  function v517ExposePromptSystem(meta) {
    window.PVOS_V6_PROMPT_SYSTEM = {
      contract: 'v6-prompt-quality-system@0.2.0',
      sections: V6_PROMPT_QUALITY_SECTIONS.slice(),
      maxPublicWords: 950,
      defaultPromptVisible: false,
      expressionModes: ['source-natural', 'soft-smile'],
      textStrategy: meta.strategy,
      textStrategyEffective: meta.effectiveStrategy,
      route: meta.routeName,
      wordCount: meta.wordCount,
      componentResetIds: V6_COMPONENT_STACK_IDS.slice(),
    };
  }

  function v517CompactPrompt(sourceText) {
    const routeName = v608ActiveDirectionName();
    const routeCore = v517RouteCorePrompt();
    const title = document.getElementById('v5131GenerationText')?.value?.trim()
      || document.getElementById('v517Text')?.value?.trim()
      || document.getElementById('cnInput')?.value?.trim()
      || '';
    const brief = document.getElementById('v517Brief')?.value?.trim() || document.getElementById('subjectNote')?.value?.trim() || '';
    const pose = document.querySelector('.v517-pose.active b')?.textContent?.trim() || 'natural portrait posture';
    const requestedStrategy = window.v5131TextState?.strategy || 'reserve-space';
    const strategy = currentTextMode() === 'poster-structure'
      ? (title ? 'integrated-text' : 'poster-layout')
      : (requestedStrategy === 'integrated-text' && !title ? 'reserve-space' : requestedStrategy);
    const relation = window.v5131TextState?.relation || 'independent-layout';
    const strategyHeading = V517_STRATEGY_HEADINGS[strategy] || V517_STRATEGY_HEADINGS['reserve-space'];
    const relationLabel = V517_RELATION_LABELS[relation] || relation;
    const keptBlocks = v517ExtractKeptBlocks(sourceText);
    const expression = currentExpressionMode() === 'soft-smile'
      ? 'Use a natural soft smile only. Build it through cheeks, eyelids, mouth corners, and eye focus together; avoid forced grin, frozen gaze, or uncanny asymmetry.'
      : 'Preserve the source expression intention only. Full preservation means facial features, landmark geometry, proportions, hairstyle silhouette, and distinctive marks; rebuild expression and eye focus as a living face instead of mechanically cloning the source.';
    const textRule = strategy === 'integrated-text'
      ? `Use the phrase “${title}” as the only intentional text anchor. Keep it away from eyes, nose bridge, mouth, jawline, and active hands.`
      : strategy === 'clean'
        ? 'Create a complete clean image base with no readable text, no fake labels, and no random lettering.'
        : strategy === 'poster-layout'
          ? 'Build an explicit editable poster skeleton: a primary headline container, a bottom information band, one or two restrained supporting graphic blocks, and protected portrait zones. Do not render readable words, letters, numbers, placeholder copy, or pseudo-text.'
          : 'Reserve clean negative space for later accurate layout. Do not render readable words inside the base image.';
    const compact = [
      'IMAGE EDITING CREATIVE BRIEF',
      `Selected visual direction: ${routeName}.`,
      brief ? `User intent: ${brief}` : '',
      '',
      'REFERENCE ROLE:',
      'Use uploaded photographs for facial identity, hairstyle silhouette, age impression, and distinctive traits. Re-stage pose, clothing, and environment naturally when the selected direction requires it.',
      '',
      'ART DIRECTION:',
      `${routeCore || 'Create a polished portrait or poster-ready image with coherent light, natural anatomy, believable body proportions, and a clear visual hierarchy.'} Pose direction: ${pose}.`,
      keptBlocks ? `\nROUTE, TEMPLATE, COMPONENT, AND TYPOGRAPHY GRAMMAR:\n${keptBlocks}` : '',
      '',
      'IDENTITY, EXPRESSION, AND GAZE:',
      `${expression} Keep eyes alive, aligned, and focused. Protect pupils, catchlights, eyelids, mouth tension, and facial volume.`,
      '',
      'BODY, POSE, AND ANATOMY:',
      'Match the uploaded person with believable body proportions, neck length, shoulder width, weight distribution, hands, and wardrobe scale. Avoid mismatched body shape, mannequin posture, rigid symmetry, and twisted joints.',
      '',
      'SCENE, COMPOSITION, LIGHT, AND MATERIAL:',
      'Build one coherent staging world with readable depth, contact shadows, and restrained key-light logic. If eyewear or glass appears, keep lenses transparent with subtle physical reflections; reduce glare before hiding identity.',
      '',
      V6_SCENE_RICHNESS_EN[currentSceneRichness()] || V6_SCENE_RICHNESS_EN.standard,
      '',
      strategyHeading + ':',
      textRule,
      strategy === 'poster-layout' ? `\nPOSTER LAYOUT SKELETON:\n${v6PosterLayoutSkeletonForApi() || V6_GROUP_POSTER_LAYOUT_SKELETON.poster}` : '',
      strategy === 'poster-layout' ? `\nLAYOUT REFERENCE RULE:\n${v6TemplateReferenceHint(v6TemplateReferenceModeForApi())}` : '',
      '',
      `TYPOGRAPHY COMPOSITION RELATION — ${relationLabel}:`,
      title
        ? `Keep planned typography as a disciplined layout layer. User-supplied phrase: ${title}.`
        : 'Keep planned typography as a disciplined layout layer. No concrete phrase has been entered, so do not render readable headline text in the base image.',
      '',
      'TYPOGRAPHY OUTPUT CONTRACT:',
      'Accurate titles, names, dates, captions, and seals belong to the later layout layer unless the selected strategy asks for one short anchor. Do not invent logos, watermarks, pseudo-text, captions, or random letters.',
      '',
      'NEGATIVE CONSTRAINTS:',
      'Avoid duplicate faces, changed identity, body-proportion mismatch, stiff expression, frozen smile, dead eyes, mismatched gaze through glass, theatrical eyeglass reflections, muddy overlaps, hidden neck, collar choking the throat, extra fingers, random text, logos, and watermark-like marks.',
      '',
      'FINAL PRIORITY:',
      'Make the person recognizable, alive, and naturally staged. Preserve facial identity first, then expression credibility, then composition clarity, then typography-safe space.',
    ].filter(Boolean).join('\n');
    const originalWords = String(sourceText || '').trim().split(/\s+/).filter(Boolean).length;
    const compactWords = compact.trim().split(/\s+/).filter(Boolean).length;
    v517UpdatePromptSummary(originalWords, compactWords);
    v517ExposePromptSystem({
      strategy: requestedStrategy,
      effectiveStrategy: strategy,
      routeName,
      wordCount: compactWords,
    });
    return compact;
  }

  window.v517CompactPrompt = v517CompactPrompt;

  function v517UpdatePromptSummary(originalWords, compactWords) {
    const box = document.getElementById('v517PromptStats');
    if (!box) return;
    const saved = Math.max(0, originalWords - compactWords);
    box.innerHTML = `<span>生成 Prompt：${compactWords} 词</span><span>移除目录索引与冗余说明：${saved} 词</span><span>完整文本默认折叠</span>`;
  }

  function v517WrapPromptBox() {
    const box = document.getElementById('promptBox');
    if (!box || document.getElementById('v517PromptDetails')) return;
    const summary = document.createElement('section');
    summary.className = 'v517-prompt-summary';
    summary.innerHTML = '<h3>Prompt 已准备好</h3><p>默认隐藏完整 Prompt，只保留可复制的生成指令。一级/二级目录和数据节点不会进入生成文本。</p><div id="v517PromptStats" class="v517-prompt-stats"></div>';
    const details = document.createElement('details');
    details.id = 'v517PromptDetails';
    details.className = 'v517-prompt-details';
    details.innerHTML = '<summary>查看完整生成 Prompt</summary>';
    box.parentNode.insertBefore(summary, box);
    box.parentNode.insertBefore(details, box);
    details.appendChild(box);
  }

  function v517InstallPromptGovernance() {
    if (window.__v517PromptGovernanceInstalled) return;
    window.__v517PromptGovernanceInstalled = true;
    const compactCurrent = () => {
      const box = document.getElementById('promptBox');
      if (!box || box.dataset.v517Internal) return;
      box.dataset.v517Internal = 'true';
      box.value = v517CompactPrompt(box.value);
      delete box.dataset.v517Internal;
    };
    const oldRenderPrompt = window.renderPrompt;
    if (typeof oldRenderPrompt === 'function') {
      window.renderPrompt = function() {
        const result = oldRenderPrompt.apply(this, arguments);
        compactCurrent();
        return result;
      };
    }
    const oldRenderAll = window.renderAll;
    if (typeof oldRenderAll === 'function') {
      window.renderAll = function() {
        const result = oldRenderAll.apply(this, arguments);
        compactCurrent();
        return result;
      };
    }
    setTimeout(() => {
      v517WrapPromptBox();
      compactCurrent();
    }, 0);
  }

  function v517InstallRouteFixes() {
    if (window.__v517RouteFixesInstalled) return;
    window.__v517RouteFixesInstalled = true;
    const syncRouteButtons = () => {
      const open = document.body.classList.contains('v591-route-browser-open');
      const top = document.getElementById('v5111RouteBrowserTopBtn');
      const internal = document.getElementById('v591RouteBrowserBtn');
      if (top) top.textContent = open ? '收起路线库' : '打开路线库';
      if (internal) internal.textContent = open ? '收起路线库' : '打开路线库';
    };
    const oldToggle = window.v591ToggleRouteBrowser;
    const setRouteBrowser = (force) => {
      const shouldOpen = typeof force === 'boolean'
        ? force
        : !document.body.classList.contains('v591-route-browser-open');
      if (shouldOpen && !document.body.classList.contains('v517-pro-workbench-open')) {
        document.body.dataset.v517RouteOpenedPro = 'true';
        v517SetProWorkbench(true);
      } else if (shouldOpen) {
        delete document.body.dataset.v517RouteOpenedPro;
      }
      if (typeof oldToggle === 'function') {
        oldToggle.call(window, shouldOpen);
      } else {
        document.body.classList.toggle('v591-route-browser-open', shouldOpen);
      }
      syncRouteButtons();
      if (!shouldOpen && document.body.dataset.v517RouteOpenedPro === 'true') {
        delete document.body.dataset.v517RouteOpenedPro;
        v517SetProWorkbench(false);
      }
      v517AnchorQuickCreate();
    };
    window.v591ToggleRouteBrowser = setRouteBrowser;
    const top = document.getElementById('v5111RouteBrowserTopBtn');
    if (top) {
      top.onclick = function() {
        setRouteBrowser();
      };
    }
    document.querySelectorAll('.v591-sidebar-close').forEach((button) => {
      button.onclick = () => setRouteBrowser(false);
    });
    const oldChoose = window.choose;
    if (typeof oldChoose === 'function') {
      window.choose = function(id, apply) {
        const showAll = document.getElementById('showAllComponents');
        if (showAll) showAll.checked = false;
        const result = oldChoose.apply(this, arguments);
        if (typeof window.refreshComponents === 'function') window.refreshComponents(true);
        v517AnchorQuickCreate();
        return result;
      };
    }
    syncRouteButtons();
  }

  function v517Bind() {
    document.getElementById('v517CreateBtn')?.addEventListener('click', () => v517ApplyQuickCreate(true));
    document.getElementById('v517CopyPromptBtn')?.addEventListener('click', (event) => v517CopyPrompt(event.currentTarget));
    document.getElementById('v517LayoutBtn')?.addEventListener('click', () => {
      v517ApplyQuickCreate(false);
      v517UpdateStatus({ next: '进入成品排版' });
      if (typeof window.switchWs === 'function') window.switchWs('layoutStudio');
    });
    document.getElementById('v517ProWorkbenchBtn')?.addEventListener('click', () => v517SetProWorkbench(!document.body.classList.contains('v517-pro-workbench-open')));
    document.getElementById('v517WorkbenchClose')?.addEventListener('click', () => v517SetProWorkbench(false));
    document.getElementById('v517Scene')?.addEventListener('change', () => v517ApplySceneDefaults(true));
    document.getElementById('v517Text')?.addEventListener('input', v517SyncCopy);
    document.getElementById('v517Brief')?.addEventListener('input', v517SyncCopy);
    document.getElementById('v517PoseGrid')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-pose');
      if (!button) return;
      v517ApplyPose(button.dataset.pose);
      if (typeof window.renderAll === 'function') window.renderAll();
    });
    document.getElementById('v517TextMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-seg');
      if (!button) return;
      document.querySelectorAll('#v517TextMode .v517-seg').forEach((item) => item.classList.toggle('active', item === button));
      v517ApplyTextMode(button.dataset.mode);
      v517UpdateStatus({ text: button.textContent.trim() });
      if (typeof window.renderAll === 'function') window.renderAll();
    });
    document.getElementById('v517ExpressionMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-seg');
      if (!button) return;
      document.querySelectorAll('#v517ExpressionMode .v517-seg').forEach((item) => item.classList.toggle('active', item === button));
      v517SyncCopy();
      v517UpdateStatus();
      if (typeof window.renderAll === 'function') window.renderAll();
    });
    document.getElementById('v517TemplateGrid')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-template');
      if (!button) return;
      v517OpenTemplateGroup(button.dataset.group, button.dataset.template);
    });
    document.getElementById('v517StyleGrid')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-style-card');
      if (!button) return;
      v517ApplyTemplate(button.dataset.style);
    });
    document.getElementById('v6ProviderMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-seg');
      if (!button) return;
      document.querySelectorAll('#v6ProviderMode .v517-seg').forEach((item) => item.classList.toggle('active', item === button));
      v6SetSceneRichness(V6_PROVIDER_DEFAULT_RICHNESS[button.dataset.provider] || 'standard');
      v6UpdateProviderNote();
      v6ExposeProviderEngine();
      v608SyncPromptAdapterState();
      v517UpdateStatus({ next: button.dataset.provider === 'doubao-seedream' ? '提示词适配：豆包 Seedream' : '提示词适配：GPT 生图' });
      v517ApplyQuickCreate(false).catch(() => {});
    });
    document.getElementById('v6TemplateReferenceMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-seg');
      if (!button) return;
      v6SetTemplateReferenceMode(button.dataset.templateReference);
      v6ExposeProviderEngine();
      if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
      v517UpdateStatus({ next: button.dataset.templateReference === 'attached' ? '模板图规则：最后一张图只参考版式结构' : '模板图规则已更新' });
      v517ApplyQuickCreate(false).catch(() => {});
    });
    document.getElementById('v6SceneRichness')?.addEventListener('click', (event) => {
      const button = event.target.closest('.v517-seg');
      if (!button) return;
      document.querySelectorAll('#v6SceneRichness .v517-seg').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-pvos-richness]').forEach((item) => item.classList.toggle('primary', item.dataset.pvosRichness === button.dataset.richness));
      v6ExposeProviderEngine();
      v608SyncPromptAdapterState();
      if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
      v517ApplyQuickCreate(false).catch(() => {});
    });
    v6ExposeProviderEngine();
  }

  function v517PruneLegacySurfaces() {
    const apply = () => {
      const assetTitle = document.querySelector('#ws-assetLibrary .drawer-head h2');
      if (assetTitle && assetTitle.textContent.trim() !== '素材库') assetTitle.textContent = '素材库';
      document.querySelectorAll('#ws-assetLibrary button').forEach((button) => {
        const text = button.textContent.trim();
        if (text === '用于生图气质') button.textContent = '用于生图';
        if (text === '应用到当前排版') button.textContent = '用于排版';
        if (text === '查看参考与边界') button.textContent = '查看边界';
        if (text === '查看双通道规则') button.textContent = '查看规则';
      });
    };
    apply();
    const drawer = document.getElementById('drawer');
    if (drawer && !drawer.dataset.v517Pruned) {
      drawer.dataset.v517Pruned = '1';
      let pending = false;
      const schedule = () => {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(() => {
          pending = false;
          apply();
        });
      };
      new MutationObserver(schedule).observe(drawer, { childList: true, subtree: true });
    }
  }

  function initV517Experience() {
    v517InjectStyles();
    const wait = () => {
      if (document.querySelector('#ws-workbench .controls')) {
        v517Mount();
        v517InstallPromptGovernance();
        v517InstallRouteFixes();
        v517InstallLayoutCanvasTools();
        v517PruneLegacySurfaces();
        const version = document.querySelector('.version');
        if (version) version.textContent = 'V6.1.1 · 海报骨架双轨版 · Visual Core 5.16.1';
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  }

  // ========================================================================
  // Add buttons to topbar
  // ========================================================================

  function addTopbarButtons() {
    // Wait for topbar to be ready
    const waitForTopbar = () => {
      const topActions = document.querySelector('.top-actions');
      if (!topActions) {
        setTimeout(waitForTopbar, 100);
        return;
      }

      // Check if already added
      if (document.getElementById('pvos-feedback-btn')) return;

      // Insert feedback and submission buttons before the theme toggle
      const feedbackBtn = document.createElement('button');
      feedbackBtn.id = 'pvos-feedback-btn';
      feedbackBtn.className = 'btn ghost';
      feedbackBtn.type = 'button';
      feedbackBtn.textContent = '反馈';
      feedbackBtn.onclick = pvosOpenFeedback;
      feedbackBtn.style.cssText = 'font-size:11px;';

      const submitBtn = document.createElement('button');
      submitBtn.id = 'pvos-submit-btn';
      submitBtn.className = 'btn ghost';
      submitBtn.type = 'button';
      submitBtn.textContent = '投稿';
      submitBtn.onclick = pvosOpenSubmission;
      submitBtn.style.cssText = 'font-size:11px;';

      const telemetryBtn = document.createElement('button');
      telemetryBtn.id = 'pvos-telemetry-btn';
      telemetryBtn.className = 'btn ghost';
      telemetryBtn.type = 'button';
      telemetryBtn.onclick = toggleTelemetryConsent;
      telemetryBtn.style.cssText = 'font-size:11px;';

      const supportMenu = document.createElement('details');
      supportMenu.id = 'pvos-support-menu';
      supportMenu.className = 'pvos-support-menu';
      supportMenu.innerHTML = '<summary class="btn ghost">支持</summary><div class="pvos-support-popover" aria-label="支持工具"></div>';
      const supportBody = supportMenu.querySelector('.pvos-support-popover');
      supportBody.appendChild(feedbackBtn);
      supportBody.appendChild(submitBtn);
      supportBody.appendChild(telemetryBtn);

      const themeToggle = document.getElementById('v5111ThemeToggle');
      if (themeToggle) {
        topActions.insertBefore(supportMenu, themeToggle);
      } else {
        topActions.appendChild(supportMenu);
      }
      updateTelemetryButton();
    };

    waitForTopbar();
  }

  // ========================================================================
  // Hook into existing functions
  // ========================================================================

  function installHooks() {
    // Count prompt-copy telemetry only after a copy implementation reports real success.
    // Never increment analytics on click alone: clipboard permission can fail.
    if (!window.__pvosCopySuccessTelemetryInstalled) {
      window.__pvosCopySuccessTelemetryInstalled = true;
      window.addEventListener('pvos:prompt-copy-success', function(event) {
        sendEvent('prompt_copied', {
          text_strategy: window.v5131TextState ? window.v5131TextState.strategy : null,
          source: event?.detail?.source || 'prompt-copy',
        });
      });
    }

    // Hook route selection - choose() function (not select())
    const oldChoose = window.choose;
    if (typeof oldChoose === 'function') {
      window.choose = function(id, silent) {
        const result = oldChoose.apply(this, arguments);
        if (id) {
          sendEvent('route_selected', { route_id: id });
          if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
        }
        return result;
      };
    }

    // Hook text strategy change - v5131SetTextStrategy
    const oldSetStrategy = window.v5131SetTextStrategy;
    if (oldSetStrategy) {
      window.v5131SetTextStrategy = function(v) {
        sendEvent('text_strategy_changed', {
          text_strategy: v,
          route_id: window.route ? window.route().id : null
        });
        const result = oldSetStrategy.apply(this, arguments);
        if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
        return result;
      };
    }

    // Any text-relation or user-copy update also invalidates in-flight prompt compilation.
    const oldSetRelation = window.v5131SetRelation;
    if (oldSetRelation) {
      window.v5131SetRelation = function(v) {
        const result = oldSetRelation.apply(this, arguments);
        if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
        return result;
      };
    }
    const oldSetUserText = window.v5131SetUserText;
    if (oldSetUserText) {
      window.v5131SetUserText = function(v) {
        const result = oldSetUserText.apply(this, arguments);
        if (typeof window.pvosMarkPromptDirty === 'function') window.pvosMarkPromptDirty();
        return result;
      };
    }

    // Hook stage switching - switchStage (for layout tab within stage)
    const oldSwitchStage = window.switchStage;
    if (oldSwitchStage) {
      window.switchStage = function(name) {
        if (name === 'layout') {
          sendEvent('layout_opened', {
            route_id: window.route ? window.route().id : null
          });
        }
        return oldSwitchStage.apply(this, arguments);
      };
    }

    // Hook workspace switching - switchWs (for Layout Studio tab)
    const oldSwitchWs = window.switchWs;
    if (oldSwitchWs) {
      window.switchWs = function(name) {
        if (name === 'layoutStudio') {
          sendEvent('layout_opened', {
            route_id: window.route ? window.route().id : null
          });
        }
        return oldSwitchWs.apply(this, arguments);
      };
    }

    // Hook file upload - track base_image_uploaded
    const oldHandleUpload = window.handleUpload;
    if (oldHandleUpload) {
      window.handleUpload = function(e) {
        const result = oldHandleUpload.apply(this, arguments);
        if (e?.target?.files?.length > 0) {
          sendEvent('base_image_uploaded', {
            route_id: window.route ? window.route().id : null
          });
        }
        return result;
      };
    }

    // Hook upload button trigger - v5111TriggerBaseUpload
    const oldTriggerBaseUpload = window.v5111TriggerBaseUpload;
    if (oldTriggerBaseUpload) {
      window.v5111TriggerBaseUpload = function() {
        // Just trigger the upload, event will fire when file is selected
        return oldTriggerBaseUpload.apply(this, arguments);
      };
    }

    // Hook poster export - track poster_exported via v5111ExportFinishedPoster
    const oldExportFinishedPoster = window.v5111ExportFinishedPoster;
    if (oldExportFinishedPoster) {
      window.v5111ExportFinishedPoster = function(btn) {
        sendEvent('poster_exported', {
          route_id: window.route ? window.route().id : null
        });
        return oldExportFinishedPoster.apply(this, arguments);
      };
    } else if (window.exportFinishedPoster) {
      // Fallback to direct exportFinishedPoster
      const oldExport = window.exportFinishedPoster;
      window.exportFinishedPoster = function() {
        sendEvent('poster_exported', {
          route_id: window.route ? window.route().id : null
        });
        return oldExport.apply(this, arguments);
      };
    }
  }

  // ========================================================================
  // App open event
  // ========================================================================

  function trackAppOpen() {
    sendEvent('app_open', {
      release_version: VERSION
    });
  }

  // ========================================================================
  // Initialize when DOM is ready
  // ========================================================================

  function init() {
    initV517Experience();
    addTopbarButtons();
    installHooks();
    trackAppOpen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500); // Small delay to ensure other scripts are loaded
  }

})();
