// ---------- AI Chat — frontend ----------
// State : window.aiChatHistory (session only, not persisted)
// Uses : api(), toast()
// Integration : wizard (wizOpen), day editor (openExistingDay)

/* Markdown rendering helpers (lightweight — no external lib needed) */

function _aiRenderInline(text) {
  var s = escapeHtml(text);
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function _aiRenderMarkdown(text) {
  if (!text) return '';
  var lines = text.split('\n');
  var html = '';
  var inCodeBlock = false;
  var codeContent = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Code block fences
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        html += '<pre><code>' + escapeHtml(codeContent.replace(/\n$/, '')) + '</code></pre>';
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeContent = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    var trimmed = line.trim();

    // Headings
    if (/^#{1,4}\s/.test(trimmed)) {
      var level = trimmed.match(/^#{1,4}/)[0].length;
      var hContent = _aiRenderInline(trimmed.replace(/^#+\s*/, ''));
      html += '<h' + level + '>' + hContent + '</h' + level + '>';
      continue;
    }

    // Blockquote
    if (/^>\s/.test(trimmed)) {
      html += '<blockquote>' + _aiRenderInline(trimmed.replace(/^>\s*/, '')) + '</blockquote>';
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(trimmed)) {
      html += '<hr>';
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      html += '<li>' + _aiRenderInline(trimmed.replace(/^[-*+]\s*/, '')) + '</li>';
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      html += '<li value="' + trimmed.match(/^\d+/)[0] + '">' + _aiRenderInline(trimmed.replace(/^\d+\.\s*/, '')) + '</li>';
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      html += '</p><p>';
      continue;
    }

    // Regular text
    html += _aiRenderInline(line) + ' ';
  }

  if (inCodeBlock) {
    html += '<pre><code>' + escapeHtml(codeContent.replace(/\n$/, '')) + '</code></pre>';
  }

  // Wrap list items
  html = html.replace(/(<li[^>]*>.*?<\/li>)((?!<\/?li|<pre|<code|<\/p>).)*/gs, function(m) {
    var items = m.match(/<li[^>]*>.*?<\/li>/g);
    if (items && items.length > 1) {
      return '<ul>' + items.join('') + '</ul>';
    }
    return m;
  });

  // Wrap ordered list items
  html = html.replace(/((?:<li value="\d+".*?<\/li>)+)/g, function(m) {
    return '<ol>' + m + '</ol>';
  });

  // Trim and wrap
  html = html.trim();
  html = '<p>' + html + '</p>';
  // Clean double paragraph wraps
  html = html.replace(/<\/p>\s*<p>/g, '</p><p>');
  // Remove empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

/* Parse action markers from AI response */

function _aiParseActions(text) {
  var actions = [];
  var regex = /\[(wizOpen|openDay):\s*(\{[^}]+\})\]/g;
  var match;
  while ((match = regex.exec(text)) !== null) {
    try {
      var data = JSON.parse(match[2]);
      actions.push({ type: match[1], data: data });
    } catch (_) {}
  }
  return actions;
}

/* Strip action markers from display text */

function _aiStripActions(text) {
  return text.replace(/\[(wizOpen|openDay):\s*\{[^}]+\}\]/g, '').trim();
}

/* Render action buttons */

function _aiRenderActions(actions) {
  if (!actions || actions.length === 0) return '';
  var html = '<div class="ai-chat-actions">';
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    var label = '';
    var icon = '';
    switch (a.type) {
      case 'wizOpen':
        label = 'Ouvrir le wizard';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        break;
      case 'openDay':
        label = 'Ouvrir le jour';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        break;
    }
    html += '<button type="button" class="ai-chat-action-btn" data-ai-action="' + a.type + '" data-ai-action-data=\'' + JSON.stringify(a.data) + '\'>' + icon + label + '</button>';
  }
  html += '</div>';
  return html;
}

/* Handle action button click */

function _aiHandleActionClick(e) {
  var btn = e.currentTarget;
  var type = btn.getAttribute('data-ai-action');
  var raw = btn.getAttribute('data-ai-action-data');
  var data;
  try { data = JSON.parse(raw); } catch (_) { return; }

  switch (type) {
    case 'wizOpen':
      if (typeof wizOpen === 'function') {
        wizOpen(data);
      }
      break;
    case 'openDay':
      if (typeof openExistingDay === 'function' && data.id) {
        // Fetch the day by ID
        api('/api/days/' + data.id).then(function(day) {
          openExistingDay(day);
        }).catch(function() {
          toast('Impossible de charger ce jour', 'error');
        });
      } else if (data.date && data.instrument) {
        api('/api/days/lookup?date=' + encodeURIComponent(data.date) + '&instrument=' + encodeURIComponent(data.instrument)).then(function(day) {
          if (day) {
            openExistingDay(day);
          } else {
            toast('Jour introuvable pour cette date', 'error');
          }
        }).catch(function() {
          toast('Impossible de charger ce jour', 'error');
        });
      }
      break;
  }
}

/* --- Core chat functions --- */

function aiChatInit() {
  window.aiChatHistory = [];

  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;

  // Render welcome
  messages.innerHTML =
    '<div class="ai-chat-welcome">' +
      '<div class="ai-chat-welcome-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' +
        '</svg>' +
      '</div>' +
      '<div class="ai-chat-welcome-title">Assistant COCKPIT</div>' +
      '<div class="ai-chat-welcome-text">' +
        'Pose-moi des questions sur tes trades, demande-moi de créer ou modifier des entrées, ou de te donner des insights sur tes performances.' +
      '</div>' +
    '</div>';
}

function aiChatAddMessage(role, content, extra) {
  extra = extra || {};
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;

  // Remove welcome if user message
  var welcome = messages.querySelector('.ai-chat-welcome');
  if (welcome && role === 'user') {
    welcome.remove();
  }

  var now = new Date();
  var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var div = document.createElement('div');
  div.className = 'ai-chat-msg ai-chat-msg-' + role;
  if (extra.error) div.classList.add('ai-chat-error');

  var displayContent = content;
  var actions = [];

  if (role === 'assistant') {
    actions = _aiParseActions(content);
    displayContent = _aiStripActions(content);
  }

  if (role === 'assistant' || role === 'system') {
    div.innerHTML =
      '<div class="ai-chat-msg-bubble">' + _aiRenderMarkdown(displayContent) + '</div>' +
      _aiRenderActions(actions) +
      '<div class="ai-chat-msg-time">' + timeStr + '</div>';
  } else {
    div.innerHTML =
      '<div class="ai-chat-msg-bubble">' + escapeHtml(displayContent) + '</div>' +
      '<div class="ai-chat-msg-time">' + timeStr + '</div>';
  }

  messages.appendChild(div);

  // Bind action buttons
  var actionBtns = div.querySelectorAll('.ai-chat-action-btn');
  for (var i = 0; i < actionBtns.length; i++) {
    actionBtns[i].addEventListener('click', _aiHandleActionClick);
  }

  aiChatScrollBottom();
}

function aiChatScrollBottom() {
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;
  // Use requestAnimationFrame to ensure DOM is flushed
  requestAnimationFrame(function() {
    messages.scrollTop = messages.scrollHeight;
  });
}

function aiChatShowLoading() {
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;
  var loading = document.createElement('div');
  loading.className = 'ai-chat-loading';
  loading.id = 'aiChatLoading';
  loading.innerHTML =
    '<div class="ai-chat-loading-dots">' +
      '<span></span><span></span><span></span>' +
    '</div>' +
    '<span class="ai-chat-loading-label">Réflexion...</span>';
  messages.appendChild(loading);
  aiChatScrollBottom();
}

function aiChatHideLoading() {
  var loading = document.getElementById('aiChatLoading');
  if (loading) loading.remove();
}

function aiChatSetBusy(busy) {
  var input = document.getElementById('aiChatInput');
  var send = document.getElementById('aiChatSend');
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;
}

/* --- Pending image support --- */

var _aiChatPendingImageToken = null;

function _aiChatShowImagePreview(base64Data) {
  var preview = document.getElementById('aiChatImgPreview');
  if (!preview) return;
  preview.innerHTML =
    '<div class=\"ai-chat-img-chip\">' +
      '<img src=\"' + base64Data + '\" alt=\"Image uploadee\" class=\"ai-chat-img-thumb\">' +
      '<button type="button" class="ai-chat-img-remove" id="aiChatImgRemove" aria-label="Retirer image">' +
        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"12\" height=\"12\">' +
          '<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/>' +
        '</svg>' +
      '</button>' +
    '</div>';
  preview.hidden = false;

  // Bind remove button
  var removeBtn = document.getElementById('aiChatImgRemove');
  if (removeBtn) {
    removeBtn.addEventListener('click', _aiChatClearImage);
  }
}

function _aiChatClearImage() {
  _aiChatPendingImageToken = null;
  var preview = document.getElementById('aiChatImgPreview');
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = '';
  }
  var input = document.getElementById('aiChatImgInput');
  if (input) input.value = '';
}

function _aiChatUploadImage(file) {
  if (!file) return;
  // Validate type
  if (!file.type.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
    toast("Format d'image non supporte. PNG, JPEG, GIF ou WebP.", 'error');
    return;
  }
  // Validate size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    toast('Image trop volumineuse (max 5 Mo).', 'error');
    return;
  }

  var formData = new FormData();
  formData.append('file', file);

  // Show local preview immediately
  var reader = new FileReader();
  reader.onload = function(e) {
    _aiChatShowImagePreview(e.target.result);
  };
  reader.readAsDataURL(file);

  // Upload to server
  toast("Upload de l'image...", 'info');
  api('/api/ai/chat/upload-image', {
    method: 'POST',
    body: formData,
    // Ensure we don't set Content-Type manually — browser sets it with boundary
  }).then(function(result) {
    if (result && result.image_token) {
      _aiChatPendingImageToken = result.image_token;
      toast("Image prete. Dis a l'assistant de l'attacher a un trade.", 'success');
    } else {
      toast("Erreur lors de l'upload", 'error');
      _aiChatClearImage();
    }
  }).catch(function(err) {
    toast('Erreur upload: ' + (err.message || 'inconnue'), 'error');
    _aiChatClearImage();
  });
}

function _aiChatHandlePaste(e) {
  var clipboardData = e.clipboardData || e.originalEvent?.clipboardData || window.clipboardData;
  if (!clipboardData) return;
  var items = clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') === 0) {
      var file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        _aiChatUploadImage(file);
        return;
      }
    }
  }
}

async function aiChatSend() {
  var input = document.getElementById('aiChatInput');
  var text = (input && input.value.trim()) || '';

  // Build message content: include image hint if pending
  var content = text;
  if (!content && !_aiChatPendingImageToken) return;

  // Push to history if needed
  if (!window.aiChatHistory) {
    window.aiChatHistory = [];
  }

  // Add user message
  var displayText = _aiChatPendingImageToken
    ? (text || 'Attache cette image a un trade')
    : text;
  aiChatAddMessage('user', displayText);
  window.aiChatHistory.push({ role: 'user', content: displayText });
  input.value = '';
  input.style.height = 'auto';

  aiChatSetBusy(true);
  aiChatShowLoading();

  try {
    // Build request with pending image token
    var body = { messages: window.aiChatHistory };
    if (_aiChatPendingImageToken) {
      body.pending_image_token = _aiChatPendingImageToken;
    }

    var result = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    aiChatHideLoading();

    var responseText = result.response || result.error || 'Pas de réponse.';

    // Handle missing API key
    if (result.needs_api_key) {
      aiChatAddMessage('system', responseText);
      return;
    }

    // Handle circuit breaker
    if (result.circuit_open) {
      aiChatAddMessage('system', responseText);
      return;
    }

    aiChatAddMessage('assistant', responseText);
    window.aiChatHistory.push({ role: 'assistant', content: responseText });

  } catch (err) {
    aiChatHideLoading();
    aiChatAddMessage('assistant', '**Erreur :** ' + (err.message || "Impossible de contacter l'assistant."), { error: true });
    toast('Erreur API chat', 'error');
  } finally {
    aiChatSetBusy(false);
    input.focus();
  }
}

function aiChatClear() {
  window.aiChatHistory = [];
  var messages = document.getElementById('aiChatMessages');
  if (messages) messages.innerHTML = '';

  // Reset with welcome
  aiChatInit();

  // Also send a reset to the server to clear cache
  api('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: '' }], reset: true }),
  }).catch(function() { /* silent */ });

  toast('Nouvelle conversation', 'success');
}

function aiChatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

/* Handle Enter key (to send) vs Shift+Enter (newline) */

function _aiChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aiChatSend();
  }
}

/* --- Bind --- */

function bindAIChat() {
  var input = document.getElementById('aiChatInput');
  var send = document.getElementById('aiChatSend');
  var clearBtn = document.getElementById('aiChatClear');

  if (!input || !send) return;

  aiChatInit();

  send.addEventListener('click', aiChatSend);
  input.addEventListener('keydown', _aiChatKeydown);
  input.addEventListener('input', function() { aiChatInputResize(this); });
  input.addEventListener('paste', _aiChatHandlePaste);

  // File input binding
  var imgInput = document.getElementById('aiChatImgInput');
  if (imgInput) {
    imgInput.addEventListener('change', function(e) {
      var files = e.target.files;
      if (files && files.length > 0) {
        _aiChatUploadImage(files[0]);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', aiChatClear);
  }

  // Focus input when panel opens
  var toggle = document.getElementById('aiPanelToggle');
  if (toggle) {
    toggle.addEventListener('click', function() {
      // Small delay to let panel open animation finish
      setTimeout(function() { input.focus(); }, 100);
    });
  }
}
