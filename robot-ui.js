/* Dependency-free real-robot comparison viewer.
 * window.mountRobot(containerElementOrSelector, auditMetadataOrRobotManifest)
 * Returns { selectScene, selectTrial, play, pause, seek, getState, destroy }.
 * Media URLs resolve against document.baseURI (or manifest.base_url).
 * Shared progress is a normalized clip viewer, NOT an event-aligned comparison.
 */
(function (global) {
  'use strict';
  const mounts = new WeakMap();
  let nextId = 0;
  const css = `
    .r2g-robot{color:var(--ink,#24382f);font:inherit;width:100%}
    .r2g-robot *{box-sizing:border-box}
    .r2g-robot button,.r2g-robot select{font:inherit;color:inherit}
    .r2g-robot button{cursor:pointer;border:1px solid var(--line,#cdd8ce);border-radius:8px;padding:.65rem .85rem;background:var(--paper,#fbfaf5)}
    .r2g-robot button:focus-visible,.r2g-robot select:focus-visible,.r2g-robot input:focus-visible{outline:3px solid var(--green,#278660);outline-offset:3px}
    .r2g-robot .robot-scenes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem;margin-bottom:1rem}
    .r2g-robot .robot-scenes button[aria-pressed=true]{background:var(--green,#247151);color:white;border-color:transparent}
    .r2g-robot .robot-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
    .r2g-robot .robot-method{min-width:0;border:1px solid var(--line,#d8dfd5);border-radius:12px;overflow:hidden;background:var(--surface,#fffef9)}
    .r2g-robot .robot-method-head{display:flex;flex-wrap:wrap;gap:.7rem;align-items:center;justify-content:space-between;padding:.85rem}
    .r2g-robot h3{font:inherit;font-weight:650;margin:0}
    .r2g-robot .robot-trial{font-size:.85em;display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;max-width:100%}
    .r2g-robot select{max-width:100%;border:1px solid var(--line,#cdd8ce);border-radius:5px;background:var(--paper,#fbfaf5);padding:.35rem}
    .r2g-robot .robot-cameras{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;background:#dde3dc}
    .r2g-robot figure{margin:0;min-width:0;background:var(--paper,#fbfaf5)}
    .r2g-robot video{width:100%;aspect-ratio:4/3;display:block;object-fit:contain;background:#101612}
    .r2g-robot figcaption{background:var(--paper,#fbfaf5);padding:.4rem .6rem;font-size:.82em;margin:0}
    .r2g-robot .robot-clock{font-variant-numeric:tabular-nums;font-size:.83em;color:var(--muted,#58685e);padding:.65rem .85rem;margin:0}
    .r2g-robot .robot-controls{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-top:1rem}
    .r2g-robot .robot-progress{display:flex;align-items:center;gap:.65rem;flex:1;min-width:180px;font-size:.85em}
    .r2g-robot input[type=range]{flex:1;min-width:70px;accent-color:var(--green,#247151)}
    .r2g-robot output{min-width:3.5em;text-align:right;font-variant-numeric:tabular-nums}
    .r2g-robot .robot-outcome{font-size:14px;font-weight:650;border-radius:20px;padding:4px 12px}.r2g-robot .is-success{color:#227457;background:#e5f2e9}.r2g-robot .is-failure{color:#a74630;background:#faeae4}
    .r2g-robot .robot-note{font-size:.84em;line-height:1.5;color:var(--muted,#58685e);margin:.65rem 0 0}
    .r2g-robot .robot-status:empty{display:none}
    .r2g-robot .robot-status{font-size:.85em;color:#8b402b;margin:.6rem 0}
    @media(max-width:760px){.r2g-robot .robot-scenes{grid-template-columns:repeat(2,minmax(0,1fr))}.r2g-robot .robot-comparison{grid-template-columns:1fr}}
  `;
  function element(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = String(text);
    return e;
  }
  function button(label, handler) {
    const b = element('button', '', label);
    b.type = 'button'; b.addEventListener('click', handler); return b;
  }
  function seconds(value) { return Number.isFinite(value) ? value.toFixed(2) + ' s' : '—'; }
  function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0; }
  global.mountRobot = function mountRobot(container, supplied) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('mountRobot: container not found');
    const manifest = supplied && (supplied.robot || supplied);
    if (!manifest || !Array.isArray(manifest.scenes) || !manifest.scenes.length) throw new TypeError('mountRobot: scenes are required');
    if (mounts.has(container)) mounts.get(container).destroy();
    const id = 'robot-' + (++nextId);
    const root = element('section', 'r2g-robot'); root.setAttribute('aria-label', 'Real-world robot task comparison');
    root.appendChild(element('style', '', css));
    const picker = element('nav', 'robot-scenes'); picker.setAttribute('aria-label', 'Robot task');
    const panels = element('div', 'robot-comparison');
    const controls = element('div', 'robot-controls');
    const toggle = button('Play both', () => playing || starting ? pause() : play());
    const restart = button('Restart', () => { pause(); seek(0); });
    const progressLabel = element('label', 'robot-progress', 'Clip progress');
    const slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.step = '1'; slider.value = '0';
    slider.id = id + '-progress'; slider.setAttribute('aria-label', 'Relative progress within each clip; not event aligned');
    progressLabel.htmlFor = slider.id;
    const progressText = element('output', '', '0%'); progressText.htmlFor = slider.id;
    progressLabel.append(slider, progressText); controls.append(toggle, restart, progressLabel);
    const status = element('p', 'robot-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    root.append(picker, panels, controls, status); container.appendChild(root);
    let viewportVisible=false;
    let currentScene, selected = {}, records = [], clocks = [], progress = 0;
    let playing = false, starting = false, destroyed = false, raf = 0, epoch = 0, lastTick = 0, resumeAfterSeek = false;
    const sceneButtons = new Map();
    function url(src) {
      if (typeof src !== 'string' || !src) return null;
      try {
        const base = manifest.base_url ? new URL(manifest.base_url, document.baseURI) : document.baseURI;
        const u = new URL(src, base);
        return ['http:', 'https:', 'file:', 'blob:'].includes(u.protocol) ? u.href : null;
      } catch (_) { return null; }
    }
    function duration(rec) { return positive(rec.video.duration) || positive(rec.meta.duration_s); }
    function span() { return Math.max(0, ...records.map(duration)); }
    function update() {
      slider.value = String(Math.round(progress * 1000)); progressText.value = Math.round(progress * 100) + '%';
      toggle.textContent = playing || starting ? 'Pause both' : 'Play both';
      toggle.setAttribute('aria-pressed', String(playing || starting));
      for (const c of clocks) {
        const rec = records.find(r => r.method === c.method && r.view === 'external');
        const d = rec ? duration(rec) : 0;
        c.el.textContent = 'Clip ' + seconds(progress * d) + ' / ' + seconds(d) + ' · ' + c.trialLabel;
      }
    }
    function position(force) {
      const total = span();
      for (const rec of records) {
        const d = duration(rec); if (!d) continue;
        const target = progress * d;
        if (rec.video.readyState >= 1 && (force || Math.abs(rec.video.currentTime - target) > .3)) {
          try { rec.video.currentTime = target; } catch (_) { /* A later metadata event retries. */ }
        }
        const speed = total ? d / total : 1;
        try { rec.video.playbackRate = Math.max(.0625, Math.min(16, speed)); } catch (_) { /* The progress clock remains authoritative. */ }
      }
    }
    function pause() {
      epoch++; playing = false; starting = false; cancelAnimationFrame(raf); raf = 0;
      records.forEach(r => r.video.pause()); update();
    }
    function tick(now) {
      if (!playing || destroyed) return;
      const elapsed = Math.min((now - lastTick) / 1000, .25); lastTick = now;
      // Wait for all four feeds rather than silently leaving one view behind.
      if (records.every(r => r.video.readyState >= 3 || r.video.ended)) {
        progress = Math.min(1, progress + elapsed / (span() || 1));
        position(false); update();
      } else {
        position(true);
      }
      if (progress >= 1) { pause(); position(true); return; }
      raf = requestAnimationFrame(tick);
    }
    async function play() {
      if (destroyed || playing || starting) return;
      if (records.length !== 4 || records.some(r => !r.valid || r.failed) || !span()) {
        status.textContent = 'Both camera views are required for each method. Check the selected media files.'; return;
      }
      if (progress >= 1) progress = 0;
      status.textContent = ''; const token = ++epoch; starting = true; position(true); update();
      const results = await Promise.allSettled(records.map(r => r.video.play()));
      if (destroyed || token !== epoch) return;
      if (results.some(r => r.status === 'rejected')) {
        pause(); status.textContent = 'Playback could not start for every camera. Check media access, then press Play both again.'; return;
      }
      starting = false; playing = true; lastTick = performance.now(); update(); raf = requestAnimationFrame(tick);
    }
    function seek(value) {
      const n = Number(value); if (!Number.isFinite(n) || destroyed) return;
      progress = Math.max(0, Math.min(1, n)); position(true); update();
    }
    function releaseVideos() {
      for (const r of records) { r.video.pause(); r.video.removeAttribute('src'); r.video.load(); }
      records = []; clocks = [];
    }
    function renderScene() {
      pause(); releaseVideos(); progress = 0; resumeAfterSeek = false; status.textContent = ''; panels.replaceChildren();
      for (const methodId of ['astra', 'ours']) {
        const method = currentScene.methods.find(m => m.id === methodId);
        if (!method || !Array.isArray(method.trials) || !method.trials.length) {
          panels.appendChild(element('p', 'robot-status', 'Missing ' + methodId + ' trial metadata.')); continue;
        }
        let trial = method.trials.find(t => t.id === selected[methodId]);
        if (!trial) trial = method.trials.find(t => t.id === method.default_trial_id) || method.trials[0];
        selected[methodId] = trial.id;
        const panel = element('article', 'robot-method'); panel.dataset.method = methodId;
        const head = element('header', 'robot-method-head'); head.appendChild(element('h3', '', method.label || (methodId === 'astra' ? 'GPT-6 Astra' : 'Ours')));
        const outcome = element('span', 'robot-outcome '+(trial.display_outcome==='Success'?'is-success':'is-failure'), trial.display_outcome || ''); head.appendChild(outcome);
        if (method.trials.length > 1) {
          const label = element('label', 'robot-trial', 'Trial'); const select = element('select');
          select.setAttribute('aria-label', (method.label || methodId) + ' trial');
          for (const t of method.trials) { const option = element('option', '', t.label || t.id); option.value = t.id; select.appendChild(option); }
          select.value = trial.id; select.addEventListener('change', () => selectTrial(methodId, select.value)); label.appendChild(select); head.appendChild(label);
        }
        const cameras = element('div', 'robot-cameras');
        for (const view of ['external', 'wrist']) {
          const meta = (trial.videos || {})[view] || {}; const frame = element('figure'); const video = element('video');
          video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'metadata'; video.controls = false;
          video.setAttribute('aria-label', (method.label || methodId) + ' ' + view + ' camera');
          const resolved = url(meta.src); const rec = { video, meta, method: methodId, view, valid: !!resolved, failed: false };
          records.push(rec);
          video.addEventListener('loadedmetadata', () => { if (records.includes(rec) && !destroyed) { position(true); update(); } });
          video.addEventListener('error', () => {
            if (!destroyed && records.includes(rec)) { rec.failed = true; pause(); status.textContent = 'Could not load ' + (method.label || methodId) + ' ' + view + ' camera.'; }
          });
          if (resolved) video.src = resolved;
          frame.append(video, element('figcaption', '', view === 'external' ? 'External camera' : 'Wrist camera')); cameras.appendChild(frame);
        }
        const clock = element('p', 'robot-clock'); clocks.push({ method: methodId, el: clock, trialLabel: trial.label || trial.id });
        panel.append(head, cameras, clock); panels.appendChild(panel);
      }
      for (const [sid, b] of sceneButtons) b.setAttribute('aria-pressed', String(sid === currentScene.id));
      update();
      if(viewportVisible) play();
    }
    function selectScene(sceneId) {
      if (destroyed) return;
      const scene = manifest.scenes.find(s => s.id === sceneId);
      if (!scene) throw new RangeError('mountRobot: unknown scene ' + sceneId);
      currentScene = scene; selected = {}; renderScene();
    }
    function selectTrial(methodId, trialId) {
      if (destroyed) return;
      const method = currentScene.methods.find(m => m.id === methodId);
      if (!method || !method.trials.some(t => t.id === trialId)) throw new RangeError('mountRobot: unknown trial');
      selected[methodId] = trialId; renderScene();
    }
    slider.addEventListener('input', () => {
      const target = Number(slider.value) / 1000;
      if (playing || starting) { resumeAfterSeek = true; pause(); }
      seek(target);
    });
    slider.addEventListener('change', () => {
      if (resumeAfterSeek) { resumeAfterSeek = false; if (progress < 1) play(); }
    });
    for (const scene of manifest.scenes) {
      const b = button(scene.title || scene.id, () => selectScene(scene.id)); b.dataset.scene = scene.id;
      sceneButtons.set(scene.id, b); picker.appendChild(b);
    }
    const api = { selectScene, selectTrial, play, pause, seek,
      getState: () => ({ scene: currentScene.id, trials: { ...selected }, progress, playing, starting, timelineMode: 'relative_progress', aligned: false }),
      destroy: () => { if (destroyed) return; pause(); destroyed = true; releaseVideos(); root.remove(); mounts.delete(container); }
    };
    mounts.set(container, api); selectScene(manifest.scenes[0].id);
    new IntersectionObserver(es=>{viewportVisible=es[0].isIntersecting;viewportVisible?play():pause()},{threshold:.35}).observe(panels);return api;
  };
})(window);
