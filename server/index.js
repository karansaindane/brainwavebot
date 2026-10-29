/**
 * Brain-Computer Interface (BCI) Real-Time Server
 * 2-Class Motor Imagery Classifier (Left Hand vs. Right Hand)
 *
 * Architecture:
 * - Ingests 250 Hz binary EEG packets from UDP port 3001.
 * - Extracts bilateral motor cortex channels:
 *     * Channel 1 (C3 - Left Hemisphere -> Controls Right Hand)
 *     * Channel 3 (C4 - Right Hemisphere -> Controls Left Hand)
 * - Runs FFT + Hann window to isolate Mu Band (8-12 Hz) power on both hemispheres.
 * - Computes the Lateralization Index (LI): (P_C4 - P_C3) / (P_C4 + P_C3).
 * - Classifies into: 'REST' | 'RIGHT_HAND' | 'LEFT_HAND'.
 * - Broadcasts 30 FPS telemetry over Socket.io.
 */

const path = require('path');
const http = require('http');
const dgram = require('dgram');
const express = require('express');
const { Server } = require('socket.io');

const RingBuffer = require('./ringBuffer');
const { analyzeBilateralSpectrum } = require('./dsp');

// Server Configuration
const HTTP_PORT = process.env.PORT || 3000;
const UDP_PORT = process.env.UDP_PORT || 3001;
const SAMPLE_RATE = 250;               // 250 Hz
const BUFFER_CAPACITY = 250;           // 1 second buffer = 250 samples
const FPS_BROADCAST = 30;              // 30 FPS capped rate for browser performance
const DEFAULT_LI_THRESHOLD = 0.35;     // Lateralization Index magnitude threshold
const DEFAULT_DROP_THRESHOLD = 35.0;   // 35% drop in unilateral Mu power
const CALIBRATION_SAMPLES = 50;        // ~1.5s of initial rest to establish baseline

// Initialize Express & HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve frontend static assets
app.use(express.static(path.join(__dirname, '../public')));

// 8-Channel Ring Buffer
const ringBuffer = new RingBuffer(BUFFER_CAPACITY, 8);

// BCI Baseline & Classification State
let baselineC3 = null;
let baselineC4 = null;
let calibHistoryC3 = [];
let calibHistoryC4 = [];

let currentLIThreshold = DEFAULT_LI_THRESHOLD;
let currentDropThreshold = DEFAULT_DROP_THRESHOLD;

let currentClassification = 'REST'; // 'REST' | 'RIGHT_HAND' | 'LEFT_HAND'
let previousClassification = 'REST';
let eventCounts = { total: 0, rightHand: 0, leftHand: 0 };
let lastEventTimestamp = null;

// Telemetry & Rate Tracking
let totalUdpPackets = 0;
let udpPacketsInCurrentSec = 0;
let incomingSampleRate = 0;

let newSamplesC3 = [];
let newSamplesC4 = [];

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

udpSocket.on('message', (msg) => {
  if (msg.length >= 32) {
    const numSamples = Math.floor(msg.length / 32);

    for (let s = 0; s < numSamples; s++) {
      const baseOffset = s * 32;
      const channels = new Float64Array(8);

      for (let ch = 0; ch < 8; ch++) {
        channels[ch] = msg.readFloatLE(baseOffset + ch * 4);
      }

      ringBuffer.push(channels);
      newSamplesC3.push(channels[0]); // Ch 1 (C3)
      newSamplesC4.push(channels[2]); // Ch 3 (C4)
    }

    totalUdpPackets += numSamples;
    udpPacketsInCurrentSec += numSamples;
  }
});

udpSocket.bind(UDP_PORT, '0.0.0.0', () => {
  console.log(`[UDP INGEST] Listening for synthetic EEG packets on udp://0.0.0.0:${UDP_PORT}`);
});

// ==========================================
// 2. 2-Class DSP & Classification Engine (30 FPS)
// ==========================================
const broadcastIntervalMs = Math.round(1000 / FPS_BROADCAST); // ~33 ms

setInterval(() => {
  if (ringBuffer.size() < 128) return;

  // 1. Extract bilateral 1-second windows: Channel 1 (C3) and Channel 3 (C4)
  const c3Data = ringBuffer.getChannelData(0);
  const c4Data = ringBuffer.getChannelData(2);

  // 2. Perform Bilateral Spectral Analysis & Lateralization Index
  const bilateral = analyzeBilateralSpectrum(c3Data, c4Data, SAMPLE_RATE);
  const c3Mu = bilateral.c3.muPower;
  const c4Mu = bilateral.c4.muPower;
  const li = bilateral.lateralizationIndex;

  // 3. Baseline Calibration
  if (baselineC3 === null || baselineC4 === null) {
    calibHistoryC3.push(c3Mu);
    calibHistoryC4.push(c4Mu);

    if (calibHistoryC3.length >= CALIBRATION_SAMPLES) {
      baselineC3 = calibHistoryC3.reduce((a, b) => a + b, 0) / calibHistoryC3.length;
      baselineC4 = calibHistoryC4.reduce((a, b) => a + b, 0) / calibHistoryC4.length;
      console.log(
        `[BCI CALIBRATION] Bilateral Baselines Established -> C3: ${baselineC3.toFixed(1)} uV^2 | C4: ${baselineC4.toFixed(1)} uV^2`
      );
    } else {
      baselineC3 = c3Mu;
      baselineC4 = c4Mu;
    }
  }

  // 4. Calculate individual ERD drop percentages
  let c3Drop = 0;
  let c4Drop = 0;
  if (baselineC3 > 0) c3Drop = ((baselineC3 - c3Mu) / baselineC3) * 100.0;
  if (baselineC4 > 0) c4Drop = ((baselineC4 - c4Mu) / baselineC4) * 100.0;

  // 5. 2-Class Classification Decision Logic:
  // - Right Hand: C3 desynchronizes -> C4 power >> C3 power -> LI > +threshold
  // - Left Hand:  C4 desynchronizes -> C3 power >> C4 power -> LI < -threshold
  let detectedClass = 'REST';

  if (li >= currentLIThreshold && c3Drop >= currentDropThreshold) {
    detectedClass = 'RIGHT_HAND';
  } else if (li <= -currentLIThreshold && c4Drop >= currentDropThreshold) {
    detectedClass = 'LEFT_HAND';
  } else {
    detectedClass = 'REST';
  }

  currentClassification = detectedClass;

  // Adaptive baseline: adapt only during REST to avoid baseline collapse during motor events
  if (currentClassification === 'REST' && baselineC3 !== null && baselineC4 !== null) {
    baselineC3 = 0.995 * baselineC3 + 0.005 * c3Mu;
    baselineC4 = 0.995 * baselineC4 + 0.005 * c4Mu;
  }

  // State Transition Notifications
  if (currentClassification !== previousClassification) {
    lastEventTimestamp = Date.now();
    eventCounts.total++;

    if (currentClassification === 'RIGHT_HAND') {
      eventCounts.rightHand++;
      console.log(
        `>>> [BCI EVENT] ➔ RIGHT HAND DETECTED! LI: ${li.toFixed(2)} | C3 Drop: ${c3Drop.toFixed(1)}% | C4: ${c4Drop.toFixed(1)}%`
      );
    } else if (currentClassification === 'LEFT_HAND') {
      eventCounts.leftHand++;
      console.log(
        `>>> [BCI EVENT] ⬅ LEFT HAND DETECTED!  LI: ${li.toFixed(2)} | C4 Drop: ${c4Drop.toFixed(1)}% | C3: ${c3Drop.toFixed(1)}%`
      );
    } else {
      console.log(`>>> [BCI EVENT] ⚖ RESTORED TO REST (Balanced). LI: ${li.toFixed(2)}`);
    }

    io.emit('bci-action', {
      action: currentClassification,
      previous: previousClassification,
      lateralizationIndex: parseFloat(li.toFixed(3)),
      c3Drop: parseFloat(c3Drop.toFixed(1)),
      c4Drop: parseFloat(c4Drop.toFixed(1)),
      timestamp: lastEventTimestamp,
      counts: eventCounts
    });

    previousClassification = currentClassification;
  }

  // 6. Package and broadcast live telemetry
  const latestChannels = ringBuffer.getLatestSample();
  const flushedC3 = newSamplesC3.slice();
  const flushedC4 = newSamplesC4.slice();
  newSamplesC3 = [];
  newSamplesC4 = [];

  const telemetryPayload = {
    timestamp: Date.now(),
    classification: currentClassification,
    lateralizationIndex: parseFloat(li.toFixed(3)),
    liThreshold: currentLIThreshold,
    dropThreshold: currentDropThreshold,
    c3: {
      voltage: latestChannels[0],
      muPower: parseFloat(c3Mu.toFixed(2)),
      baseline: parseFloat(baselineC3.toFixed(2)),
      dropPercentage: parseFloat(c3Drop.toFixed(1)),
      bandPowers: {
        delta: parseFloat(bilateral.c3.bandPowers.delta.toFixed(2)),
        theta: parseFloat(bilateral.c3.bandPowers.theta.toFixed(2)),
        mu: parseFloat(bilateral.c3.bandPowers.mu.toFixed(2)),
        beta: parseFloat(bilateral.c3.bandPowers.beta.toFixed(2)),
        gamma: parseFloat(bilateral.c3.bandPowers.gamma.toFixed(2)),
        mains: parseFloat(bilateral.c3.bandPowers.mains.toFixed(2))
      }
    },
    c4: {
      voltage: latestChannels[2],
      muPower: parseFloat(c4Mu.toFixed(2)),
      baseline: parseFloat(baselineC4.toFixed(2)),
      dropPercentage: parseFloat(c4Drop.toFixed(1)),
      bandPowers: {
        delta: parseFloat(bilateral.c4.bandPowers.delta.toFixed(2)),
        theta: parseFloat(bilateral.c4.bandPowers.theta.toFixed(2)),
        mu: parseFloat(bilateral.c4.bandPowers.mu.toFixed(2)),
        beta: parseFloat(bilateral.c4.bandPowers.beta.toFixed(2)),
        gamma: parseFloat(bilateral.c4.bandPowers.gamma.toFixed(2)),
        mains: parseFloat(bilateral.c4.bandPowers.mains.toFixed(2))
      }
    },
    samplesC3: flushedC3,
    samplesC4: flushedC4,
    allChannels: Array.from(latestChannels),
    stats: {
      sampleRate: incomingSampleRate,
      bufferedSamples: ringBuffer.size(),
      totalPackets: totalUdpPackets,
      counts: eventCounts
    }
  };

  io.emit('bci-data', telemetryPayload);
}, broadcastIntervalMs);

// ==========================================
// 3. Socket.io Client Connection & Commands
// ==========================================
io.on('connection', (socket) => {
  console.log(`[CLIENT] Frontend dashboard connected (id: ${socket.id})`);

  socket.on('calibrate', () => {
    const c3Data = ringBuffer.getChannelData(0);
    const c4Data = ringBuffer.getChannelData(2);
    if (c3Data.length > 0 && c4Data.length > 0) {
      const b = analyzeBilateralSpectrum(c3Data, c4Data, SAMPLE_RATE);
      baselineC3 = b.c3.muPower;
      baselineC4 = b.c4.muPower;
      console.log(
        `[BCI CALIBRATION] User re-calibrated baselines -> C3: ${baselineC3.toFixed(1)} | C4: ${baselineC4.toFixed(1)}`
      );
      socket.emit('calibrated', { baselineC3, baselineC4 });
    }
  });

  socket.on('set-li-threshold', (val) => {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0.1 && parsed <= 0.8) {
      currentLIThreshold = parsed;
      console.log(`[BCI CONFIG] LI threshold updated to ±${currentLIThreshold}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[CLIENT] Frontend dashboard disconnected (id: ${socket.id})`);
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    sampleRate: incomingSampleRate,
    classification: currentClassification,
    lateralizationIndexThreshold: currentLIThreshold,
    baselineC3,
    baselineC4,
    eventCounts
  });
});

server.listen(HTTP_PORT, () => {
  console.log('='.repeat(75));
  console.log('🧠 2-CLASS BRAIN-COMPUTER INTERFACE (BCI) SERVER READY');
  console.log('='.repeat(75));
  console.log(`Dashboard URL      : http://localhost:${HTTP_PORT}`);
  console.log(`UDP EEG Ingest     : udp://127.0.0.1:${UDP_PORT}`);
  console.log(`Target Sites       : Ch 1 (C3 - Left Brain) vs Ch 3 (C4 - Right Brain)`);
  console.log(`Classification     : Left Hand vs. Rest vs. Right Hand (Lateralization Index)`);
  console.log(`Broadcast Rate     : ${FPS_BROADCAST} FPS over Socket.io`);
  console.log('='.repeat(75));
});
