/**
 * RingBuffer: Fixed-capacity circular buffer for multi-channel EEG telemetry.
 * Stores the last N samples (e.g., 250 samples = 1 second at 250 Hz) across 8 channels.
 */

class RingBuffer {
  /**
   * @param {number} capacity - Number of samples to retain (e.g. 250)
   * @param {number} channels - Number of EEG channels (default 8)
   */
  constructor(capacity = 250, channels = 8) {
    this.capacity = capacity;
    this.channels = channels;
    // Flat Float64Array for memory locality and speed: capacity * channels
    this.buffer = new Float64Array(capacity * channels);
    this.writeIndex = 0;
    this.count = 0;
  }

  /**
   * Push one multi-channel sample [ch0, ch1, ..., ch7]
   * @param {number[]|Float32Array} sample
   */
  push(sample) {
    const base = this.writeIndex * this.channels;
    const len = Math.min(sample.length, this.channels);
    for (let c = 0; c < len; c++) {
      this.buffer[base + c] = sample[c];
    }
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Check if ring buffer has reached full capacity
   * @returns {boolean}
   */
  isFull() {
    return this.count >= this.capacity;
  }

  /**
   * Number of samples currently stored
   * @returns {number}
   */
  size() {
    return this.count;
  }

  /**
   * Get chronological data for a specific channel (oldest to newest)
   * @param {number} channelIndex - 0-indexed (0 is Channel 1)
   * @returns {Float64Array} array of length this.count
   */
  getChannelData(channelIndex) {
    if (channelIndex < 0 || channelIndex >= this.channels) {
      throw new Error(`Invalid channel index: ${channelIndex}`);
    }
    const result = new Float64Array(this.count);
    const start = this.count < this.capacity ? 0 : this.writeIndex;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result[i] = this.buffer[idx * this.channels + channelIndex];
    }
    return result;
  }

  /**
   * Get the most recently pushed sample across all channels
   * @returns {number[]}
   */
  getLatestSample() {
    if (this.count === 0) return new Array(this.channels).fill(0);
    const lastIdx = (this.writeIndex - 1 + this.capacity) % this.capacity;
    const base = lastIdx * this.channels;
    const sample = [];
    for (let c = 0; c < this.channels; c++) {
      sample.push(this.buffer[base + c]);
    }
    return sample;
  }

  /**
   * Get the last `n` samples for a given channel in chronological order
   * @param {number} channelIndex
   * @param {number} n
   * @returns {number[]}
   */
  getRecentChannelSamples(channelIndex, n) {
    const available = Math.min(n, this.count);
    if (available === 0) return [];
    const result = new Array(available);
    const startIdx = (this.writeIndex - available + this.capacity) % this.capacity;
    for (let i = 0; i < available; i++) {
      const idx = (startIdx + i) % this.capacity;
      result[i] = this.buffer[idx * this.channels + channelIndex];
    }
    return result;
  }

  /**
   * Clear the ring buffer
   */
  clear() {
    this.writeIndex = 0;
    this.count = 0;
    this.buffer.fill(0);
  }
}

module.exports = RingBuffer;

