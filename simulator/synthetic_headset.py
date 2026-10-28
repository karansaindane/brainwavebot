#!/usr/bin/env python3
"""
Synthetic EEG Hardware Simulator for Brain-Computer Interface (BCI) MVP
Streams 8-channel synthetic EEG data at 250 Hz over UDP to 127.0.0.1:3001.

Simulates:
- Channel 1 (C3 Motor Cortex):
    * 10 Hz (Alpha/Mu Band): Primary sensorimotor rhythm (~15.0 uV)
    * 18 Hz (Beta Band): Motor activity rhythm (~6.0 uV)
    * 50 Hz (Powerline Mains Noise): Environmental artifact (~2.5 uV)
    * Low-frequency drift and Gaussian random noise
- Channels 2-8: Realistic EEG electrode channels (Cz, C4, F3, F4, P3, P4, O1)
- Periodic Event-Related Desynchronization (ERD):
    * Every 5 seconds, the 10 Hz wave amplitude on Channel 1 drops by 80% for 2.5s.
    * This simulates the user imagining moving their contralateral hand.
"""

import sys
import time
import math
import socket
import struct
import random
import argparse

# Default Configuration
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3001
DEFAULT_SAMPLE_RATE = 250  # 250 Hz (4 ms per sample)
DEFAULT_BASELINE_SEC = 5.0  # Seconds of rest before ERD event
DEFAULT_ERD_SEC = 2.5       # Seconds of motor imagery ERD duration


def build_channel_sample(t, erd_factor):
    """
    Generate one sample for all 8 EEG channels at time t (seconds).
    erd_factor: 1.0 during baseline rest, 0.2 during 80% desynchronization.
    """
    # 50 Hz Mains powerline noise (common across all channels with slight phase variation)
    noise_50hz = 2.5 * math.sin(2.0 * math.pi * 50.0 * t)

    # 18 Hz Beta wave (associated with active thinking / motor cortex)
    beta_18hz = 6.0 * math.sin(2.0 * math.pi * 18.0 * t)

    # Low-frequency baseline drift (0.5 Hz slow drift)
    drift = 1.5 * math.sin(2.0 * math.pi * 0.5 * t)

    # High frequency white noise
    white_noise = random.gauss(0.0, 0.8)

    # Channel 1 (C3 - Left Motor Cortex / Hand Area):
    # Features 10 Hz Mu rhythm that drops by 80% during motor imagery
    mu_10hz_ch1 = (15.0 * erd_factor) * math.sin(2.0 * math.pi * 10.0 * t)
    ch1 = mu_10hz_ch1 + beta_18hz + noise_50hz + drift + white_noise

    # Channel 2 (Cz - Central midline): Slight 10 Hz modulation
    mu_10hz_ch2 = 12.0 * math.sin(2.0 * math.pi * 10.0 * t + 0.4)
    ch2 = mu_10hz_ch2 + 4.5 * math.sin(2.0 * math.pi * 18.0 * t + 0.5) + noise_50hz * 0.9 + random.gauss(0.0, 0.7)

    # Channel 3 (C4 - Right Motor Cortex): Remains stable during unilateral imagery
    mu_10hz_ch3 = 14.0 * math.sin(2.0 * math.pi * 10.0 * t + 0.9)
    ch3 = mu_10hz_ch3 + 5.0 * math.sin(2.0 * math.pi * 18.0 * t + 1.0) + noise_50hz * 1.1 + random.gauss(0.0, 0.8)

    # Channel 4 (F3 - Frontal Left): Higher Beta, lower Alpha
    ch4 = 5.0 * math.sin(2.0 * math.pi * 10.0 * t + 1.2) + 8.0 * math.sin(2.0 * math.pi * 22.0 * t) + noise_50hz + random.gauss(0.0, 0.9)

    # Channel 5 (F4 - Frontal Right): Higher Beta
    ch5 = 5.0 * math.sin(2.0 * math.pi * 10.0 * t + 1.5) + 7.5 * math.sin(2.0 * math.pi * 21.0 * t) + noise_50hz + random.gauss(0.0, 0.9)

    # Channel 6 (P3 - Parietal Left): Parieto-occipital alpha rhythm
    ch6 = 18.0 * math.sin(2.0 * math.pi * 10.0 * t + 2.0) + 3.0 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 0.8 + random.gauss(0.0, 0.7)

    # Channel 7 (P4 - Parietal Right): Parieto-occipital alpha rhythm
    ch7 = 17.0 * math.sin(2.0 * math.pi * 10.0 * t + 2.3) + 3.5 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 0.8 + random.gauss(0.0, 0.7)

    # Channel 8 (Oz - Occipital): Strong visual alpha
    ch8 = 20.0 * math.sin(2.0 * math.pi * 10.0 * t + 3.14) + 2.0 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 1.2 + random.gauss(0.0, 1.0)

    return (ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8)


def main():
    parser = argparse.ArgumentParser(description="Synthetic 8-Channel EEG UDP Simulator for BCI")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Target UDP host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Target UDP port (default: {DEFAULT_PORT})")
    parser.add_argument("--rate", type=int, default=DEFAULT_SAMPLE_RATE, help=f"Sampling rate in Hz (default: {DEFAULT_SAMPLE_RATE})")
    parser.add_argument("--baseline", type=float, default=DEFAULT_BASELINE_SEC, help=f"Baseline duration in seconds (default: {DEFAULT_BASELINE_SEC})")
    parser.add_argument("--erd", type=float, default=DEFAULT_ERD_SEC, help=f"ERD duration in seconds (default: {DEFAULT_ERD_SEC})")
    args = parser.parse_args()

    host = args.host
    port = args.port
    rate = args.rate
    dt = 1.0 / rate
    cycle_duration = args.baseline + args.erd

    # Setup UDP Socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    target_addr = (host, port)

    print("=" * 70)
    print("🧠 BRAINWAVE SYNTHETIC EEG HEADSET SIMULATOR")
    print("=" * 70)
    print(f"Target Endpoint   : udp://{host}:{port}")
    print(f"Sampling Rate     : {rate} Hz (dt = {dt*1000:.2f} ms)")
    print(f"Channels          : 8 Channels (Ch1: C3 Motor Cortex)")
    print(f"Signal Mixture    : 10 Hz (Mu/Alpha) + 18 Hz (Beta) + 50 Hz (Powerline Noise)")
    print(f"Event Schedule    : {args.baseline:.1f}s Rest Baseline -> {args.erd:.1f}s Motor Imagery (80% drop in 10Hz)")
    print(f"Cycle Period      : Every {cycle_duration:.1f} seconds")
    print(f"Payload Format    : 8 x 32-bit float (IEEE 754 little-endian, 32 bytes/packet)")
    print("=" * 70)
    print("Streaming started. Press Ctrl+C to terminate.\n")

    sample_index = 0
    start_time = time.perf_counter()
    next_sample_time = start_time
    last_status_print = start_time
    samples_in_current_sec = 0

    prev_state = None

    try:
        while True:
            # Current elapsed simulation time
            t = sample_index * dt
            cycle_t = t % cycle_duration

            # Determine whether we are in Baseline Rest or Motor Imagery ERD
            if cycle_t < args.baseline:
                # Baseline Rest: 100% Mu amplitude
                erd_factor = 1.0
                state_str = "REST (10 Hz Baseline @ 100%)"
                state_code = "REST"
            else:
                # Motor Imagery ERD: 80% drop (amplitude drops to 20%)
                # Add a 100ms smooth fade transition to avoid artificial square step discontinuity
                transition_in = (cycle_t - args.baseline) / 0.1
                transition_out = (cycle_duration - cycle_t) / 0.1

                if transition_in < 1.0:
                    erd_factor = 1.0 - 0.8 * transition_in
                elif transition_out < 1.0:
                    erd_factor = 0.2 + 0.8 * (1.0 - transition_out)
                else:
                    erd_factor = 0.2

                state_str = "⚡ MOTOR IMAGERY (10 Hz ERD @ -80%)"
                state_code = "ERD"

            # Print state transition notices
            if state_code != prev_state:
                timestamp_str = f"[{t:6.2f}s]"
                if state_code == "ERD":
                    print(f"\n{timestamp_str} >>> [EVENT TRIGGERED] Hand Motor Imagery Initiated! Ch1 Mu power dropping by ~96% (-80% amp)...")
                else:
                    print(f"\n{timestamp_str} >>> [REST RESTORED]   Motor Imagery Ended. Ch1 Mu rhythm returning to baseline...")
                prev_state = state_code

            # Generate sample
            channels = build_channel_sample(t, erd_factor)

            # Pack 8 floats as little-endian float32 ('<8f' = 32 bytes)
            payload = struct.pack("<8f", *channels)

            # Transmit UDP packet
            try:
                sock.sendto(payload, target_addr)
            except Exception as e:
                # If target is unreachable temporarily, keep running
                pass

            sample_index += 1
            samples_in_current_sec += 1

            # Periodic terminal status update (every 1.0s)
            now = time.perf_counter()
            if now - last_status_print >= 1.0:
                measured_rate = samples_in_current_sec / (now - last_status_print)
                ch1_val = channels[0]
                erd_pct = (1.0 - erd_factor) * 100.0
                sys.stdout.write(
                    f"\r[STATUS] T={t:6.1f}s | Rate: {measured_rate:5.1f} Hz | "
                    f"Ch1: {ch1_val:+6.1f} uV | Mu Sup: {erd_pct:4.0f}% | State: {state_str:<32}"
                )
                sys.stdout.flush()
                last_status_print = now
                samples_in_current_sec = 0

            # High precision drift-corrected sleep
            next_sample_time += dt
            sleep_time = next_sample_time - time.perf_counter()
            if sleep_time > 0:
                time.sleep(sleep_time)
            elif sleep_time < -0.1:
                # Reset if lagging significantly (e.g. system suspended)
                next_sample_time = time.perf_counter()

    except KeyboardInterrupt:
        print("\n\n" + "-" * 70)
        print("Simulator stopped by user.")
        print(f"Total samples sent : {sample_index}")
        print(f"Total streamed time: {sample_index * dt:.2f} seconds")
        print("-" * 70)
    finally:
        sock.close()


if __name__ == "__main__":
    main()

