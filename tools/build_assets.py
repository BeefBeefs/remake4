#!/usr/bin/env python3
"""Convert the extracted Akuma disc into web assets under public/assets.

usage:
  python3 tools/build_assets.py --disc <dir containing MAP/ IMG/ WAV/ *.EVT> [--bin AKUMA.bin] [--out public/assets]
        [--only tiles,maps,sprites,images,audio,scripts,lang,stats,monsters,cdaudio,video] [--sprites KUSA,RINING,...|all]

Original data is never copied verbatim except the small PCM WAV sound effects.
"""
import argparse, base64, glob, json, os, subprocess, sys, struct
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import akuma_formats as af

# Map order, tileset and place name, exactly as the game executable lists them.
MAPS = [
    ("a1", "st1", "Ruined Valley"), ("a2", "st1", "Glucyn"), ("a3", "st1", "Mor"), ("a4", "st1", "Caedda"),
    ("a5", "st1", "Gudoc"), ("a6", "st1", "Codd"), ("a7", "st1", "Sucla"), ("a8", "st1", "Dragon Valley"),
    ("a9", "st1", "Dinyc"), ("a10", "st1", "Merylon"), ("a11", "st1", "Carnivore Coast"), ("a12", "st1", "Echo Valley"),
    ("a13", "st1", "Shadow Mountain"), ("a14", "st1", "Veddyn"), ("t1", "st1", "Western Village"),
    ("t2", "st1", "Mantis Village"), ("t3", "st1", "Stone Village"), ("t4", "st1", "Eastern Village"),
    ("c1", "st3", "Dragon cave"), ("c2", "st3", "Geran"), ("d8", "st3", "Desolation cave"),
    ("d9", "st3", "Death Rattle cave"), ("b1", "st2", "Death Rock"), ("b2", "st2", "Myra"),
    ("b3", "st2", "Totem Mountain"), ("b4", "st2", "Haiku Valley"), ("b5", "st2", "Four Winds Valley"),
    ("b6", "st2", "Deamyr Cemetery"), ("b7", "st2", "Vampire Valley"), ("t5", "st2", "Vulcan Village"),
    ("t6", "st2", "Bear Village"), ("c4", "st3", "Soul Castle"), ("c3", "st3", "Silla"), ("d1", "st3", "Diddyn"),
    ("d2", "st3", "Sall"), ("d3", "st3", "Spider cave"), ("d4", "st3", "Deep Bane cave"), ("d5", "st3", "Dinyc"),
    ("d6", "st3", "Cave of Bones"), ("d7", "st3", "Pandemonium cave"), ("c5", "st3", "Endless cave"),
    ("d10", "st3", "Lost Souls cave"),
]

DEFAULT_SPRITES = ["KUSA", "RINING", "LEELIM", "ENEMY-A", "ENEMY-AD", "BLOOD", "ARROW", "SHOT-A", "ITEM"]
NEW_COLS = 32  # repacked tile sheet width in tiles -> 1024 px, keeps height under 4096


def find(disc, *parts):
    p = os.path.join(disc, *parts)
    if os.path.exists(p):
        return p
    # case-insensitive fallback
    cur = disc
    for part in parts:
        hit = [e for e in os.listdir(cur) if e.lower() == part.lower()]
        if not hit:
            raise FileNotFoundError(os.path.join(*parts))
        cur = os.path.join(cur, hit[0])
    return cur


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


# ---------------------------------------------------------------- tiles

def build_tiles(disc, out):
    meta = {}
    for ts in ("st1", "st2", "st3"):
        data = open(find(disc, "MAP", ts + ".til"), "rb").read()
        sheet = af.load_til_sheet(data)
        n = af.til_tile_count(sheet)
        rows = (n + NEW_COLS - 1) // NEW_COLS
        img = np.zeros((rows * af.TILE_H, NEW_COLS * af.TILE_W, 4), np.uint8)
        solid, markers = [], []
        for i in range(n):
            t = af.til_get(sheet, i)
            r, c = divmod(i, NEW_COLS)
            blk = img[r * af.TILE_H:(r + 1) * af.TILE_H, c * af.TILE_W:(c + 1) * af.TILE_W]
            blk[..., :3] = t
            # pure black is the colour key: transparent for overlay tiles.
            blk[..., 3] = np.where(t.sum(-1) == 0, 0, 255)
            if (t == t[0, 0]).all():
                solid.append([i, int(t[0, 0, 0]), int(t[0, 0, 1]), int(t[0, 0, 2])])
            # grey 8b898b / purple 83507b are editor markers (collision / void), never art. Some marker
            # tiles are two-tone (marker colour + black colour key), so test every non-black pixel.
            flat = t.reshape(-1, 3)
            live = flat[flat.sum(-1) > 0]
            if len(live):
                q = live >> 3
                is_grey = (q == np.array([0x8b >> 3, 0x89 >> 3, 0x8b >> 3])).all(-1)
                is_purple = (q == np.array([0x83 >> 3, 0x50 >> 3, 0x7b >> 3])).all(-1)
                if (is_grey | is_purple).all():
                    markers.append(i)
        os.makedirs(os.path.join(out, "tiles"), exist_ok=True)
        Image.fromarray(img).save(os.path.join(out, "tiles", ts + ".png"), optimize=True)
        meta[ts] = {"tileW": af.TILE_W, "tileH": af.TILE_H, "cols": NEW_COLS, "count": n,
                    "width": img.shape[1], "height": img.shape[0], "solidTiles": solid, "markers": markers}
        print("tiles", ts, n, "tiles", img.shape, "solid:", [s[0] for s in solid][:12])
    write_json(os.path.join(out, "tiles", "tilesets.json"), meta)


# ---------------------------------------------------------------- maps

def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype="<u2").tobytes()).decode()


def read_map_records(disc):
    """AKUMA.EXE keeps one 92-byte record per map (file name, tileset, name, then ints). Ints 2 and 3 are the place's
    position on the 800x600 world pictures; the first 22 records are the real world, the rest the underworld."""
    import struct
    d = open(find(disc, "AKUMA.EXE"), "rb").read()
    a = d.find(b"a1.map\0", 0x95000)
    out = {}
    for n in range(len(MAPS)):
        r = d[a + n * 92: a + (n + 1) * 92]
        mid = r[0:16].split(b"\0")[0].decode()[:-4]
        f = struct.unpack_from("<7i", r, 64)
        out[mid] = {"wx": f[2], "wy": f[3], "world": 1 if n < 22 else 2}
    return out


def build_maps(disc, out):
    index = []
    recs = read_map_records(disc)
    for i, (mid, ts, name) in enumerate(MAPS):
        m = af.parse_map(open(find(disc, "MAP", mid + ".map"), "rb").read())
        # drop the unused right/bottom border: the game stores a fixed 128x128 buffer
        write_json(os.path.join(out, "maps", mid + ".json"), {
            "id": mid, "name": name, "tileset": ts, "w": m["w"], "h": m["h"],
            "ground": b64(m["ground"]), "objects": b64(m["objects"]),
            "trailer": base64.b64encode(m["trailer"]).decode(),
        })
        index.append({"id": mid, "name": name, "tileset": ts, "w": m["w"], "h": m["h"], "order": i, **recs[mid]})
    write_json(os.path.join(out, "maps", "index.json"), index)
    print("maps", len(index))


# ---------------------------------------------------------------- sprites

def pack_frames(frames, max_w=2048, max_h=4096):
    """Shelf packer. frames: list of (key, rgba array). Returns pages[(w,h,array)], placement{key:(page,x,y)}"""
    order = sorted(range(len(frames)), key=lambda i: -frames[i][1].shape[0])
    pages, place = [], {}
    cur = None  # [array rows list]
    x = y = shelf_h = 0
    page_items = []

    def flush():
        nonlocal page_items, x, y, shelf_h
        if not page_items:
            return
        H = max(16, y + shelf_h)
        atlas = np.zeros((H, max_w, 4), np.uint8)
        for key, arr, px, py in page_items:
            atlas[py:py + arr.shape[0], px:px + arr.shape[1]] = arr
            place[key] = (len(pages), px, py)
        pages.append(atlas)
        page_items = []
        x = y = shelf_h = 0

    for i in order:
        key, arr = frames[i]
        h, w = arr.shape[:2]
        if x + w + 1 > max_w:
            x, y, shelf_h = 0, y + shelf_h + 1, 0
        if y + h + 1 > max_h:
            flush()
        if h > shelf_h:
            shelf_h = h
        page_items.append((key, arr, x, y))
        x += w + 1
    flush()
    return pages, place


def trim(arr):
    a = arr[..., 3] > 0
    if not a.any():
        return None
    ys, xs = np.where(a)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return arr[y0:y1, x0:x1], int(x0), int(y0)


def build_sprites(disc, out, names):
    imgdir = find(disc, "IMG")
    if names == ["all"]:
        # skip LANG.GOS (a text file), DOS 8.3 aliases (~) and the RGB555 "...0" twins
        names = sorted(os.path.splitext(f)[0] for f in os.listdir(imgdir)
                       if f.upper().endswith(".GOS") and f.upper() != "LANG.GOS" and "~" not in f
                       and not os.path.splitext(f)[0].upper().endswith("0"))
    for name in names:
        path = find(imgdir, name + ".GOS")
        lead, recs = af.parse_gos(open(path, "rb").read())
        frames, meta_recs, keymap = [], [], {}
        for ri, rec in enumerate(recs):
            mr = {"w": rec.w, "h": rec.h, "hx": rec.hx, "hy": rec.hy, "frames": []}
            for fi in range(rec.count):
                rgba = af.decode_gos_frame(rec, fi, True)
                t = trim(rgba)
                if t is None:
                    mr["frames"].append(None)
                    continue
                arr, ox, oy = t
                key = (ri, fi)
                frames.append((key, arr))
                keymap[key] = (len(mr["frames"]), ox - rec.hx, oy - rec.hy, arr.shape[1], arr.shape[0])
                mr["frames"].append({"ox": ox - rec.hx, "oy": oy - rec.hy, "w": arr.shape[1], "h": arr.shape[0]})
            meta_recs.append(mr)
        pages, place = pack_frames(frames)
        for key, (pg, px, py) in place.items():
            ri, fi = key
            f = meta_recs[ri]["frames"][fi]
            f["page"], f["x"], f["y"] = pg, px, py
        sdir = os.path.join(out, "sprites")
        os.makedirs(sdir, exist_ok=True)
        files = []
        for pi, atlas in enumerate(pages):
            fn = "%s.%d.png" % (name.lower(), pi) if len(pages) > 1 else name.lower() + ".png"
            Image.fromarray(atlas).save(os.path.join(sdir, fn), optimize=True)
            files.append({"file": fn, "w": atlas.shape[1], "h": atlas.shape[0]})
        write_json(os.path.join(sdir, name.lower() + ".json"), {"name": name, "pages": files, "records": meta_recs})
        print("sprites", name, "records", len(recs), "frames", len(frames), "pages", [(p.shape[1], p.shape[0]) for p in pages])


# ---------------------------------------------------------------- images / scripts / audio / video

def build_images(disc, out):
    imgdir = find(disc, "IMG")
    odir = os.path.join(out, "images")
    os.makedirs(odir, exist_ok=True)
    for f in sorted(os.listdir(imgdir)):
        base, ext = os.path.splitext(f)
        p = os.path.join(imgdir, f)
        ext = ext.upper()
        if ext in (".BMP", ".PCX"):
            im = Image.open(p).convert("RGB")
            im.save(os.path.join(odir, base.lower() + ".webp"), quality=88)
        elif ext == ".SF6":  # 565 twin of the 555 .SF5; keep one copy
            im = Image.fromarray(af.parse_sf(open(p, "rb").read(), True))
            im.save(os.path.join(odir, base.lower() + ".webp"), quality=88)
    print("images", sorted(os.listdir(odir)))


def build_lang(disc, out):
    """IMG/LANG.GOS is the game's English string table (cp949 text, CRLF). Index meaning was worked out from the
    scripts: kind k of LOCATE_ENEMY is monster name k (1-based); consumable item id i -> line 2*i-165 (+ effect line);
    quest item id i -> line i+29; magic k -> line 205+2(k-1); weapon ids are category base + position."""
    path = find(disc, "IMG", "LANG.GOS")
    t = open(path, "rb").read().decode("cp949").split("\r\n")
    monsters = t[77:137]
    maps = t[487:529]
    magic = {k: {"name": t[205 + 2 * (k - 1)], "desc": t[206 + 2 * (k - 1)]} for k in range(1, 13)}
    items = {}
    for i in range(151, 197):
        items[i] = {"name": t[2 * i - 165], "desc": t[2 * i - 164]}
    for i in range(200, 255):
        items[i] = {"name": t[i + 29], "desc": ""}
    # equipment: (category, first line, last line, id base, "stat lines are parenthesised" vs strict name/stat pairs)
    cats = [("sword", 284, 341, 1, "paren"), ("bow", 342, 368, 41, "paren"), ("shield", 369, 386, 61, "paren"),
            ("cap", 387, 397, 71, "paren"), ("armor", 398, 414, 81, "paren"), ("shoes", 415, 434, 101, "pair"),
            ("ring", 435, 462, 111, "pair"), ("necklace", 463, 486, 131, "pair")]
    weapons = {}
    counts = {}
    for cat, a, b, base, mode in cats:
        entries = []
        for ln in range(a, b + 1):
            line = t[ln]
            if mode == "pair":
                if (ln - a) % 2 == 0:
                    entries.append({"name": line, "stats": ""})
                else:
                    entries[-1]["stats"] = line.strip("()")
            elif line.startswith("("):
                entries[-1]["stats"] = line.strip("()")
            else:
                entries.append({"name": line, "stats": ""})
        counts[cat] = len(entries)
        for k, e in enumerate(entries):
            weapons[base + k] = dict(e, category=cat)
    ui = t[:77]
    write_json(os.path.join(out, "text", "lang.json"),
               {"ui": ui, "monsters": monsters, "maps": maps, "magic": magic, "items": items, "weapons": weapons})
    print("lang: monsters", len(monsters), "items", len(items), "weapons", counts)


def build_scripts(disc, out):
    odir = os.path.join(out, "scripts")
    os.makedirs(odir, exist_ok=True)
    for f in sorted(os.listdir(disc)):
        if f.upper().endswith(".EVT"):
            text = open(os.path.join(disc, f), "rb").read().decode("cp949", errors="replace")
            text = text.replace("\r\n", "\n")
            with open(os.path.join(odir, f.lower()), "w", encoding="utf-8") as fh:
                fh.write(text)
    print("scripts", sorted(os.listdir(odir)))


def build_audio(disc, out):
    odir = os.path.join(out, "sfx")
    os.makedirs(odir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(find(disc, "WAV"))):
        if f.lower().endswith(".wav"):
            data = open(os.path.join(find(disc, "WAV"), f), "rb").read()
            open(os.path.join(odir, f.lower()), "wb").write(data)
            n += 1
    print("sfx", n)


def parse_cue(cue_path):
    tracks, cur = [], None
    for line in open(cue_path):
        t = line.split()
        if not t:
            continue
        if t[0] == "TRACK":
            cur = {"num": int(t[1]), "type": t[2]}
            tracks.append(cur)
        elif t[0] == "INDEX" and t[1] == "01":
            m, s, f = map(int, t[2].split(":"))
            cur["lba"] = (m * 60 + s) * 75 + f
    return tracks


def build_cdaudio(binpath, out):
    cue = os.path.splitext(binpath)[0] + ".cue"
    tracks = parse_cue(cue)
    size = os.path.getsize(binpath)
    total = size // 2352
    odir = os.path.join(out, "music")
    os.makedirs(odir, exist_ok=True)
    with open(binpath, "rb") as fh:
        for i, t in enumerate(tracks):
            if t["type"] != "AUDIO":
                continue
            end = tracks[i + 1]["lba"] if i + 1 < len(tracks) else total
            fh.seek(t["lba"] * 2352)
            pcm = fh.read((end - t["lba"]) * 2352)
            dst = os.path.join(odir, "track%02d.ogg" % t["num"])
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "-",
                            "-c:a", "libvorbis", "-q:a", "0", dst], input=pcm, check=True)
            print("music", dst, "%.1fs" % (len(pcm) / 4 / 44100), os.path.getsize(dst) // 1024, "KB")


def build_video(disc, out):
    odir = os.path.join(out, "video")
    os.makedirs(odir, exist_ok=True)
    for f in sorted(os.listdir(find(disc, "IMG"))):
        if f.upper().endswith(".AVI"):
            dst = os.path.join(odir, os.path.splitext(f)[0].lower() + ".mp4")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(find(disc, "IMG"), f),
                            "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                            "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", dst], check=True)
            print("video", dst, os.path.getsize(dst) // 1024, "KB")


# groups of WEAPONL.HTM in document order -> item ids (same order as LANG.GOS: normal items first, then event-only ones)
STAT_GROUPS = [
    list(range(1, 21)), list(range(21, 34)),          # swords: shop / event
    list(range(41, 52)), list(range(52, 57)),         # bows
    list(range(61, 67)), list(range(67, 70)),         # shields
    list(range(71, 76)), list(range(76, 78)),         # caps
    list(range(81, 89)), list(range(89, 92)),         # armor
    list(range(101, 108)), list(range(108, 111)),     # shoes
    list(range(111, 125)),                            # rings (no price in the manual)
    list(range(131, 143)),                            # necklaces
    list(range(151, 161)),                            # effect items
    list(range(161, 169)),                            # recovery items
    list(range(169, 174)) + list(range(178, 184)),    # drugs and scrolls
    list(range(174, 178)),                            # ice ball, fire ball, gate jewel, holy eye
    list(range(184, 197)),                            # spells (Seal magic first): mana cost
]
STAT_COLUMNS = {"attack": "atk", "a. speed": "aspeed", "a.speed": "aspeed", "life": "life", "defense": "def",
                "expense": "price", "weight": "weight", "effect range": "range", "distance": "range", "mana": "mana"}


def build_stats(disc, out):
    """MANUAL/WEAPONL.HTM (the printed manual's item list) holds prices and stats: attack, attack speed, durability
    ('life'), defense, bow range, weight, shop price, spell mana cost. Rows are matched to item ids by order."""
    import re
    path = find(disc, "MANUAL", "WEAPONL.HTM")
    t = open(path, "rb").read().decode("cp949", "replace")
    t = re.sub(r"<(script|style).*?</\\1>", "", t, flags=re.S | re.I)
    groups, header = [], None
    for tr in re.findall(r"<tr.*?</tr>", t, flags=re.S | re.I):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ")).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
        if not any(cells):
            continue
        if cells[0].lower() in ("items", "item"):
            header = [c.lower() for c in cells]
            groups.append([])
        elif header and groups and len(cells) == len(header):
            groups[-1].append(dict(zip(header, cells)))
    if [len(g) for g in groups] != [len(g) for g in STAT_GROUPS]:
        raise SystemExit("WEAPONL.HTM layout changed: %s" % [len(g) for g in groups])
    stats = {}
    for ids, rows in zip(STAT_GROUPS, groups):
        for i, row in zip(ids, rows):
            e = {}
            for col, val in row.items():
                num = re.sub(r"[^0-9-]", "", val.replace("+ ", "+"))
                key = STAT_COLUMNS.get(col)
                if key and num not in ("", "-"):
                    e[key] = int(num)
                elif col.startswith("special") and val:
                    e["special"] = val
                elif col in ("effect", "explain") and val:
                    e["effect"] = val
            stats[i] = e
    os.makedirs(os.path.join(out, "text"), exist_ok=True)
    with open(os.path.join(out, "text", "itemstats.json"), "w") as f:
        json.dump(stats, f, indent=0, sort_keys=True)
    print("stats", len(stats), "items,", sum(1 for e in stats.values() if "price" in e), "with prices")


def build_monsters(disc, out):
    """AKUMA.EXE .data holds the monster table: 59 records of 52 bytes from the first record "Measel":
    [id u8][family u8] name[20] hp u16, then bytes b0..b9 (b0 attack, b1 defense, b3 move speed look right from the
    pattern across monsters; b2 b4 b5 b6 b7 are unexplained and kept raw), then u16 sound ids. Record i belongs to
    LOCATE_ENEMY kind i+2 (the LANG.GOS list has an extra "Hooks" first), so kind 1 has no record."""
    import struct
    d = open(find(disc, "AKUMA.EXE"), "rb").read()
    first = d.find(b"Measel", 0x8E000) - 2
    lang = json.load(open(os.path.join(out, "text", "lang.json")))["monsters"]
    table = {}
    for n in range(59):
        r = d[first + n * 52: first + (n + 1) * 52]
        name = r[2:22].split(b"\0")[0].decode("latin1")
        kind = n + 2
        if lang[kind - 1] != name and (kind, name) not in ((15, "Two head demon"), (49, "Cyclop")):
            raise SystemExit("monster table misaligned at kind %d: %r vs %r" % (kind, lang[kind - 1], name))
        table[kind] = {
            "name": name, "hp": struct.unpack_from("<H", r, 22)[0], "atk": r[24], "def": r[25], "speed": r[27],
            "raw": list(r[24:34]), "sfx": [v for v in struct.unpack_from("<5H", r, 38)],
        }
    with open(os.path.join(out, "text", "monsters.json"), "w") as f:
        json.dump(table, f, sort_keys=True)
    print("monsters", len(table), "records")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--disc", required=True)
    ap.add_argument("--bin")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "assets"))
    ap.add_argument("--only", default="tiles,maps,sprites,images,audio,scripts,lang,stats,monsters")
    ap.add_argument("--sprites", default=",".join(DEFAULT_SPRITES))
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    todo = a.only.split(",")
    if "tiles" in todo: build_tiles(a.disc, out)
    if "maps" in todo: build_maps(a.disc, out)
    if "sprites" in todo: build_sprites(a.disc, out, a.sprites.split(","))
    if "images" in todo: build_images(a.disc, out)
    if "audio" in todo: build_audio(a.disc, out)
    if "scripts" in todo: build_scripts(a.disc, out)
    if "lang" in todo: build_lang(a.disc, out)
    if "stats" in todo: build_stats(a.disc, out)
    if "monsters" in todo: build_monsters(a.disc, out)
    if "cdaudio" in todo: build_cdaudio(a.bin, out)
    if "video" in todo: build_video(a.disc, out)


if __name__ == "__main__":
    main()
