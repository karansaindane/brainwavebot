/**
 * Brainwave BCI Frontend Application
 *
 * Real-time features:
 * - Socket.io live streaming client
 * - High-DPI Canvas EEG Oscilloscope with phosphor glow & auto-scroll
 * - Real-time Mu Band Power gauge & dynamic threshold marker
 * - High-visibility "Action Triggered" Motor Imagery indicator
 * - Multi-band spectral bars (Delta, Theta, Mu, Beta, Gamma, Mains)
 * - 8-Channel electrode matrix
 * - Web Audio API BCI activation chime
 */

(() => {
  'use strict';

  // ==========================================
  // DOM Elements
  // ==========================================
  const wsStatusEl = document.getElementById('wsStatus');
  const wsLedEl = document.getElementById('wsLed');
  const udpStatusEl = document.getElementById('udpStatus');
  const udpLedEl = document.getElementById('udpLed');

  const actionAlertBox = document.getElementById('actionAlertBox');
  const alertBadge = document.getElementById('alertBadge');
  const alertTitle = document.getElementById('alertTitle');
  const alertDesc = document.getElementById('alertDesc');
  const alertSymbol = document.getElementById('alertSymbol');
  const erdPercentVal = document.getElementById('erdPercentVal');
  const eventCountVal = document.getElementById('eventCountVal');
  const thresholdDisplay = document.getElementById('thresholdDisplay');

  const voltageDisplay = document.getElementById('voltageDisplay');
  const erdHighlightLabel = document.getElementById('erdHighlightLabel');

  const currentMuDisplay = document.getElementById('currentMuDisplay');
  const baselineMuDisplay = document.getElementById('baselineMuDisplay');
  const gaugeFill = document.getElementById('gaugeFill');
  const thresholdLine = document.getElementById('thresholdLine');
  const thresholdMarkerLabel = document.getElementById('thresholdMarkerLabel');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdSliderVal = document.getElementById('thresholdSliderVal');
  const sliderHintVal = document.getElementById('sliderHintVal');

  const calibrateBtn = document.getElementById('calibrateBtn');
  const audioToggleBtn = document.getElementById('audioToggleBtn');
  const audioIcon = document.getElementById('audioIcon');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const logStream = document.getElementById('logStream');

  // Spectral band elements
  const deltaBar = document.getElementById('deltaBar');
  const thetaBar = document.getElementById('thetaBar');
  const muBar = document.getElementById('muBar');
  const betaBar = document.getElementById('betaBar');
  const gammaBar = document.getElementById('gammaBar');
  const mainsBar = document.getElementById('mainsBar');

  const deltaVal = document.getElementById('deltaVal');
  const thetaVal = document.getElementById('thetaVal');
  const muVal = document.getElementById('muVal');
  const betaVal = document.getElementById('betaVal');
  const gammaVal = document.getElementById('gammaVal');
  const mainsVal = document.getElementById('mainsVal');

  // Canvas
  const canvas = document.getElementById('eegCanvas');
  const ctx = canvas.getContext('2d');

  // ==========================================
  // Application State
  // ==========================================
  let isAudioEnabled = true;
  let isMotorImageryActive = false;
  let currentThreshold = 40.0;
  let currentBaseline = 100.0;
  let audioCtx = null;

  // Circular Waveform Buffer for Canvas Display (~2.5 seconds = 625 samples at 250Hz)
  const MAX_WAVEFORM_POINTS = 625;
  const waveformBuffer = new Float32Array(MAX_WAVEFORM_POINTS);
  let waveformCount = 0;

  // Maximum expected voltage for canvas Y-axis scale (+- 40 uV)
  const VOLTAGE_SCALE_UV = 40.0;

  // ==========================================
  // Web Audio API Synthesizer (BCI Activation Sound)
  // ==========================================
  function playActivationSound() {
    if (!isAudioEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const now = audioCtx.currentTime;
      // High-tech two-tone frequency chime
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5

      osc2.frequency.setValueAtTime(293.66, now); // D4
      osc2.frequency.exponentialRampToValueAtTime(440.0, now + 0.12);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } catch (e) {
      // Audio not permitted without user gesture or unsupported
    }
  }

  // ==========================================
  // High-DPI Canvas Setup & Resizing
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

  // ==========================================
  // 60 FPS Canvas Oscilloscope Renderer
  // ==========================================
  function renderOscilloscope() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const midY = height / 2;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Subtle background tint shift when ERD is active
    if (isMotorImageryActive) {
      ctx.fillStyle = 'rgba(255, 46, 99, 0.08)';
      ctx.fillRect(0, 0, width, height);
    }

    // Draw horizontal grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

    // +20 uV and -20 uV lines
    const yQuarter = height / 4;
    ctx.beginPath();
    ctx.moveTo(0, yQuarter);
    ctx.lineTo(width, yQuarter);
    ctx.moveTo(0, height - yQuarter);
    ctx.lineTo(width, height - yQuarter);
    ctx.stroke();

    // Center zero-voltage reference line (dashed)
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertical time grid lines (every 100px)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    for (let x = 100; x < width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw EEG Waveform
    if (waveformCount > 1) {
      const step = width / (MAX_WAVEFORM_POINTS - 1);
      const pointsToDraw = Math.min(waveformCount, MAX_WAVEFORM_POINTS);
      const startX = width - (pointsToDraw - 1) * step;

      ctx.beginPath();

      for (let i = 0; i < pointsToDraw; i++) {
        // Read oldest to newest
        const val = waveformBuffer[i];
        // Normalize val to canvas height: +VOLTAGE_SCALE_UV at top, -VOLTAGE_SCALE_UV at bottom
        const y = midY - (val / VOLTAGE_SCALE_UV) * (height / 2 - 15);
        const x = startX + i * step;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Neon Phosphor Waveform Styling
      if (isMotorImageryActive) {
        ctx.strokeStyle = '#ff2e63';
        ctx.shadowColor = '#ff2e63';
        ctx.shadowBlur = 10;
      } else {
        ctx.strokeStyle = '#00f2fe';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 8;
      }

      ctx.lineWidth = 2.0;
      ctx.stroke();

      // Current beam head dot
      const latestVal = waveformBuffer[pointsToDraw - 1];
      const headY = midY - (latestVal / VOLTAGE_SCALE_UV) * (height / 2 - 15);
      ctx.beginPath();
      ctx.arc(width - 2, headY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = isMotorImageryActive ? '#ff2e63' : '#00f2fe';
      ctx.shadowBlur = 12;
      ctx.fill();
    }

    ctx.restore();
    requestAnimationFrame(renderOscilloscope);
  }

  // Start oscilloscope rendering loop
  requestAnimationFrame(renderOscilloscope);

  // ==========================================
  // Socket.io Connection & Streaming
  // ==========================================
  const socket = io();

  socket.on('connect', () => {
    wsStatusEl.textContent = 'ONLINE';
    wsLedEl.classList.add('active');
    appendLog('system-msg', `Connected to BCI server via WebSocket (ID: ${socket.id})`);
  });

  socket.on('disconnect', () => {
    wsStatusEl.textContent = 'DISCONNECTED';
    wsLedEl.classList.remove('active');
    udpStatusEl.textContent = 'OFFLINE';
    udpLedEl.classList.remove('active');
    appendLog('system-msg', 'Disconnected from BCI server. Reconnecting...');
  });

  socket.on('connect_error', () => {
    wsStatusEl.textContent = 'RETRYING...';
    wsLedEl.classList.remove('active');
  });

  // Dedicated High-Priority Motor Imagery Event Trigger
  socket.on('motor-imagery', (evt) => {
    if (evt.state === 'TRIGGERED') {
      isMotorImageryActive = true;
      playActivationSound();
      appendLog(
        'trigger',
        `⚡ MOTOR IMAGERY DETECTED: -${evt.dropPercentage}% Mu drop (Power: ${evt.muPower} vs Base: ${evt.baseline})`
      );
    } else {
      isMotorImageryActive = false;
      appendLog(
        'release',
        `✓ Rest restored: Mu power normalized (-${evt.dropPercentage}% drop)`
      );
    }
  });

  // Core Real-Time Telemetry Payload (30 FPS)
  socket.on('bci-data', (data) => {
    // 1. Update Ingest Status & Hardware Rate
    if (data.stats && data.stats.sampleRate > 0) {
      udpStatusEl.textContent = `${data.stats.sampleRate} Hz`;
      udpLedEl.classList.add('active');
    } else {
      udpStatusEl.textContent = 'WAITING';
      udpLedEl.classList.remove('active');
    }

    // 2. Ingest recent samples into canvas circular waveform buffer
    if (data.samples && data.samples.length > 0) {
      for (let s = 0; s < data.samples.length; s++) {
        const val = data.samples[s];
        if (waveformCount < MAX_WAVEFORM_POINTS) {
          waveformBuffer[waveformCount++] = val;
        } else {
          // Shift left by 1
          waveformBuffer.copyWithin(0, 1);
          waveformBuffer[MAX_WAVEFORM_POINTS - 1] = val;
        }
      }
    }

    // 3. Instantaneous Channel 1 Voltage Display
    if (typeof data.voltage === 'number') {
      const sign = data.voltage >= 0 ? '+' : '';
      voltageDisplay.textContent = `${sign}${data.voltage.toFixed(2)} µV`;
    }

    // 4. Update Motor Imagery Action Alert UI
    const isTriggered = data.isMotorImagery;
    isMotorImageryActive = isTriggered;

    if (isTriggered) {
      actionAlertBox.className = 'action-alert-box state-triggered';
      alertBadge.textContent = '⚡ ACTION TRIGGERED';
      alertTitle.textContent = 'MOTOR IMAGERY DETECTED';
      alertDesc.textContent =
        'Contralateral Hand Movement Intent Recognized (Sensorimotor Rhythm ERD Active)';
      alertSymbol.textContent = '⚡';
      erdHighlightLabel.textContent = 'State: ⚡ ERD ACTIVE (-80% 10Hz)';
      erdHighlightLabel.style.color = 'var(--neon-coral)';
    } else {
      actionAlertBox.className = 'action-alert-box state-idle';
      alertBadge.textContent = 'REST STATE';
      alertTitle.textContent = 'SENSORIMOTOR RHYTHM INTACT';
      alertDesc.textContent =
        'Channel 1 (C3 Motor Cortex) exhibits synchronous 10 Hz Alpha/Mu oscillations.';
      alertSymbol.textContent = '🧠';
      erdHighlightLabel.textContent = 'State: Idle Rest';
      erdHighlightLabel.style.color = 'var(--text-dim)';
    }

    erdPercentVal.textContent = `${data.dropPercentage.toFixed(1)}%`;
    if (data.stats && typeof data.stats.eventCount === 'number') {
      eventCountVal.textContent = data.stats.eventCount;
    }

    // 5. Update Mu Band Power Meter & Gauge
    currentBaseline = data.baseline || currentBaseline;
    currentMuDisplay.textContent = data.muPower.toFixed(2);
    baselineMuDisplay.textContent = currentBaseline.toFixed(2);

    // Percentage of current power relative to baseline
    const powerRatio = currentBaseline > 0 ? (data.muPower / currentBaseline) : 1.0;
    const clampedGaugePct = Math.min(Math.max(powerRatio * 100.0, 3.0), 100.0);
    gaugeFill.style.width = `${clampedGaugePct}%`;

    if (isTriggered) {
      gaugeFill.classList.add('desynced');
    } else {
      gaugeFill.classList.remove('desynced');
    }

    // 6. Spectral Frequency Bands Breakdown
    if (data.bandPowers) {
      const bp = data.bandPowers;
      // Find max power among bands for relative visualization scaling
      const maxBand = Math.max(bp.delta, bp.theta, bp.mu, bp.beta, bp.gamma, bp.mains, 10.0);

      updateBandBar(deltaBar, deltaVal, bp.delta, maxBand);
      updateBandBar(thetaBar, thetaVal, bp.theta, maxBand);
      updateBandBar(muBar, muVal, bp.mu, maxBand);
      updateBandBar(betaBar, betaVal, bp.beta, maxBand);
      updateBandBar(gammaBar, gammaVal, bp.gamma, maxBand);
      updateBandBar(mainsBar, mainsVal, bp.mains, maxBand);
    }

    // 7. 8-Channel Electrode Array Matrix Readout
    if (data.allChannels && data.allChannels.length >= 8) {
      for (let ch = 0; ch < 8; ch++) {
        const v = data.allChannels[ch];
        const vEl = document.getElementById(`chVolt-${ch}`);
        const fEl = document.getElementById(`chFill-${ch}`);
        if (vEl && fEl) {
          const s = v >= 0 ? '+' : '';
          vEl.textContent = `${s}${v.toFixed(1)} µV`;
          // Map [-30, +30] uV to [5%, 95%] fill width
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
  // User Controls & Interaction
  // ==========================================

  // 1. Re-Calibrate Baseline Button
  calibrateBtn.addEventListener('click', () => {
    socket.emit('calibrate');
    appendLog('system-msg', 'User requested baseline recalibration.');
  });

  socket.on('calibrated', (res) => {
    appendLog('system-msg', `New baseline established: ${res.baseline.toFixed(2)} µV²`);
  });

  // 2. Sensitivity Slider
  thresholdSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    currentThreshold = val;
    thresholdSliderVal.textContent = `${val}%`;
    sliderHintVal.textContent = `${val}%`;
    thresholdDisplay.textContent = `${val.toFixed(1)}%`;
    thresholdMarkerLabel.textContent = `Threshold (-${val}%)`;

    // Position threshold marker line: (100 - threshold)% from left
    const thresholdPositionPct = 100.0 - val;
    thresholdLine.style.left = `${thresholdPositionPct}%`;

    socket.emit('set-threshold', val);
  });

  // Set initial threshold line position
  thresholdLine.style.left = `${100.0 - currentThreshold}%`;

  // 3. Audio Toggle
  audioToggleBtn.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    audioIcon.textContent = isAudioEnabled ? '🔊' : '🔇';
    audioToggleBtn.title = isAudioEnabled ? 'Audio Alerts Enabled' : 'Audio Alerts Muted';
    appendLog('system-msg', `Audio alerts ${isAudioEnabled ? 'enabled' : 'muted'}.`);
  });

  // 4. Clear Log Button
  clearLogBtn.addEventListener('click', () => {
    logStream.innerHTML = '';
    appendLog('system-msg', 'Log cleared.');
  });

  // Helper: Append entry to log stream
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

    // Prune log entries if exceeding 100
    while (logStream.children.length > 100) {
      logStream.removeChild(logStream.firstChild);
    }
  }

  // Log initial welcome
  appendLog('system-msg', 'BCI Telemetry Dashboard initialized. Waiting for EEG UDP stream...');
})();

