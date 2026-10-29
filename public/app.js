/**
 * Brainwave 2-Class BCI Frontend Application
 * Real-time Directional Motor Imagery (Left Hand vs. Right Hand vs. Rest)
 */

(() => {
  'use strict';

  // DOM Elements
  const wsStatusEl = document.getElementById('wsStatus');
  const wsLedEl = document.getElementById('wsLed');
  const udpStatusEl = document.getElementById('udpStatus');
  const udpLedEl = document.getElementById('udpLed');

  // Directional Action Cards
  const cardLeftHand = document.getElementById('cardLeftHand');
  const cardRest = document.getElementById('cardRest');
  const cardRightHand = document.getElementById('cardRightHand');

  const statLeftDrop = document.getElementById('statLeftDrop');
  const statRightDrop = document.getElementById('statRightDrop');
  const statRestStatus = document.getElementById('statRestStatus');

  // Lateralization Meter
  const liValueDisplay = document.getElementById('liValueDisplay');
  const liThresholdDisplay = document.getElementById('liThresholdDisplay');
  const countRightVal = document.getElementById('countRightVal');
  const countLeftVal = document.getElementById('countLeftVal');
  const liNeedle = document.getElementById('liNeedle');
  const threshLeftLine = document.getElementById('threshLeftLine');
  const threshRightLine = document.getElementById('threshRightLine');

  const liSlider = document.getElementById('liSlider');
  const liSliderVal = document.getElementById('liSliderVal');
  const hintRightVal = document.getElementById('hintRightVal');
  const hintLeftVal = document.getElementById('hintLeftVal');

  // Dual Voltage Displays
  const c3VoltDisplay = document.getElementById('c3VoltDisplay');
  const c4VoltDisplay = document.getElementById('c4VoltDisplay');
  const currentActionLabel = document.getElementById('currentActionLabel');

  // Dual Mu Power Blocks
  const c3PowerVal = document.getElementById('c3PowerVal');
  const c3BaseVal = document.getElementById('c3BaseVal');
  const c3DropVal = document.getElementById('c3DropVal');
  const c3GaugeFill = document.getElementById('c3GaugeFill');

  const c4PowerVal = document.getElementById('c4PowerVal');
  const c4BaseVal = document.getElementById('c4BaseVal');
  const c4DropVal = document.getElementById('c4DropVal');
  const c4GaugeFill = document.getElementById('c4GaugeFill');

  // Canvas
  const canvas = document.getElementById('eegCanvas');
  const ctx = canvas.getContext('2d');

  // Buttons & Controls
  const calibrateBtn = document.getElementById('calibrateBtn');
  const audioToggleBtn = document.getElementById('audioToggleBtn');
  const audioIcon = document.getElementById('audioIcon');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const logStream = document.getElementById('logStream');

  // Spectral band bars
  const deltaBar = document.getElementById('deltaBar');
  const thetaBar = document.getElementById('thetaBar');
  const muBar = document.getElementById('muBar');
  const betaBar = document.getElementById('betaBar');
  const mainsBar = document.getElementById('mainsBar');

  const deltaVal = document.getElementById('deltaVal');
  const thetaVal = document.getElementById('thetaVal');
  const muVal = document.getElementById('muVal');
  const betaVal = document.getElementById('betaVal');
  const mainsVal = document.getElementById('mainsVal');

  // App State
  let isAudioEnabled = true;
  let currentClassification = 'REST';
  let currentLIThreshold = 0.35;
  let audioCtx = null;

  // Dual Circular Buffers for Canvas (625 points = ~2.5s @ 250Hz)
  const MAX_POINTS = 625;
  const bufferC3 = new Float32Array(MAX_POINTS);
  const bufferC4 = new Float32Array(MAX_POINTS);
  let bufferCount = 0;

  const VOLTAGE_SCALE = 40.0; // +- 40 uV

  // ==========================================
  // Spatial Audio Feedback (Stereo Pan)
  // ==========================================
  function playDirectionalTone(direction) {
    if (!isAudioEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      let panNode = null;
      if (audioCtx.createStereoPanner) {
        panNode = audioCtx.createStereoPanner();
      }

      if (direction === 'RIGHT_HAND') {
        // High frequency chime (Right Ear)
        osc.frequency.setValueAtTime(659.25, now); // E5
        osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5
        if (panNode) panNode.pan.setValueAtTime(0.85, now); // Pan Right
      } else if (direction === 'LEFT_HAND') {
        // Lower frequency chime (Left Ear)
        osc.frequency.setValueAtTime(440.0, now); // A4
        osc.frequency.exponentialRampToValueAtTime(329.63, now + 0.12); // E4
        if (panNode) panNode.pan.setValueAtTime(-0.85, now); // Pan Left
      } else {
        return;
      }

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      if (panNode) {
        osc.connect(gain);
        gain.connect(panNode);
        panNode.connect(audioCtx.destination);
      } else {
        osc.connect(gain);
        gain.connect(audioCtx.destination);
      }

      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {}
  }

  // ==========================================
  // Canvas Setup & Rendering Loop
  // ==========================================
  function setupCanvasDPI() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
  }

  window.addEventListener('resize', setupCanvasDPI);
  setupCanvasDPI();

  function renderOscilloscope() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const midY = height / 2;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Background tint by state
    if (currentClassification === 'RIGHT_HAND') {
      ctx.fillStyle = 'rgba(0, 242, 254, 0.06)';
      ctx.fillRect(0, 0, width, height);
    } else if (currentClassification === 'LEFT_HAND') {
      ctx.fillStyle = 'rgba(244, 63, 94, 0.06)';
      ctx.fillRect(0, 0, width, height);
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

    const yQuarter = height / 4;
    ctx.beginPath();
    ctx.moveTo(0, yQuarter); ctx.lineTo(width, yQuarter);
    ctx.moveTo(0, height - yQuarter); ctx.lineTo(width, height - yQuarter);
    ctx.stroke();

    // Center zero dashed line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY); ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (bufferCount > 1) {
      const step = width / (MAX_POINTS - 1);
      const points = Math.min(bufferCount, MAX_POINTS);
      const startX = width - (points - 1) * step;

      // Draw Channel 3: C4 (Right Brain / Left Hand) in Magenta
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const y = midY - (bufferC4[i] / VOLTAGE_SCALE) * (height / 2 - 15);
        const x = startX + i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#f43f5e';
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Draw Channel 1: C3 (Left Brain / Right Hand) in Cyan
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const y = midY - (bufferC3[i] / VOLTAGE_SCALE) * (height / 2 - 15);
        const x = startX + i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#00f2fe';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    ctx.restore();
    requestAnimationFrame(renderOscilloscope);
  }

  requestAnimationFrame(renderOscilloscope);

  // ==========================================
  // Socket.io Connection & Telemetry
  // ==========================================
  const socket = io();

  socket.on('connect', () => {
    wsStatusEl.textContent = 'ONLINE';
    wsLedEl.classList.add('active');
    appendLog('system-msg', `Connected to 2-Class BCI Server (ID: ${socket.id})`);
  });

  socket.on('disconnect', () => {
    wsStatusEl.textContent = 'DISCONNECTED';
    wsLedEl.classList.remove('active');
    udpStatusEl.textContent = 'OFFLINE';
    udpLedEl.classList.remove('active');
    appendLog('system-msg', 'Server disconnected. Reconnecting...');
  });

  // Dedicated Action Transition Event
  socket.on('bci-action', (evt) => {
    if (evt.action === 'RIGHT_HAND') {
      playDirectionalTone('RIGHT_HAND');
      appendLog('right-hand', `➔ RIGHT HAND DETECTED! (LI: +${evt.lateralizationIndex.toFixed(2)}, C3 Drop: -${evt.c3Drop}%)`);
    } else if (evt.action === 'LEFT_HAND') {
      playDirectionalTone('LEFT_HAND');
      appendLog('left-hand', `⬅ LEFT HAND DETECTED! (LI: ${evt.lateralizationIndex.toFixed(2)}, C4 Drop: -${evt.c4Drop}%)`);
    } else {
      appendLog('rest', `⚖ Sensorimotor Rhythms Balanced (Rest State)`);
    }
  });

  // 30 FPS Telemetry Stream
  socket.on('bci-data', (data) => {
    // 1. Ingest rate
    if (data.stats && data.stats.sampleRate > 0) {
      udpStatusEl.textContent = `${data.stats.sampleRate} Hz`;
      udpLedEl.classList.add('active');
    }

    // 2. Buffer recent samples for C3 and C4
    if (data.samplesC3 && data.samplesC4) {
      const len = Math.min(data.samplesC3.length, data.samplesC4.length);
      for (let s = 0; s < len; s++) {
        if (bufferCount < MAX_POINTS) {
          bufferC3[bufferCount] = data.samplesC3[s];
          bufferC4[bufferCount] = data.samplesC4[s];
          bufferCount++;
        } else {
          bufferC3.copyWithin(0, 1);
          bufferC4.copyWithin(0, 1);
          bufferC3[MAX_POINTS - 1] = data.samplesC3[s];
          bufferC4[MAX_POINTS - 1] = data.samplesC4[s];
        }
      }
    }

    // 3. Update Classification HUD
    currentClassification = data.classification;

    cardLeftHand.classList.remove('active');
    cardRest.classList.remove('active');
    cardRightHand.classList.remove('active');

    if (currentClassification === 'LEFT_HAND') {
      cardLeftHand.classList.add('active');
      currentActionLabel.textContent = 'Current State: ⬅ LEFT HAND (Right Brain C4 ERD Active)';
      currentActionLabel.style.color = 'var(--c4-color)';
    } else if (currentClassification === 'RIGHT_HAND') {
      cardRightHand.classList.add('active');
      currentActionLabel.textContent = 'Current State: ➔ RIGHT HAND (Left Brain C3 ERD Active)';
      currentActionLabel.style.color = 'var(--c3-color)';
    } else {
      cardRest.classList.add('active');
      currentActionLabel.textContent = 'Current State: ⚖ BALANCED REST';
      currentActionLabel.style.color = 'var(--rest-color)';
    }

    // Drops stats on HUD
    statLeftDrop.textContent = `${data.c4.dropPercentage.toFixed(1)}%`;
    statRightDrop.textContent = `${data.c3.dropPercentage.toFixed(1)}%`;

    // 4. Update Lateralization Needle (-1.0 to +1.0 mapped to 0% to 100%)
    const li = data.lateralizationIndex;
    liValueDisplay.textContent = (li >= 0 ? '+' : '') + li.toFixed(3);
    const needlePct = Math.min(Math.max(((li + 1.0) / 2.0) * 100.0, 3.0), 97.0);
    liNeedle.style.left = `${needlePct}%`;

    // Counter stats
    if (data.stats && data.stats.counts) {
      countRightVal.textContent = data.stats.counts.rightHand;
      countLeftVal.textContent = data.stats.counts.leftHand;
    }

    // 5. Voltages
    const signC3 = data.c3.voltage >= 0 ? '+' : '';
    const signC4 = data.c4.voltage >= 0 ? '+' : '';
    c3VoltDisplay.textContent = `C3: ${signC3}${data.c3.voltage.toFixed(2)} µV`;
    c4VoltDisplay.textContent = `C4: ${signC4}${data.c4.voltage.toFixed(2)} µV`;

    // 6. Dual Mu Gauges
    c3PowerVal.textContent = `${data.c3.muPower.toFixed(1)} µV²`;
    c3BaseVal.textContent = `${data.c3.baseline.toFixed(1)}`;
    c3DropVal.textContent = `${data.c3.dropPercentage.toFixed(1)}%`;
    const c3Ratio = data.c3.baseline > 0 ? (data.c3.muPower / data.c3.baseline) : 1.0;
    c3GaugeFill.style.width = `${Math.min(Math.max(c3Ratio * 100.0, 4.0), 100.0)}%`;

    c4PowerVal.textContent = `${data.c4.muPower.toFixed(1)} µV²`;
    c4BaseVal.textContent = `${data.c4.baseline.toFixed(1)}`;
    c4DropVal.textContent = `${data.c4.dropPercentage.toFixed(1)}%`;
    const c4Ratio = data.c4.baseline > 0 ? (data.c4.muPower / data.c4.baseline) : 1.0;
    c4GaugeFill.style.width = `${Math.min(Math.max(c4Ratio * 100.0, 4.0), 100.0)}%`;

    // 7. Spectral Bands (C3)
    if (data.c3.bandPowers) {
      const bp = data.c3.bandPowers;
      const maxBand = Math.max(bp.delta, bp.theta, bp.mu, bp.beta, bp.mains, 10.0);
      updateBandBar(deltaBar, deltaVal, bp.delta, maxBand);
      updateBandBar(thetaBar, thetaVal, bp.theta, maxBand);
      updateBandBar(muBar, muVal, bp.mu, maxBand);
      updateBandBar(betaBar, betaVal, bp.beta, maxBand);
      updateBandBar(mainsBar, mainsVal, bp.mains, maxBand);
    }

    // 8. 8-Channel Matrix
    if (data.allChannels) {
      for (let ch = 0; ch < 8; ch++) {
        const v = data.allChannels[ch];
        const vEl = document.getElementById(`chVolt-${ch}`);
        const fEl = document.getElementById(`chFill-${ch}`);
        if (vEl && fEl) {
          const s = v >= 0 ? '+' : '';
          vEl.textContent = `${s}${v.toFixed(1)} µV`;
          const norm = Math.min(Math.max(((v + 30.0) / 60.0) * 100.0, 5.0), 95.0);
          fEl.style.width = `${norm}%`;
        }
      }
    }
  });

  function updateBandBar(barEl, valEl, power, maxPower) {
    if (!barEl || !valEl) return;
    valEl.textContent = power.toFixed(1);
    const pct = Math.min(Math.max((power / maxPower) * 100.0, 4.0), 100.0);
    barEl.style.width = `${pct}%`;
  }

  // ==========================================
  // User Controls
  // ==========================================
  calibrateBtn.addEventListener('click', () => {
    socket.emit('calibrate');
    appendLog('system-msg', 'User requested bilateral baseline calibration.');
  });

  socket.on('calibrated', (res) => {
    appendLog('system-msg', `Baselines calibrated -> C3: ${res.baselineC3.toFixed(1)} µV², C4: ${res.baselineC4.toFixed(1)} µV²`);
  });

  liSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    currentLIThreshold = val;
    liSliderVal.textContent = `±${val.toFixed(2)}`;
    liThresholdDisplay.textContent = `±${val.toFixed(2)}`;
    hintRightVal.textContent = `+${val.toFixed(2)}`;
    hintLeftVal.textContent = `-${val.toFixed(2)}`;

    // Update threshold line positions on LI track:
    // Left line = ((-val + 1) / 2) * 100%
    // Right line = ((val + 1) / 2) * 100%
    const leftLinePct = ((-val + 1.0) / 2.0) * 100.0;
    const rightLinePct = ((val + 1.0) / 2.0) * 100.0;
    threshLeftLine.style.left = `${leftLinePct}%`;
    threshRightLine.style.left = `${rightLinePct}%`;

    socket.emit('set-li-threshold', val);
  });

  audioToggleBtn.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    audioIcon.textContent = isAudioEnabled ? '🔊' : '🔇';
    appendLog('system-msg', `Stereo audio feedback ${isAudioEnabled ? 'enabled' : 'muted'}.`);
  });

  clearLogBtn.addEventListener('click', () => {
    logStream.innerHTML = '';
    appendLog('system-msg', 'Log cleared.');
  });

  function appendLog(typeClass, text) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const entry = document.createElement('div');
    entry.className = `log-entry ${typeClass}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${timeStr}]`;

    const textSpan = document.createElement('span');
    textSpan.className = 'log-text';
    textSpan.textContent = text;

    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);

    logStream.appendChild(entry);
    logStream.scrollTop = logStream.scrollHeight;

    while (logStream.children.length > 100) {
      logStream.removeChild(logStream.firstChild);
    }
  }
})();
