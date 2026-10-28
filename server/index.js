/**
 * Brain-Computer Interface (BCI) Real-Time Server
 *
 * Architecture:
 * - Express: Serves dashboard frontend and REST endpoints.
 * - UDP Listener (dgram): Ingests 250 Hz binary EEG packets from Python simulator on port 3001.
 * - Ring Buffer: Maintains the last 1-second sliding window (250 samples x 8 channels).
 * - DSP Engine: Runs FFT + Hann window to isolate Mu Band (8-12 Hz) power on Channel 1.
 * - Motor Imagery Classifier: Triggers detection when Mu power drops >= 40% below baseline.
 * - Socket.io: Broadcasts capped telemetry stream (30 FPS) to connected frontends.
 */

const path = require('path');
const http = require('http');
const dgram = require('dgram');
const express = require('express');
const { Server } = require('socket.io');

const RingBuffer = require('./ringBuffer');
const { analyzeSpectrum } = require('./dsp');

// Server Configuration
const HTTP_PORT = process.env.PORT || 3000;
const UDP_PORT = process.env.UDP_PORT || 3001;
const SAMPLE_RATE = 250;               // 250 Hz
const BUFFER_CAPACITY = 250;           // 1 second buffer = 250 samples
const FPS_BROADCAST = 30;              // 30 FPS capped rate for browser performance
const DEFAULT_DROP_THRESHOLD = 40.0;   // 40% drop in Mu power indicates ERD
const CALIBRATION_SAMPLES = 50;        // ~1.5 seconds of frames to establish initial baseline

// Initialize Express & HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve frontend static assets
app.use(express.static(path.join(__dirname, '../public')));

// 8-Channel Ring Buffer (stores 1 second = 250 samples)
const ringBuffer = new RingBuffer(BUFFER_CAPACITY, 8);

// BCI Classification State
let baselineMuPower = null;
let calibrationHistory = [];
let currentThresholdPercent = DEFAULT_DROP_THRESHOLD;
let isMotorImageryActive = false;
let previousMotorImageryState = false;
let eventTriggerCount = 0;
let lastEventTimestamp = null;

// Telemetry & Rate Tracking
let totalUdpPackets = 0;
let udpPacketsInCurrentSec = 0;
let incomingSampleRate = 0;
let newSamplesSinceLastBroadcast = [];

// Compute incoming sample rate every second
setInterval(() => {
  incomingSampleRate = udpPacketsInCurrentSec;
  udpPacketsInCurrentSec = 0;
}, 1000);

// ==========================================
// 1. UDP Listener for Synthetic Headset
// ==========================================
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
  console.error(`[UDP ERROR] Listener failure: ${err.message}`);
  udpSocket.close();
});

udpSocket.on('message', (msg, rinfo) => {
  // Each sample has 8 float32 values (little-endian), 4 bytes each = 32 bytes
  if (msg.length >= 32) {
    const numSamples = Math.floor(msg.length / 32);

    for (let s = 0; s < numSamples; s++) {
      const baseOffset = s * 32;
      const channels = new Float64Array(8);

      for (let ch = 0; ch < 8; ch++) {
        channels[ch] = msg.readFloatLE(baseOffset + ch * 4);
      }

      // Ingest sample into circular ring buffer
      ringBuffer.push(channels);

      // Track channel 1 sample for real-time waveform streaming to frontend
      newSamplesSinceLastBroadcast.push(channels[0]);
    }

    totalUdpPackets += numSamples;
    udpPacketsInCurrentSec += numSamples;
  }
});

udpSocket.bind(UDP_PORT, '0.0.0.0', () => {
  console.log(`[UDP INGEST] Listening for synthetic EEG packets on udp://0.0.0.0:${UDP_PORT}`);
});

// ==========================================
// 2. DSP & Classification Engine (30 FPS)
// ==========================================
const broadcastIntervalMs = Math.round(1000 / FPS_BROADCAST); // ~33 ms

setInterval(() => {
  // Only process once we have buffered a meaningful segment of data (>= 128 samples)
  if (ringBuffer.size() < 128) {
    return;
  }

  // 1. Extract chronological 1-second window for Channel 1 (C3 Motor Cortex)
  const ch1Data = ringBuffer.getChannelData(0);

  // 2. Perform FFT & Spectral Analysis
  const spectrumResult = analyzeSpectrum(ch1Data, SAMPLE_RATE);
  const currentMuPower = spectrumResult.muPower;

  // 3. Baseline Calibration
  if (baselineMuPower === null) {
    calibrationHistory.push(currentMuPower);
    if (calibrationHistory.length >= CALIBRATION_SAMPLES) {
      // Calculate mean of calibration frames
      const sum = calibrationHistory.reduce((a, b) => a + b, 0);
      baselineMuPower = sum / calibrationHistory.length;
      console.log(`[BCI CALIBRATION] Baseline Mu Power established: ${baselineMuPower.toFixed(2)} uV^2`);
    } else {
      // Still calibrating, use current value as temporary baseline
      baselineMuPower = currentMuPower;
    }
  }

  // 4. ERD Calculation & Classification Check
  // ERD = ((Baseline - Current) / Baseline) * 100
  let dropPercentage = 0;
  if (baselineMuPower > 0) {
    dropPercentage = ((baselineMuPower - currentMuPower) / baselineMuPower) * 100.0;
  }

  // Check threshold: If power drops below baseline by >= 40%
  const isDetected = dropPercentage >= currentThresholdPercent;
  isMotorImageryActive = isDetected;

  // Adaptive baseline: when in relaxed rest, slowly adapt baseline (EMA)
  // Freeze baseline update during motor imagery to avoid baseline shrinkage
  if (!isDetected && baselineMuPower !== null) {
    baselineMuPower = 0.995 * baselineMuPower + 0.005 * currentMuPower;
  }

  // State Transition Detection (Trigger alert events)
  if (isMotorImageryActive !== previousMotorImageryState) {
    if (isMotorImageryActive) {
      eventTriggerCount++;
      lastEventTimestamp = Date.now();
      console.log(
        `>>> [CLASSIFICATION] ⚡ MOTOR IMAGERY DETECTED! Drop: ${dropPercentage.toFixed(1)}% ` +
        `(Mu Power: ${currentMuPower.toFixed(1)} vs Base: ${baselineMuPower.toFixed(1)})`
      );

      // Emit high-priority action trigger to connected frontends
      io.emit('motor-imagery', {
        state: 'TRIGGERED',
        dropPercentage: parseFloat(dropPercentage.toFixed(1)),
        muPower: parseFloat(currentMuPower.toFixed(2)),
        baseline: parseFloat(baselineMuPower.toFixed(2)),
        timestamp: lastEventTimestamp,
        eventCount: eventTriggerCount
      });
    } else {
      console.log(`>>> [CLASSIFICATION] REST STATE RESTORED. Drop returned to ${dropPercentage.toFixed(1)}%`);
      io.emit('motor-imagery', {
        state: 'RELEASED',
        dropPercentage: parseFloat(dropPercentage.toFixed(1)),
        muPower: parseFloat(currentMuPower.toFixed(2)),
        baseline: parseFloat(baselineMuPower.toFixed(2)),
        timestamp: Date.now()
      });
    }
    previousMotorImageryState = isMotorImageryActive;
  }

  // 5. Package and broadcast live telemetry to frontend clients
  const latestChannels = ringBuffer.getLatestSample();
  const flushedSamples = newSamplesSinceLastBroadcast.slice();
  newSamplesSinceLastBroadcast = [];

  const telemetryPayload = {
    timestamp: Date.now(),
    voltage: latestChannels[0],              // Latest Channel 1 instantaneous voltage
    samples: flushedSamples,                 // Recent raw samples for smooth curve rendering
    allChannels: Array.from(latestChannels), // Snapshot of all 8 channels
    muPower: parseFloat(currentMuPower.toFixed(2)),
    baseline: parseFloat(baselineMuPower.toFixed(2)),
    dropPercentage: parseFloat(dropPercentage.toFixed(1)),
    isMotorImagery: isMotorImageryActive,
    threshold: currentThresholdPercent,
    bandPowers: {
      delta: parseFloat(spectrumResult.bandPowers.delta.toFixed(2)),
      theta: parseFloat(spectrumResult.bandPowers.theta.toFixed(2)),
      mu: parseFloat(spectrumResult.bandPowers.mu.toFixed(2)),
      beta: parseFloat(spectrumResult.bandPowers.beta.toFixed(2)),
      gamma: parseFloat(spectrumResult.bandPowers.gamma.toFixed(2)),
      mains: parseFloat(spectrumResult.bandPowers.mains.toFixed(2))
    },
    spectrumPreview: spectrumResult.spectrumPreview,
    stats: {
      sampleRate: incomingSampleRate,
      bufferedSamples: ringBuffer.size(),
      totalPackets: totalUdpPackets,
      eventCount: eventTriggerCount
    }
  };

  io.emit('bci-data', telemetryPayload);
}, broadcastIntervalMs);

// ==========================================
// 3. Socket.io Client Connection & Commands
// ==========================================
io.on('connection', (socket) => {
  console.log(`[CLIENT] Frontend dashboard connected (id: ${socket.id})`);

  // Handle manual baseline calibration request
  socket.on('calibrate', () => {
    const ch1Data = ringBuffer.getChannelData(0);
    if (ch1Data.length > 0) {
      const spectrum = analyzeSpectrum(ch1Data, SAMPLE_RATE);
      baselineMuPower = spectrum.muPower;
      console.log(`[BCI CALIBRATION] User requested re-calibration. New baseline: ${baselineMuPower.toFixed(2)} uV^2`);
      socket.emit('calibrated', { baseline: baselineMuPower });
    }
  });

  // Handle sensitivity threshold adjustment
  socket.on('set-threshold', (val) => {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 90) {
      currentThresholdPercent = parsed;
      console.log(`[BCI CONFIG] Threshold updated to ${currentThresholdPercent}%`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[CLIENT] Frontend dashboard disconnected (id: ${socket.id})`);
  });
});

// REST Health Check Endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    udpPort: UDP_PORT,
    httpPort: HTTP_PORT,
    sampleRate: incomingSampleRate,
    bufferedSamples: ringBuffer.size(),
    baselineMuPower,
    currentThresholdPercent,
    isMotorImageryActive,
    eventTriggerCount
  });
});

// Start HTTP Server
server.listen(HTTP_PORT, () => {
  console.log('='.repeat(70));
  console.log('🧠 BRAIN-COMPUTER INTERFACE (BCI) SERVER READY');
  console.log('='.repeat(70));
  console.log(`Web Dashboard URL : http://localhost:${HTTP_PORT}`);
  console.log(`UDP EEG Ingest     : udp://127.0.0.1:${UDP_PORT}`);
  console.log(`DSP Target Band    : Mu / Sensorimotor Rhythm (8 - 12 Hz)`);
  console.log(`Classification     : Motor Imagery triggered on >= ${DEFAULT_DROP_THRESHOLD}% Mu power drop`);
  console.log(`Broadcast Rate     : ${FPS_BROADCAST} FPS over Socket.io`);
  console.log('='.repeat(70));
});

