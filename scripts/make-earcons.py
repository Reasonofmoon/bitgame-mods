#!/usr/bin/env python3
"""Writes the 8-bit cues of game-earcons as small WAV files (square waves).

    python3 scripts/make-earcons.py

Standard library only. 22.05 kHz, 16-bit mono, a few kB each.
"""
import math
import os
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'plugins', 'game-earcons', 'sounds')

# (frequency Hz or 0 for a rest, milliseconds, duty cycle)
CUES = {
    # a turn finished: rising arpeggio C5 E5 G5 C6
    'done': [(523.25, 70, 0.25), (659.25, 70, 0.25), (783.99, 70, 0.25), (1046.50, 200, 0.25)],
    # a failure: falling G4 D4 A3
    'miss': [(392.00, 110, 0.5), (293.66, 110, 0.5), (220.00, 240, 0.5)],
    # needs you (a question or a permission prompt): two pings
    'ask': [(880.00, 80, 0.25), (0, 50, 0.5), (1318.51, 130, 0.25)],
    # saved: the coin
    'save': [(987.77, 70, 0.5), (1318.51, 320, 0.5)],
    # a guard refused a call: low buzz
    'block': [(110.00, 150, 0.125), (98.00, 220, 0.125)],
    # a file changed (hardcore): one short blip
    'hit': [(1567.98, 45, 0.25)],
}


def tone(freq, ms, duty, amp=0.28):
    n = int(RATE * ms / 1000)
    out = []
    for i in range(n):
        if freq == 0:
            out.append(0.0)
            continue
        phase = (i * freq / RATE) % 1.0
        square = 1.0 if phase < duty else -1.0
        # quick attack, linear decay: no clicks at the edges
        attack = min(1.0, i / (RATE * 0.004))
        decay = 1.0 - (i / n) * 0.65
        out.append(square * amp * attack * decay)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, notes in CUES.items():
        samples = [s for note in notes for s in tone(*note)]
        samples += [0.0] * int(RATE * 0.02)
        path = os.path.join(OUT, f'{name}.wav')
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s)) * 32767)) for s in samples))
        print(f'{path}  {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    main()
