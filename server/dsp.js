/**
 * Digital Signal Processing (DSP) Module for Brain-Computer Interface (BCI)
 *
 * Implements:
 * - Cooley-Tukey Radix-2 Fast Fourier Transform (FFT) in pure JavaScript
 * - Hann Windowing to eliminate spectral leakage
 * - Power Spectral Density (PSD) estimation
 * - Frequency band power extraction:
 *     * Delta (1 - 4 Hz)
 *     * Theta (4 - 8 Hz)
 *     * Mu / Alpha (8 - 12 Hz) -> Primary Motor Imagery desynchronization marker
 *     * Beta (12 - 30 Hz)
 *     * Gamma (30 - 50 Hz)
 *     * Powerline Noise (48 - 52 Hz)
 * - Bilateral Lateralization Index (LI) for 2-class motor imagery (Left vs. Right)
 */

/**
 * In-place Radix-2 Decimation-In-Time Cooley-Tukey FFT.
 * Modifies `real` and `imag` arrays directly.
 * Array length N MUST be a power of 2 (e.g., 256).
 *
 * @param {Float64Array|number[]} real - Real components
 * @param {Float64Array|number[]} imag - Imaginary components
 */
function fft(real, imag) {
  const n = real.length;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2. Received length: ${n}`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;

      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computations
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2.0 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const idx1 = i + k;
        const idx2 = i + k + halfLen;

        const uR = real[idx1];
        const uI = imag[idx1];
        const vR = real[idx2] * wR - imag[idx2] * wI;
        const vI = real[idx2] * wI + imag[idx2] * wR;

        real[idx1] = uR + vR;
        imag[idx1] = uI + vI;
        real[idx2] = uR - vR;
        imag[idx2] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }
}

// Pre-computed Hann window cache for 250 points
const HANN_CACHE = new Float64Array(250);
for (let i = 0; i < 250; i++) {
  HANN_CACHE[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / 249.0));
}

/**
 * Compute Power Spectral Density (PSD) for a 1-second buffer of EEG samples.
 * Pads 250 samples to 256 for optimal radix-2 FFT.
 *
 * @param {Float64Array|number[]} samples - 250 raw EEG samples
 * @param {number} sampleRate - Sampling rate in Hz (default: 250)
 * @returns {{ bins: Array<{freq: number, power: number}>, totalPower: number, df: number }}
 */
function computePSD(samples, sampleRate = 250) {
  const fftSize = 256;
  const numSamples = Math.min(samples.length, 250);

  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  // Apply Hann window and zero-pad to 256
  for (let i = 0; i < numSamples; i++) {
    const win = i < HANN_CACHE.length ? HANN_CACHE[i] : 0.5 * (1 - Math.cos((2 * Math.PI * i) / (numSamples - 1)));
    real[i] = samples[i] * win;
  }

  fft(real, imag);

  const df = sampleRate / fftSize; // 250 / 256 ~= 0.9765625 Hz
  const half = fftSize / 2;
  const bins = new Array(half);
  let totalPower = 0;

  for (let k = 0; k < half; k++) {
    const freq = k * df;
    const p = (real[k] * real[k] + imag[k] * imag[k]) / fftSize;
    bins[k] = { freq, power: p };
    totalPower += p;
  }

  return { bins, totalPower, df };
}

/**
 * Extract average power within a specific frequency band [minFreq, maxFreq]
 */
function getBandPower(bins, minFreq, maxFreq) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < bins.length; i++) {
    const { freq, power } = bins[i];
    if (freq >= minFreq && freq <= maxFreq) {
      sum += power;
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

/**
 * Spectral analysis for single EEG channel
 */
function analyzeSpectrum(samples, sampleRate = 250) {
  const psd = computePSD(samples, sampleRate);
  const { bins } = psd;

  const delta = getBandPower(bins, 1.0, 4.0);
  const theta = getBandPower(bins, 4.0, 8.0);
  const mu    = getBandPower(bins, 8.0, 12.0); // 8-12 Hz
  const beta  = getBandPower(bins, 12.0, 30.0);
  const gamma = getBandPower(bins, 30.0, 50.0);
  const mains = getBandPower(bins, 48.0, 52.0);

  return {
    muPower: mu,
    bandPowers: { delta, theta, mu, beta, gamma, mains },
    spectrumPreview: bins.slice(0, 35).map(b => ({
      freq: Math.round(b.freq * 10) / 10,
      power: Math.round(b.power * 100) / 100
    }))
  };
}

/**
 * Calculate the Lateralization Index (LI) between C3 (Left brain) and C4 (Right brain)
 *
 * Formula:
 *   LI = (Power_C4 - Power_C3) / (Power_C4 + Power_C3)
 *
 * Interpretation:
 *   - Rest: C3 ~= C4 -> LI ~= 0.0
 *   - Right Hand Motor Imagery: C3 drops -> Power_C4 >> Power_C3 -> LI approaches +1.0
 *   - Left Hand Motor Imagery: C4 drops -> Power_C3 >> Power_C4 -> LI approaches -1.0
 *
 * @param {number} c3MuPower - Mu power for C3 (Channel 1)
 * @param {number} c4MuPower - Mu power for C4 (Channel 3)
 * @returns {number} LI clamped to [-1.0, +1.0]
 */
function computeLateralizationIndex(c3MuPower, c4MuPower) {
  const denom = c4MuPower + c3MuPower;
  if (denom < 1e-6) return 0.0;
  const rawLI = (c4MuPower - c3MuPower) / denom;
  return Math.min(Math.max(rawLI, -1.0), 1.0);
}

/**
 * Bilateral C3 & C4 spectral analysis for 2-class Motor Imagery
 */
function analyzeBilateralSpectrum(c3Samples, c4Samples, sampleRate = 250) {
  const c3Result = analyzeSpectrum(c3Samples, sampleRate);
  const c4Result = analyzeSpectrum(c4Samples, sampleRate);
  const li = computeLateralizationIndex(c3Result.muPower, c4Result.muPower);

  return {
    c3: c3Result,
    c4: c4Result,
    lateralizationIndex: li
  };
}

module.exports = {
  fft,
  computePSD,
  getBandPower,
  analyzeSpectrum,
  computeLateralizationIndex,
  analyzeBilateralSpectrum
};
