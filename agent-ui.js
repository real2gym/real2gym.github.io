/* Standalone, dependency-free agent viewer.
 * API: window.mountAgent(containerElementOrSelector, manifest)
 * Returns { selectScene(id), selectRound(index), destroy() }.
 * CSS is supplied by the host. Hooks: .agent-ui, .agent-top, .agent-totals,
 * .agent-scene-picker, .agent-scene-card, .agent-workbench, .agent-screen,
 * .agent-toolbar, .agent-views, .agent-rounds, .agent-round, .agent-inspector,
 * .agent-tabs, .agent-stats, .agent-stat, .agent-code, .agent-downloads,
 * .agent-estimate-note, .agent-timing-note, .agent-success, .agent-result-note.
 * Cream/green host tokens: --paper, --ink, --muted, --line, --green, --surface.
 * Media/download URLs resolve against the host document, without fetch/imports.
 */
(function (global) {
  'use strict';
  const mounted = new WeakMap();
  let nextId = 0;
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
  function format(value) {
    return value === null || value === undefined ? '—' : number.format(value);
  }
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }
  function button(label, action, value, className) {
    const el = node('button', className, label);
    el.type = 'button'; el.dataset.action = action; el.dataset.value = String(value);
    return el;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const resolved = new URL(value, document.baseURI);
      return ['http:', 'https:', 'file:', 'blob:'].includes(resolved.protocol) ? value : null;
    } catch (_) { return null; }
  }
  function download(label, value) {
    const url = safeUrl(value);
    if (!url) return null;
    const a = node('a', 'agent-download', label);
    a.href = url; a.download = ''; return a;
  }
  function stats(el, entries) {
    el.replaceChildren();
    for (const [label, value, suffix] of entries) {
      const item = node('div', 'agent-stat');
      item.append(node('dt', 'agent-stat-label', label),
        node('dd', 'agent-stat-value', format(value) + (suffix || '')));
      el.append(item);
    }
  }
  function mapped(round) {
    const m = round && round.video_mapping;
    return !!m && ['source_reconstructed_sampling', 'verified', 'exact', 'mapped'].includes(m.status)
      && Number.isFinite(m.start_s) && m.start_s >= 0;
  }

  global.mountAgent = function mountAgent(container, manifest) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container || container.nodeType !== 1) throw new TypeError('mountAgent requires a container element.');
    if (!manifest || !Array.isArray(manifest.scenes) || !manifest.scenes.length) {
      throw new TypeError('mountAgent requires a manifest with scenes.');
    }
    const scenes = manifest.scenes;
    if (new Set(scenes.map(s => s.id)).size !== scenes.length ||
        scenes.some(s => !Array.isArray(s.rounds) || !s.rounds.length || !Array.isArray(s.videos))) {
      throw new TypeError('Scenes require unique IDs, saved rounds and a videos array.');
    }
    if (mounted.has(container)) mounted.get(container).destroy();
    const prefix = 'agent-' + (++nextId);
    let currentScene, currentRound = 0, currentView = '', activeTab = 'code';
    let pendingSeek = null, disposed = false;
    const root = node('section', 'agent-ui');
    root.setAttribute('aria-label', 'Agent execution traces');
    const top = node('div', 'agent-top');
    top.append(node('h3', 'agent-heading', 'Agent execution'));
    const scenePicker = node('div', 'agent-scene-picker scene-picker');
    scenePicker.setAttribute('role', 'group'); scenePicker.setAttribute('aria-label', 'Choose scene');
    for (const s of scenes) scenePicker.append(button(s.id, 'scene', s.id, 'agent-scene-card scene-card'));
    const resultBar = node('div', 'agent-result');
    const sceneTitle = node('h3', 'agent-scene-title');
    const scenePrompt = node('p', 'agent-scene-prompt');
    const result = node('span', 'agent-success');
    resultBar.append(sceneTitle, scenePrompt, result);
    const sceneStats = node('dl', 'agent-scene-stats agent-stats');
    const workbench = node('div', 'agent-workbench');
    const screen = node('div', 'agent-screen');
    const video = node('video', 'agent-video');
    video.controls = true; video.playsInline = true; video.preload = 'metadata';
    video.setAttribute('aria-label', 'Recorded execution video');
    const toolbar = node('div', 'agent-toolbar');
    const viewButtons = node('div', 'agent-views');
    viewButtons.setAttribute('role', 'group'); viewButtons.setAttribute('aria-label', 'Camera view');
    const clock = node('span', 'agent-clock', '0.00 s');
    const followLabel = node('label', 'agent-follow');
    const follow = node('input'); follow.type = 'checkbox'; follow.checked = true;
    followLabel.append(follow, document.createTextNode(' Follow video'));
    toolbar.append(viewButtons, clock, followLabel);
    const videoStatus = node('p', 'agent-video-status'); videoStatus.setAttribute('role', 'status');
    const roundButtons = node('div', 'agent-rounds agent-steps');
    roundButtons.setAttribute('role', 'group'); roundButtons.setAttribute('aria-label', 'Saved decisions');
    screen.append(video, toolbar, videoStatus, roundButtons);
    const inspector = node('div', 'agent-inspector');
    const roundLabel = node('span', 'agent-round-label eyebrow');
    const roundTitle = node('h3', 'agent-round-title');
    const intent = node('p', 'agent-intent');
    const roundStats = node('dl', 'agent-round-stats agent-stats');
    const tabs = node('div', 'agent-tabs'); tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Decision details');
    const tabButtons = {};
    for (const name of ['code', 'feedback']) {
      const b = button(name === 'code' ? 'Original code' : 'Feedback', 'tab', name, 'agent-tab');
      b.id = prefix + '-tab-' + name; b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', prefix + '-panel'); tabButtons[name] = b; tabs.append(b);
    }
    const code = node('pre', 'agent-code'); code.id = prefix + '-panel';
    code.setAttribute('role', 'tabpanel'); code.tabIndex = 0;
    inspector.append(roundLabel, roundTitle, intent, roundStats, tabs, code);
    workbench.append(screen, inspector);
    root.append(top, scenePicker, resultBar, sceneStats, workbench);
    container.replaceChildren(root);

    function applySeek() {
      if (pendingSeek === null || video.readyState < 1) return;
      const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : pendingSeek;
      try { video.currentTime = Math.min(pendingSeek, end); pendingSeek = null; }
      catch (_) { /* Keep the saved timestamp pending until metadata is available. */ }
    }
    function renderContent() {
      const r = currentScene.rounds[currentRound];
      // textContent preserves the complete original code; no HTML parsing, slicing or truncation.
      code.textContent = activeTab === 'code'
        ? (typeof r.code === 'string' ? r.code : '(No code saved for this decision.)')
        : JSON.stringify({ executed: r.executed, stop: r.stop, feedback_error: r.feedback_error,
          raw_metrics: r.raw_metrics, feedback: r.feedback }, null, 2);
      for (const [name, b] of Object.entries(tabButtons)) {
        const active = name === activeTab;
        b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active));
        b.tabIndex = active ? 0 : -1;
      }
      code.setAttribute('aria-labelledby', tabButtons[activeTab].id);
    }
    function selectRound(index, seek = true) {
      if (disposed) return;
      if (!Number.isInteger(index) || index < 0 || index >= currentScene.rounds.length) {
        throw new RangeError('Unknown decision index.');
      }
      currentRound = index;
      const r = currentScene.rounds[index], m = r.table_allocated_metrics || {}, raw = r.raw_metrics || {};
      roundLabel.textContent = 'DECISION ' + (index + 1) + ' / ' + currentScene.rounds.length;
      roundTitle.textContent = r.stop ? 'Stop decision' : r.feedback_error ? 'Decision with execution feedback error'
        : r.zero_step ? 'Zero-step decision' : 'Execution stage';
      intent.textContent = r.intent || '';
      const stepEstimate = r.metric_provenance?.control_steps?.status === 'estimated_normalized';
      stats(roundStats, [[stepEstimate ? 'Control steps ≈' : 'Control steps', m.control_steps], [stepEstimate ? 'Total control steps ≈' : 'Total control steps', currentScene.rounds.slice(0,index+1).reduce((n,r)=>n+(r.table_allocated_metrics?.control_steps||0),0)],
        ['Time ≈', Number.isFinite(m.wall_time_ms) ? m.wall_time_ms / 1000 : m.wall_seconds, ' s']]);
      for(const label of roundStats.querySelectorAll('dt')) if(label.textContent.includes('≈')) label.title='Estimated per-round allocation';
      for (const b of roundButtons.children) {
        const active = Number(b.dataset.value) === index;
        b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
      }
      renderContent();
      if (seek) {
        video.pause();
        pendingSeek = mapped(r) ? r.video_mapping.start_s : null;
        applySeek();
      }
    }
    function selectView(view, preserveTime = true) {
      const v = currentScene.videos.find(x => x.view === view);
      if (!v) return;
      const oldTime = pendingSeek !== null ? pendingSeek : (video.currentTime || 0);
      video.pause(); currentView = view; pendingSeek = preserveTime ? oldTime : 0;
      videoStatus.textContent = '';
      const url = safeUrl(v.url);
      if (url) { video.src = url; video.hidden = false; }
      else { video.removeAttribute('src'); video.hidden = true; videoStatus.textContent = 'Video URL unavailable.'; }
      video.load(); clock.textContent = '0.00 s';
      video.addEventListener('loadedmetadata',()=>{const box=video.getBoundingClientRect();if(box.bottom>0 && box.top<innerHeight && box.height>0 && Math.min(box.bottom,innerHeight)-Math.max(box.top,0)>=box.height*.5)video.play().catch(()=>{});},{once:true});
      for (const b of viewButtons.children) {
        const active = b.dataset.value === view;
        b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
      }
    }
    function selectScene(id) {
      if (disposed) return;
      const s = scenes.find(x => x.id === id);
      if (!s) throw new RangeError('Unknown scene: ' + id);
      currentScene = s; currentRound = 0; follow.checked = true; pendingSeek = null;
      follow.disabled = !s.rounds.some(mapped);
      sceneTitle.textContent = s.id;
      scenePrompt.textContent = s.task?.language?.split(/(?<=\.)\s/)[0] || "";
      result.textContent = s.result && s.result.user_confirmed_success ? 'Success' : 'Not confirmed';
      for (const b of scenePicker.children) {
        const active = b.dataset.value === id;
        b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
      }
      const m = s.workbook_metrics || {};
      stats(sceneStats, [['Scene tokens', m.policy_total_tokens], ['Control steps', m.control_steps],
        ['Decisions', m.decision_submissions], ['Scene time', m.wall_seconds, ' s']]);
      roundButtons.replaceChildren();
      s.rounds.forEach((r, i) => {
        const label = 'Round ' + (i + 1) + (r.stop ? ' · Stop' : r.zero_step ? ' · 0 steps' : '');
        const b = button(label, 'round', i, 'agent-round agent-step');
        b.title = mapped(r) ? 'Saved video time ' + r.video_mapping.start_s.toFixed(2) + ' s' : 'Video mapping unavailable';
        roundButtons.append(b);
      });
      viewButtons.replaceChildren();
      for (const v of s.videos) viewButtons.append(button(v.view, 'view', v.view, 'agent-view'));
      selectRound(0, false);
      if (s.videos.length) selectView(s.videos.some(v => v.view === currentView) ? currentView : s.videos[0].view, false);
      else {
        video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
        currentView = ''; clock.textContent = '—'; videoStatus.textContent = 'No saved video for this scene.';
        }
    }
    function click(event) {
      const b = event.target.closest && event.target.closest('button[data-action]');
      if (!b || !root.contains(b)) return;
      if (b.dataset.action === 'scene') selectScene(b.dataset.value);
      if (b.dataset.action === 'round') selectRound(Number(b.dataset.value));
      if (b.dataset.action === 'view') selectView(b.dataset.value);
      if (b.dataset.action === 'tab') { activeTab = b.dataset.value; renderContent(); }
    }
    function keydown(event) {
      if (!event.target.matches('[role="tab"]')) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      activeTab = event.key === 'Home' ? 'code' : event.key === 'End' ? 'feedback' : activeTab === 'code' ? 'feedback' : 'code';
      renderContent(); tabButtons[activeTab].focus();
    }
    function timeupdate() {
      clock.textContent = (video.currentTime || 0).toFixed(2) + ' s';
      if (!follow.checked || pendingSeek !== null) return;
      const t = video.currentTime;
      const i = currentScene.rounds.findIndex(r => mapped(r) && Number.isFinite(r.video_mapping.end_s) &&
        r.video_mapping.end_s > r.video_mapping.start_s && t >= r.video_mapping.start_s && t < r.video_mapping.end_s);
      let next=i;
      if(next<0) currentScene.rounds.forEach((r,j)=>{if(mapped(r)&&r.video_mapping.start_s<=t)next=j});
      if(next>=0 && next!==currentRound) selectRound(next,false);
    }
    function followPlayback(){follow.checked=true;timeupdate()}
    function ended(){if(follow.checked)selectRound(currentScene.rounds.length-1,false)}
    function videoError() { videoStatus.textContent = 'Unable to load this video.'; }
    root.addEventListener('click', click); tabs.addEventListener('keydown', keydown);
    video.addEventListener('loadedmetadata', applySeek); video.addEventListener('timeupdate', timeupdate);
    video.addEventListener('play',followPlayback); video.addEventListener('seeked',timeupdate); video.addEventListener('ended',ended);
    video.addEventListener('error', videoError);
    const api = { selectScene, selectRound, destroy() {
      if (disposed) return;
      disposed = true; video.pause();
      root.removeEventListener('click', click); tabs.removeEventListener('keydown', keydown);
      video.removeEventListener('loadedmetadata', applySeek); video.removeEventListener('timeupdate', timeupdate);
      video.removeEventListener('play',followPlayback); video.removeEventListener('seeked',timeupdate); video.removeEventListener('ended',ended);
      video.removeEventListener('error', videoError); video.removeAttribute('src'); video.load();
      root.remove(); mounted.delete(container);
    } };
    mounted.set(container, api); selectScene(scenes[0].id); return api;
  };
})(window);
