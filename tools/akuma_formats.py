#!/usr/bin/env python3
"""Readers for the file formats of "Akuma - Demon Spawn" (JC Research / Triger Soft, 1999).

Everything here was reverse engineered from the game's own data; see docs/FORMATS.md.

  GOS   sprite bank: records of animation frames, row-RLE, RGB565 (or RGB555 for the *0 variants)
  MAP   128x128 cell grid, 4 bytes/cell (ground tile u16, object tile u16), plus a trailer
  TIL   tile sheet, 20 tiles per row, 32x20 px tiles, raw RGB565 raster 640 px wide
  SF5   800x600 RGB555 picture (4 byte header: u16 w, u16 h)     SF6 = same in RGB565
  EVT   CP949 text dialogue / quest scripts
"""
import struct
import numpy as np

# ---------------------------------------------------------------- pixel formats


def rgb565(buf):
    a = np.frombuffer(buf, dtype="<u2").astype(np.uint32)
    r = ((a >> 11) & 31) * 255 // 31
    g = ((a >> 5) & 63) * 255 // 63
    b = (a & 31) * 255 // 31
    return np.stack([r, g, b], -1).astype(np.uint8)


def rgb555(buf):
    a = np.frombuffer(buf, dtype="<u2").astype(np.uint32)
    r = ((a >> 10) & 31) * 255 // 31
    g = ((a >> 5) & 31) * 255 // 31
    b = (a & 31) * 255 // 31
    return np.stack([r, g, b], -1).astype(np.uint8)


# ---------------------------------------------------------------- GOS

GOS_HEADER = 28


class GosRecord:
    """One animation: `count` frames that share a size and a hotspot."""

    def __init__(self, count, w, h, hx, hy, chunks):
        self.count, self.w, self.h, self.hx, self.hy = count, w, h, hx, hy
        self.chunks = chunks  # list of (flag byte, raw RLE bytes)


def parse_gos(data):
    """Return (leading_u16, [GosRecord...]).

    File = u16 + records + one 0xFF terminator byte.
    Record = u8 frame count, u16 w, u16 h, u16 hotspot x, u16 hotspot y, 19 reserved bytes,
             then `count` chunks of [u32 length][u8 flag][length bytes of RLE rows].
    """
    lead = struct.unpack("<H", data[:2])[0]
    p, recs = 2, []
    end = len(data) - 1  # trailing 0xFF
    while p + GOS_HEADER <= end:
        cnt = data[p]
        w, h, hx, hy = struct.unpack("<HHHH", data[p + 1:p + 9])
        q = p + GOS_HEADER
        chunks = []
        for _ in range(cnt):
            ln = struct.unpack("<I", data[q:q + 4])[0]
            flag = data[q + 4]
            chunks.append((flag, data[q + 5:q + 5 + ln]))
            q += 5 + ln
        recs.append(GosRecord(cnt, w, h, hx, hy, chunks))
        p = q
    if p != end:
        raise ValueError("GOS parse ended at %d, expected %d" % (p, end))
    return lead, recs


def decode_gos_frame(rec, chunk_index, fmt565=True):
    """Decode one frame to an RGBA uint8 array (h, w, 4). Colour 0x0000 never occurs inside runs
    except as real black, so transparency comes only from skipped pixels."""
    w, h = rec.w, rec.h
    _, d = rec.chunks[chunk_index]
    flat = np.zeros((h * w, 4), np.uint8)
    srcs, dsts = [], []
    i = 0
    for y in range(h):
        x = 0
        while True:
            b = d[i]
            if b == 0xFF:
                i += 1
                break
            x += b
            n = d[i + 1]
            i += 2
            if n:
                srcs.append(np.frombuffer(d, dtype="<u2", count=n, offset=i))
                dsts.append(np.arange(y * w + x, y * w + x + n))
                x += n
                i += 2 * n
    if srcs:
        vals = np.concatenate(srcs).astype(np.uint32)
        idx = np.concatenate(dsts)
        if fmt565:
            r, g, b = (vals >> 11) & 31, (vals >> 5) & 63, vals & 31
            flat[idx, 0] = r * 255 // 31
            flat[idx, 1] = g * 255 // 63
            flat[idx, 2] = b * 255 // 31
        else:
            r, g, b = (vals >> 10) & 31, (vals >> 5) & 31, vals & 31
            flat[idx, 0] = r * 255 // 31
            flat[idx, 1] = g * 255 // 31
            flat[idx, 2] = b * 255 // 31
        flat[idx, 3] = 255
    return flat.reshape(h, w, 4)


# ---------------------------------------------------------------- MAP / TIL

MAP_STRIDE = 128
TILE_W, TILE_H, TILE_COLS = 32, 20, 20
NONE = 0xFFFF


def parse_map(data):
    """-> dict(w, h, ground[h][w], objects[h][w], trailer bytes). 0xFFFF == no tile."""
    w, h = data[0], data[1]
    cells = np.frombuffer(data[2:2 + MAP_STRIDE * MAP_STRIDE * 4], dtype="<u2").reshape(MAP_STRIDE, MAP_STRIDE, 2)
    return {
        "w": w,
        "h": h,
        "ground": cells[:h, :w, 0].copy(),
        "objects": cells[:h, :w, 1].copy(),
        "trailer": data[2 + MAP_STRIDE * MAP_STRIDE * 4:],
        "cells": cells,
    }


def load_til_sheet(data):
    """Raw RGB565 raster, 640 px wide. -> (rows, 640, 3) uint8 (a few trailing bytes are ignored)."""
    W = TILE_COLS * TILE_W
    rows = (len(data) // 2) // W
    return rgb565(data[:rows * W * 2]).reshape(rows, W, 3)


def til_tile_count(sheet):
    return (sheet.shape[0] // TILE_H) * TILE_COLS


def til_get(sheet, idx):
    r, c = divmod(int(idx), TILE_COLS)
    return sheet[r * TILE_H:(r + 1) * TILE_H, c * TILE_W:(c + 1) * TILE_W]


# ---------------------------------------------------------------- SF5 / SF6


def parse_sf(data, is565):
    w, h = struct.unpack("<HH", data[:4])
    conv = rgb565 if is565 else rgb555
    return conv(data[4:4 + w * h * 2]).reshape(h, w, 3)
