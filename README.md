# 🧠 Brainwave BCI — 2-Class Motor Imagery (Left Hand vs. Right Hand)

A complete, runnable Minimum Viable Product (MVP) for a real-time **Brain-Computer Interface (BCI)** desktop application featuring **2-Class Motor Imagery (Left Hand vs. Right Hand vs. Rest)**.

The system models non-invasive EEG telemetry from human motor cortex activation using:
1. **Python Synthetic Headset Simulator**: Generates 8-channel EEG at 250 Hz, alternating between **Rest**, **Right Hand motor imagery** (contralateral C3 ERD), and **Left Hand motor imagery** (contralateral C4 ERD).
2. **Node.js DSP Backend**: Unpacks 250 Hz UDP float streams, runs bilateral Cooley-Tukey Radix-2 FFTs on electrodes **C3** (Channel 1) and **C4** (Channel 3), calculates the **Lateralization Index (LI)**, and broadcasts telemetry at 30 FPS over Socket.io.
3. **Cyber-Neuro Web Dashboard**: Features a 3-way directional HUD (`⬅ LEFT HAND` | `⚖ REST` | `➔ RIGHT HAND`), a real-time Lateralization Index balance needle, dual-waveform oscilloscope (C3 in Cyan, C4 in Magenta), dual Mu band gauges, and spatial stereo audio feedback.

---

## 🏛 System Architecture & Signal Flow

```
┌────────────────────────────────────────────────────────┐
│             Python Hardware Simulator                  │
│          (simulator/synthetic_headset.py)              │
│                                                        │
│  Streams 8-Ch EEG @ 250 Hz via UDP (127.0.0.1:3001)    │
│  - Phase 1: REST (3.5s)       --> C3=100%, C4=100%     │
│  - Phase 2: RIGHT HAND (2.5s) --> C3=20%,  C4=100%     │
│  - Phase 3: REST (3.0s)       --> C3=100%, C4=100%     │
│  - Phase 4: LEFT HAND (2.5s)  --> C3=100%, C4=20%      │
└───────────────────────────┬────────────────────────────┘
                            │ Binary IEEE 754 floats (`<8f` = 32 bytes)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Node.js DSP Backend                      │
│      (server/index.js, dsp.js, ringBuffer.js)          │
│                                                        │
│  1. Unpacks UDP datagrams into 250-sample Ring Buffer  │
│  2. Bilateral Radix-2 FFT on Ch1 (C3) & Ch3 (C4)       │
│  3. Computes Lateralization Index:                     │
│        LI = (P_C4 - P_C3) / (P_C4 + P_C3)              │
│  4. Classifies:                                        │
│        LI >= +0.35 --> RIGHT HAND (Left brain ERD)     │
│        LI <= -0.35 --> LEFT HAND  (Right brain ERD)    │
│        Otherwise   --> REST                            │
└───────────────────────────┬────────────────────────────┘
                            │ Socket.io (30 FPS capped rate)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Cyber-Neuro Web Dashboard                 │
│              (public/index.html & app.js)              │
│                                                        │
│  1. 3-Way Directional HUD (⬅ LEFT / ⚖ REST / ➔ RIGHT) │
│  2. Dynamic Lateralization Balance Needle (-1 to +1)   │
│  3. Dual-Waveform Oscilloscope (C3 Cyan / C4 Magenta)  │
│  4. Dual Mu Power Gauges (8 - 12 Hz)                   │
│  5. Stereo Spatial Audio Feedback (Left / Right pan)   │
└────────────────────────────────────────────────────────┘
```

---

## 🔬 Neuroscience & DSP Principles

### 1. Contralateral Brain Organization
The primary motor cortex has a contralateral representation of the body:
* **Electrode C3 (Left Hemisphere)**: Controls the **Right Hand**.
* **Electrode C4 (Right Hemisphere)**: Controls the **Left Hand**.

### 2. Event-Related Desynchronization (ERD)
* In resting state, sensorimotor pyramidal neurons oscillate synchronously at **8–12 Hz (Mu rhythm)** on both hemispheres.
* When imagining moving the **Right Hand**, pyramidal neurons in **C3** desynchronize, causing an 80% amplitude reduction (**~96% power drop** in Mu band at C3). C4 remains synchronized.
* When imagining moving the **Left Hand**, neurons in **C4** desynchronize (**~96% power drop** in Mu band at C4). C3 remains synchronized.

### 3. Lateralization Index (LI)
To isolate intentional hand movement from global arousal or noise, the standard BCI metric is the **Lateralization Index**:

$$\text{LI} = \frac{P_{\text{C4}} - P_{\text{C3}}}{P_{\text{C4}} + P_{\text{C3}}}$$

* **REST**: $P_{\text{C4}} \approx P_{\text{C3}} \implies \mathbf{\text{LI} \approx 0.00}$
* **RIGHT HAND**: $P_{\text{C3}} \ll P_{\text{C4}} \implies \mathbf{\text{LI} \ge +0.35}$ (typically $+0.92$)
* **LEFT HAND**: $P_{\text{C4}} \ll P_{\text{C3}} \implies \mathbf{\text{LI} \le -0.35}$ (typically $-0.92$)

---

## 🚀 How to Run and Test

### 1. Automated Verification
Run the automated test suite in under a second:
```bash
npm test
```
Expected output:
```
--- 3. 2-Class Motor Imagery Signal Classification ---
     [REST]       LI: 0.000 | C3 Mu: 1312.5 | C4 Mu: 1312.5
     [RIGHT HAND] LI: +0.923 | C3 Mu: 52.5 | C4 Mu: 1312.5
     [LEFT HAND]  LI: -0.923 | C3 Mu: 1312.5 | C4 Mu: 52.5
  ✓ [PASS] Classifies simulated signals into REST, RIGHT_HAND, and LEFT_HAND
```

### 2. Live Interactive Run

#### Terminal 1: Start Backend Server
```bash
npm start
```
* **Dashboard URL**: [http://localhost:3000](http://localhost:3000)
* **UDP Listener**: `127.0.0.1:3001`

#### Terminal 2: Start Synthetic Headset
```bash
npm run simulator
```

---

## 🎛 Dashboard Features

* **3-Way Directional HUD**: Large action cards light up when **LEFT HAND** (coral/magenta) or **RIGHT HAND** (cyan) is recognized.
* **Lateralization Needle**: Center gauge with a live needle showing hemispheric balance swinging from left (-1.0) to right (+1.0).
* **Dual-Trace Oscilloscope**: Real-time rendering of C3 (Cyan) and C4 (Magenta) brainwaves.
* **Dual Mu Gauges**: Visual feedback for sensorimotor rhythm power on both hemispheres.
* **Stereo Spatial Audio**: Web Audio API pans high-frequency chimes to the right ear for Right Hand, and lower-frequency chimes to the left ear for Left Hand.
* **Sensitivity Slider**: Adjust the Lateralization Index threshold from $\pm 0.20$ to $\pm 0.65$ (default: $\pm 0.35$).
