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

        // Advance twiddle factor
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
 * @returns {{ bins: Array<{freq: number, power: number}>, totalPower: number }}
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
  // Bins from numSamples to fftSize remain 0 (zero-padding)

  // Execute in-place FFT
  fft(real, imag);

  // Frequency resolution (Hz per bin)
  const df = sampleRate / fftSize; // 250 / 256 ~= 0.9765625 Hz
  const half = fftSize / 2;
  const bins = new Array(half);
  let totalPower = 0;

  for (let k = 0; k < half; k++) {
    const freq = k * df;
    // Power = magnitude squared / N
    const p = (real[k] * real[k] + imag[k] * imag[k]) / fftSize;
    bins[k] = { freq, power: p };
    totalPower += p;
  }

  return { bins, totalPower, df };
}

/**
 * Extract average power within a specific frequency band [minFreq, maxFreq]
 *
 * @param {Array<{freq: number, power: number}>} bins - PSD bins
 * @param {number} minFreq - Lower boundary in Hz
 * @param {number} maxFreq - Upper boundary in Hz
 * @returns {number} Average power in the band
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
 * Comprehensive EEG spectral breakdown
 *
 * @param {Float64Array|number[]} samples - 250 samples from EEG Channel 1
 * @param {number} sampleRate - Sampling frequency in Hz
 * @returns {object} Spectral powers and Mu band metric
 */
function analyzeSpectrum(samples, sampleRate = 250) {
  const psd = computePSD(samples, sampleRate);
  const { bins } = psd;

  // Extract canonical brainwave frequency bands
  const delta = getBandPower(bins, 1.0, 4.0);    // 1-4 Hz
  const theta = getBandPower(bins, 4.0, 8.0);    // 4-8 Hz
  const mu    = getBandPower(bins, 8.0, 12.0);   // 8-12 Hz (Sensorimotor / Mu rhythm)
  const beta  = getBandPower(bins, 12.0, 30.0);  // 12-30 Hz
  const gamma = getBandPower(bins, 30.0, 50.0);  // 30-50 Hz
  const mains = getBandPower(bins, 48.0, 52.0);  // 50 Hz Powerline artifact

  return {
    muPower: mu,
    bandPowers: {
      delta,
      theta,
      mu,
      beta,
      gamma,
      mains
    },
    // Top 35 bins (up to ~34 Hz) for client-side visual spectrum
    spectrumPreview: bins.slice(0, 35).map(b => ({
      freq: Math.round(b.freq * 10) / 10,
      power: Math.round(b.power * 100) / 100
    }))
  };
}

module.exports = {
  fft,
  computePSD,
  getBandPower,
  analyzeSpectrum
};

