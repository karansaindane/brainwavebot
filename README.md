# 🧠 Brainwave BCI — Brain-Computer Interface MVP

A complete, runnable Minimum Viable Product (MVP) for a real-time **Brain-Computer Interface (BCI)** desktop application. 

This system models non-invasive EEG telemetry from a user performing **Motor Imagery** (imagining moving their right hand). Because physical EEG headsets are not always available during early development, the architecture uses a **Python-based synthetic hardware simulator** that streams 8-channel EEG at 250 Hz over UDP, a **Node.js backend** that runs Digital Signal Processing (FFT, Hann window, power band isolation, threshold classification), and a **cyber-neuro Web Dashboard** that visualizes live brainwaves, frequency spectra, and classified action events.

---

## 🏛 System Architecture & Signal Flow

```
┌────────────────────────────────┐
│   Python Hardware Simulator    │  Generates 8-ch EEG @ 250 Hz
│ (simulator/synthetic_headset.py│  Mixes 10Hz Mu + 18Hz Beta + 50Hz Mains
│                                │  Every 5s: 10Hz drops by 80% (Motor Imagery ERD)
└───────────────┬────────────────┘
                │  UDP Datagrams (127.0.0.1:3001)
                │  Binary IEEE 754 float32 (`<8f` = 32 bytes/packet)
                ▼
┌────────────────────────────────┐
│      Node.js DSP Backend       │  1. Unpacks binary float stream (dgram UDP)
│       (server/index.js)        │  2. Ingests into 250-sample Ring Buffer (1.0s window)
│       (server/dsp.js)          │  3. In-place Radix-2 Cooley-Tukey FFT + Hann Window
│       (server/ringBuffer.js)   │  4. Extracts Mu Band Power (8 - 12 Hz) on Ch 1
│                                │  5. Evaluates ERD Threshold (>= 40% drop vs Baseline)
└───────────────┬────────────────┘
                │  Socket.io WebSocket (30 FPS capped rate)
                │  JSON Telemetry (Voltage, Band Powers, Action Triggers)
                ▼
┌────────────────────────────────┐
│   Cyber-Neuro Web Dashboard    │  1. High-DPI Canvas Oscilloscope (Channel 1 Voltage)
│      (public/index.html)       │  2. Glowing Mu Band Power Gauge & Threshold Line
│      (public/style.css)        │  3. "Action Triggered" Motor Imagery Alert HUD
│      (public/app.js)           │  4. Spectral Bands breakdown + 8-Ch Array Matrix
└────────────────────────────────┘
```

---

## 📁 Exact File Structure

```
brainwave/
├── package.json                   # Node.js dependencies (express, socket.io)
├── README.md                      # Architecture documentation & quickstart
├── simulator/
│   └── synthetic_headset.py      # 8-Channel 250Hz UDP EEG hardware simulator
├── server/
│   ├── index.js                  # Express, Socket.io & UDP server orchestrator
│   ├── dsp.js                    # Radix-2 FFT, Hann window & spectral power analysis
│   └── ringBuffer.js             # Circular buffer (1.0s = 250 samples x 8 channels)
└── public/
    ├── index.html                # Dark cyber-neuro dashboard markup
    ├── style.css                 # Dark theme styling, glow effects & responsive HUD
    └── app.js                    # Canvas oscilloscope, Socket.io client & Web Audio alert
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Node.js**: v16+ (or any modern Node runtime) & `npm`
- **Python**: 3.8+ (Uses **Python Standard Library only** — zero `pip` dependencies required!)

### 2. Install Node Dependencies
In the root directory (`brainwave`), install the required Express and Socket.io packages:
```bash
npm install
```

### 3. Launch the Backend Server
Start the Node.js UDP listener, DSP pipeline, and HTTP dashboard server:
```bash
npm start
# or: node server/index.js
```
Expected output:
```
======================================================================
🧠 BRAIN-COMPUTER INTERFACE (BCI) SERVER READY
======================================================================
Web Dashboard URL : http://localhost:3000
UDP EEG Ingest     : udp://127.0.0.1:3001
DSP Target Band    : Mu / Sensorimotor Rhythm (8 - 12 Hz)
Classification     : Motor Imagery triggered on >= 40% Mu power drop
Broadcast Rate     : 30 FPS over Socket.io
======================================================================
[UDP INGEST] Listening for synthetic EEG packets on udp://0.0.0.0:3001
```

### 4. Open the Web Dashboard
Open your browser and navigate to:
```
http://localhost:3000
```
The status pill in the top header will display **`SOCKET: ONLINE`** and wait for EEG data.

### 5. Start the Synthetic EEG Headset Simulator
Open a second terminal window in the project directory and run:
```bash
python simulator/synthetic_headset.py
# or: npm run simulator
```
Expected output:
```
======================================================================
🧠 BRAINWAVE SYNTHETIC EEG HEADSET SIMULATOR
======================================================================
Target Endpoint   : udp://127.0.0.1:3001
Sampling Rate     : 250 Hz (dt = 4.00 ms)
Channels          : 8 Channels (Ch1: C3 Motor Cortex)
Signal Mixture    : 10 Hz (Mu/Alpha) + 18 Hz (Beta) + 50 Hz (Powerline Noise)
Event Schedule    : 5.0s Rest Baseline -> 2.5s Motor Imagery (80% drop in 10Hz)
Cycle Period      : Every 7.5 seconds
Payload Format    : 8 x 32-bit float (IEEE 754 little-endian, 32 bytes/packet)
======================================================================
Streaming started. Press Ctrl+C to terminate.

[STATUS] T=   1.0s | Rate: 250.0 Hz | Ch1:  +14.2 uV | Mu Sup:    0% | State: REST (10 Hz Baseline @ 100%)
...
[  5.00s] >>> [EVENT TRIGGERED] Hand Motor Imagery Initiated! Ch1 Mu power dropping by ~96% (-80% amp)...
```

---

## 🔬 Neuroscience & DSP Principles

### 1. Sensorimotor Rhythm & Event-Related Desynchronization (ERD)
- In human neuroscience, synchronous firing of pyramidal neurons in the primary motor cortex (specifically electrode position **C3** for the contralateral right hand) produces an idling oscillation at **8–12 Hz** known as the **Mu rhythm** (or sensorimotor rhythm).
- When a person moves or **actively imagines moving** their hand (**Motor Imagery**), the synchronized idle firing dissolves. This physiological phenomenon is known as **Event-Related Desynchronization (ERD)**.
- In this simulator, every 5 seconds the user "imagines moving their hand," causing an **80% drop in 10 Hz amplitude**. Because power is proportional to amplitude squared:
  $$\text{Power} \propto A^2 \implies (0.2)^2 = 0.04 \quad (\text{a } 96\% \text{ reduction in band power})$$

### 2. Fast Fourier Transform (FFT) & Hann Window
- The backend stores the most recent 1 second of data ($N = 250$ samples at $F_s = 250 \text{ Hz}$).
- To prevent spectral leakage, a **Hann Window** is applied:
  $$w[n] = 0.5 \left(1 - \cos\left(\frac{2\pi n}{N-1}\right)\right)$$
- The windowed signal is zero-padded to $N = 256$ points (nearest power of 2) and analyzed with an in-place Radix-2 Cooley-Tukey FFT.
- With $F_s = 250 \text{ Hz}$ and $N = 256$, the frequency bin spacing is $\Delta f = \frac{250}{256} \approx 0.9766 \text{ Hz}$.
- The **Mu Band (8–12 Hz)** is calculated by averaging the Power Spectral Density (PSD) bins from $8.0 \text{ Hz}$ to $12.0 \text{ Hz}$.

### 3. Classification Logic & Adaptive Baseline
- The baseline average Mu power is calibrated during initial rest.
- Desynchronization percentage:
  $$\Delta \text{Mu} = \left(\frac{\text{Baseline} - \text{Current Mu Power}}{\text{Baseline}}\right) \times 100\%$$
- If $\Delta \text{Mu} \ge 40\%$, the classifier triggers **`MOTOR IMAGERY DETECTED`**.
- When resting, an Exponential Moving Average (EMA) gently adapts baseline power ($\text{Baseline} = 0.995 \times \text{Baseline} + 0.005 \times \text{Current}$). During an ERD event, baseline updates are frozen to prevent baseline shrinkage.

---

## 🎛 Dashboard Features

1. **High-DPI Canvas Oscilloscope**:
   - Live-scrolling voltage-over-time waveform for Channel 1.
   - Dual-buffered 60 FPS animation with phosphor neon glow.
   - Voltage reference markings (+40 µV, 0 µV, -40 µV).
   - Dynamic canvas hue tint during active ERD events.
2. **"Action Triggered" Hero Card**:
   - In rest: Calm green status with `SENSORIMOTOR RHYTHM INTACT`.
   - When Motor Imagery is recognized: Pulses vibrant neon coral/crimson with `⚡ MOTOR IMAGERY DETECTED`.
   - Synthesizes an authentic sci-fi BCI activation sound via the Web Audio API.
3. **Mu Band Power Gauge**:
   - Real-time power level vs baseline.
   - Visible threshold cutoff marker line.
   - Interactive threshold slider (20% to 75%, default 40%).
4. **Spectral Breakdown**:
   - Real-time power levels across **Delta** (1-4 Hz), **Theta** (4-8 Hz), **Mu/Alpha** (8-12 Hz), **Beta** (12-30 Hz), **Gamma** (30-50 Hz), and **50Hz Mains**.
5. **8-Channel Array Grid**:
   - Live voltage readout and VU indicators for all 8 electrode locations.
6. **Activity Log**:
   - Chronological timestamped event ledger with desynchronization percentage and trigger durations.

---

## ⚙️ Configuration & Options

### Python Simulator CLI Flags
```bash
python simulator/synthetic_headset.py --help

Options:
  --host TEXT       Target UDP host (default: 127.0.0.1)
  --port INT        Target UDP port (default: 3001)
  --rate INT        Sampling rate in Hz (default: 250)
  --baseline FLOAT  Baseline rest duration in seconds (default: 5.0)
  --erd FLOAT       Motor imagery ERD duration in seconds (default: 2.5)
```

### Environment Variables for Node Server
```bash
PORT=3000      # HTTP Dashboard port (default: 3000)
UDP_PORT=3001  # UDP Ingest port (default: 3001)
```

---

## 📄 License
MIT License. Created for BCI & Neurotechnology MVP prototyping.

