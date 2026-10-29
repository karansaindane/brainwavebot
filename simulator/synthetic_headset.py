#!/usr/bin/env python3
"""
Synthetic EEG Hardware Simulator for Brain-Computer Interface (BCI)
Streams 8-channel synthetic EEG data at 250 Hz over UDP to 127.0.0.1:3001.

2-Class Motor Imagery Simulation (Left Hand vs. Right Hand):
- Contralateral Neuroanatomy:
    * Channel 1 (C3 - Left Motor Cortex): Controls RIGHT HAND.
    * Channel 3 (C4 - Right Motor Cortex): Controls LEFT HAND.
    * Channel 2 (Cz - Midline): Stable vertex reference.
    * Channels 4-8: Frontal, Parietal, and Occipital sites.
- Signal Mixture:
    * 10 Hz (Alpha/Mu band): Primary sensorimotor rhythm (~15.0 uV).
    * 18 Hz (Beta band): Motor execution rhythm (~6.0 uV).
    * 50 Hz (Powerline Noise): Mains artifact (~2.5 uV).
    * Low-frequency drift (0.5 Hz) and Gaussian white noise.
- Alternating Event Schedule:
    1. REST (3.5s): Both C3 and C4 produce full 10 Hz Mu oscillations.
    2. RIGHT HAND (2.5s): C3 Mu amplitude drops by 80% (Left hemisphere ERD).
    3. REST (3.0s): Both C3 and C4 return to baseline.
    4. LEFT HAND (2.5s): C4 Mu amplitude drops by 80% (Right hemisphere ERD).
"""

import sys
import time
import math
import socket
import struct
import random
import argparse

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3001
DEFAULT_SAMPLE_RATE = 250  # 250 Hz

# Schedule defaults (seconds)
DEFAULT_REST_SEC = 3.5
DEFAULT_ACTION_SEC = 2.5


def build_8ch_sample(t, erd_c3, erd_c4):
    """
    Generate one 8-channel EEG sample at time t (seconds).
    erd_c3: 1.0 (rest) or 0.2 (right hand movement desynchronization)
    erd_c4: 1.0 (rest) or 0.2 (left hand movement desynchronization)
    """
    noise_50hz = 2.5 * math.sin(2.0 * math.pi * 50.0 * t)
    beta_18hz = 6.0 * math.sin(2.0 * math.pi * 18.0 * t)
    drift = 1.5 * math.sin(2.0 * math.pi * 0.5 * t)

    # Channel 1: C3 (Left Motor Cortex -> Controls RIGHT HAND)
    mu_ch1 = (15.0 * erd_c3) * math.sin(2.0 * math.pi * 10.0 * t)
    ch1 = mu_ch1 + beta_18hz + noise_50hz + drift + random.gauss(0.0, 0.8)

    # Channel 2: Cz (Midline)
    mu_ch2 = 12.0 * math.sin(2.0 * math.pi * 10.0 * t + 0.4)
    ch2 = mu_ch2 + 4.5 * math.sin(2.0 * math.pi * 18.0 * t + 0.5) + noise_50hz * 0.9 + random.gauss(0.0, 0.7)

    # Channel 3: C4 (Right Motor Cortex -> Controls LEFT HAND)
    mu_ch3 = (15.0 * erd_c4) * math.sin(2.0 * math.pi * 10.0 * t + 0.9)
    ch3 = mu_ch3 + beta_18hz + noise_50hz * 1.1 + drift + random.gauss(0.0, 0.8)

    # Channel 4: F3 (Frontal Left)
    ch4 = 5.0 * math.sin(2.0 * math.pi * 10.0 * t + 1.2) + 8.0 * math.sin(2.0 * math.pi * 22.0 * t) + noise_50hz + random.gauss(0.0, 0.9)

    # Channel 5: F4 (Frontal Right)
    ch5 = 5.0 * math.sin(2.0 * math.pi * 10.0 * t + 1.5) + 7.5 * math.sin(2.0 * math.pi * 21.0 * t) + noise_50hz + random.gauss(0.0, 0.9)

    # Channel 6: P3 (Parietal Left)
    ch6 = 18.0 * math.sin(2.0 * math.pi * 10.0 * t + 2.0) + 3.0 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 0.8 + random.gauss(0.0, 0.7)

    # Channel 7: P4 (Parietal Right)
    ch7 = 17.0 * math.sin(2.0 * math.pi * 10.0 * t + 2.3) + 3.5 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 0.8 + random.gauss(0.0, 0.7)

    # Channel 8: Oz (Occipital Visual Alpha)
    ch8 = 20.0 * math.sin(2.0 * math.pi * 10.0 * t + 3.14) + 2.0 * math.sin(2.0 * math.pi * 18.0 * t) + noise_50hz * 1.2 + random.gauss(0.0, 1.0)

    return (ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8)


def compute_fade_factor(current_t, start_t, end_t, fade_dur=0.15):
    """Compute smooth 1.0 -> 0.2 -> 1.0 transition factor."""
    if current_t < start_t or current_t >= end_t:
        return 1.0

    in_elapsed = current_t - start_t
    out_remaining = end_t - current_t

    if in_elapsed < fade_dur:
        return 1.0 - 0.8 * (in_elapsed / fade_dur)
    elif out_remaining < fade_dur:
        return 0.2 + 0.8 * (1.0 - (out_remaining / fade_dur))
    else:
        return 0.2


def main():
    parser = argparse.ArgumentParser(description="2-Class (Left vs Right Hand) Synthetic EEG Simulator for BCI")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Target UDP host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Target UDP port (default: {DEFAULT_PORT})")
    parser.add_argument("--rate", type=int, default=DEFAULT_SAMPLE_RATE, help=f"Sampling rate in Hz (default: {DEFAULT_SAMPLE_RATE})")
    parser.add_argument("--rest", type=float, default=DEFAULT_REST_SEC, help=f"Rest duration between actions (default: {DEFAULT_REST_SEC}s)")
    parser.add_argument("--action", type=float, default=DEFAULT_ACTION_SEC, help=f"Action duration for each hand (default: {DEFAULT_ACTION_SEC}s)")
    args = parser.parse_args()

    host = args.host
    port = args.port
    rate = args.rate
    dt = 1.0 / rate

    t_rest1 = args.rest
    t_action1 = t_rest1 + args.action
    t_rest2 = t_action1 + args.rest
    t_action2 = t_rest2 + args.action
    cycle_duration = t_action2

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    target_addr = (host, port)

    print("=" * 75)
    print("🧠 BRAINWAVE 2-CLASS BCI SIMULATOR: LEFT HAND vs. RIGHT HAND")
    print("=" * 75)
    print(f"Target Endpoint   : udp://{host}:{port}")
    print(f"Sampling Rate     : {rate} Hz (dt = {dt*1000:.2f} ms)")
    print(f"Electrode Pair    : Ch1 (C3 - Left Brain) vs Ch3 (C4 - Right Brain)")
    print(f"Cycle Schedule    : Rest ({args.rest:.1f}s) -> RIGHT HAND ({args.action:.1f}s) -> "
          f"Rest ({args.rest:.1f}s) -> LEFT HAND ({args.action:.1f}s)")
    print(f"Total Cycle       : {cycle_duration:.1f} seconds")
    print(f"Format            : 8 x 32-bit float (IEEE 754 LE, 32 bytes/packet)")
    print("=" * 75)
    print("Streaming started. Press Ctrl+C to terminate.\n")

    sample_index = 0
    next_sample_time = time.perf_counter()
    last_status_print = next_sample_time
    samples_in_current_sec = 0
    prev_state = None

    try:
        while True:
            t = sample_index * dt
            cycle_t = t % cycle_duration

            if cycle_t < t_rest1:
                erd_c3 = 1.0
                erd_c4 = 1.0
                state_code = "REST"
                state_str = "REST (Both C3 & C4 Synchronized @ 100%)"
            elif cycle_t < t_action1:
                erd_c3 = compute_fade_factor(cycle_t, t_rest1, t_action1)
                erd_c4 = 1.0
                state_code = "RIGHT_HAND"
                state_str = "➔ RIGHT HAND (C3 Left-Brain ERD @ -80%)"
            elif cycle_t < t_rest2:
                erd_c3 = 1.0
                erd_c4 = 1.0
                state_code = "REST"
                state_str = "REST (Both C3 & C4 Synchronized @ 100%)"
            else:
                erd_c3 = 1.0
                erd_c4 = compute_fade_factor(cycle_t, t_rest2, t_action2)
                state_code = "LEFT_HAND"
                state_str = "⬅ LEFT HAND (C4 Right-Brain ERD @ -80%)"

            if state_code != prev_state:
                ts = f"[{t:6.2f}s]"
                if state_code == "RIGHT_HAND":
                    print(f"\n{ts} >>> [EVENT] ➔ RIGHT HAND MOTOR IMAGERY! (C3 Left Motor Cortex desynchronized by 80%)")
                elif state_code == "LEFT_HAND":
                    print(f"\n{ts} >>> [EVENT] ⬅ LEFT HAND MOTOR IMAGERY!  (C4 Right Motor Cortex desynchronized by 80%)")
                else:
                    print(f"\n{ts} >>> [REST]  Sensorimotor Rhythms Balanced (Both hands resting)")
                prev_state = state_code

            channels = build_8ch_sample(t, erd_c3, erd_c4)
            payload = struct.pack("<8f", *channels)

            try:
                sock.sendto(payload, target_addr)
            except Exception:
                pass

            sample_index += 1
            samples_in_current_sec += 1

            now = time.perf_counter()
            if now - last_status_print >= 1.0:
                measured_rate = samples_in_current_sec / (now - last_status_print)
                c3_val = channels[0]
                c4_val = channels[2]
                c3_sup = (1.0 - erd_c3) * 100.0
                c4_sup = (1.0 - erd_c4) * 100.0
                sys.stdout.write(
                    f"\r[STATUS] T={t:5.1f}s | Rate: {measured_rate:5.1f} Hz | "
                    f"C3:{c3_val:+5.1f}uV (ERD:{c3_sup:2.0f}%) | "
                    f"C4:{c4_val:+5.1f}uV (ERD:{c4_sup:2.0f}%) | State: {state_str:<42}"
                )
                sys.stdout.flush()
                last_status_print = now
                samples_in_current_sec = 0

            next_sample_time += dt
            sleep_time = next_sample_time - time.perf_counter()
            if sleep_time > 0:
                time.sleep(sleep_time)
            elif sleep_time < -0.1:
                next_sample_time = time.perf_counter()

    except KeyboardInterrupt:
        print(f"\nSimulator stopped. Total samples sent: {sample_index}")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
